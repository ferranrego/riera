/**
 * Point `content/active` at the language this build teaches.
 *
 * Content is namespaced per language (`content/prs`, `content/ca`) and the app
 * imports it through `@content/*`. That alias used to be a Turbopack
 * `resolveAlias`, which silently did not apply: tsconfig `paths` resolved
 * `@content/*` to `content/prs/*` first, so a Catalan build shipped the Dari
 * lexicon while its branding said Catalan. The build succeeded, the page title
 * was right, and only the actual words were wrong - which is exactly the kind of
 * failure that reaches a user.
 *
 * A symlink removes the ambiguity: `@content/*` maps to `content/active/*` in
 * tsconfig, and `content/active` is a real directory entry pointing at the right
 * language. Next, Turbopack, vitest, tsc and any script all resolve it the same
 * way, because there is nothing left to resolve.
 *
 * Runs automatically via the `prebuild` / `predev` hooks.
 *
 * One symlink means one language per working tree at a time. Re-pointing it
 * while a dev server is running in the *other* language leaves that server with
 * its own branding, layout direction and prompts but the wrong content, and
 * nothing errors - so this warns loudly when it changes an existing link.
 */
import { existsSync, lstatSync, readdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { soleLanguage } from "./content-path.ts";

const lang = process.env.NEXT_PUBLIC_TARGET_LANG || soleLanguage();

const contentDir = join(import.meta.dirname, "..", "content");
const target = join(contentDir, lang);
const link = join(contentDir, "active");

if (!existsSync(target)) {
  const available = readdirSync(contentDir).filter(
    (d) => d !== "active" && d !== "schema" && !d.startsWith("."),
  );
  throw new Error(
    `No content for NEXT_PUBLIC_TARGET_LANG="${lang}" (looked in ${target}). ` +
      `Available: ${available.join(", ")}`,
  );
}

// lstat, not exists: a symlink to a since-removed directory reports as missing.
let previous: string | null = null;
if (existsSync(link) || (() => { try { lstatSync(link); return true; } catch { return false; } })()) {
  try {
    previous = readlinkSync(link);
  } catch {
    // Not a symlink (a stray real directory); nothing to preserve.
  }
  rmSync(link, { recursive: true, force: true });
}
symlinkSync(lang, link, "dir");

if (previous && previous !== lang) {
  console.warn(
    `content/active: ${previous} -> ${lang}. Any dev server still running in ` +
      `"${previous}" is now serving ${lang} content - restart it.`,
  );
} else {
  console.log(`content/active -> content/${lang}`);
}
