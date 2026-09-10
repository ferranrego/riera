# Working on this repo

**Riera** - Catalan (`ca`), deployed at rieralearn.vercel.app.

This was one repo building two apps until it was split. The sibling is
**Darya** (Dari), at `github.com/ferranrego/darya`, and the two share
ancestry and identical file paths on purpose - see "Porting from Darya" below.
The `LanguageProfile` registry in `src/lib/lang/` is kept for that reason, not
because this repo will ever build a second language.

Read `docs/PEDAGOGY.md` before changing anything that decides what a learner is
taught: levels, word selection, the generation prompt, difficulty thresholds,
the SRS, or lexicon content. The numbers in it are the product.

## The five that have actually bitten

Each of these shipped, reached a learner, and was invisible until measured.

1. **A silent failure beats a loud one, every time.** Nothing here crashes. The
   grammar course taught `Vull que tu vinguis venir amb mi` for months; B2 texts
   contained none of the words they were written to teach; Catalan B2 learners
   were handed the C1 course and skipped B2 entirely. All of it rendered fine.
   If you change something learner-facing, **measure the output**, do not read
   the code and conclude it works.

2. **One command runs the gate: `pnpm gate`.** It is typecheck, lint, test and
   validate:content in order. There is one language here now, so the old
   `for L in ca prs` loop is gone - and so is the trap that made it necessary,
   where a bare `pnpm validate:content` in a Dari session validated the
   other language and reported success. The default language is now read from
   `content/`, so nothing can silently resolve to a language this repo does not
   ship.

3. **`content/active` always points at `content/ca`.** It is written by
   `scripts/link-content.ts` from `prebuild`/`predev` and there is only one
   language to point at, so the old hazard - flipping it under a running dev
   server and serving the other language's content under this one's branding -
   cannot happen here any more. This is what the split bought: Riera and
   Darya can now run locally at the same time.

4. **Never delete or renumber a lexicon entry.** `user_words.lexeme_id` is a
   foreign key and cached texts store `lexemeId` inside their JSON. Dropping an
   entry orphans real learner progress; renumbering ids silently repoints it at
   a different word. Repair in place. **Never run `audit-ca-lexicon.ts --fix`**,
   which does both.

5. **Comments here are load-bearing.** Most explain a specific incident. Do not
   delete one because the code looks self-evident - it looks self-evident
   *because* of the fix the comment describes. A comment that no longer matches
   its code is a defect: two of them were found asserting the opposite of what
   the code did.

## Before content reaches a reviewer

The cost of a defect is set by how late it is caught, and that is the one thing
you control. Write the check *before* the change, not after the review finds it.

Authoring vocabulary, examples or texts, in order:

1. **Author into a reviewed file**, never straight into `lexicon.json`. A 1.8 MB
   JSON diff is not legible, so nothing in it gets read - which is how
   `registre` shipped glossed as a verb.
2. **`node scripts/review-batch.ts --lang ca --repairs <file>`** renders the
   batch as learner-facing cards. Read them. This is the step that catches what
   no validator can express: a card reading *registre · verb · record* is
   obviously wrong to anyone, in any language. It is also how the `register`
   field turned out to be `formal` on every everyday word.
3. **`--apply`, which prints `lexicon-diff.ts` automatically** - counts by part
   of speech and register, before and after, plus a sample of the actual edits.
   "142 repaired" is not checkable; "noun 290 → 63, verb 0 → 43" is.
4. **`pnpm validate:content --lang <lang>`**, then the language gates.
5. **Only then a philologist**, on one batch at a time. Running three batches
   back to back put 142 entries into a single review, which is not a review.

Two habits that cost real defects here: never report a gate as green without
its exit code (a grep for your own filenames is not `pnpm lint`), and when a
heuristic looks sound, test the direction you did *not* think of - the
corpus-attestation check was probed for fake evidence and not for real evidence
belonging to a different word, which is exactly `registre`/`registrar`.

## Content rules

- **A wrong entry is worse than a missing one.** Everything generated is guilty
  until proven innocent. Candidates that fail `verifyEntry` are dropped, not
  patched.
- **Author content rather than generating it** unless told otherwise. The 445
  broken Catalan entries all came from bulk generation passes.
- **Wrong-by-design content exists.** Distractors, `extraWords`, and the
  sentence in a `spotError` exercise are wrong on purpose. Do not "fix" them;
  the validators already skip them.
- **An agent finding graduates into a mechanical check.** That is the repo's
  pattern: a philologist found every seed-text token pointing at the wrong
  lexeme, and it is now a permanent check in `validate-content.ts`. A finding
  you only fix will come back.

## Porting from Darya

The two repos were one, so ~80% of any feature commit is files they still share.
That only stays cheap if porting is a git operation. Two things keep it one:
**identical file paths** and **shared ancestry**.

```bash
git fetch darya
git log --oneline main..darya/main    # what is portable
./scripts/port.sh <sha>              # cherry-pick, dropping Darya-only files
pnpm gate
```

**The one habit that makes this work: keep shared changes in their own commit.**
Before the split a single commit routinely touched nine shared files *and*
`lang/ca/prompts.ts` *and* `lang/prs/prompts.ts`. Now write two:

```
feat(core): show mistakes without the learner asking   <- ports
feat(ca): interference rules for correction hints    <- never ports
```

Everything else follows from that. It costs nothing while writing and it is the
difference between one command and an afternoon.

What ports: `src/` outside `src/lib/lang/ca/`, `supabase/migrations/`, shared
`scripts/`, `content/schema/`. What never does: `content/ca/` and the profile's
own prompts, brand and samples - those are this language, by definition.

**Migrations must not drift.** The schema is language-agnostic and identical in
both databases, so a migration ports 1:1 - but a database that has missed one is
invisible until a shared code path reads a column that is not there. After
porting a migration: `npx supabase db push && pnpm validate:db`.

If the repos drift far enough that cherry-picks stop applying, `git merge
darya/main` still works - shared ancestry makes it a real three-way merge, and
the conflicts are exactly the files meant to differ (`src/lib/lang/index.ts`,
`package.json`, this file, brand strings). Resolve to "ours" and move on.

## Cost and time

The app must never bill. The chain is five free-tier providers deep - Hugging
Face (Qwen) first, then Groq, OpenRouter, and smaller fallbacks - and **every
one of those quotas is shared by every user of the deployment**, so one active
learner can exhaust a day for everybody. Raising the known-word prompt slice
from 160 to 600 words did exactly that in a single session.

Before adding or enlarging a model call, **count the calls per user action and
estimate the tokens**. One generation is up to three sequential calls
(generate → repair → add missing targets), and up to three attempts of those.

**Time is the other budget, and it is easy to miss.** Vercel kills the route at
`maxDuration` - 60s for generation, 30s for the chat routes. A per-provider
timeout multiplied by five providers and two attempts is minutes, so the later
providers in the chain could never actually run: the function died first,
having spent the tokens, with nothing cached and a 504 body the client cannot
parse. `completeJson` therefore takes a **shared deadline** and gives each
attempt what is left of it. A caller making several completions must create one
deadline (`deadlineIn`) and pass it to all of them - a per-call budget is how
the problem comes back.

Model output is untrusted input: Zod-parse it, and validate the assembled result
before it reaches a cache other learners read.

**An agent must never call the provider chain itself.** `completeJson`
(`src/lib/ai/providers.ts`) and everything built on it - `generateText`, any
`*.live.test.ts` file, any script gated on `LIVE_AI=1` - draws on the exact
same shared Groq/OpenRouter/HuggingFace budget a real learner's next request
needs. This is not a hypothetical: in one session an agent ran
`author-texts.live.test.ts` (an offline content-drafting tool built the same
session) to author seed texts, and separately, by mistake, an unrelated
verification command (see the flag-order note below) fired three more
`*.live.test.ts` files alongside it - between them, Groq's daily token cap,
OpenRouter's daily free-model cap, and HuggingFace's monthly credits were all
exhausted in one sitting, for every learner using the deployment, not just a
test account. **The chain exists only for a live user's own request.**
Content is authored directly - by a person, or by an agent writing the
target-language sentences itself - never by asking the app's own model chain
to draft them. Verify a change by reading its output against real content and
running the offline suite (`pnpm test`); do not generate live text to look
at, and do not run a `.live.test.ts` file or anything gated on `LIVE_AI=1` -
those are for a human maintainer to run deliberately, occasionally, never as
a matter of routine verification, and never by an agent.

## Verification

`pnpm test` is offline; this is what an agent runs. Live-provider checks are
opt-in, human-only (see above), and even then only when nothing else can
answer the question:

```
LIVE_AI=1 NEXT_PUBLIC_TARGET_LANG=ca AUDIT_PER_LEVEL=2 \
  pnpm exec vitest run scripts/audit-generation.live.test.ts --disable-console-intercept
```

The file path must come **before** `--disable-console-intercept`. Vitest does
not recognize that flag, and (confirmed by testing both orders) treats an
unrecognized flag as taking the next token as its value when the flag comes
first - so the flag-first order silently drops the file filter and runs the
*entire* suite, live-provider tests included (34 files instead of 1, four
`.live.test.ts` files hitting the shared free-tier chain instead of the one
you meant to run). This order was wrong in this file for some time; if you
copy a verification command from an older comment or an agent's output,
check the order before running it.

That audit is the only thing that measures whether generated texts actually
teach. It prints coverage, new-words-used and part-of-speech mix per level, and
gates levels up to B2.

Catalan-specific gates: `node scripts/audit-ca-content.ts` (unteachable entries,
by level) and `node scripts/verify-ca-grammar.ts [--max-level B2]`.
