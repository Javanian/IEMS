mock_provider "aws" {}
run "private_storage" {
  command = plan
  assert {
    condition     = aws_s3_bucket_public_access_block.lake.block_public_policy && !aws_s3_bucket.lake.force_destroy
    error_message = "Public policy and destructive force destroy must be disabled."
  }
  assert {
    condition     = aws_s3_bucket_versioning.lake.versioning_configuration[0].status == "Enabled"
    error_message = "Versioned recovery evidence required."
  }
}
