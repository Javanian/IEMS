variable "vpc_id" {
  type    = string
  default = "vpc-00000000000000000"
}
variable "application_security_group_id" {
  type    = string
  default = "sg-00000000000000000"
}
variable "private_subnet_ids" {
  type    = list(string)
  default = ["subnet-00000000000000001", "subnet-00000000000000002", "subnet-00000000000000003"]
  validation {
    condition     = length(var.private_subnet_ids) == 3 && length(toset(var.private_subnet_ids)) == 3
    error_message = "Three distinct private subnets in three AZs are required."
  }
}

resource "aws_security_group" "data" {
  name        = "${local.name}-data"
  description = "Tenant data ingress only from the application security group"
  vpc_id      = var.vpc_id
  ingress {
    from_port       = 9098
    to_port         = 9098
    protocol        = "tcp"
    security_groups = [var.application_security_group_id]
  }
  ingress {
    from_port       = 5439
    to_port         = 5439
    protocol        = "tcp"
    security_groups = [var.application_security_group_id]
  }
  tags = local.tags
}

resource "aws_msk_serverless_cluster" "events" {
  cluster_name = local.name
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.data.id]
  }
  client_authentication {
    sasl {
      iam { enabled = true }
    }
  }
  tags = local.tags
  lifecycle { prevent_destroy = true }
}

resource "aws_iam_role_policy" "events" {
  role = aws_iam_role.runtime.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["kafka-cluster:Connect", "kafka-cluster:DescribeCluster"], Resource = [aws_msk_serverless_cluster.events.arn] },
      { Effect = "Allow", Action = ["kafka-cluster:ReadData", "kafka-cluster:WriteData", "kafka-cluster:DescribeTopic"], Resource = ["arn:aws:kafka:us-east-1:123456789012:topic/${local.name}/${aws_msk_serverless_cluster.events.cluster_uuid}/iems.reporting-snapshots.v2.${var.tenant_id}"] },
      { Effect = "Allow", Action = ["kafka-cluster:AlterGroup", "kafka-cluster:DescribeGroup"], Resource = ["arn:aws:kafka:us-east-1:123456789012:group/${local.name}/${aws_msk_serverless_cluster.events.cluster_uuid}/iems-${var.tenant_id}"] }
    ]
  })
}

resource "aws_glue_catalog_database" "tenant" {
  name = "iems_${replace(var.tenant_id, "-", "_")}"
}

resource "aws_glue_catalog_table" "snapshots" {
  name          = "reporting_snapshots_v2"
  database_name = aws_glue_catalog_database.tenant.name
  table_type    = "EXTERNAL_TABLE"
  parameters    = { classification = "json" }
  storage_descriptor {
    location      = "s3://${aws_s3_bucket.lake.id}/${local.prefix}reporting-v2/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"
    ser_de_info {
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"
    }
    columns {
      name = "event_id"
      type = "string"
    }
    columns {
      name = "tenant_id"
      type = "string"
    }
    columns {
      name = "plant_id"
      type = "string"
    }
    columns {
      name = "payload_hash"
      type = "string"
    }
    columns {
      name = "payload_json"
      type = "string"
    }
  }
}

resource "aws_iam_role" "warehouse" {
  name = "${local.name}-warehouse"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "redshift-serverless.amazonaws.com" }, Condition = { StringEquals = { "aws:SourceAccount" = "123456789012" } } }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy" "warehouse" {
  role = aws_iam_role.warehouse.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetObject"], Resource = ["${aws_s3_bucket.lake.arn}/${local.prefix}reporting-v2/*"] },
      { Effect = "Allow", Action = ["s3:ListBucket"], Resource = [aws_s3_bucket.lake.arn], Condition = { StringLike = { "s3:prefix" = ["${local.prefix}reporting-v2/*"] } } },
      { Effect = "Allow", Action = ["glue:GetDatabase", "glue:GetTable", "glue:GetPartitions"], Resource = ["arn:aws:glue:us-east-1:123456789012:catalog", "arn:aws:glue:us-east-1:123456789012:database/${aws_glue_catalog_database.tenant.name}", "arn:aws:glue:us-east-1:123456789012:table/${aws_glue_catalog_database.tenant.name}/reporting_snapshots_v2"] }
    ]
  })
}

resource "aws_redshiftserverless_namespace" "tenant" {
  namespace_name       = local.name
  db_name              = "iems"
  manage_admin_password = true
  iam_roles            = [aws_iam_role.warehouse.arn]
  default_iam_role_arn = aws_iam_role.warehouse.arn
  log_exports          = ["userlog", "connectionlog", "useractivitylog"]
  tags                 = local.tags
  lifecycle { prevent_destroy = true }
}

resource "aws_redshiftserverless_workgroup" "tenant" {
  workgroup_name       = local.name
  namespace_name       = aws_redshiftserverless_namespace.tenant.namespace_name
  base_capacity        = 8
  max_capacity         = 8
  publicly_accessible  = false
  enhanced_vpc_routing = true
  subnet_ids           = var.private_subnet_ids
  security_group_ids   = [aws_security_group.data.id]
  config_parameter {
    parameter_key   = "require_ssl"
    parameter_value = "true"
  }
  config_parameter {
    parameter_key   = "max_query_execution_time"
    parameter_value = "60"
  }
  tags = local.tags
}
