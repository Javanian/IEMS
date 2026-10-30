mock_provider "aws" {}

run "private_bounded_runtime" {
  command = plan
  assert {
    condition     = aws_ecs_service.app.network_configuration[0].assign_public_ip == false
    error_message = "Tasks must remain private."
  }
  assert {
    condition     = length(aws_subnet.private) == 2 && aws_ecs_service.app.desired_count == 1
    error_message = "Unexpected network or capacity contract."
  }
  assert {
    condition     = length(aws_security_group.app.ingress) == 0
    error_message = "Offline module must not introduce ingress."
  }
  assert {
    condition     = aws_cloudwatch_log_group.app.retention_in_days == 7
    error_message = "Log retention must stay bounded."
  }
}

run "reject_mutable_image" {
  command = plan
  variables {
    image = "example.invalid/iems:latest"
  }
  expect_failures = [var.image]
}

run "reject_unbounded_capacity" {
  command = plan
  variables {
    replicas = 3
  }
  expect_failures = [var.replicas]
}

run "reject_wildcard_secrets" {
  command = plan
  variables {
    secret_arns = { mongo = "*", rabbit = "*", redis = "*" }
  }
  expect_failures = [var.secret_arns]
}
