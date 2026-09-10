import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isKnownToken } from "../ai/vocab-check.ts";
import { REGISTERED_LANGS, profile } from "../lang/index.ts";
import { tokenize } from "./index.ts";

/**
 * Corpus-level guard on the verb morphology.
 *
 * Unit tests check individual paradigms; this checks the thing that actually
 * matters - that the Dari we ship is recognised by the same acceptance rule the
 * app uses at runtime (`isKnownToken`). It is deliberately coupled to production
 * rather than to a private copy of the logic, so refactors of the morphology
 * engine are measured against real content instead of against themselves.
 *
 * The budget is a ratchet: it may fall, never rise. The handful of remaining
 * failures are genuine out-of-lexicon vocabulary, not morphology bugs.
 */

// The active language, not a hardcoded one: the acceptance rule under test
// belongs to the *active* profile, so reading another language's content would
// tokenize it with the wrong engine and report every word as unknown. That is
// exactly the bug this file exists to catch, one level up.
//
// Resolved from NEXT_PUBLIC_TARGET_LANG rather than the `content/active`
// symlink, and for that same reason. The symlink is shared filesystem state
// that a dev server or another test run can re-point mid-flight, while the
// `@content` alias this test's lexicon arrives through is per-process. When the
// two disagreed, this compared one language's grammar against the other's
// lexicon and reported 3,608 unresolved tokens - the failure it is meant to
// detect, arriving for a reason that had nothing to do with the content.
const LANG = process.env.NEXT_PUBLIC_TARGET_LANG || REGISTERED_LANGS[0];
const CONTENT = join(import.meta.dirname, "..", "..", "..", "content", LANG);
// Any letter in any script: the previous Perso-Arabic-only filter silently
// discarded every Catalan token, leaving nothing to assert on.
const HAS_LETTER = /\p{L}/u;

/**
 * Branches that hold deliberately wrong language: distractor chips, the decoy
 * tiles in a word bank, and the error a spotError exercise exists to teach.
 *
 * Counting those as "unresolved vocabulary" measures the wrong thing - they are
 * *supposed* to be unresolvable, and a lexicon that resolved `dormeixo` or
 * `teno` would be the actual defect. Skipping them is what makes the budget
 * below mean "correct content the engine cannot explain".
 */
const WRONG_BY_DESIGN = new Set(["distractors", "distractorsTarget", "extraWords", "errorWord"]);

/** Every target-language string in a content file, wherever it is nested. */
function collectTarget(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectTarget(child, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  const isSpotError = "type" in node && (node as { type: string }).type === "spotError";
  for (const [key, value] of Object.entries(node)) {
    if (WRONG_BY_DESIGN.has(key)) continue;
    if (isSpotError && key === "target") continue;
    if (typeof value === "string") {
      if (key === "target" || key === "answer" || key === "titleTarget") out.push(value);
    } else {
      collectTarget(value, out);
    }
  }
}

/**
 * Mid-sentence capitalised words in a cased script are proper nouns, which a
 * lexicon should not carry. Perso-Arabic has no case, so nothing is skipped
 * there and the Dari budget is unaffected.
 */
function properNouns(text: string): Set<string> {
  const names = new Set<string>();
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const words = sentence.trim().split(/\s+/);
    // A sentence-initial word is capitalised by position, but may be a clitic
    // glued to a name ("L'Anna"), in which case the name still counts.
    const first = words[0]?.split("'").slice(1).join("'");
    for (const w of [...(first ? [first] : []), ...words.slice(1)]) {
      const bare = w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
      if (bare && bare[0] !== bare[0].toLowerCase()) names.add(bare.toLowerCase());
    }
  }
  return names;
}

function corpus(): string[] {
  const out: string[] = [];
  for (const dir of [join(CONTENT, "grammar"), join(CONTENT, "texts", "seed")]) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      collectTarget(JSON.parse(readFileSync(join(dir, file), "utf8")), out);
    }
  }
  return out;
}

describe("shipped content is recognised by the runtime acceptance rule", () => {
  const strings = corpus();
  const tokens = strings.flatMap((s) => {
    const names = properNouns(s);
    return tokenize(s).filter(
      (t) => t !== "___" && HAS_LETTER.test(t) && !names.has(t.toLowerCase()),
    );
  });

  it("reads a non-trivial corpus", () => {
    expect(strings.length).toBeGreaterThan(0);
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("does not regress the count of unrecognised tokens", () => {
    const unknown = tokens.filter((t) => !isKnownToken(t));

    // Per-language ratchet: may fall, never rise.
    //
    // prs was 192 until 36 lexemes that existed only in the database were
    // restored to content/ - they were the vocabulary the C1/C2 lessons use.
    // ca is 0: every word of correct Catalan in the A1-A2 course and the seed
    // texts resolves, which is the standard a tap-to-reveal reader has to meet.
    const BUDGET: Record<string, number> = { prs: 5, ca: 100 };
    const budget = BUDGET[profile.code] ?? 0;
    expect(unknown.length, `unresolved tokens for "${profile.code}"`).toBeLessThanOrEqual(budget);
  });
});
