output "vpc_id" {
  value = aws_vpc.bot.id
}

output "subnet_id" {
  value = aws_subnet.bot.id
  # EC2の初回起動時に、パッケージ取得先へ接続できるようにする。
  depends_on = [aws_route_table_association.bot]
}
