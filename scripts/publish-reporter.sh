#!/bin/sh
# Builds the standalone reporter and publishes it with the workflow to the
# public repo wngstnr-code/clamp-reporter (reporter 2, D-054).
# Usage: scripts/publish-reporter.sh "<commit message>"
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CLONE=${CLAMP_REPORTER_CLONE:-"$ROOT/../clamp-reporter"}
MSG=${1:-"build: update reporter"}
SRC=$(git -C "$ROOT" rev-parse --short HEAD)

pnpm --dir "$ROOT" --filter @clamp/backend bundle:reporter
[ -d "$CLONE/.git" ] || git clone https://github.com/wngstnr-code/clamp-reporter.git "$CLONE"
mkdir -p "$CLONE/.github/workflows"
cp "$ROOT/scripts/reporter-repo/.github/workflows/report.yml" "$CLONE/.github/workflows/report.yml"
cp "$ROOT/scripts/reporter-repo/README.md" "$ROOT/scripts/reporter-repo/LICENSE" "$CLONE/"
cp "$ROOT/backend/dist/reporter.mjs" "$CLONE/reporter.mjs"
cd "$CLONE"
git add -A
if git diff --cached --quiet; then echo "nothing to publish"; exit 0; fi
git commit -q -m "$MSG" -m "Built from clamp commit $SRC."
git push -q origin HEAD:main
echo "published $(git rev-parse --short HEAD)"
