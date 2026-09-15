# Infrastructure

東京リージョンの本番 1 環境。専用 VPC に EC2 `t3a.small`（gp3 20 GiB）を配置。
ECR にイメージを保存し、SSM で管理する。

```sh
cd infrastructure/environments/production
export AWS_PROFILE=poc
terraform init
terraform plan
terraform apply
```

state: `s3://tfstate-075472845547-ap-northeast-1-an/hannariko/production/terraform.tfstate`

EC2 の置き換えは `prevent_destroy` で保護。終了後も EBS は残る。
初回起動で Docker / Compose を導入する。アプリの配置先は `/opt/hannariko`。

## CI/CD

PR でビルド・起動確認、`main` への push で ECR → SSM → Compose 更新。

初回設定:

1. GitHub Environment `production` を作成し、デプロイ元を `main` ブランチのみに制限（承認なし）。`terraform output -json github_actions_variables` の値をその Environment の Variables に設定。
2. EC2 の `/opt/hannariko/.env` に Bot の環境変数を用意。
3. `main` に push、または Actions の「CI and deploy」を手動実行。

EC2 でのログ確認:

```sh
cd /opt/hannariko
docker compose --env-file image.env logs --tail=100 -f bot
```
