import { describe, expect, it, vi } from "vitest";
import { PROFILES, REGISTERED_LANGS, profile, type LanguageProfile } from "./index.ts";

/**
 * Capability gating is what lets one codebase serve languages with genuinely
 * different feature sets. These assert both directions:
 *
 *   * Dari declares every capability, so Phase 4's gating must be a no-op for
 *     the app that exists today - the failure mode to fear is silently hiding
 *     a working feature;
 *   * a profile that declines a capability actually turns it off, which is the
 *     only reason the gating exists.
 */

describe("language profiles", () => {
  it("every registered profile is internally consistent", () => {
    for (const [code, p] of Object.entries(PROFILES)) {
      expect(p.code, `${code}: code must match its registry key`).toBe(code);
      expect(p.dir === "ltr" || p.dir === "rtl", `${code}: dir`).toBe(true);
      // letter-spacing goes through a CSS var, where a bare `0` is dropped as
      // invalid at computed-value time. A keyword is fine; a bare number is not.
      expect(p.letterSpacing, `${code}: letterSpacing must be a keyword or carry a unit`)
        .toMatch(/^(normal|-?[\d.]+[a-z%]+)$/);
      for (const fn of [
        "normalize",
        "matchKey",
        "tokenize",
        "buildIndex",
        "verbHeadwordProblem",
        "generatedFormsByKey",
        "inflectionHint",
      ] as const) {
        expect(typeof p.text[fn], `${code}: text.${fn}`).toBe("function");
      }
      expect(p.prompts.teacher.length, `${code}: prompts.teacher`).toBeGreaterThan(0);
      expect(p.prompts.scenarios.length, `${code}: prompts.scenarios`).toBeGreaterThan(0);
      // Brand is what a deployment ships under; a missing field would render as
      // "undefined" in the title bar and the install manifest.
      for (const f of ["appName", "nativeName", "tagline", "description", "mascotName"] as const) {
        expect(p.brand[f]?.length, `${code}: brand.${f}`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * Both directions of the gating, pinned per language: Dari declares every
   * capability, so gating must be a no-op for it; Catalan declines all three,
   * which is the only reason the gating exists.
   *
   * Keyed by code and run only for the codes registered, so a deployment
   * carrying one language keeps its own assertions and drops the other's.
   * Written as `PROFILES.prs` / `PROFILES.ca` this was a type error - not a
   * skipped test - the moment the registry held one language.
   */
  const EXPECTED: Record<
    string,
    { dir: "ltr" | "rtl"; capabilities: LanguageProfile["capabilities"] }
  > = {
    prs: {
      dir: "rtl",
      capabilities: { transliteration: true, scriptCourse: true, fontPicker: true },
    },
    ca: {
      dir: "ltr",
      capabilities: { transliteration: false, scriptCourse: false, fontPicker: false },
    },
  };

  for (const [code, profile] of Object.entries(PROFILES)) {
    const expected = EXPECTED[code];
    if (!expected) continue;
    it(`${code} declares exactly the capabilities it should`, () => {
      expect(profile.capabilities).toEqual(expected.capabilities);
      expect(profile.dir).toBe(expected.dir);
    });
  }

  it("every registered language has pinned expectations", () => {
    for (const code of Object.keys(PROFILES)) {
      expect(EXPECTED[code], `no pinned capabilities for "${code}"`).toBeDefined();
    }
  });

  it("no UI file hardcodes brand, language name or target-language text", async () => {
    // Three separate leaks reached production, each caught by a user rather
    // than by a test:
    //   1. brand      - Riera's welcome screen said "Darya"
    //   2. language   - "You'll learn Dari by reading it." in the Catalan app
    //   3. script     - خوش آمدید greeted Catalan learners
    // All three must come from the profile, so all three are checked here.
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join, sep } = await import("node:path");
    const root = join(import.meta.dirname, "..", "..");

    const brands = Object.values(PROFILES).map((p) => p.brand.appName);
    const languages = Object.values(PROFILES).map((p) => p.name);
    // Any script that is not the Latin alphabet the UI itself is written in.
    const NON_LATIN = /[\u0600-\u06FF\u0750-\u077F\u0400-\u04FF\u4E00-\u9FFF]/;
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== "lang") walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(name) || name.includes(".test.")) continue;
        readFileSync(full, "utf8")
          .split("\n")
          .forEach((line, i) => {
            const code = line.trim();
            if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
            const where = `${full.slice(root.length + 1)}:${i + 1}`;

            // Two narrow, justified exemptions:
            //  - the alphabet route tree exists only to teach a non-Latin
            //    script and 404s wholesale when capabilities.scriptCourse is
            //    off, so a glyph there can never reach a Catalan learner;
            //  - a regex literal is a *matcher*, not rendered text. The cloze
            //    placeholder pattern includes a tatweel so it can strip one if
            //    the model emits it; it simply never matches Latin input.
            const inGatedAlphabetRoute = full.includes(`${sep}alphabet${sep}`);
            const isRegexLiteral = /=\s*\/|\.match\(\/|\.test\(\/|\.replace\(\//.test(code);
            if (inGatedAlphabetRoute || isRegexLiteral) return;
            for (const b of brands) {
              if (new RegExp(`\\b${b}\\b`).test(code)) offenders.push(`${where} brand "${b}"`);
            }
            for (const l of languages) {
              if (new RegExp(`\\b${l}\\b`).test(code)) offenders.push(`${where} language "${l}"`);
            }
            if (NON_LATIN.test(code)) offenders.push(`${where} target-language text`);
          });
      }
    };
    walk(join(root, "app"));
    walk(join(root, "components"));
    expect(offenders, "must come from the language profile").toEqual([]);
  });

  it("each profile ships a distinct brand", () => {
    const names = Object.values(PROFILES).map((p) => p.brand.appName);
    expect(new Set(names).size, "two deployments must not share a name").toBe(names.length);
  });

  it("resolves a profile for the active build", () => {
    // Compared against the registry, not a literal default. A hardcoded "prs"
    // here asserted the wrong language in a repo that does not ship it.
    expect(profile.code).toBe(process.env.NEXT_PUBLIC_TARGET_LANG ?? REGISTERED_LANGS[0]);
  });
});
