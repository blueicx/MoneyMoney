#!/usr/bin/env bash
set -euo pipefail

tag="${1:?release tag required}"
archive="${2:?remote archive path required}"
expected_archive="${3:?archive SHA-256 required}"
expected_server="${4:?server SHA-256 required}"
expected_index="${5:?index SHA-256 required}"

[[ "$tag" =~ ^[a-zA-Z0-9._-]+$ ]] || { echo 'invalid release tag' >&2; exit 2; }
[[ "$archive" == /tmp/moneymoney-*.tar.gz ]] || { echo 'archive must be a bounded /tmp/moneymoney-*.tar.gz path' >&2; exit 2; }

app_root=/opt/moneymoney
stage="$app_root/.staging/dist-$tag"
backup="$app_root/backups/dist-pre-$tag"
rollback="$app_root/dist.rollback-$tag"
failed="$app_root/dist.failed-$tag"

test -d "$app_root/dist"
test -f "$archive"
for target in "$stage" "$backup" "$rollback" "$failed"; do
  test ! -e "$target" || { echo "target already exists: $target" >&2; exit 3; }
done

actual_archive=$(sha256sum "$archive" | awk '{print $1}')
test "$actual_archive" = "$expected_archive" || { echo 'archive hash mismatch' >&2; exit 4; }

mkdir -p "$app_root/.staging" "$app_root/backups"
mkdir "$stage"
tar -xzf "$archive" -C "$stage"
test -f "$stage/dist/web/server.js"
test -f "$stage/dist/web/public/index.html"
test "$(sha256sum "$stage/dist/web/server.js" | awk '{print $1}')" = "$expected_server"
test "$(sha256sum "$stage/dist/web/public/index.html" | awk '{print $1}')" = "$expected_index"

cp -a "$app_root/dist" "$backup"
systemctl stop moneymoney.service
mv "$app_root/dist" "$rollback"
mv "$stage/dist" "$app_root/dist"
chown -R moneymoney:moneymoney "$app_root/dist"
systemctl start moneymoney.service

healthy=0
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/api/health/live >/dev/null; then healthy=1; break; fi
  sleep 1
done

if [[ "$healthy" != 1 ]]; then
  systemctl stop moneymoney.service || true
  mv "$app_root/dist" "$failed"
  mv "$rollback" "$app_root/dist"
  chown -R moneymoney:moneymoney "$app_root/dist"
  systemctl start moneymoney.service
  echo 'deployment failed; rollback restored' >&2
  exit 5
fi

test "$(sha256sum "$app_root/dist/web/server.js" | awk '{print $1}')" = "$expected_server"
test "$(sha256sum "$app_root/dist/web/public/index.html" | awk '{print $1}')" = "$expected_index"
echo "release=$tag"
echo "backup=$backup"
echo "rollback=$rollback"
echo "archive_sha256=$actual_archive"
echo "service=$(systemctl is-active moneymoney.service)"
curl -fsS http://127.0.0.1:3001/api/health/live
