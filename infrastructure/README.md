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
CI/CD は次の段階で追加する。
