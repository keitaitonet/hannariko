variable "name" {
  type        = string
  description = "Botのリソース名"
}

variable "vpc_id" {
  type        = string
  description = "配置先VPC"
}

variable "subnet_id" {
  type        = string
  description = "外部へ接続できる配置先サブネット"
}

variable "instance_type" {
  type        = string
  description = "EC2のインスタンスタイプ"
}

variable "memory_table_arn" {
  type        = string
  description = "読み書きを許可する記憶テーブル"
}
