#!/usr/bin/env bash
# Runs on the production host (piped over ssh by release.sh): download the verified Windows
# artifact straight from GitHub through a short-lived link, then publish it through the
# repository's operator-only publisher. Usage: server-publish.sh <artifact-url> <source-sha> <notes-base64>
set -euo pipefail
url=$1; sha=$2; notes=$(printf '%s' "$3" | base64 -d)
app=/var/www/glintex-app; releases=/var/lib/glintex/desktop-releases
work=$(mktemp -d /root/glintex-desktop-release.XXXXXX)
trap 'rm -rf "$work"' EXIT
curl -fsSL --retry 3 -o "$work/artifact.zip" "$url"
unzip -q "$work/artifact.zip" -d "$work/artifact"
delivery=$work/artifact/out/delivery
version=$(python3 -c "import json,sys;m=json.load(open(sys.argv[1],encoding='utf-8-sig'));assert m['sourceCommit']==sys.argv[2],'artifact is for a different commit';print(m['version'])" "$delivery/manifest.json" "$sha")
cd "$app"
node apps/backend/scripts/publish-desktop-release.mjs "$delivery" "$work/artifact/out/verification/windows-verification.json" "$releases" "$notes"
# The backend container reads releases as uid 1000 through the ubuntu group.
chown root:ubuntu "$releases/latest.json" "$releases/$version" "$releases/$version"/*
chmod 750 "$releases/$version"; chmod 640 "$releases/$version"/* "$releases/latest.json"
echo "--- latest.json: $(cat "$releases/latest.json")"
docker exec glintex-app-backend-1 node -e "const m=require('/app/desktop-releases/$version/manifest.json');console.log('backend serves', m.version, m.sourceCommit.slice(0,8), m.sha256.slice(0,12))"
