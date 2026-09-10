/**
 * Mark the words a beginner needs, whatever the corpus says about them.
 *
 * Frequency decides teaching *order*. It does not decide what a learner needs
 * on their first day, and no corpus will, because concrete nouns are rarer in
 * written text than abstract ones. Catalan's ranking is blended from subtitles
 * and Wikipedia and is correct as frequency - its L1 head is `estat`, `cosa`,
 * `part`, `vegada`, `manera`, `guerra`, `punt`, `acord`, `sistema`, `empresa` -
 * while `poma` sits at 1468, `plat` at 1161, `carn` at 818. Measured, 80 of the
 * 138 concrete beginner words present in the lexicon ranked past L1, so
 * "El gos menja carn" and "Quant costa la poma?" could not be written at the
 * level they belong to.
 *
 * The fix is additive rather than a re-ranking: this tags what
 * `content/<lang>/lexicon/beginner-spec.json` requires, and the generator lets
 * the first two levels teach anything so tagged. `freqRank` is untouched,
 * because it is correct and every level above L2 depends on it, and the tag
 * does not make a word count as already known - it makes it *teachable early*.
 *
 * The source is the spec rather than the old hand-written `beginner-core.txt`,
 * so the tag is a *consequence* of the requirements instead of a second list
 * kept in step with them by hand. The two had already drifted: the list was
 * missing every subject pronoun, every possessive, every demonstrative, ten of
 * twelve position words and fifteen numbers, because a list written from
 * memory has holes shaped like whatever the writer forgot. The spec states
 * what coverage *means*, and `verify-beginner-core.ts` can falsify it.
 *
 * Usage: node scripts/tag-beginner-core.ts --lang ca [--apply]
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PROFILES } from "../src/lib/lang/index.ts";
import { join } from "node:path";

import { lexiconFileSchema, type LexiconEntry } from "../src/lib/content/schema.ts";
import { isTeachable } from "../src/lib/content/teachability.ts";
import { BEGINNER_CORE_TAG } from "../src/lib/content/word-selection.ts";
import { contentRoot, targetLang } from "./content-path.ts";
import { readSpec, specWords } from "./verify-beginner-core.ts";

/** The profile for `lang`, or a clear error naming what is registered. */
function langProfile(lang: string) {
  const p = PROFILES[lang as keyof typeof PROFILES];
  if (!p) throw new Error(`No language profile for "${lang}" (have: ${Object.keys(PROFILES).join(", ")})`);
  return p;
}

/**
 * Every requirement the spec states, verbatim.
 *
 * Multi-word requirements (`hi ha`, Dari compound verbs like `گپ زدن`) are left
 * whole here; the caller decides whether they resolve as one entry or have to
 * be split into components. Falls back to the superseded `beginner-core.txt`
 * only if no spec exists for the language.
 */
export function readBeginnerCore(root: string): string[] {
  const spec = readSpec(root);
  if (spec) return [...new Set(specWords(spec))];
  const path = join(root, "lexicon", "beginner-core.txt");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

export function readVerbFunctions(root: string): string[] {
  const spec = readSpec(root);
  if (spec) return [...new Set(Object.values(spec.verbFunctions).flat())];
  return [];
}

function main() {
  const lang = targetLang();
  const root = contentRoot();
  const apply = process.argv.includes("--apply");

  const path = join(root, "lexicon", "lexicon.json");
  const file = JSON.parse(readFileSync(path, "utf8"));
  lexiconFileSchema.parse(file);
  const entries: LexiconEntry[] = file.entries;
  const { buildIndex, tokenize } = langProfile(lang).text;
  const index = buildIndex(entries);

  const missing: string[] = [];
  const unteachable: string[] = [];
  const hit = new Set<string>();

  // Resolve the whole requirement before splitting it. `خدا حافظ` and
  // `فریاد زدن` are single lexicon entries, so splitting first reported their
  // second halves as absent words that never needed to exist.
  //
  // Split with the production tokenizer, not "has a space" as the test for
  // whether there is anything to split. Catalan apostrophation (`d'acord`,
  // `t'agradaria`) makes a phrase multi-word with no space at all, so
  // `!req.includes(" ")` treated them as atomic and reported both as entirely
  // missing from the lexicon instead of tagging the `acord` and `agradaria`
  // they decompose to - the same defect verify-beginner-core.ts's `usable()`
  // had, caught here because tagging ran against the same spec.
  const wanted: string[] = [];
  for (const req of readBeginnerCore(root)) {
    if (index.resolve(req)) {
      wanted.push(req);
      continue;
    }
    const parts = tokenize(req);
    wanted.push(...(parts.length > 1 ? parts : [req]));
  }
  
  const super7Wanted: string[] = [];
  for (const req of readVerbFunctions(root)) {
    if (index.resolve(req) || !req.includes(" ")) super7Wanted.push(req);
    else super7Wanted.push(...req.split(/\s+/).filter(Boolean));
  }

  for (const word of wanted) {
    const entry = index.resolve(word);
    if (!entry) {
      missing.push(word);
      continue;
    }
    // A word whose gloss is a placeholder cannot be taught at any level, so
    // tagging it would only move the failure.
    if (!isTeachable(entry)) unteachable.push(`${word} (${entry.id})`);
    hit.add(entry.id);
  }
  
  const super7Hit = new Set<string>();
  for (const word of super7Wanted) {
    const entry = index.resolve(word);
    if (entry) super7Hit.add(entry.id);
  }

  let added = 0;
  let removed = 0;
  let super7Added = 0;
  for (const e of entries) {
    const tags = new Set(e.tags);
    if (hit.has(e.id) && !tags.has(BEGINNER_CORE_TAG)) {
      tags.add(BEGINNER_CORE_TAG);
      added++;
    } else if (!hit.has(e.id) && tags.has(BEGINNER_CORE_TAG)) {
      // The list is the source of truth, so removing a line removes the tag.
      tags.delete(BEGINNER_CORE_TAG);
      removed++;
    }
    
    if (super7Hit.has(e.id) && !tags.has("super-7")) {
      tags.add("super-7");
      super7Added++;
    } else if (!super7Hit.has(e.id) && tags.has("super-7")) {
      tags.delete("super-7");
    }
    
    e.tags = [...tags];
  }

  const tagged = entries.filter((e) => e.tags.includes(BEGINNER_CORE_TAG));
  const pastL1 = tagged.filter((e) => e.freqRank > 700).length;
  console.log(
    `${lang}: ${wanted.length} wanted, ${tagged.length} tagged ` +
      `(+${added} -${removed}); ${pastL1} of them rank past ~L1, which is the point.`,
  );

  if (unteachable.length) {
    console.log(`\n${unteachable.length} tagged but not yet teachable:\n  ${unteachable.join(", ")}`);
  }
  if (missing.length) {
    console.log(`\n${missing.length} not in the lexicon at all:\n  ${missing.join(" ")}`);
  }

  if (!apply) {
    console.log("\n(dry run - pass --apply to write the tags)");
    return;
  }
  lexiconFileSchema.parse(file);
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
  console.log(`\nrewrote ${path}`);
}

main();
