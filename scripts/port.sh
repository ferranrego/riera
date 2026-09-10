#!/usr/bin/env bash
# Port a commit from Darya.
#
#   ./scripts/port.sh <sha>          # one commit
#   ./scripts/port.sh <sha> <sha>…   # several, in order
#
# The two repos share ancestry and keep identical file paths, so git
# three-way-merges instead of guessing. That is the whole reason the profile
# registry survived the fork.
#
# A commit that also touched Darya's own language will try to recreate files
# this repo deleted. Those are removed here and left visible in the diff: if a
# port re-adds the other language, you want to see it, not have it land quietly.
#
# What never ports: content/ (different languages), brand strings, and anything
# under src/lib/lang/<code>/. What always ports cleanly: src/ outside lang/,
# supabase/migrations/ (apply with `supabase db push` afterwards), and shared
# scripts.
set -euo pipefail
cd "$(dirname "$0")/.."

[ $# -gt 0 ] || { echo "usage: $0 <sha>..."; exit 2; }
[ -z "$(git status --porcelain)" ] || { echo "working tree is dirty; commit or stash first"; exit 1; }

git remote get-url darya >/dev/null 2>&1 || {
  echo "no 'darya' remote. Add it:"; echo "  git remote add darya https://github.com/ferranrego/darya.git"; exit 1; }

git fetch darya

OTHER=prs
for sha in "$@"; do
  echo "==> $(git log -1 --format='%h %s' "$sha")"
  git cherry-pick -n "$sha"
  removed=$(git diff --cached --name-only -- \
    "src/lib/lang/$OTHER" "content/$OTHER" "scripts/data" 2>/dev/null \
    | grep -E "(^|/)($OTHER)(/|[.-])" || true)
  if [ -n "$removed" ]; then
    echo "    dropping $SIBN-only files this repo does not carry:"
    printf '      %s\n' $removed
    git rm -rq --ignore-unmatch $removed
  fi
  git commit -q -C "$sha"
  echo "    -> $(git log -1 --format='%h')"
done

echo
echo "now run: pnpm gate"
