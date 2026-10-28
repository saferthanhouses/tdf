# Credentials come from the environment, never from files in the repo:
#   DIGITALOCEAN_TOKEN                               DigitalOcean API token (full access)
#   SPACES_ACCESS_KEY_ID / SPACES_SECRET_ACCESS_KEY  a Spaces key with full access, used to create buckets
#   GITHUB_TOKEN                                     fine-grained token: Administration, Secrets, Variables (write)
provider "digitalocean" {}

provider "github" {
  owner = var.github_owner
}
