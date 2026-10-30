terraform {
  required_version = ">= 1.7.0, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "5.100.0"
    }
  }
}

# This root is an offline contract. All AWS endpoints are deliberately loopback.
provider "aws" {
  region                      = "us-east-1"
  access_key                  = "offline-mock-only"
  secret_key                  = "offline-mock-only"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  skip_region_validation     = true
  endpoints {
    ec2            = "http://127.0.0.1:9"
    ecs            = "http://127.0.0.1:9"
    iam            = "http://127.0.0.1:9"
    cloudwatchlogs = "http://127.0.0.1:9"
    s3             = "http://127.0.0.1:9"
    sts            = "http://127.0.0.1:9"
  }
}

variable "name" {
  type    = string
  default = "iems-offline"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.name))
    error_message = "Use a bounded lowercase deployment name."
  }
}

variable "image" {
  type    = string
  default = "example.invalid/iems-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  validation {
    condition     = can(regex("^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$", var.image))
    error_message = "Pin the reviewed container image by SHA256 digest."
  }
}

variable "replicas" {
  type    = number
  default = 1
  validation {
    condition     = floor(var.replicas) == var.replicas && var.replicas >= 1 && var.replicas <= 2
    error_message = "Offline capacity contract permits one or two tasks only."
  }
}

variable "secret_arns" {
  type = object({ mongo = string, rabbit = string, redis = string })
  default = {
    mongo  = "arn:aws:secretsmanager:us-east-1:123456789012:secret:iems/mock-mongo"
    rabbit = "arn:aws:secretsmanager:us-east-1:123456789012:secret:iems/mock-rabbit"
    redis  = "arn:aws:secretsmanager:us-east-1:123456789012:secret:iems/mock-redis"
  }
  validation {
    condition     = alltrue([for arn in values(var.secret_arns) : can(regex("^arn:aws:secretsmanager:us-east-1:[0-9]{12}:secret:iems/[A-Za-z0-9/_-]+$", arn))])
    error_message = "Supply scoped secret ARNs, never plaintext credentials or wildcard resources."
  }
}

resource "aws_vpc" "app" {
  cidr_block           = "10.78.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                = { Name = var.name, Contract = "offline-only" }
}

resource "aws_subnet" "private" {
  for_each                = { a = "10.78.1.0/24", b = "10.78.2.0/24" }
  vpc_id                  = aws_vpc.app.id
  cidr_block              = each.value
  availability_zone       = "us-east-1${each.key}"
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.name}-${each.key}" }
}

resource "aws_security_group" "app" {
  name_prefix = "${var.name}-"
  description = "Private application contract; ingress integration owned by cloud delivery"
  vpc_id      = aws_vpc.app.id
  ingress     = []
  egress {
    description = "TLS to private endpoints only"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.app.cidr_block]
  }
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/iems/${var.name}"
  retention_in_days = 7
}

resource "aws_iam_role" "execution" {
  name_prefix = "${var.name}-exec-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "execution" {
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = values(var.secret_arns) },
      { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = ["${aws_cloudwatch_log_group.app.arn}:*"] }
    ]
  })
}

resource "aws_iam_role" "task" {
  name_prefix = "${var.name}-task-"
  assume_role_policy = aws_iam_role.execution.assume_role_policy
}

resource "aws_ecs_cluster" "app" {
  name = var.name
}

resource "aws_ecs_task_definition" "app" {
  family                   = var.name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name      = "api"
    image     = var.image
    essential = true
    readonlyRootFilesystem = true
    portMappings = [{ containerPort = 4313, protocol = "tcp" }]
    secrets = [
      { name = "PORTFOLIO_MONGO_URI", valueFrom = var.secret_arns.mongo },
      { name = "PLATFORM_RABBIT_URL", valueFrom = var.secret_arns.rabbit },
      { name = "PLATFORM_REDIS_URL", valueFrom = var.secret_arns.redis }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = { awslogs-group = aws_cloudwatch_log_group.app.name, awslogs-region = "us-east-1", awslogs-stream-prefix = "api" }
    }
  }])
}

resource "aws_ecs_service" "app" {
  name            = var.name
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.replicas
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = [for subnet in aws_subnet.private : subnet.id]
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}

output "contract" {
  value = {
    mode              = "OFFLINE_MOCK_ONLY"
    desired_count     = aws_ecs_service.app.desired_count
    private_subnets   = length(aws_subnet.private)
    public_ip_enabled = false
    mongo_authority   = "external-replica-required"
    image             = var.image
  }
}
