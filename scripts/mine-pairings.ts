/**
 * Mines noun+adjective and verb+object pairings actually attested in
 * target-language text, so a reviewer can ask "has anyone in what we have
 * ever put X next to Y?" before a sentence-frame generator ships a pairing
 * like "cold flower" or "warm river" - the failure documented in
 * `.claude/plans/i-want-you-to-warm-tiger.md`. Selectional restrictions are
 * lexical, not categorical, and cannot be derived - only checked against
 * evidence.
 *
 * ---------------------------------------------------------------------------
 * IMPORTANT: `scripts/data/corpus/*.txt` ARE NOT RUNNING TEXT.
 * ---------------------------------------------------------------------------
 *
 * The original plan for this script assumed the corpora `build-frequency.ts`
 * downloads (`ca-opensubtitles.txt`, `ca-wikipedia.txt`, `fa-opensubtitles.txt`,
 * `fa-wikipedia.txt`) could be mined for co-occurrence. Checked directly before
 * writing any of this:
 *
 *   $ head -3 scripts/data/corpus/ca-opensubtitles.txt
 *   que 100257
 *   no 94010
 *   de 89622
 *   $ head -3 scripts/data/corpus/ca-wikipedia.txt
 *   1	!	515
 *   2	"	30694
 *   4	$	3814
 *
 * Every line is `word count` (hermitdave) or `id\tword\tcount` (Leipzig) - a
 * word-frequency table, not a sentence. There is no adjacency, no order, no
 * sentence boundary: the information "did X ever appear near Y" was never
 * captured when these files were built, and cannot be recovered from them.
 * Mining co-occurrence from a frequency list is not a hard version of this
 * task, it is a different task this data cannot do. So this script does NOT
 * read `scripts/data/corpus/`, and does NOT import `readCorpus` from
 * `build-frequency.ts` - there is nothing in that file to reuse for this job.
 *
 * Per the fallback the plan named, this mines the largest genuinely
 * sentential in-language sources actually in the repo instead, most to least
 * trusted:
 *
 *  1. `content/<lang>/grammar/all.json` - hand-authored course examples and
 *     exercise sentences. 2,732 `target` strings in ca, 2,167 in prs (counted
 *     directly). The wrong-by-design `spotError` sentence is excluded per
 *     CLAUDE.md ("distractors, extraWords, and the sentence in a spotError
 *     exercise are wrong on purpose. Do not 'fix' them") - its
 *     `correctedTarget` is used instead, when the author supplied one.
 *  2. `scripts/data/seed-texts-<lang>.ts` - hand-authored reader texts. Small
 *     today (dozens per language); this is the pipeline the plan's step 6/7
 *     grows.
 *  3. `lexicon.json`'s `exampleTarget` field - 4,609 ca / 6,154 prs entries,
 *     ALL of them present. `expand-lexicon.ts` shows many were generated in
 *     bulk by an LLM, so a pairing attested only here is weak evidence - close
 *     to asking a model to confirm its own output - and is used last.
 *
 * Total input is on the order of ten thousand sentences per language, not the
 * ~1.1M/~1.65M running words the plan assumed before this was checked - two
 * to three orders of magnitude smaller. Stated here so nobody reads
 * `pairings-<lang>.tsv` as corpus-scale coverage: a real, everyday pairing
 * that never happened to land in a grammar example, a seed text, or a lexicon
 * example sentence will show 0 attestations. That means "not attested in what
 * we have", not "not Catalan/Dari". This output is a REVIEW FLAG, never a
 * hard gate, for exactly that reason.
 *
 * ---------------------------------------------------------------------------
 * The known trap (CLAUDE.md)
 * ---------------------------------------------------------------------------
 *
 * `LexiconIndex.resolve()` returns exactly one entry for a surface and cannot
 * report ambiguity. A true homograph - two lexicon entries spelled identically,
 * e.g. Dari شیر "milk"/"lion" - has every attestation of that surface credited
 * to whichever entry `resolve()` prefers (authored headword order: see
 * `buildLexiconIndex` in `src/lib/lang/{ca,prs}/lexicon-index.ts`), which is
 * exactly the shape of the `registre`/`registrar` incident: real evidence,
 * credited to the wrong word. This script cannot fix that - resolution has to
 * stay production-accurate, or the miner would stop measuring what a learner
 * actually gets shown. It can only surface it: `findHomographIds` groups
 * entries by identical `targetNormalized`, and every mined pair touching one
 * of those ids is printed as an "ambiguous" warning so a reviewer double-checks
 * it before trusting the count. The TSV itself carries no extra column for
 * this - the warning is the review flag.
 *
 * Usage:
 *   node scripts/mine-pairings.ts --lang ca
 *   node scripts/mine-pairings.ts --lang prs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  grammarCoursesFileSchema,
  lexiconFileSchema,
  type GrammarCoursesFile,
  type GrammarExercise,
  type LexiconEntry,
} from "../src/lib/content/schema.ts";
import { PROFILES, type TargetLang } from "../src/lib/lang/index.ts";
import type { LexiconIndex } from "../src/lib/lang/types.ts";
import { contentRoot, targetLang } from "./content-path.ts";
import type { SeedTextSource } from "./data/seed-text-source.ts";

// ---------------------------------------------------------------------------
// Sentence collection
// ---------------------------------------------------------------------------

/**
 * Real target-language sentences (or short phrases) an exercise contributes.
 * `spotError.target` is deliberately excluded - see the file header.
 */
function sentencesFromExercise(ex: GrammarExercise): string[] {
  switch (ex.type) {
    case "fillBlank":
      return [ex.target];
    case "buildSentence":
      // The tiles in their correct reading order reconstruct the sentence the
      // exercise actually teaches; `extraWords` (wrong tiles) are excluded.
      return [ex.words.map((w) => w.target).join(" ")];
    case "chooseTranslation":
      return [ex.target];
    case "matchPairs":
      return ex.pairs.map((p) => p.target);
    case "spotError":
      // `target` contains exactly one deliberate error (CLAUDE.md: wrong by
      // design, never treated as real usage). Use the fix instead, if authored.
      return ex.correctedTarget ? [ex.correctedTarget] : [];
    default:
      return [];
  }
}

/** Every hand-authored example/exercise sentence in a language's grammar course. */
export function collectGrammarSentences(file: GrammarCoursesFile): string[] {
  const out: string[] = [];
  for (const course of file.courses) {
    for (const block of course.blocks) {
      for (const lesson of block.lessons) {
        for (const slide of lesson.slides) {
          for (const example of slide.examples) out.push(example.target);
        }
        for (const exercise of lesson.exercises) {
          out.push(...sentencesFromExercise(exercise));
        }
      }
    }
  }
  return out;
}

/** Every hand-authored seed-text sentence (and title) for a language. */
export function collectSeedSentences(seedTexts: readonly SeedTextSource[]): string[] {
  const out: string[] = [];
  for (const text of seedTexts) {
    out.push(text.titleTarget);
    for (const sentence of text.sentences) out.push(sentence.target);
  }
  return out;
}

/** Every lexicon entry's worked example sentence. Weak evidence - see header. */
export function collectLexiconExampleSentences(entries: readonly LexiconEntry[]): string[] {
  return entries.map((e) => e.exampleTarget);
}

// ---------------------------------------------------------------------------
// Homograph detection
// ---------------------------------------------------------------------------

/**
 * Ids of every entry that shares its exact `targetNormalized` spelling with at
 * least one other entry. A true homograph pair, independent of which one
 * `resolve()` would actually pick for a given surface - that precedence is
 * production behaviour and is what the miner counts through, deliberately;
 * this is only the flag that says "double-check this one".
 */
export function findHomographIds(entries: readonly LexiconEntry[]): Set<string> {
  const bySurface = new Map<string, LexiconEntry[]>();
  for (const entry of entries) {
    const list = bySurface.get(entry.targetNormalized) ?? [];
    list.push(entry);
    bySurface.set(entry.targetNormalized, list);
  }
  const ids = new Set<string>();
  for (const list of bySurface.values()) {
    if (list.length > 1) for (const entry of list) ids.add(entry.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Mining
// ---------------------------------------------------------------------------

export const COUNT_THRESHOLD = 3;
export const WINDOW = 3;

export type PairingKind = "mod" | "vobj";

export interface PairCount {
  kind: PairingKind;
  lexemeA: string;
  targetA: string;
  lexemeB: string;
  targetB: string;
  count: number;
}

export interface AnnotatedPair extends PairCount {
  /** True if either lexeme's surface is shared with another entry - see findHomographIds. */
  ambiguous: boolean;
}

/**
 * Classify an ordered pair of resolved lexemes as they occurred in the
 * sentence (`a` before `b`). Returns the pair in the canonical order the TSV
 * documents - `(noun, adjective)` for "mod", `(verb, noun)` for "vobj" -
 * regardless of which order the sentence actually used, since Catalan and
 * Dari both allow either order for these relations.
 */
function classify(a: LexiconEntry, b: LexiconEntry): Omit<PairCount, "count"> | null {
  if (a.pos === "noun" && b.pos === "adjective") {
    return { kind: "mod", lexemeA: a.id, targetA: a.target, lexemeB: b.id, targetB: b.target };
  }
  if (a.pos === "adjective" && b.pos === "noun") {
    return { kind: "mod", lexemeA: b.id, targetA: b.target, lexemeB: a.id, targetB: a.target };
  }
  if (a.pos === "verb" && b.pos === "noun") {
    return { kind: "vobj", lexemeA: a.id, targetA: a.target, lexemeB: b.id, targetB: b.target };
  }
  if (a.pos === "noun" && b.pos === "verb") {
    return { kind: "vobj", lexemeA: b.id, targetA: b.target, lexemeB: a.id, targetB: a.target };
  }
  return null;
}

/**
 * Mine noun+adjective and verb+object pairings from a set of sentences.
 *
 * Tokenization and resolution are passed in rather than picked from a
 * language code, so a test can exercise this against a tiny hand-built
 * lexicon while production code always passes the real per-language profile -
 * see the trap note in the file header for why `index` must be the real
 * production index and not a reimplementation.
 */
export function minePairings(
  sentences: readonly string[],
  tokenize: (text: string) => string[],
  index: LexiconIndex,
  threshold = COUNT_THRESHOLD,
  window = WINDOW,
): PairCount[] {
  const counts = new Map<string, PairCount>();

  for (const sentence of sentences) {
    const tokens = tokenize(sentence);
    const resolved = tokens.map((t) => index.resolve(t));

    for (let i = 0; i < resolved.length; i++) {
      const a = resolved[i];
      if (!a) continue;
      const last = Math.min(i + window, resolved.length - 1);
      for (let j = i + 1; j <= last; j++) {
        const b = resolved[j];
        if (!b || b.id === a.id) continue;
        const pair = classify(a, b);
        if (!pair) continue;
        const key = `${pair.kind}\t${pair.lexemeA}\t${pair.lexemeB}`;
        const existing = counts.get(key);
        if (existing) existing.count++;
        else counts.set(key, { ...pair, count: 1 });
      }
    }
  }

  return [...counts.values()]
    .filter((p) => p.count >= threshold)
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.kind.localeCompare(b.kind) ||
        a.targetA.localeCompare(b.targetA) ||
        a.targetB.localeCompare(b.targetB),
    );
}

/** Flag every mined pair that touches a homograph surface, for the console report. */
export function annotateAmbiguous(
  pairs: readonly PairCount[],
  homographIds: ReadonlySet<string>,
): AnnotatedPair[] {
  return pairs.map((p) => ({
    ...p,
    ambiguous: homographIds.has(p.lexemeA) || homographIds.has(p.lexemeB),
  }));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const lang = targetLang() as TargetLang;
  const profile = PROFILES[lang];
  if (!profile) throw new Error(`No language profile for "${lang}"`);

  const root = contentRoot();

  const lexiconFile = lexiconFileSchema.parse(
    JSON.parse(readFileSync(join(root, "lexicon", "lexicon.json"), "utf8")),
  );
  const entries = lexiconFile.entries;

  const grammarFile = grammarCoursesFileSchema.parse(
    JSON.parse(readFileSync(join(root, "grammar", "all.json"), "utf8")),
  );

  const { seedTexts } = (await import(`./data/seed-texts-${lang}.ts`)) as {
    seedTexts: SeedTextSource[];
  };

  const grammarSentences = collectGrammarSentences(grammarFile);
  const seedSentences = collectSeedSentences(seedTexts);
  const lexiconSentences = collectLexiconExampleSentences(entries);
  const sentences = [...grammarSentences, ...seedSentences, ...lexiconSentences];

  const index = profile.text.buildIndex(entries);
  const pairs = minePairings(sentences, profile.text.tokenize, index);
  const homographIds = findHomographIds(entries);
  const annotated = annotateAmbiguous(pairs, homographIds);

  const tsv = [
    ["kind", "lexemeA", "targetA", "lexemeB", "targetB", "count"].join("\t"),
    ...pairs.map((p) => [p.kind, p.lexemeA, p.targetA, p.lexemeB, p.targetB, p.count].join("\t")),
  ].join("\n");
  const outPath = join(import.meta.dirname, "data", `pairings-${lang}.tsv`);
  writeFileSync(outPath, tsv + "\n");

  console.log(
    `${lang}: ${sentences.length.toLocaleString()} sentences mined ` +
      `(grammar ${grammarSentences.length}, seed ${seedSentences.length}, ` +
      `lexicon example ${lexiconSentences.length})`,
  );
  console.log(`${pairs.length} pair(s) at count >= ${COUNT_THRESHOLD}`);
  console.log(`wrote ${outPath}`);

  const ambiguous = annotated.filter((p) => p.ambiguous);
  if (ambiguous.length > 0) {
    console.log(
      `\n${ambiguous.length} pair(s) touch a homograph surface (same spelling, ` +
        `different lexicon entry) - resolve() picked one sense; review before trusting:`,
    );
    for (const p of ambiguous.slice(0, 20)) {
      console.log(`  ${p.kind}\t${p.targetA} (${p.lexemeA}) + ${p.targetB} (${p.lexemeB})\tx${p.count}`);
    }
  }

  console.log("\ntop 10 by count:");
  for (const p of pairs.slice(0, 10)) {
    console.log(`  ${p.kind}\t${p.targetA}\t${p.targetB}\t${p.count}`);
  }

  console.log(
    "\n(review flag, not a gate: absence here means 'not attested in these ~10k " +
      "sentences', not 'not idiomatic'. See file header.)",
  );
}
