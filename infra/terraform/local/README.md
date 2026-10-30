# PLAT-050 owned Docker profile

Use only `ops/platform/local-lifecycle.mjs` with a new absolute private state directory.
Terraform state/tfvars/ownership contain synthetic local credentials and must stay private,
outside Git and attachments. On Windows choose a directory whose ACL is limited to the
operator; mode 0600 is not an ACL replacement. Never share its raw contents.

The profile owns a unique internal network, four labelled containers and two labelled data
volumes. Only API port 4313 is published, bound to host 127.0.0.1 at a chosen free port.
Mongo is an isolated single-node replica, Rabbit has persisted quorum data, Redis has no
persistence and is disposable. API memory 256MiB, Mongo 512MiB, Rabbit/Redis 256MiB each;
logs rotate at 2x5MiB per container. This is a synthetic local profile, not HA or production.

Terraform and kreuzwerker/docker 3.6.2 must already be installed in an offline provider
mirror. The runner refuses remote Docker engines, global cleanup, unlabelled resources,
source mismatch and unknown Terraform state. It checks live container/network/volume IDs
and owner/source labels before mutation. Images stay cached on teardown. No root compose
file, user database, unrelated listener or global Docker configuration is changed.

Four versioned images are used: Node 24.19.0, Mongo 7.0.14, RabbitMQ 4.1.5, Redis 7.4.6.
Initial image pulls and npm dependency fetches during image build require available registry
access or a preloaded cache. No machine-wide installation or hidden provider download.
