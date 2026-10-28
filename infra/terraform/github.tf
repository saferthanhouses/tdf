locals {
  repo = var.github_repository

  # Read by .github/workflows/restore-test.yml.
  actions_secrets = merge(
    {
      DO_TOKEN               = var.restore_test_do_token
      SPACES_RO_KEY          = digitalocean_spaces_key.restore_test_backups.access_key
      SPACES_RO_SECRET       = digitalocean_spaces_key.restore_test_backups.secret_key
      PGBACKREST_CIPHER_PASS = random_password.pgbackrest_cipher.result
      DUMPS_KEY              = digitalocean_spaces_key.restore_test_dumps.access_key
      DUMPS_SECRET           = digitalocean_spaces_key.restore_test_dumps.secret_key
    },
    var.hc_restore_url != "" ? { HC_RESTORE_URL = var.hc_restore_url } : {},
  )
  actions_variables = merge(
    {
      SPACES_ENDPOINT        = local.spaces_endpoint
      SPACES_BUCKET          = digitalocean_spaces_bucket.backups.name
      SPACES_REPO_PATH       = local.spaces_repo_path
      DUMPS_ENDPOINT_URL     = "https://${local.spaces_endpoint}"
      DUMPS_BUCKET           = digitalocean_spaces_bucket.dumps.name
      DO_REGION              = var.backup_region # restore far from production, like a real disaster
      DO_SSH_KEY_FINGERPRINT = local.ssh_key_fingerprint
    },
    length(var.no_pii_databases) > 0 ? { NO_PII_DATABASES = join(" ", var.no_pii_databases) } : {},
  )
}

resource "github_repository_deploy_key" "platform" {
  repository = local.repo
  title      = "platform Droplet (read-only)"
  key        = tls_private_key.deploy.public_key_openssh
  read_only  = true
}

# for_each keys must be known at plan time, so iterate over names and look values up.
resource "github_actions_secret" "restore_test" {
  for_each    = nonsensitive(toset(keys(local.actions_secrets)))
  repository  = local.repo
  secret_name = each.key
  value       = local.actions_secrets[each.key]
}

resource "github_actions_variable" "restore_test" {
  for_each      = toset(keys(local.actions_variables))
  repository    = local.repo
  variable_name = each.key
  value         = local.actions_variables[each.key]
}
