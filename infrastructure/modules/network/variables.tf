variable "cidr_block" {
  type        = string
  description = "VPCとサブネットのCIDR"
}

variable "availability_zone" {
  type        = string
  description = "Botを配置するAZ"
}
