#!/bin/bash
set -euo pipefail
umask 077

export BOT_IMAGE=${1:?image digest required}
compose_config=${2:?base64 compose config required}
region=${3:?AWS region required}

cloud-init status --wait
cd /opt/hannariko
exec 9>.deploy.lock
flock -w 600 9
trap 'rm -f compose.next.yaml' EXIT

if [[ ! -f .env ]]; then
  echo '/opt/hannariko/.env に DISCORD_BOT_TOKEN と OPENAI_API_KEY を設定してください。' >&2
  exit 1
fi

printf %s "$compose_config" | base64 --decode > compose.next.yaml
docker compose --env-file /dev/null -f compose.next.yaml config --quiet
aws ecr get-login-password --region "$region" |
  docker login --username AWS --password-stdin "${BOT_IMAGE%%/*}"
docker compose --env-file /dev/null -f compose.next.yaml pull
mv compose.next.yaml compose.yaml
printf 'BOT_IMAGE=%s\n' "$BOT_IMAGE" > image.env
docker compose --env-file image.env up -d --wait --wait-timeout 120

# このBotのコンテナが参照していない旧イメージだけを削除する。
docker image prune --all --force \
  --filter label=org.opencontainers.image.source=https://github.com/keitaitonet/hannariko
