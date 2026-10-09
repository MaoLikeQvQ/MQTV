#!/usr/bin/env bash
# Executed over SSH; .env and docker-compose.yml must already exist on the server.
set -euo pipefail

deploy_path=${1:?Usage: deploy.sh DEPLOY_PATH APP_IMAGE DRPY_IMAGE}
app_image=${2:?APP_IMAGE is required}
drpy_image=${3:?DRPY_IMAGE is required}
[[ "$deploy_path" = /* ]] || { echo 'DEPLOY_PATH must be absolute' >&2; exit 1; }
[[ "$app_image" =~ ^ghcr.io/maolikeqvq/mqtv@sha256:[a-f0-9]{64}$ ]] || exit 1
[[ "$drpy_image" =~ ^ghcr.io/maolikeqvq/mqtv-drpy@sha256:[a-f0-9]{64}$ ]] || exit 1
cd "$deploy_path"
[[ -f .env && -f docker-compose.yml ]] || { echo 'Upload .env and docker-compose.yml first' >&2; exit 1; }
command -v flock >/dev/null || { echo 'Install flock (util-linux) first' >&2; exit 1; }
exec 9>.deploy.lock
flock -w 300 9 || { echo 'Another deployment holds .deploy.lock' >&2; exit 1; }
docker compose version >/dev/null
# Shell exports take precedence over --env-file; release files must own image selection.
unset LIBRETV_IMAGE DRPY_IMAGE

umask 077
pending=$(mktemp .env.release.pending.XXXXXX)
printf 'LIBRETV_IMAGE=%s\nDRPY_IMAGE=%s\n' "$app_image" "$drpy_image" > "$pending"
compose=(docker compose --file docker-compose.yml --env-file .env --env-file "$pending")
drpy_enabled=0
update_started=0
finish() {
  result=$?
  trap - EXIT
  if (( result != 0 && update_started )); then
    if [[ -f .env.release ]]; then
      echo 'Deployment failed; restoring the previous image pair' >&2
      rollback=(docker compose --file docker-compose.yml --env-file .env --env-file .env.release)
      if [[ "$drpy_enabled" = 1 ]]; then rollback+=(--profile drpy); fi
      if "${rollback[@]}" up -d --no-build --wait --wait-timeout 120; then
        echo 'Previous release restored; this deployment remains failed' >&2
      else
        echo 'Rollback also failed; inspect docker compose ps and container logs' >&2
      fi
    else
      echo 'First deployment failed; no recorded previous release is available' >&2
    fi
  fi
  rm -f "$pending"
  exit "$result"
}
trap finish EXIT

# Compose parses .env, including quoted values; never execute it as a shell script.
drpy_enabled=$("${compose[@]}" config --environment | sed -n 's/^DRPY_ENABLED=//p')
if [[ "$drpy_enabled" = 1 ]]; then compose+=(--profile drpy); fi
"${compose[@]}" pull
update_started=1
"${compose[@]}" up -d --no-build --wait --wait-timeout 120
# Save only image references; runtime settings and private sources stay untouched.
mv "$pending" .env.release
echo 'MQTV deployment healthy; image pair recorded in .env.release'
