# Generated secrets. They live in the (encrypted) state and reach the Droplet only through
# out/platform.env and bootstrap.sh. No special characters: provision.sh and create-app-db.sh accept
# [A-Za-z0-9_.~+=-] only, because passwords are interpolated into SQL.
locals {
  app_roles = {
    for pair in setproduct(var.app_databases, ["owner", "app", "readonly"]) :
    "${pair[0]}_${pair[1]}" => { app = pair[0], role = pair[1] }
  }
}

resource "random_password" "postgres_superuser" {
  length  = 32
  special = false
}

resource "random_password" "pgbackrest_cipher" {
  length  = 48
  special = false
}

resource "random_password" "app_role" {
  for_each = local.app_roles
  length   = 32
  special  = false
}

# Read-only deploy key the Droplet uses to clone the repository.
resource "tls_private_key" "deploy" {
  algorithm = "ED25519"
}
