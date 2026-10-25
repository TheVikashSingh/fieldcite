#!/usr/bin/env bash
# CS-12: fails if a secret from the build environment reached what the browser downloads. Run
# after `npm run build` with sentinel values (not real secrets) in these variables; CI does.
set -euo pipefail

names=(OPENAI_API_KEY PERPLEXITY_API_KEY GEMINI_API_KEY DATABASE_URL AUTH_SECRET RESEND_API_KEY TURNSTILE_SECRET_KEY)
[ -d .next/static ] || { echo "No .next/static: run npm run build first." >&2; exit 1; }

# Browser bundles, plus the prerendered HTML and RSC payloads served to visitors.
targets=(.next/static)
[ -d .next/server/app ] && targets+=(.next/server/app)

status=0
for name in "${names[@]}"; do
  value="${!name:-}"
  if [ -z "$value" ]; then
    echo "$name is not set: set a sentinel value so the check can look for it." >&2
    exit 1
  fi
  if grep -rlF --include='*.js' --include='*.css' --include='*.html' --include='*.rsc' --include='*.txt' -- "$value" "${targets[@]}"; then
    echo "::error::The value of $name is in the files above." >&2
    status=1
  fi
  if grep -rlF -- "$name" .next/static; then
    echo "::error::$name is named in the browser bundle above." >&2
    status=1
  fi
done

[ "$status" -eq 0 ] && echo "No secret values in client bundles or prerendered pages."
exit "$status"
