#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash deploy/huoshan/deploy.sh [--ref <commit>] [--apply --expect <current-release>]
Without --apply, build and validate the committed release locally.
EOF
}

ref=HEAD
apply=false
expected=
while (( $# )); do
  case "$1" in
    --ref) ref="${2:?Missing Git ref}"; shift 2 ;;
    --apply) apply=true; shift ;;
    --expect) expected="${2:?Missing current release}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
if "$apply" && [[ ! "$expected" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]]; then
  echo 'Pass the current production release name with --expect.' >&2
  exit 2
fi

export LC_ALL=C COPYFILE_DISABLE=1
cd "$(dirname "$0")/../.."
root="$(pwd -P)"
commit="$(git rev-parse --verify --end-of-options "$ref^{commit}")"
name="$(date -u +%Y%m%d-%H%M%S)-${commit:0:12}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir "$work/release"
git archive "$commit" src public migrations scripts local-sync deploy/huoshan package.json |
  tar -xf - -C "$work/release"

(
  cd "$work/release"
  "$root/node_modules/.bin/esbuild" deploy/huoshan/entry.ts --bundle --format=esm \
    --platform=neutral --target=es2022 --outfile=deploy/huoshan/worker.mjs
  node --check deploy/huoshan/worker.mjs
  bash -n deploy/huoshan/activate-release.sh
  for extension in js css; do
    hash="$(shasum -a 256 "public/admin/admin.$extension")"
    asset="admin.${hash:0:12}.$extension"
    grep -Fq "/admin/$asset" public/admin/index.html
    cmp "public/admin/admin.$extension" "public/admin/$asset"
  done
  printf '%s\n' "$commit" > RELEASE_COMMIT
  tar -czf "$work/release.tar.gz" .
)
checksum="$(shasum -a 256 "$work/release.tar.gz")"
printf 'Built %s from %s\n' "$name" "$commit"
if ! "$apply"; then
  exit 0
fi

# The release name, predecessor, and checksum are restricted to shell-safe names above.
ssh -T -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 huoshan-server \
  "bash -c '
    set -euo pipefail
    umask 077
    cd /opt/ldxp-cf-demo/backups
    mkdir $name
    cd $name
    cat > release.tar.gz
    printf "%s  release.tar.gz\\n" ${checksum:0:64} | sha256sum -c -
    tar -xOzf release.tar.gz ./deploy/huoshan/activate-release.sh > activate-release.sh
    exec bash activate-release.sh $name $expected
  '" < "$work/release.tar.gz"
