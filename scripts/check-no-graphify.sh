#!/usr/bin/env bash
# Fails if stale graphify command references remain in tracked files.
set -euo pipefail

hits=$(git grep -nE "graphify (query|path|explain)" -- ':!scripts/check-no-graphify.sh' || true)

if [[ -n "$hits" ]]; then
  echo "Found stale graphify references:"
  echo "$hits"
  exit 1
fi

echo "No stale graphify references found."
