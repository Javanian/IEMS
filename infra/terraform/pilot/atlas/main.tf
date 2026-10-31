terraform {
  required_version = ">= 1.11.0, < 2.0.0"
  required_providers {
    mongodbatlas = {
      source  = "mongodb/mongodbatlas"
      version = "1.40.0"
    }
  }
}

# No credentials or provider connection configured. Only mocked-provider tests.
variable "project_id" {
  type    = string
  default = "111111111111111111111111"
}
variable "tenant_id" {
  type    = string
  default = "11111111-1111-4111-8111-111111111111"
  validation {
    condition     = can(regex("^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", var.tenant_id))
    error_message = "Tenant UUID required."
  }
}
resource "mongodbatlas_database_user" "runtime" {
  username           = "arn:aws:iam::123456789012:role/iems-${var.tenant_id}"
  project_id         = var.project_id
  auth_database_name = "$external"
  aws_iam_type       = "ROLE"
  roles {
    role_name     = "readWrite"
    database_name = "iems_${replace(var.tenant_id, "-", "_")}"
  }
  scopes {
    name = "iems-offline-review"
    type = "CLUSTER"
  }
}
