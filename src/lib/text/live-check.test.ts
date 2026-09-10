import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { REGISTERED_LANGS, profile } from "../lang/index.ts";
import { checkDraft } from "./live-check.ts";

/**
 * The composer's free checks, which run on every keystroke and never call a
 * provider.
 *
 * The failure that matters here is the false positive, not the miss. A hint on
 * correct writing teaches the learner that the hints mean nothing, and after
 * that the true ones are wasted too - so the assertions below lean on "stays
 * quiet when the Catalan/Dari is right" at least as hard as on catching things.
 */

const isDari = profile.code === "prs";

describe("checkDraft", () => {
  it("says nothing about an empty or whitespace draft", () => {
    expect(checkDraft("")).toEqual([]);
    expect(checkDraft("   ")).toEqual([]);
  });

  it("catches the language next door and names the fix", () => {
    // Both are real words in the neighbouring language, so only the rule table
    // can tell them apart - the lexicon check alone would just say "unknown".
    const draft = isDari ? "مه به مدرسه میروم" : "hi han moltes coses";
    const hints = checkDraft(draft);

    const rule = hints.find((h) => h.kind === "interference");
    expect(rule).toBeDefined();
    expect(rule!.suggestion).toBe(isDari ? "مکتب" : "hi ha");
    expect(rule!.whyEn.length).toBeGreaterThan(10);
  });

  it("matches inflected variants of a rule but labels them with the canonical form", () => {
    if (isDari) return; // `alsoMatch` is a Catalan-only concern so far.
    const hints = checkDraft("tens que anar");
    const rule = hints.find((h) => h.kind === "interference");
    expect(rule?.suggestion).toBe("he de");
  });

  it("does not fire a rule inside a longer word", () => {
    // "lo" is a rule in Catalan; "los"/"color" must not trip it.
    const draft = isDari ? "کتاب" : "el color és bonic";
    expect(checkDraft(draft).some((h) => h.kind === "interference")).toBe(false);
  });

  it("flags a word that is not a word", () => {
    const hints = checkDraft(isDari ? "قققققق" : "zzzqqq");
    expect(hints.some((h) => h.kind === "unknown")).toBe(true);
    expect(hints[0].suggestion).toBeNull();
  });

  it("stays quiet on correct, ordinary writing", () => {
    // The sample sentence each profile ships is by definition good target text.
    expect(checkDraft(profile.samples.sentence.target)).toEqual([]);
    for (const starter of profile.samples.starters) {
      // Starters are tappable as the learner's first message; flagging one
      // would mean the app contradicts its own suggestion.
      const hints = checkDraft(starter.target.replace(/\.\.\./g, ""));
      expect(hints, `starter "${starter.target}"`).toEqual([]);
    }
  });

  it("reports an interference hit once, not also as an unknown word", () => {
    const draft = isDari ? "مدرسه" : "hi han";
    const hints = checkDraft(draft);
    expect(hints).toHaveLength(1);
    expect(hints[0].kind).toBe("interference");
  });

  it("never returns more than three hints", () => {
    const nonsense = (isDari ? "ققق ضضض ثثث سسس ببب" : "zzz qqq xxx vvv www");
    expect(checkDraft(nonsense).length).toBeLessThanOrEqual(3);
  });

  it("every shipped rule is matched by its own wrong form", () => {
    // A rule whose `wrong` does not survive tokenize+matchKey is dead weight
    // that nobody would notice, since the check simply stays silent.
    for (const rule of profile.prompts.interferenceRules) {
      const hints = checkDraft(rule.wrong);
      expect(
        hints.some((h) => h.kind === "interference" && h.suggestion === rule.right),
        `rule "${rule.wrong}" never fires`,
      ).toBe(true);
    }
  });

  it("every shipped rule suggests something different from the mistake", () => {
    for (const rule of profile.prompts.interferenceRules) {
      expect(rule.right, `rule "${rule.wrong}"`).not.toBe(rule.wrong);
      expect(rule.whyEn.length, `rule "${rule.wrong}"`).toBeGreaterThan(10);
    }
  });
});

/**
 * The false-positive budget, measured against real content rather than assumed.
 *
 * Every seed sentence is correct target language by construction - a
 * philologist has been over them and `validate:content` gates them. So an
 * interference rule firing on one is not a finding about the content, it is a
 * bug in the rule, and it would fire on the learner's correct writing too.
 *
 * Zero is the right budget here, unlike the unknown-token side, where
 * `corpus.test.ts` already documents a small tail of genuine out-of-lexicon
 * vocabulary.
 */
describe("interference rules against shipped content", () => {
  const LANG = process.env.NEXT_PUBLIC_TARGET_LANG || REGISTERED_LANGS[0];
  const SEED = join(import.meta.dirname, "..", "..", "..", "content", LANG, "texts", "seed");

  function seedSentences(): string[] {
    const out: string[] = [];
    for (const file of readdirSync(SEED).filter((f) => f.endsWith(".json"))) {
      const doc = JSON.parse(readFileSync(join(SEED, file), "utf8"));
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== "object") return;
        for (const [key, value] of Object.entries(node)) {
          if (typeof value === "string") {
            if (key === "target") out.push(value);
          } else walk(value);
        }
      };
      walk(doc);
    }
    return out;
  }

  it("never fires on a seed sentence", () => {
    const sentences = seedSentences();
    // If this is empty the test is asserting nothing, which is the failure mode
    // a corpus test has to rule out first.
    expect(sentences.length).toBeGreaterThan(50);

    const misfires = sentences
      .map((s) => ({ s, hits: checkDraft(s).filter((h) => h.kind === "interference") }))
      .filter((r) => r.hits.length > 0)
      .map((r) => `${r.hits.map((h) => h.found).join("/")} in "${r.s}"`);

    expect(misfires).toEqual([]);
  });
});
