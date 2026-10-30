terraform {
  required_version = ">= 1.7.0, < 2.0.0"
  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "3.6.2"
    }
  }
}

variable "docker_host" {
  type = string
  validation {
    condition     = contains(["npipe:////./pipe/docker_engine", "unix:///var/run/docker.sock"], var.docker_host)
    error_message = "Only a local Docker engine is permitted."
  }
}
provider "docker" {
  host = var.docker_host
}

variable "owner" {
  type = string
  validation {
    condition     = can(regex("^iems-tpr139-[a-f0-9]{12}$", var.owner))
    error_message = "Use the launcher-generated TPR-139 owner name."
  }
}
variable "image" {
  type = string
  validation {
    condition     = can(regex("^iems-platform:[a-f0-9]{12}$", var.image))
    error_message = "Use the locally built exact source image tag."
  }
}
variable "api_port" {
  type    = number
  default = 14313
  validation {
    condition     = floor(var.api_port) == var.api_port && var.api_port >= 1024 && var.api_port <= 65535
    error_message = "Use an unprivileged loopback port."
  }
}
variable "rabbit_password" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^[a-f0-9]{64}$", var.rabbit_password))
    error_message = "Use the launcher-generated random password."
  }
}
variable "source_sha" {
  type = string
  validation {
    condition     = can(regex("^[a-f0-9]{40}$", var.source_sha))
    error_message = "Full committed source SHA required."
  }
}
locals {
  labels = { "iems.owner" = var.owner, "iems.issue" = "TPR-139", "iems.source" = var.source_sha }
}
resource "docker_network" "owned" {
  name     = var.owner
  internal = true
  dynamic "labels" {
    for_each = local.labels
    content {
      label = labels.key
      value = labels.value
    }
  }
}
resource "docker_volume" "data" {
  for_each = toset(["mongo", "rabbit"])
  name     = "${var.owner}-${each.key}"
  dynamic "labels" {
    for_each = local.labels
    content {
      label = labels.key
      value = labels.value
    }
  }
}
resource "docker_image" "service" {
  for_each     = { mongo = "mongo:7.0.14", rabbit = "rabbitmq:4.1.5-alpine", redis = "redis:7.4.6-alpine", api = var.image }
  name         = each.value
  keep_locally = true
}
resource "docker_container" "service" {
  for_each = toset(["mongo", "rabbit", "redis", "api"])
  name     = "${var.owner}-${each.key}"
  image    = docker_image.service[each.key].image_id
  restart  = "no"
  must_run = true
  memory   = each.key == "mongo" ? 512 : 256
  command = each.key == "mongo" ? ["mongod", "--replSet", "rs0", "--bind_ip_all", "--wiredTigerCacheSizeGB", "0.25"] : each.key == "redis" ? ["redis-server", "--save", "", "--appendonly", "no", "--maxmemory", "64mb", "--maxmemory-policy", "allkeys-lru"] : null
  env = each.key == "rabbit" ? ["RABBITMQ_DEFAULT_USER=iems", "RABBITMQ_DEFAULT_PASS=${var.rabbit_password}"] : each.key == "api" ? [
    "PLATFORM_OWNER=${var.owner}", "PLATFORM_SOURCE_SHA=${var.source_sha}",
    "PLATFORM_MONGO_URI=mongodb://${var.owner}-mongo:27017/?replicaSet=rs0",
    "PLATFORM_RABBIT_URL=amqp://iems:${var.rabbit_password}@${var.owner}-rabbit:5672",
    "PLATFORM_REDIS_URL=redis://${var.owner}-redis:6379",
    "PLATFORM_DB=portfolio_owned_${replace(var.owner, "-", "_")}",
    "PLATFORM_ORIGIN=http://127.0.0.1:${var.api_port}"
  ] : []
  networks_advanced {
    name = docker_network.owned.name
  }
  dynamic "labels" {
    for_each = local.labels
    content {
      label = labels.key
      value = labels.value
    }
  }
  dynamic "volumes" {
    for_each = contains(["mongo", "rabbit"], each.key) ? [each.key] : []
    content {
      volume_name    = docker_volume.data[each.key].name
      container_path = each.key == "mongo" ? "/data/db" : "/var/lib/rabbitmq"
    }
  }
  dynamic "ports" {
    for_each = each.key == "api" ? [var.api_port] : []
    content {
      internal = 4313
      external = ports.value
      ip       = "127.0.0.1"
    }
  }
  log_opts = { "max-size" = "5m", "max-file" = "2" }
}
output "health_url" {
  value = "http://127.0.0.1:${var.api_port}/health"
}
