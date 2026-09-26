resource "aws_dynamodb_table" "memory" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "guildId"
  range_key    = "memoryKey"

  attribute {
    name = "guildId"
    type = "S"
  }

  attribute {
    name = "memoryKey"
    type = "S"
  }

  deletion_protection_enabled = true
}

