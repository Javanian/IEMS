mock_provider "mongodbatlas" {}
run "tenant_database_scope" {
  command = plan
  assert {
    condition     = mongodbatlas_database_user.runtime.auth_database_name == "$external" && mongodbatlas_database_user.runtime.aws_iam_type == "ROLE"
    error_message = "Use scoped IAM authentication without a stored password."
  }
}
