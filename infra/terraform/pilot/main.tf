terraform {
  required_version = ">= 1.11.0, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.33.0"
    }
  }
}

# All service endpoints are inert. This is an offline review fixture, not live IaC.
provider "aws" {
  region                      = "us-east-1"
  access_key                  = "offline-mock-only"
  secret_key                  = "offline-mock-only"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  skip_region_validation     = true
  endpoints {
    iam                = "http://127.0.0.1:9"
    sts                = "http://127.0.0.1:9"
    s3                 = "http://127.0.0.1:9"
    ec2                = "http://127.0.0.1:9"
    kafka              = "http://127.0.0.1:9"
    glue               = "http://127.0.0.1:9"
    redshiftserverless = "http://127.0.0.1:9"
  }
}

variable "tenant_id" {
  type    = string
  default = "11111111-1111-4111-8111-111111111111"
  validation {
    condition     = can(regex("^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", var.tenant_id))
    error_message = "A tenant UUID is required."
  }
}

locals {
  name   = "iems-${var.tenant_id}"
  prefix = "tenants/${var.tenant_id}/"
  tags   = { Project = "IEMS", TenantId = var.tenant_id, EvidenceClass = "OFFLINE_ONLY" }
}

resource "aws_iam_role" "runtime" {
  name = local.name
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ecs-tasks.amazonaws.com" }, Condition = {
      StringEquals = { "aws:SourceAccount" = "123456789012" }
      ArnLike      = { "aws:SourceArn" = "arn:aws:ecs:us-east-1:123456789012:*" }
    } }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy" "objects" {
  role = aws_iam_role.runtime.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:ListBucket"], Resource = [aws_s3_bucket.lake.arn], Condition = { StringLike = { "s3:prefix" = ["${local.prefix}*"] } } },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = ["${aws_s3_bucket.lake.arn}/${local.prefix}*"] }
    ]
  })
}

resource "aws_s3_bucket" "lake" {
  bucket        = local.name
  force_destroy = false
  tags          = local.tags
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_public_access_block" "lake" {
  bucket                  = aws_s3_bucket.lake.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "lake" {
  bucket = aws_s3_bucket.lake.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "lake" {
  bucket = aws_s3_bucket.lake.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_policy" "tls" {
  bucket = aws_s3_bucket.lake.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.lake.arn, "${aws_s3_bucket.lake.arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } }]
  })
}

output "evidence_class" { value = "OFFLINE_ONLY_NO_APPLY" }
