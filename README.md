# はんなり子

Discordサーバーの参加者として会話するBot。Node.js 24 / pnpmを使用。

現在はMastra版を削除し、新実装を始める前の状態です。
Botのソースコード・テスト・起動／ビルドコマンド・Docker構成はまだありません。
新しい依存ライブラリも、この段階では追加していません。

## 残しているもの

- Node.js / pnpm / TypeScriptの開発設定
- `.env.example`：OpenAI APIキーとDiscord Botトークンの設定例
- `infrastructure/`：既存AWS環境のTerraform定義
- `scripts/deploy.sh`：イメージとCompose設定を受け取る既存の配置スクリプト

依存関係は `pnpm install --frozen-lockfile` で準備できます。
CIは依存関係の整合性と配置スクリプトの構文だけを確認します。
自動ビルド・デプロイは新実装に合わせて再構成します。
この変更では稼働中の本番環境を変更していません。

旧実装はGit履歴から参照できます。
設計メモは検討資料であり、全記述が合意済みという扱いではありません。
