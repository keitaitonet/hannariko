output "github_actions_variables" {
  value = {
    AWS_REGION     = "ap-northeast-1"
    AWS_ROLE_ARN   = aws_iam_role.deploy.arn
    INSTANCE_ID    = aws_instance.bot.id
    ECR_REPOSITORY = aws_ecr_repository.bot.repository_url
  }
}
