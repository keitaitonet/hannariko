resource "aws_security_group" "bot" {
  name   = "hannariko"
  vpc_id = aws_vpc.bot.id

  # Discord, OpenAI and AWS APIs. No inbound ports; administration uses SSM.
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

data "aws_ssm_parameter" "ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_instance" "bot" {
  ami                    = nonsensitive(data.aws_ssm_parameter.ami.value)
  instance_type          = "t3a.small"
  subnet_id              = aws_subnet.bot.id
  vpc_security_group_ids = [aws_security_group.bot.id]
  iam_instance_profile   = aws_iam_instance_profile.bot.name
  user_data              = file("${path.module}/user-data.sh")

  depends_on = [aws_route_table_association.bot]

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 20
    encrypted             = true
    delete_on_termination = false
  }

  credit_specification {
    cpu_credits = "standard"
  }

  lifecycle {
    # Preserve local DBs: replacing this instance requires an explicit migration.
    ignore_changes  = [ami]
    prevent_destroy = true
  }

  tags = { Name = "hannariko" }
}

resource "aws_ecr_repository" "bot" {
  name = "hannariko"
}
