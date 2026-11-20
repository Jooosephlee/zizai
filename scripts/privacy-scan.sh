#!/usr/bin/env bash
set -eu

cd "$(dirname "$0")/.."

# Split the literals here so the scanner can also inspect its own source.
# The public GitHub account is an authorized repository identity, so its login
# is not treated as a secret. Home directories, mail providers and old product
# names still are.
blocked='fuw''uok|dz''sq|amb''ero|电子''书签|bear''er|ct''0|collectTo''Bookmark|native''Messaging|gma''il|/Us''ers/|one''save|one-click-''save|__one_click_''save|(^|[^[:alnum:]_])(__)?o''cs([-_A-Z]|$)'

if LC_ALL=C grep -rInEi --exclude-dir=.git --exclude-dir=node_modules -- "$blocked" .; then
  exit 1
else
  result=$?
  if [ "$result" -ne 1 ]; then exit "$result"; fi
fi

# Commit metadata is pushed too. Check every author and committer, and
# refuse the local placeholder address so it is replaced before publishing.
if git rev-parse --verify --quiet HEAD >/dev/null; then
  identities=$(git log --all --format='%an <%ae>%n%cn <%ce>' | sort -u)
  if printf '%s\n' "$identities" | LC_ALL=C grep -Ei -- "$blocked|\.inva""lid>" ; then
    echo "Commit identity above must not be published. Set the public noreply address and rewrite these commits." >&2
    exit 1
  fi
fi

echo "Privacy scan passed."
