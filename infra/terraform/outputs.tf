output "droplet_ip" {
  value = digitalocean_droplet.platform.ipv4_address
}

output "droplet_ipv6" {
  value = digitalocean_droplet.platform.ipv6_address
}

output "dns_records_to_create" {
  description = "Create these at your DNS host so Caddy can get a certificate."
  value = [
    "A    ${var.farm_site_domain}  ${digitalocean_droplet.platform.ipv4_address}",
    "AAAA ${var.farm_site_domain}  ${digitalocean_droplet.platform.ipv6_address}",
  ]
}

output "buckets" {
  value = {
    backups = digitalocean_spaces_bucket.backups.name
    dumps   = digitalocean_spaces_bucket.dumps.name
    region  = var.backup_region
  }
}

output "next_steps" {
  value = <<-EOT
    1. Create the DNS records above.
    2. ./bootstrap.sh        (copies out/platform.env and the deploy key, then runs provision.sh as root)
    3. ssh ${var.admin_user}@${digitalocean_droplet.platform.ipv4_address} sudo /opt/platform/repo/infra/platform/deploy.sh
  EOT
}
