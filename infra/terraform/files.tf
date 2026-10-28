# Files bootstrap.sh copies to the Droplet. out/ is gitignored; both are written 0600.
resource "local_sensitive_file" "platform_env" {
  filename        = "${path.module}/out/platform.env"
  file_permission = "0600"
  content = templatefile("${path.module}/platform.env.tftpl", {
    admin_user         = var.admin_user
    repo_url           = "git@github.com:${var.github_owner}/${var.github_repository}.git"
    repo_branch        = var.repo_branch
    ts_authkey_host    = var.ts_authkey_host
    ts_authkey_apps    = var.ts_authkey_apps
    apps               = var.app_databases
    volume_name        = local.volume_name
    db_mem_limit       = var.db_mem_limit
    superuser_password = random_password.postgres_superuser.result
    app_passwords      = { for k, v in random_password.app_role : k => v.result }
    spaces_endpoint    = local.spaces_endpoint
    spaces_bucket      = digitalocean_spaces_bucket.backups.name
    spaces_repo_path   = local.spaces_repo_path
    spaces_key         = digitalocean_spaces_key.droplet_backups.access_key
    spaces_secret      = digitalocean_spaces_key.droplet_backups.secret_key
    cipher_pass        = random_password.pgbackrest_cipher.result
    hc_backup_url      = var.hc_backup_url
    farm_site_domain   = var.farm_site_domain
    acme_email         = var.acme_email
  })
}

resource "local_sensitive_file" "deploy_key" {
  filename        = "${path.module}/out/deploy_key"
  file_permission = "0600"
  content         = tls_private_key.deploy.private_key_openssh
}

resource "local_file" "deploy_key_pub" {
  filename        = "${path.module}/out/deploy_key.pub"
  file_permission = "0644"
  content         = tls_private_key.deploy.public_key_openssh
}
