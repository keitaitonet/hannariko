variable "name" {
  type        = string
  description = "デプロイ対象の名前"
}

variable "region" {
  type        = string
  description = "デプロイ先リージョン"
}

variable "github_subject" {
  type        = string
  description = "production Environmentに限定するGitHub OIDCのsub"
}

variable "repository_arn" {
  type        = string
  description = "イメージのpush先ECR"
}

variable "instance_arn" {
  type        = string
  description = "SSMコマンド実行先のEC2"
}
