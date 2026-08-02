#!/usr/bin/env bash
# validate-graph.sh — wrapper for scripts/validate-graph.ts
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npx tsx scripts/validate-graph.ts "$@"