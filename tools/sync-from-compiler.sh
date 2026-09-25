#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 /path/to/sultanc" >&2
  exit 2
fi

SULTANC_ROOT=$(cd "$1" && pwd)
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REGISTRY="$SULTANC_ROOT/tools/generate/registry/token_registry.def"
IDENTIFIERS="$SULTANC_ROOT/tools/generate/registry/identifier_policy_registry.def"

[[ -f "$REGISTRY" ]] || { echo "missing $REGISTRY" >&2; exit 1; }
[[ -f "$IDENTIFIERS" ]] || { echo "missing $IDENTIFIERS" >&2; exit 1; }

python3 "$HERE/tools/generate-syntax.py" \
  "$REGISTRY" \
  --identifier-policy "$IDENTIFIERS" \
  --surface "$HERE/metadata/syntax-surface.json" \
  --grammar "$HERE/grammars/sultanc.tmLanguage.json"

python3 "$HERE/tests/verify_language_support.py"
echo "SultanC language-support assets synchronized from compiler-owned registries."
