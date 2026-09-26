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

## デプロイの状態

Botの再実装に向けて、リポジトリ内の旧Docker構成と自動デプロイを削除しています。
Terraform定義と `scripts/deploy.sh` は保持していますが、新実装用のイメージと
Compose設定が揃うまでは、新しいデプロイは行いません。
既存の本番コンテナ・ボリューム・環境変数はこの整理では変更していません。

GitHub EnvironmentやIAMなど、既存のデプロイ基盤も保持しています。
新しいCI/CDの接続は実装後に行います。

EC2 でのログ確認:

```sh
cd /opt/hannariko
docker compose --env-file image.env logs --tail=100 -f bot
```
