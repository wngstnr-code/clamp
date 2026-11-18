#!/bin/sh
# Builds the reporter library and deploys reporter 3 to Netlify (D-054).
# Needs: `npx netlify-cli@27.16.2 login` once, and the site linked (first run asks).
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SITE="$ROOT/scripts/reporter-netlify"
pnpm --dir "$ROOT" --filter @clamp/sdk build
pnpm --dir "$ROOT/backend" exec esbuild src/reporter.ts --bundle --platform=node --format=esm --target=node22 \
  --outfile="$SITE/reporter-lib.mjs" --log-level=warning \
  --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"
cd "$SITE"
npx --yes netlify-cli@27.16.2 deploy --prod --dir public --functions netlify/functions
