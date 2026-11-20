#!/usr/bin/env bash
set -euo pipefail

base=/opt/ldxp-cf-demo
unit=ldxp-cf-demo.service
node=/usr/local/bin/node
name="${1:?Missing release name}"
predecessor="${2:?Missing predecessor}"
[[ "$name" =~ ^[0-9]{8}-[0-9]{6}-[a-f0-9]{12}$ ]]
[[ "$predecessor" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]]
release="$base/releases/$name"
previous="$base/releases/$predecessor"
cd "$base/backups/$name"
export LC_ALL=C
umask 077

exec 9>"$base/.stock-release.lock"
flock -n 9
if [[ "$(readlink -f "$base/current")" != "$previous" ]]; then
  echo "Current release changed. Expected $previous." >&2
  exit 1
fi

mkdir -m 0755 "$release"
# Keep the release readable by the service user and keep backup files private.
(umask 022; tar --no-same-owner --no-same-permissions --no-overwrite-dir -xzf release.tar.gz -C "$release")
for file in package.json package-lock.json; do
  if ! cmp -s "$previous/deploy/huoshan/$file" "$release/deploy/huoshan/$file"; then
    echo "Runtime $file changed. Install and verify the new production dependencies before switching releases." >&2
    exit 1
  fi
done
dependencies="$(readlink -e "$previous/deploy/huoshan/node_modules")"
test -d "$dependencies/miniflare"
ln -s "$dependencies" "$release/deploy/huoshan/node_modules"

# Keep the previous admin fingerprinted assets available for browsers with cached HTML.
for asset in "$previous"/public/admin/admin.*.js "$previous"/public/admin/admin.*.css; do
  [[ -f "$asset" && "${asset##*/}" =~ ^admin\.[a-f0-9]{12}\.(js|css)$ ]] || continue
  destination="$release/public/admin/${asset##*/}"
  [[ -e "$destination" ]] || cp -p "$asset" "$destination"
done
for file in deploy/huoshan/worker.mjs deploy/huoshan/server.mjs public/index.html public/admin/index.html; do
  runuser -u ldxp -- test -r "$release/$file"
done
"$node" --check "$release/deploy/huoshan/worker.mjs"

python3 - <<'PY'
import sqlite3
from contextlib import closing
from pathlib import Path

state = Path("/var/lib/ldxp-cf-demo/d1")
files = [path for path in state.rglob("*.sqlite") if path.name != "metadata.sqlite"]
if len(files) != 1:
    raise SystemExit(f"Expected one production database, found {len(files)}")
with closing(sqlite3.connect(files[0].as_uri() + "?mode=ro", uri=True, timeout=15)) as source:
    with closing(sqlite3.connect("pre-deploy.sqlite")) as backup:
        source.backup(backup)
        if backup.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise SystemExit("Production backup failed SQLite integrity check")
print("SQLite backup verified", flush=True)
PY

switch_to() {
  ln -s "$1" "$base/.next-$name" && mv -Tf "$base/.next-$name" "$base/current"
}

rollback() {
  local status=$?
  trap - EXIT
  if (( status != 0 )) && [[ "$(readlink -f "$base/current")" == "$release" ]]; then
    echo 'Release verification failed. Restoring previous application.' >&2
    if switch_to "$previous" && systemctl restart "$unit" &&
      "$node" "$previous/deploy/huoshan/wait-ready.mjs" && systemctl is-active "$unit"; then
      echo "Restored $previous" >&2
    else
      echo "Automatic rollback failed. Inspect $unit and $base/current immediately." >&2
    fi
  fi
  exit "$status"
}

trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
test "$(readlink -f "$base/current")" = "$previous"
switch_to "$release"
systemctl restart "$unit"
"$node" "$release/deploy/huoshan/wait-ready.mjs"
systemctl is-active "$unit"

fetch=(curl --noproxy '*' --silent --show-error --retry 2 --max-time 10 -A Mozilla/5.0)
for endpoint in http://127.0.0.1:8787 https://parity.sirhao.top; do
  "${fetch[@]}" --fail "$endpoint/?lang=zh&release=$name" -o home.html
  "${fetch[@]}" --fail "$endpoint/admin/?release=$name" -o admin.html
  for asset in $(grep -Eo '/admin/admin\.[a-f0-9]{12}\.(js|css)' "$release/public/admin/index.html"); do
    grep -Fq "$asset" admin.html
    "${fetch[@]}" --fail "$endpoint$asset" -o asset.check
    cmp asset.check "$release/public$asset"
  done
  for asset in styles.css app.js i18n.js select-picker.js sponsors.js sponsor-crop.js; do
    # Probe the URL used by the real page, including its cache-busting version.
    asset_url="$(grep -m1 -Eo "/${asset%.*}\\.${asset##*.}(\?v=[a-zA-Z0-9._-]+)?" "$release/public/index.html")"
    grep -Fq "$asset_url" home.html
    "${fetch[@]}" --fail "$endpoint$asset_url" -o asset.check
    cmp asset.check "$release/public/$asset"
  done
  "${fetch[@]}" --fail "$endpoint/api/products?pageSize=1&release=$name" |
    python3 -c 'import json,sys; assert json.load(sys.stdin)["total"] > 0'
  "${fetch[@]}" --fail "$endpoint/api/sponsors" -D sponsors.headers |
    python3 -c 'import json,sys; data=json.load(sys.stdin); assert isinstance(data["enabled"], bool) and isinstance(data["ads"], list); print("Sponsors enabled={}, visible={}".format(data["enabled"], len(data["ads"])))'
  grep -Eiq '^cache-control: no-store([[:space:]]|$)' sponsors.headers
  status="$("${fetch[@]}" "$endpoint/api/control/sponsors" -o /dev/null -w '%{http_code}')"
  test "$status" = 401
  printf 'Verified %s\n' "$endpoint"
done
trap - EXIT INT TERM HUP
printf 'ACTIVE %s\nBACKUP %s/pre-deploy.sqlite\n' "$(readlink -f "$base/current")" "$PWD"
