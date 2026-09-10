import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { soleLanguage } from "./scripts/content-path.ts";

/**
 * Content is namespaced per language (`content/<lang>/…`) and reached through
 * the `@content` alias. The Next build points it at the `content/active`
 * symlink, written from NEXT_PUBLIC_TARGET_LANG by scripts/link-content.ts.
 *
 * Vitest resolves the same variable but **must not go through that symlink**.
 * The symlink is one shared piece of filesystem state while the variable is
 * per-process, so a test run in one language silently re-points the content
 * under a dev server running in the other: the Dari app keeps its Dari
 * branding, layout direction and prompts, and starts serving the Catalan
 * lexicon. Nothing errors - the two halves just quietly stop matching.
 *
 * Resolving straight from the variable gives the test run its own view of the
 * content and leaves the symlink alone, which is what the `pretest` hook used
 * to fight over.
 */
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const lang = process.env.NEXT_PUBLIC_TARGET_LANG || soleLanguage();

/**
 * Checks that hit the live provider chain cost API quota, so they stay out of
 * `pnpm test` - but they have to be *runnable*, and naming them in `exclude`
 * meant they were not: vitest applies the exclusion even when the file is passed
 * explicitly, so the command in generate-smoke.test.ts's own header answered
 * "No test files found". Gating on an env var keeps them off the default run and
 * lets `LIVE_AI=1` ask for them by name.
 *
 * CLAUDE.md is explicit and non-negotiable: an agent must never set `LIVE_AI=1`
 * itself - that budget is a real learner's, not a development tool's, and one
 * session already exhausted a full day of it this way.
 */
const liveExclusions = process.env.LIVE_AI ? [] : ["**/*.live.test.ts"];

/**
 * `*.manual.test.ts` - a different reason to exclude, not cost. These are
 * content-authoring utilities (write a file, print a brief) that need `@content`
 * and so have to run through vitest the same way a live check does, but never
 * call a model. They are for a person (or an agent, since they cost nothing -
 * see CLAUDE.md, only `LIVE_AI` guards a real budget) to invoke deliberately
 * by full path, never for `pnpm test` to pick up as a behavioural test.
 *
 * Same exclude-applies-even-when-named quirk `LIVE_AI` above exists to solve:
 * vitest applies `exclude` even when the file is passed explicitly, so
 * without an unlock these would answer "No test files found" for the exact
 * command their own header tells you to run.
 */
const manualExclusions = process.env.MANUAL ? [] : ["**/*.manual.test.ts"];

export default defineConfig({
  test: { exclude: ["**/node_modules/**", ...liveExclusions, ...manualExclusions] },
  resolve: {
    alias: {
      "server-only": r("./test/server-only-stub.ts"),
      "@content": r(`./content/${lang}`),
      "@": r("./src"),
    },
  },
});
