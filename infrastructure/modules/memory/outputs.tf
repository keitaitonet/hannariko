output "table_name" {
  value = aws_dynamodb_table.memory.name
}

output "table_arn" {
  value = aws_dynamodb_table.memory.arn
}
