/**
 * Render authored lexicon entries the way a learner meets them.
 *
 * Written after a batch of 142 hand-repaired Catalan entries went in with
 * `registre` glossed as a verb. Every mechanical gate passed it: the charset
 * was right, the example contained the headword, the paradigm was the right
 * size. What no gate could see is that a card reading
 *
 *     registre        verb        record, register
 *
 * is obviously wrong to anyone who reads it, in any language. The defect was
 * not subtle - it was simply never *looked at*, because the work happened in a
 * 1.8 MB JSON diff where nothing is legible.
 *
 * So this prints a batch as cards. Reading twenty takes about a minute and
 * catches the class of error that costs the most: the kind a reviewer spots
 * instantly and a validator cannot express.
 *
 * Usage:
 *   node scripts/review-batch.ts --lang ca --repairs scripts/data/ca-gloss-repairs.json
 *   node scripts/review-batch.ts --lang ca --new scripts/data/new-ca-beginner.json
 *   node scripts/review-batch.ts --lang ca --ids lx-4222,lx-4105
 *   node scripts/review-batch.ts --lang ca --rank-max 700 --sample 20
 *
 * `--new` reads an authored file in `add-lexicon-entries.ts` format, so a batch
 * can be read *before* it is written. Without it the only way to see the cards
 * was to apply first and review after, which inverts the order the whole point
 * of this script depends on.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CONTENT_FORMAT_VERSION,
  lexiconFileSchema,
  levelsFileSchema,
  textDocumentSchema,
  type LexiconEntry,
  type TextDocument,
} from "../src/lib/content/schema.ts";
import { isRuledOut, isTeachable } from "../src/lib/content/teachability.ts";
import { levelVocabulary } from "../src/lib/content/level-vocabulary.ts";
import { contentRoot, targetLang } from "./content-path.ts";
import { readSpec } from "./verify-beginner-core.ts";
import type { SeedTextSource } from "./data/seed-text-source.ts";

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at !== -1 ? process.argv[at + 1] : undefined;
}

const lang = targetLang();
const entries = lexiconFileSchema.parse(
  JSON.parse(readFileSync(join(contentRoot(), "lexicon", "lexicon.json"), "utf8")),
).entries;

// --- text review ---------------------------------------------------------------
//
// `--texts <file>` renders a staged `SeedTextSource[]` batch as learner-facing
// cards, the way the rest of this file already does for lexicon entries - see
// the file header. Before this there was no way to review a drafted text
// before it landed in `scripts/data/seed-texts-<lang>.ts`, which is exactly
// the step CLAUDE.md's authoring process depends on ("author into a reviewed
// file, never straight into the content JSON").

/**
 * Content words - the same split `word-selection.ts` and `schedule.ts` use.
 * Declared here, not next to `renderTexts` below, because the `await
 * renderTexts(...)` a few lines down is a *top-level* await: it suspends the
 * rest of this module's top-level evaluation until it settles, so a `const`
 * declared later in the file - however clearly it reads next to the function
 * that uses it - is never initialized in time and throws
 * "Cannot access 'CONTENT_POS' before initialization" the first time a
 * reused (not newly-introduced) word needs it. Reproduced with a 3-text batch
 * where the third text reused the first's vocabulary - the two-text batch
 * that motivated this script never exercised the reuse path and shipped the
 * bug unnoticed.
 */
const CONTENT_POS = new Set(["noun", "verb", "adjective", "adverb"]);

const textsPath = arg("texts");
if (textsPath) {
  await renderTexts(lang, textsPath, entries);
  process.exit(0);
}

// --- which entries -----------------------------------------------------------

let selected: LexiconEntry[];
const repairsPath = arg("repairs");
const newPath = arg("new");
const ids = arg("ids");
const rankMax = arg("rank-max");

if (newPath) {
  // Not yet in the lexicon, so rank and band do not exist yet; everything a
  // reviewer actually judges - headword, part of speech, gloss, example - does.
  selected = (JSON.parse(readFileSync(newPath, "utf8")) as Partial<LexiconEntry>[]).map(
    (a, i) =>
      ({
        ...a,
        id: `new-${i}`,
        targetNormalized: a.target ?? "",
        freqRank: 0,
        freqBand: 0,
        variants: a.variants ?? [],
        tags: a.tags ?? [],
      }) as LexiconEntry,
  );
} else if (repairsPath) {
  const repairs: Record<string, { pos?: string; drop?: string }> = JSON.parse(
    readFileSync(repairsPath, "utf8"),
  );
  // Only the entries that were authored as real words; the ruled-out ones are a
  // decision, and they are listed separately at the end.
  const authored = new Set(Object.keys(repairs).filter((k) => repairs[k].pos));
  selected = entries.filter((e) => authored.has(e.id));
} else if (ids) {
  const wanted = new Set(ids.split(",").map((s) => s.trim()));
  selected = entries.filter((e) => wanted.has(e.id));
} else if (rankMax) {
  selected = entries.filter((e) => e.freqRank <= Number(rankMax));
} else {
  selected = entries;
}

selected = selected.filter((e) => !isRuledOut(e)).sort((a, b) => a.freqRank - b.freqRank);

const sample = arg("sample");
if (sample) {
  // Evenly spaced rather than random, so a run is reproducible and the sample
  // spans the whole frequency range instead of clustering.
  const step = Math.max(1, Math.floor(selected.length / Number(sample)));
  selected = selected.filter((_, i) => i % step === 0).slice(0, Number(sample));
}

// --- render ------------------------------------------------------------------

const TRANSLITERATED = lang !== "ca";

console.log(`${selected.length} entries, ${lang}\n`);

for (const e of selected) {
  const head = TRANSLITERATED && e.translit ? `${e.target}  (${e.translit})` : e.target;
  console.log(`  ${head}`);
  console.log(`  ${" ".repeat(0)}${e.pos.padEnd(12)} rank ${e.freqRank}   band ${e.freqBand}   ${e.register}`);
  console.log(`  ${e.glossEn}`);
  if (e.exampleTarget) {
    console.log(`    ${e.exampleTarget}`);
    if (TRANSLITERATED && e.exampleTranslit) console.log(`    ${e.exampleTranslit}`);
    console.log(`    ${e.exampleEn ?? ""}`);
  }
  if (e.variants.length) console.log(`    variants: ${e.variants.join(", ")}`);
  console.log();
}

// --- the shape of the batch, which is where a wrong label stands out ---------

const byPos = new Map<string, number>();
for (const e of selected) byPos.set(e.pos, (byPos.get(e.pos) ?? 0) + 1);

console.log("part of speech:");
for (const [pos, n] of [...byPos.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pos.padEnd(12)} ${String(n).padStart(4)}`);
}

/**
 * Endings that usually indicate a part of speech, as a prompt to look rather
 * than a rule to enforce. Catalan is full of counter-examples - `pare` and
 * `carrer` are nouns that look like infinitives - so this only ever asks a
 * question. The one time it is silent and wrong costs nothing; the one time it
 * asks and is right saves a shipped defect.
 */
if (lang === "ca") {
  const suspicious = selected.filter((e) => {
    const t = e.target;
    if (e.pos !== "verb" && /(ar|ir)$/.test(t) && /^to\s/i.test(e.glossEn)) return true;
    if (e.pos === "verb" && !/(ar|er|re|ir)$/.test(t)) return true;
    if (e.pos !== "verb" && /^to\s/i.test(e.glossEn)) return true;
    if (e.pos === "noun" && /(ment|íssim)$/.test(t)) return true;
    return false;
  });
  if (suspicious.length) {
    console.log("\nworth a second look:");
    for (const e of suspicious) {
      console.log(`  ${e.target} [${e.pos}] - ${e.glossEn}`);
    }
  }
}

// ---------------------------------------------------------------------------
// --texts <file>
// ---------------------------------------------------------------------------

async function renderTexts(lang: string, textsPath: string, entries: LexiconEntry[]): Promise<void> {
  // `src/lib/content/text-checks.ts` resolves its `profile` singleton
  // (`src/lib/lang/index.ts`) from `NEXT_PUBLIC_TARGET_LANG` the moment that
  // module is first evaluated. Nothing else in this file imports it
  // statically, and the assignment below has to run *before* that first
  // evaluation - a static import anywhere in this file would hoist ahead of
  // it and lock in whichever language the ambient env var named (or the
  // "prs" default) regardless of this script's own `--lang`. That is the
  // same "content/active is one shared symlink" class of bug CLAUDE.md warns
  // about, one level up the import graph, which is why both modules below are
  // dynamic imports rather than static ones.
  process.env.NEXT_PUBLIC_TARGET_LANG = lang;
  const [{ PROFILES }, checks] = await Promise.all([
    import("../src/lib/lang/index.ts"),
    import("../src/lib/content/text-checks.ts"),
  ]);
  const { checkShape, checkCoverage, checkTeaching, checkGloss, checkInterference, checkCohesion } = checks;

  const langProfile = PROFILES[lang as keyof typeof PROFILES];
  if (!langProfile) throw new Error(`No language profile for "${lang}"`);
  const { buildIndex, tokenize } = langProfile.text;
  const index = buildIndex(entries);
  const byId = new Map(entries.map((e) => [e.id, e]));

  const levelsData = levelsFileSchema.parse(
    JSON.parse(readFileSync(join(contentRoot(), "levels", "levels.json"), "utf8")),
  ).levels;
  const levelById = new Map(levelsData.map((l) => [l.id, l]));

  /**
   * Closed-class words are absorbed, not taught (PEDAGOGY §5), so they never
   * count as a `newWords` word. Read straight from `beginner-spec.json` via
   * `readSpec`/`contentRoot()` - deliberately NOT `beginner-spec.ts`'s
   * `closedClassOf`, which resolves through `content/load.ts`'s `@content`
   * import and is unavailable to a plain `node` script. Mirrors
   * `build-seed-texts.ts`'s own resolution exactly, including the
   * multi-word-entry handling ("چه وقت", "des de").
   */
  function resolveClosedWord(word: string): string[] {
    const direct = index.resolve(word);
    if (direct) return [direct.id];
    const parts = word.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return [];
    const resolved = parts.map((p) => index.resolve(p));
    if (resolved.some((e) => !e)) return [];
    return resolved.map((e) => e!.id);
  }

  const spec = readSpec(contentRoot());
  const closedClassIds = new Set<string>();
  const fieldNames = new Set<string>();
  if (spec) {
    for (const word of Object.values(spec.closedClasses).flat()) {
      for (const id of resolveClosedWord(word)) closedClassIds.add(id);
    }
    for (const field of Object.keys(spec.semanticFields)) fieldNames.add(field);
  }

  const sources = JSON.parse(readFileSync(textsPath, "utf8")) as SeedTextSource[];

  // Curriculum order, same rule as build-seed-texts.ts: a text's `newWords` is
  // measured against what came before it *within its own level in this
  // draft*, not the whole existing corpus - a batch under review is a
  // continuation of one level, and its own internal order is what a reviewer
  // needs to judge.
  const byLevel = new Map<string, SeedTextSource[]>();
  for (const s of sources) {
    const list = byLevel.get(s.level) ?? [];
    list.push(s);
    byLevel.set(s.level, list);
  }

  interface Rendered {
    source: SeedTextSource;
    doc: TextDocument;
    /** Computed newWords, when they disagree with a declared `introduces`. */
    declaredMismatch: string[] | null;
    unresolved: string[];
  }
  const rendered: Rendered[] = [];

  for (const levelSources of byLevel.values()) {
    const ordered = [...levelSources].sort((a, b) => a.seq - b.seq);
    const introduced = new Set(closedClassIds);

    for (const source of ordered) {
      const vocab = new Set<string>();
      const unresolved: string[] = [];
      const sentences = source.sentences.map((s) => {
        const tokens = tokenize(s.target).map((surface) => {
          const entry = index.resolve(surface);
          if (entry) vocab.add(entry.id);
          else unresolved.push(surface);
          return { surface, lexemeId: entry?.id ?? null };
        });
        return { ...s, tokens };
      });

      const newWords = [...vocab].filter((id) => !introduced.has(id)).sort();
      let declaredMismatch: string[] | null = null;
      if (source.introduces) {
        const declared = [...source.introduces].sort();
        if (declared.join(",") !== newWords.join(",")) declaredMismatch = newWords;
      }
      for (const id of vocab) introduced.add(id);

      const doc: TextDocument = {
        id: `tx-draft-${source.slug}`,
        formatVersion: CONTENT_FORMAT_VERSION,
        level: source.level,
        titleTarget: source.titleTarget,
        titleTranslit: source.titleTranslit,
        titleEn: source.titleEn,
        sentences,
        vocabUsed: [...vocab].sort(),
        newWords,
        newWordRatio: 0,
        source: "seed",
        createdAt: new Date().toISOString(),
        seq: source.seq,
      };
      textDocumentSchema.parse(doc);
      rendered.push({ source, doc, declaredMismatch, unresolved });
    }
  }

  console.log(`${rendered.length} texts, ${lang}\n`);

  let rejectCount = 0;
  let flagCount = 0;

  for (const { source, doc, declaredMismatch, unresolved } of rendered) {
    const level = levelById.get(source.level);

    // Best-effort scene label: which of beginner-spec's semantic fields the
    // introduced words' own lexicon tags agree on most. A hint, not a check -
    // the lexicon's free-form `tags` and the spec's canonical field names can
    // drift (`"Travel & Transportation"` on an entry vs the spec's
    // `"Travel & Transport"`), so a text with real, correctly-scoped
    // vocabulary can still come back `(unclassified)`.
    const introducedWords = doc.newWords.map((id) => byId.get(id)).filter((e): e is LexiconEntry => !!e);
    const fieldVotes = new Map<string, number>();
    for (const w of introducedWords) {
      for (const tag of w.tags) {
        if (fieldNames.has(tag)) fieldVotes.set(tag, (fieldVotes.get(tag) ?? 0) + 1);
      }
    }
    const scene = [...fieldVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    console.log(`[${source.slug}  seq ${source.seq}  scene ${scene ? `"${scene}"` : "(unclassified)"}]`);
    for (const s of doc.sentences) {
      console.log(`  ${s.target}`);
      if (langProfile.capabilities.transliteration && s.translit) console.log(`  ${s.translit}`);
      console.log(`  ${s.en}`);
    }

    const introducesLabel = introducedWords.map((w) => `${w.target} (${w.glossEn})`).join(", ");
    console.log(`  introduces: ${introducesLabel || "(none)"}`);

    const reuseWords = doc.vocabUsed
      .filter((id) => !doc.newWords.includes(id) && !closedClassIds.has(id))
      .map((id) => byId.get(id))
      .filter((e): e is LexiconEntry => !!e && CONTENT_POS.has(e.pos));
    console.log(`  reuses:     ${reuseWords.map((w) => w.target).join(", ") || "(none)"}`);

    if (unresolved.length) {
      rejectCount++;
      console.log(`  ✗ unresolved word(s): ${unresolved.join(", ")} - build:texts will fail on these`);
    }
    if (declaredMismatch) {
      rejectCount++;
      console.log(
        `  ✗ declared introduces does not match computed newWords: [${declaredMismatch.join(", ")}]`,
      );
    }

    if (level) {
      const allowed = new Set([
        ...levelVocabulary(level, entries, isTeachable).map((e) => e.id),
        ...closedClassIds,
        ...doc.newWords,
      ]);
      const defects = [
        ...checkShape(doc, level, 0),
        ...checkCoverage(doc, level, allowed),
        ...checkTeaching(doc, doc.newWords),
        ...checkGloss(doc),
        ...checkInterference(doc),
        ...checkCohesion(doc),
      ];
      for (const d of defects) {
        if (d.severity === "reject") rejectCount++;
        else flagCount++;
        console.log(`  ${d.severity === "reject" ? "✗" : "⚠"} ${d.kind}: ${d.message}`);
      }
    } else {
      console.log(`  ⚠ unknown level "${source.level}" in levels.json - gates skipped`);
    }

    console.log();
  }

  // --- the shape of the batch ------------------------------------------------

  const byPos = new Map<string, number>();
  for (const { doc } of rendered) {
    for (const id of doc.newWords) {
      const e = byId.get(id);
      if (e) byPos.set(e.pos, (byPos.get(e.pos) ?? 0) + 1);
    }
  }
  console.log("new words by part of speech:");
  for (const [pos, n] of [...byPos.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pos.padEnd(12)} ${String(n).padStart(4)}`);
  }
  console.log(`\n${rejectCount} reject-level defect(s), ${flagCount} flagged for review`);
}
