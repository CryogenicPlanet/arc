#!/usr/bin/env bash
# Runs after the initial auto-analysis of bin/Arc.arm64 into ghidra/project:
# applies recovered names, exports function bounds, then decompiles everything.
#   tools/ghidra-post.sh [names|export|decompile|all]   (default: all)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export GHIDRA_HEADLESS_MAXMEM="${GHIDRA_HEADLESS_MAXMEM:-24G}"
HEADLESS="/opt/homebrew/opt/ghidra/libexec/support/analyzeHeadless"
STEP="${1:-all}"

run() {
  "$HEADLESS" "$ROOT/ghidra/project" Arc -process Arc.arm64 -noanalysis \
    -scriptPath "$ROOT/ghidra/scripts" "$@" 2>&1 | grep -vE "WARN|Unable to read bytes" | grep -E "INFO  (ApplyArcNames|ExportFunctions|DecompileAll)|ERROR|Exception" || true
}

if [[ "$STEP" == names || "$STEP" == all ]]; then
  bun "$ROOT/tools/build-symbol-map.ts"
  run -postScript ApplyArcNames.java "$ROOT/dump/symbol-map.tsv"
fi
if [[ "$STEP" == export || "$STEP" == all ]]; then
  run -postScript ExportFunctions.java "$ROOT/ghidra/functions.tsv" -readOnly
fi
if [[ "$STEP" == decompile || "$STEP" == all ]]; then
  run -postScript DecompileAll.java "$ROOT/ghidra/decomp" 60 -readOnly
fi
