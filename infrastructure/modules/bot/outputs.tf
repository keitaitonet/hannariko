output "instance_id" {
  value = aws_instance.bot.id
}

output "instance_arn" {
  value = aws_instance.bot.arn
}

output "repository_arn" {
  value = aws_ecr_repository.bot.arn
}

output "repository_url" {
  value = aws_ecr_repository.bot.repository_url
}
