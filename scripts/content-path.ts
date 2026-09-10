import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolve which language's content a script should operate on.
 *
 * Content is namespaced per language (`content/<lang>/…`). Scripts pick the
 * language from `--lang <code>`, then `NEXT_PUBLIC_TARGET_LANG`, then the sole
 * language this repo ships - the same variable the Next build uses for its
 * `@content` alias, so `pnpm validate:content` and `pnpm build` cannot disagree
 * about which content they are looking at.
 *
 * `content/schema/` is deliberately NOT namespaced: the schemas are shared
 * across languages and are what makes them interchangeable.
 */

/**
 * The language this repo ships, read from `content/` rather than written down.
 *
 * It was the literal "prs", duplicated here, in vitest.config.ts and in
 * link-content.ts. In a Catalan-only repo that default sends `pnpm test`
 * looking for `content/prs`, and twelve test files fail to load with a module
 * resolution error rather than anything about content - which is exactly what
 * happened on this repo's first green typecheck.
 *
 * Deriving it means a repo cannot default to a language it does not have, and
 * that this file stays identical in both repos, so a change to it ports with a
 * plain cherry-pick.
 */
export function soleLanguage(contentDir = join(import.meta.dirname, "..", "content")): string {
  const langs = readdirSync(contentDir, { withFileTypes: true })
    // `active` is a symlink, and isDirectory() is false for one - so the link
    // this function helps create cannot be mistaken for a language.
    .filter((d) => d.isDirectory() && d.name !== "schema" && !d.name.startsWith("."))
    .map((d) => d.name);
  if (langs.length !== 1) {
    throw new Error(
      `content/ must hold exactly one language, found: ${langs.join(", ") || "none"}. ` +
        `Pass --lang <code> or set NEXT_PUBLIC_TARGET_LANG.`,
    );
  }
  return langs[0];
}

export function targetLang(argv: string[] = process.argv): string {
  const flag = argv.indexOf("--lang");
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1];
  return process.env.NEXT_PUBLIC_TARGET_LANG || soleLanguage();
}

/** Absolute path to the active language's content directory. */
export function contentRoot(argv: string[] = process.argv): string {
  const lang = targetLang(argv);
  const root = join(import.meta.dirname, "..", "content", lang);
  if (!existsSync(root)) {
    throw new Error(
      `No content for language "${lang}" (looked in ${root}). ` +
        `Pass --lang <code> or set NEXT_PUBLIC_TARGET_LANG.`,
    );
  }
  return root;
}

/** Absolute path to the shared, language-independent schema directory. */
export function schemaRoot(): string {
  return join(import.meta.dirname, "..", "content", "schema");
}
