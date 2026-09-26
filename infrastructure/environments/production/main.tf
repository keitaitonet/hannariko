module "network" {
  source = "../../modules/network"

  cidr_block        = "10.73.0.0/24"
  availability_zone = "ap-northeast-1a"
}

module "memory" {
  source = "../../modules/memory"

  table_name = "hannariko-memory"
}

module "bot" {
  source = "../../modules/bot"

  name             = "hannariko"
  instance_type    = "t3a.small"
  vpc_id           = module.network.vpc_id
  subnet_id        = module.network.subnet_id
  memory_table_arn = module.memory.table_arn
}

module "deployment" {
  source = "../../modules/deployment"

  name           = "hannariko"
  region         = "ap-northeast-1"
  github_subject = "repo:keitaitonet@65676193/hannariko@1370834578:environment:production"
  repository_arn = module.bot.repository_arn
  instance_arn   = module.bot.instance_arn
}
