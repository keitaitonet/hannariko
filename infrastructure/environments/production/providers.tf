provider "aws" {
  region              = "ap-northeast-1"
  allowed_account_ids = ["075472845547"]

  default_tags {
    tags = {
      Project     = "hannariko"
      Environment = "production"
      ManagedBy   = "terraform"
    }
  }
}
