resource "digitalocean_ssh_key" "admin" {
  count      = var.ssh_key_fingerprint == "" ? 1 : 0
  name       = "platform-admin"
  public_key = var.ssh_public_key
}

locals {
  ssh_key_fingerprint = var.ssh_key_fingerprint != "" ? var.ssh_key_fingerprint : digitalocean_ssh_key.admin[0].fingerprint
  volume_name         = "platform-pgdata"
}

# No user_data: anything on the Droplet (app containers included) can read it from the metadata
# service, so secrets reach the Droplet over SSH instead (bootstrap.sh).
resource "digitalocean_droplet" "platform" {
  name       = "platform"
  image      = "ubuntu-24-04-x64"
  region     = var.droplet_region
  size       = var.droplet_size
  vpc_uuid   = digitalocean_vpc.platform.id
  ssh_keys   = [local.ssh_key_fingerprint]
  monitoring = true # installs the DO monitoring agent
  ipv6       = true
  tags       = ["platform"]

  lifecycle {
    precondition {
      condition     = var.ssh_key_fingerprint != "" || var.ssh_public_key != ""
      error_message = "Set ssh_public_key or ssh_key_fingerprint."
    }
  }
}

# Unformatted: provision.sh creates the filesystem on first run and never reformats it.
resource "digitalocean_volume" "pgdata" {
  name        = local.volume_name
  region      = var.droplet_region
  size        = var.volume_size_gb
  description = "Postgres data for the platform Droplet"

  lifecycle {
    prevent_destroy = true
  }
}

resource "digitalocean_volume_attachment" "pgdata" {
  droplet_id = digitalocean_droplet.platform.id
  volume_id  = digitalocean_volume.pgdata.id
}

resource "digitalocean_project" "platform" {
  name        = "platform"
  description = "Monorepo platform Droplet: shared Postgres, apps, backups"
  purpose     = "Web Application"
  environment = "Production"
  resources = [
    digitalocean_droplet.platform.urn,
    digitalocean_volume.pgdata.urn,
    digitalocean_spaces_bucket.backups.urn,
    digitalocean_spaces_bucket.dumps.urn,
  ]
}
