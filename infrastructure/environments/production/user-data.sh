#!/bin/bash
set -euo pipefail

dnf install -y docker

# Compose is not in the Amazon Linux repository; use the official release.
compose_binary=$(mktemp)
trap 'rm -f "$compose_binary"' EXIT
curl -fsSL --retry 3 \
  https://github.com/docker/compose/releases/download/v5.5.1/docker-compose-linux-x86_64 \
  -o "$compose_binary"
echo "db1889184726840f75c4f9c001048430d4f25b3be3cb084d3ddd762bc0aed576  $compose_binary" | sha256sum --check
install -D -m 755 "$compose_binary" /usr/local/lib/docker/cli-plugins/docker-compose

systemctl enable --now docker
install -d -m 700 /opt/hannariko
docker compose version
