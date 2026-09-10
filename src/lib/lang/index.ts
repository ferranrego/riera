import { ca } from "./ca/index.ts";
import type { LanguageProfile } from "./types.ts";

export type {
  LanguageCapabilities,
  LanguagePrompts,
  LanguageProfile,
  LanguageText,
  LexiconIndex,
} from "./types.ts";

/**
 * The language this repo teaches.
 *
 * This registry is deliberately kept - rather than inlining Catalan everywhere -
 * because the sibling repo (Darya, Dari) has the identical file layout, which is
 * what lets a shared change move between them with `git cherry-pick` instead of
 * being rewritten. See CLAUDE.md, "Porting from Darya".
 */
export const PROFILES = { ca } satisfies Record<string, LanguageProfile>;

export type TargetLang = keyof typeof PROFILES;

/**
 * The languages this build carries, for the checks that have to run once per
 * language over `content/<code>/`.
 *
 * Those used to write `const LANGS = ["ca", "prs"]` by hand, in six files. A
 * literal list cannot be right in a deployment carrying one language: the tests
 * went looking for a `content/` directory that is not there, and four whole
 * test files failed to load rather than reporting anything useful.
 */
export const REGISTERED_LANGS = Object.keys(PROFILES) as TargetLang[];

const DEFAULT_LANG: TargetLang = "ca";

function resolveProfile(): LanguageProfile {
  const code = process.env.NEXT_PUBLIC_TARGET_LANG;
  if (!code) return PROFILES[DEFAULT_LANG];
  if (code in PROFILES) return PROFILES[code as TargetLang];
  throw new Error(
    `NEXT_PUBLIC_TARGET_LANG="${code}" is not a known language (have: ${Object.keys(PROFILES).join(", ")})`,
  );
}

/**
 * The language this build teaches. Resolved once at module load from
 * NEXT_PUBLIC_TARGET_LANG, so it is a build-time constant on both server and
 * client - one deployment only ever serves one language, which keeps each
 * database single-language and each brand distinct.
 */
export const profile: LanguageProfile = resolveProfile();
