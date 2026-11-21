#!/usr/bin/env bash
set -eu

cd "$(dirname "$0")/.."

if [ -e store/listing.md ]; then
  echo "store/listing.md is an internal worksheet and must not be published." >&2
  exit 1
fi

# Patterns are split so this file can be scanned without matching itself.
mail='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
homes='(/Us''ers/|C:\\Us''ers\\)'
keys='BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}'

if LC_ALL=C grep -rInE --exclude-dir=.git --exclude-dir=node_modules --exclude=privacy-scan.sh -- "$mail|$homes|$keys" .; then
  exit 1
else
  result=$?
  if [ "$result" -ne 1 ]; then exit "$result"; fi
fi

echo "Privacy scan passed."
