#!/usr/bin/env bash
# Fails CI if SPEC.md loses any moat, feature or cost-safety invariant,
# or if ACTION_PLAN.md loses its release estimate.
set -euo pipefail
fail=0
need() { # file id
  if ! grep -qE "(^|[^A-Za-z0-9])$2([^0-9]|$)" "$1"; then
    echo "::error file=$1::missing required ID $2"; fail=1
  fi
}
for i in $(seq 1 14); do need SPEC.md "CS-$i"; done
for i in $(seq 1 5);  do need SPEC.md "M-$i";  done
for i in $(seq 1 9);  do need SPEC.md "F-$i";  done
grep -q '^## 9\. Cost safety' SPEC.md || { echo "::error file=SPEC.md::cost-safety section missing"; fail=1; }
grep -q '^## Estimated completion' ACTION_PLAN.md || { echo "::error file=ACTION_PLAN.md::estimated completion section missing"; fail=1; }
[ "$fail" -eq 0 ] && echo "spec guard: all required IDs present"
exit "$fail"
