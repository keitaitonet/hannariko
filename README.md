# はんなり子

Discord 用の Mastra Bot。Node.js 24 / pnpm を使用。
`.env.example` を参考に `.env` を用意する。

## ローカル開発

```sh
pnpm install --frozen-lockfile
pnpm dev
```

## Docker Compose

```sh
docker build --platform linux/amd64 -t hannariko:local .
export BOT_IMAGE=hannariko:local
docker compose up -d --wait
docker compose logs --tail=100 -f bot
docker compose down
```

DB は volume `hannariko_data` に保存。`down -v` で削除される。

AWS 構成は [infrastructure/README.md](infrastructure/README.md) を参照。
