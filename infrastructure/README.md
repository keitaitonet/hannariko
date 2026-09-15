# Infrastructure

本番 1 環境のみ。Terraform は `environments/production/` に直接定義する。

- EC2: `t3a.small`、Amazon Linux 2023、gp3 20 GiB。
- 専用 VPC / パブリックサブネット 1 つ / Internet Gateway を作成。
  SG は外向き通信のみ許可。NAT Gateway・ロードバランサーは置かない。
- EC2 は SSM で管理し、ECR からイメージを取得する。
- GitHub Actions の OIDC は、この repo の `main` だけを許可。
- state: `s3://tfstate-075472845547-ap-northeast-1-an/hannariko/production/terraform.tfstate`。

## 検証

```sh
cd infrastructure/environments/production
AWS_PROFILE=poc terraform init -backend=false
terraform fmt -check
terraform validate
```

実際の plan / apply はユーザーが実行する。S3 backend を使う際は、
`AWS_PROFILE=poc terraform init` で初期化する。
`.terraform.lock.hcl` は Git に含める。

## 今回の範囲

インフラの定義まで。Docker Compose の初期設定、アプリの永続化設定、
CI/CD は次の差分で追加する。現時点で apply しても Bot は起動しない。
秘密情報は Terraform に渡さない。

## デフォルトから変えている設定

- gp3 20 GiB と暗号化: コンテナと DB 用。
- `cpu_credits = "standard"`: CPU バーストの追加料金を避ける。
- `ignore_changes = [ami]` / `prevent_destroy`: 新しい AMI 公開などによる
  EC2 の意図しない置き換えを防ぐ。OS 更新・移行は別途行う。
- `delete_on_termination = false`: EC2 を終了してもデータ入り EBS を残す。
  復旧は手動で、残した EBS には課金される。バックアップは別途検討。

コンテナ更新ではデータを保持する予定。ロールバックは設けない。
