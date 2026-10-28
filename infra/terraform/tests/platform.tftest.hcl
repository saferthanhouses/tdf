# tofu test: checks the platform config's safety properties with mocked providers. Every run is a plan
# (mocked computed values are available at plan time), so nothing is created anywhere, the volume's and
# backup bucket's prevent_destroy never comes into play, and out/ isn't touched.

mock_provider "digitalocean" {
  mock_resource "digitalocean_droplet" {
    defaults = {
      id           = "4242"
      urn          = "do:droplet:4242"
      ipv4_address = "203.0.113.10"
      ipv6_address = "2001:db8::10"
    }
  }
  mock_resource "digitalocean_volume" {
    defaults = { id = "vol-1", urn = "do:volume:vol-1" }
  }
  mock_resource "digitalocean_spaces_bucket" {
    defaults = { urn = "do:space:mock" }
  }
  mock_resource "digitalocean_spaces_key" {
    defaults = { access_key = "MOCKACCESSKEY", secret_key = "mocksecretkey" }
  }
  mock_resource "digitalocean_ssh_key" {
    defaults = { fingerprint = "aa:bb:cc" }
  }
}

mock_provider "github" {}
mock_provider "local" {}
mock_provider "random" {}
mock_provider "tls" {}

variables {
  state_passphrase      = "test-passphrase-0123456789"
  alert_email           = "ops@example.com"
  admin_user            = "joe"
  farm_site_domain      = "farm.example.com"
  acme_email            = "ops@example.com"
  restore_test_do_token = "dop_v1_test"
  ssh_public_key        = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItest test"
  hc_restore_url        = "https://hc-ping.com/test"
  no_pii_databases      = ["scratch"]
}

run "defaults" {
  command = plan

  assert {
    condition     = digitalocean_droplet.platform.user_data == null
    error_message = "The Droplet must not have user_data (readable by anything on the Droplet)."
  }
  assert {
    condition     = length([for r in digitalocean_firewall.platform.inbound_rule : r if r.port_range == "22"]) == 0
    error_message = "SSH must be closed when admin_cidrs is empty."
  }
  assert {
    condition     = digitalocean_spaces_bucket.backups.region != digitalocean_droplet.platform.region
    error_message = "Backups must be in a different region from the Droplet."
  }
  assert {
    condition     = digitalocean_spaces_bucket.backups.versioning[0].enabled
    error_message = "The backup bucket must be versioned."
  }
  assert {
    condition = (
      length(digitalocean_spaces_key.restore_test_backups.grant) == 1 &&
      digitalocean_spaces_key.restore_test_backups.grant[0].permission == "read" &&
      digitalocean_spaces_key.restore_test_backups.grant[0].bucket == digitalocean_spaces_bucket.backups.name
    )
    error_message = "The restore test's backup key must be read-only on the backup bucket only."
  }
  assert {
    condition = alltrue([
      for k in [digitalocean_spaces_key.droplet_backups, digitalocean_spaces_key.restore_test_dumps] :
      length(k.grant) == 1
    ])
    error_message = "Every Spaces key must be limited to a single bucket."
  }
  assert {
    condition     = github_repository_deploy_key.platform.read_only
    error_message = "The deploy key must be read-only."
  }

  # The generated env file has every key the platform scripts expect.
  assert {
    condition = alltrue([
      for m in regexall("(?m)^([A-Z_]+)=", file("../platform/platform.env.example")) :
      strcontains(local_sensitive_file.platform_env.content, "\n${m[0]}=")
    ])
    error_message = "out/platform.env is missing keys from infra/platform/platform.env.example."
  }
  assert {
    condition     = strcontains(local_sensitive_file.platform_env.content, "SPACES_KEY=MOCKACCESSKEY\n")
    error_message = "The Droplet must get the read/write backup key."
  }
  assert {
    condition     = strcontains(local_sensitive_file.platform_env.content, "DATA_DEVICE=/dev/disk/by-id/scsi-0DO_Volume_platform-pgdata\n")
    error_message = "DATA_DEVICE must point at the attached volume."
  }
  assert {
    condition     = local_sensitive_file.platform_env.file_permission == "0600" && local_sensitive_file.deploy_key.file_permission == "0600"
    error_message = "Generated secret files must be 0600."
  }

  # GitHub settings match what .github/workflows/restore-test.yml reads.
  assert {
    condition = (
      toset(keys(github_actions_secret.restore_test)) ==
      toset([for m in regexall("secrets\\.([A-Z_]+)", file("../../.github/workflows/restore-test.yml")) : m[0]])
    )
    error_message = "Actions secrets don't match the names restore-test.yml reads."
  }
  assert {
    condition = (
      toset(keys(github_actions_variable.restore_test)) ==
      toset([for m in regexall("vars\\.([A-Z_]+)", file("../../.github/workflows/restore-test.yml")) : m[0]])
    )
    error_message = "Actions variables don't match the names restore-test.yml reads."
  }
  assert {
    condition     = github_actions_variable.restore_test["DO_REGION"].value == var.backup_region
    error_message = "The restore test should run in the backup region."
  }
}

run "ssh_from_admin_cidrs" {
  command = plan
  variables {
    admin_cidrs = ["198.51.100.7/32"]
  }
  assert {
    condition = anytrue([
      for r in digitalocean_firewall.platform.inbound_rule :
      r.port_range == "22" && toset(r.source_addresses) == toset(["198.51.100.7/32"])
    ])
    error_message = "SSH must be open to admin_cidrs only."
  }
}

run "passwords_per_app" {
  command = plan
  variables {
    app_databases = ["barnbooks", "fieldnotes"]
  }
  assert {
    condition = alltrue([
      for line in ["APP_DATABASES=\"barnbooks fieldnotes\"", "FIELDNOTES_OWNER_PASSWORD=", "FIELDNOTES_APP_PASSWORD=", "FIELDNOTES_READONLY_PASSWORD=", "TS_AUTHKEY_FIELDNOTES="] :
      strcontains(local_sensitive_file.platform_env.content, line)
    ])
    error_message = "Each app needs its database listed, three role passwords and a Tailscale key line."
  }
  assert {
    condition     = length(random_password.app_role) == 6
    error_message = "Every role gets its own password."
  }
  assert {
    condition     = alltrue([for p in random_password.app_role : p.length == 32 && !p.special])
    error_message = "Passwords must be 32 characters with no specials, to pass the scripts' character check."
  }
}

run "same_region_rejected" {
  command = plan
  variables {
    backup_region = "nyc3"
  }
  expect_failures = [digitalocean_spaces_bucket.backups]
}
