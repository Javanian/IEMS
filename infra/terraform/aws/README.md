# PLAT-049 offline AWS contract

This root deliberately uses loopback endpoints and dummy non-credential strings. Its test
file replaces the AWS provider with `mock_provider`. No AWS data source, account discovery,
metadata lookup, remote backend, paid apply or cloud acceptance is part of this delivery.

Use existing Terraform >=1.7,<2 and installed hashicorp/aws 5.100.0 via a read-only provider
mirror. `node ops/platform/terraform-offline.mjs` checks fmt/validate/test in a run-owned copy,
with no init provider downloads and no live plan/apply. Missing CLI/mirror means NOT_RUN,
not PASS. The original workspace's shared lockfiles are untouched. Provider download
is setup outside this assignment, never implicit in verification.

The module models two private subnets, no public ingress/IP, bounded ECS/Fargate tasks,
digest-pinned image, scoped Secrets Manager/log permissions, separate unprivileged task role
and deployment circuit breaker. Mock tests assert boundaries and reject mutable images,
unbounded replicas and wildcard secret references. No credentials are embedded.

This is a contract fixture, not a runnable AWS deployment. A separately reviewed cloud root
must supply private endpoints/routes, image pull policy, ingress/TLS, actual digest, secret
rotation/KMS policy, Mongo replica, RabbitMQ and Redis services, backups, billing approval
and environment tests/rollback. Those external integrations belong to cloud delivery;
do not remove loopback restrictions here to apply this test root.
