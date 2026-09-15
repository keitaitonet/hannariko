#!/bin/bash
set -euo pipefail

export BOT_IMAGE=${1:?image digest required}
compose_config=${2:?base64 compose config required}
region=${3:?AWS region required}

cloud-init status --wait
cd /opt/hannariko
exec 9>.deploy.lock
flock -w 600 9
test -s .env

printf %s "$compose_config" | base64 --decode > compose.next.yaml
docker compose -f compose.next.yaml config --quiet
aws ecr get-login-password --region "$region" |
  docker login --username AWS --password-stdin "${BOT_IMAGE%%/*}"
docker compose -f compose.next.yaml pull
mv compose.next.yaml compose.yaml
printf 'BOT_IMAGE=%s\n' "$BOT_IMAGE" > image.env
docker compose --env-file image.env up -d --wait --wait-timeout 120

# Remove only unused images belonging to this bot.
docker image prune --all --force \
  --filter label=org.opencontainers.image.source=https://github.com/keitaitonet/hannariko
