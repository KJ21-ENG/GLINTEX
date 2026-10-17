#!/usr/bin/env bash
# One-command GLINTEX Windows desktop release, run from the GLINTEX main checkout:
#   scripts/desktop-release/release.sh "<release notes>"                     bump patch, push main, build, publish
#   scripts/desktop-release/release.sh --no-bump "<release notes>"           build and publish the version already on main
#   scripts/desktop-release/release.sh --publish-run <run-id> "<release notes>"  publish a finished builder run
# The private builder (KJ21-ENG/GLINTEX-desktop-builds) builds and verifies the pushed commit;
# the production host then downloads the artifact straight from GitHub. Nothing large passes
# through this machine. Production backend deploys stay separate (.github/scripts/deploy-production.sh).
set -euo pipefail
BUILDER=KJ21-ENG/GLINTEX-desktop-builds
WORKFLOW=electron-windows.yml
HOST=glintex
RELEASES=/var/lib/glintex/desktop-releases
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
cd "$root"

mode=release; run=""
case "${1:-}" in
  --no-bump) mode=no-bump; shift ;;
  --publish-run) mode=publish; run=${2:?run id required}; shift 2 ;;
esac
notes=${1:?usage: release.sh [--no-bump | --publish-run <run-id>] "<release notes>"}
step() { printf '\n== %s  [%s]\n' "$1" "$(date +%H:%M:%S)"; }
version_of() { node -p "require('./apps/desktop/package.json').version"; }
already_published() { ssh "$HOST" "test -e $RELEASES/$1"; }

publish() { # <run-id> <source-sha>
  step "Publishing run $1 on $HOST"
  local artifact url
  artifact=$(gh api "repos/$BUILDER/actions/runs/$1/artifacts" -q '.artifacts[] | select(.name | startswith("GLINTEX-Windows-x64-")) | select(.expired | not) | .id' | head -n 1)
  [ -n "$artifact" ] || { echo "No unexpired delivery artifact on run $1" >&2; exit 1; }
  # GitHub answers with a redirect to a signed download link that is valid for about a minute.
  url=$(curl -sSI -H "Authorization: Bearer $(gh auth token)" -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$BUILDER/actions/artifacts/$artifact/zip" | tr -d '\r' | awk 'tolower($1)=="location:" {print $2}')
  [ -n "$url" ] || { echo "GitHub did not return a download link for artifact $artifact" >&2; exit 1; }
  ssh "$HOST" bash -s -- "$(printf %q "$url")" "$2" "$(printf '%s' "$notes" | base64 | tr -d '\n')" < "$here/server-publish.sh"
}

if [ "$mode" = publish ]; then
  sha=$(gh run view "$run" -R "$BUILDER" --json displayTitle -q .displayTitle | awk '{print $NF}')
  [[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "Could not read the source commit from run $run" >&2; exit 1; }
  publish "$run" "$sha"
  exit 0
fi

step "Checking main"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "Run from the main branch" >&2; exit 1; }
git fetch -q origin main
git merge-base --is-ancestor origin/main HEAD || { echo "Local main is behind origin/main; pull first" >&2; exit 1; }
version_files="apps/desktop/package.json apps/desktop/package-lock.json package-lock.json"
git diff --quiet HEAD -- $version_files || { echo "Uncommitted changes in $version_files" >&2; exit 1; }
git diff --quiet HEAD -- apps || echo "Note: uncommitted changes under apps/ are not part of this release."

if [ "$mode" = release ]; then
  version=$(node -e "const [a,b,c]=require('./apps/desktop/package.json').version.split('.').map(Number);console.log([a,b,c+1].join('.'))")
  already_published "$version" && { echo "$version is already published" >&2; exit 1; }
  step "Version $version"
  node - "$version" <<'JS'
const fs = require('fs'), version = process.argv[2];
const edit = (file, change) => { const json = JSON.parse(fs.readFileSync(file, 'utf8')); change(json); fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n'); };
edit('apps/desktop/package.json', j => { j.version = version; });
edit('apps/desktop/package-lock.json', j => { j.version = version; j.packages[''].version = version; });
edit('package-lock.json', j => { j.packages['apps/desktop'].version = version; });
JS
  git commit -q -m "chore(desktop): version $version — $(printf '%s' "$notes" | head -n 1)" -- $version_files
else
  version=$(version_of)
  already_published "$version" && { echo "$version is already published; bump first" >&2; exit 1; }
fi
git push -q origin HEAD:main
sha=$(git rev-parse HEAD)
echo "main is at $sha"

step "Building $version on $BUILDER"
tag="v${version//./}-${sha:0:8}-$(date +%H%M%S)"
gh workflow run "$WORKFLOW" -R "$BUILDER" -f source_sha="$sha" -f run_tag="$tag"
title="GLINTEX $tag / $sha"
for _ in $(seq 1 30); do
  run=$(gh run list -R "$BUILDER" -w "$WORKFLOW" -L 10 --json databaseId,displayTitle -q ".[] | select(.displayTitle == \"$title\") | .databaseId" | head -n 1)
  [ -n "$run" ] && break; sleep 2
done
[ -n "$run" ] || { echo "Could not find the dispatched run" >&2; exit 1; }
echo "https://github.com/$BUILDER/actions/runs/$run"
while :; do
  read -r state conclusion < <(gh run view "$run" -R "$BUILDER" --json status,conclusion -q '"\(.status) \(.conclusion)"')
  [ "$state" = completed ] && break
  printf '  %s %s\n' "$(date +%H:%M:%S)" "$state"; sleep 30
done
if [ "$conclusion" != success ]; then
  echo "Build $run ended: $conclusion" >&2
  gh run view "$run" -R "$BUILDER" --log-failed 2>/dev/null | tail -n 60 >&2 || true
  exit 1
fi

publish "$run" "$sha"
step "GLINTEX $version is live"
