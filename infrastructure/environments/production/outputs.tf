output "github_actions_variables" {
  value = {
    AWS_REGION     = "ap-northeast-1"
    AWS_ROLE_ARN   = module.deployment.role_arn
    INSTANCE_ID    = module.bot.instance_id
    ECR_REPOSITORY = module.bot.repository_url
  }
}

output "bot_environment" {
  value = {
    AWS_REGION          = "ap-northeast-1"
    DYNAMODB_TABLE_NAME = module.memory.table_name
  }
}
