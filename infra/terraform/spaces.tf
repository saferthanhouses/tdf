locals {
  spaces_endpoint  = "${var.backup_region}.digitaloceanspaces.com"
  spaces_repo_path = "/platform"
}

# pgBackRest repository. Versioned, so a compromised Droplet can't destroy history: objects pgBackRest
# deletes (expired backups) stay recoverable for 30 days as old versions.
resource "digitalocean_spaces_bucket" "backups" {
  name   = var.backup_bucket
  region = var.backup_region
  acl    = "private"

  versioning {
    enabled = true
  }

  lifecycle_rule {
    id      = "expire-old-versions"
    enabled = true
    noncurrent_version_expiration {
      days = 30
    }
    abort_incomplete_multipart_upload_days = 7
  }

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = var.backup_region != var.droplet_region
      error_message = "backup_region must differ from droplet_region, so a regional outage can't take both."
    }
  }
}

# Sanitized pg_dumps written by the weekly restore test.
resource "digitalocean_spaces_bucket" "dumps" {
  name   = var.dumps_bucket
  region = var.backup_region
  acl    = "private"

  lifecycle_rule {
    id      = "expire-dumps"
    enabled = true
    expiration {
      days = var.dumps_retention_days
    }
    abort_incomplete_multipart_upload_days = 7
  }
}

# One key per job, each limited to one bucket.
resource "digitalocean_spaces_key" "droplet_backups" {
  name = "platform-droplet-backups"
  grant {
    bucket     = digitalocean_spaces_bucket.backups.name
    permission = "readwrite"
  }
}

resource "digitalocean_spaces_key" "restore_test_backups" {
  name = "restore-test-backups-readonly"
  grant {
    bucket     = digitalocean_spaces_bucket.backups.name
    permission = "read"
  }
}

resource "digitalocean_spaces_key" "restore_test_dumps" {
  name = "restore-test-dumps"
  grant {
    bucket     = digitalocean_spaces_bucket.dumps.name
    permission = "readwrite"
  }
}
