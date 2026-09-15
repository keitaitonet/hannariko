resource "aws_vpc" "bot" {
  cidr_block = "10.73.0.0/24"
}

resource "aws_subnet" "bot" {
  vpc_id                  = aws_vpc.bot.id
  cidr_block              = "10.73.0.0/24"
  availability_zone       = "ap-northeast-1a"
  map_public_ip_on_launch = true
}

resource "aws_internet_gateway" "bot" {
  vpc_id = aws_vpc.bot.id
}

resource "aws_route_table" "bot" {
  vpc_id = aws_vpc.bot.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.bot.id
  }
}

resource "aws_route_table_association" "bot" {
  subnet_id      = aws_subnet.bot.id
  route_table_id = aws_route_table.bot.id
}
