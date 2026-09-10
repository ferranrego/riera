/**
 * The shape of a hand-authored seed text, shared by every language.
 *
 * This interface used to live in `seed-texts-prs.ts`, the Dari *data* file, and
 * four language-neutral scripts imported the type from there - including
 * `seed-texts-ca.ts`, so the Catalan data depended on the Dari data to describe
 * itself. That is invisible while both files are present and a hard build
 * failure the moment one language is removed.
 *
 * Types belong with neither language's content. Data files import this.
 */
export interface SeedTextSource {
  slug: string;
  level: string;
  /** Curriculum order within the level. Must be unique per level. */
  seq: number;
  titleTarget: string;
  titleTranslit?: string;
  titleEn: string;
  /**
   * Lexeme ids this text was written to introduce, from the schedule slot.
   * Optional; when present the build asserts the computed newWords match, so
   * a drafted text that quietly failed to use its assigned words fails loudly.
   */
  introduces?: string[];
  sentences: Array<{ target: string; translit?: string; en: string }>;
}
