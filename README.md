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
利用状況の分析は [docs/analysis.md](docs/analysis.md) を参照。

Discord で「この挙動を記録して」「こういう機能がほしいので残して」などと伝えると、bot が tool で会話と自身の状態を保存できる。
使い方と調査時の取得手順は [docs/context-records.md](docs/context-records.md) を参照。
