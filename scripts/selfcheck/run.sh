#!/usr/bin/env bash
# scripts/selfcheck/run.sh — adversarial self-test for every verifier.
#
# Runs every mutation script in mutations/, asserts each one detects the
# injected defect, and prints "N mutations, N detected".
#
# Options:
#   --list          list mutation names and exit
#   --verbose       show full output from each mutation
#   --filter <pat>  run only mutations whose name contains <pat>
#
# Exit: 0 when ALL mutations are detected, 1 otherwise.
set -euo pipefail

SELFDIR="$(cd "$(dirname "$0")" && pwd)"
MUTDIR="$SELFDIR/mutations"

# ---- argument parsing ----
LIST=0
VERBOSE=0
FILTER=""

while [ $# -gt 0 ]; do
  case "$1" in
    --list) LIST=1 ;;
    --verbose) VERBOSE=1 ;;
    --filter) FILTER="$2"; shift ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
  shift
done

if [ ! -d "$MUTDIR" ]; then
  echo "ERROR: mutations directory not found: $MUTDIR"
  exit 2
fi

# Collect mutation scripts (sorted for deterministic output)
mapfile -t MUTATIONS < <(find "$MUTDIR" -mindepth 1 -maxdepth 1 -type f -name '*.sh' | sort)

# Apply filter
if [ -n "$FILTER" ]; then
  FILTERED=()
  for m in "${MUTATIONS[@]}"; do
    name=$(basename "$m" .sh)
    if [[ "$name" == *"$FILTER"* ]]; then
      FILTERED+=("$m")
    fi
  done
  MUTATIONS=("${FILTERED[@]}")
fi

TOTAL=${#MUTATIONS[@]}

# ---- list mode ----
if [ "$LIST" -eq 1 ]; then
  for m in "${MUTATIONS[@]}"; do
    basename "$m" .sh
  done
  exit 0
fi

if [ "$TOTAL" -eq 0 ]; then
  echo "0 mutations, 0 detected"
  exit 0
fi

# ---- run mode ----
echo "=== huu selfcheck — $TOTAL mutation(s) ==="

DETECTED=0
FAILED=()

for m in "${MUTATIONS[@]}"; do
  NAME=$(basename "$m" .sh)

  if [ "$VERBOSE" -eq 1 ]; then
    echo "--- $NAME ---"
    bash "$m" 2>&1
    RC=$?
  else
    OUT=$(bash "$m" 2>&1) || true
    RC=$?
    # Only show PASS/FAIL line, but show full output on failure
    PASS_LINE=$(echo "$OUT" | grep '^PASS ' || true)
    FAIL_LINE=$(echo "$OUT" | grep '^FAIL ' || true)
    if [ "$RC" -eq 0 ] && [ -n "$PASS_LINE" ]; then
      echo "$PASS_LINE"
      DETECTED=$((DETECTED + 1))
    else
      echo "FAIL $NAME"
      echo "$OUT"
      FAILED+=("$NAME")
    fi
  fi
done

echo "---"
echo "$TOTAL mutations, $DETECTED detected"

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "Undetected: ${FAILED[*]}"
  exit 1
fi

exit 0
