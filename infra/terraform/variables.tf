variable "state_passphrase" {
  description = "Encrypts the local state file and plans. Keep it in your password manager."
  type        = string
  sensitive   = true
  validation {
    condition     = length(var.state_passphrase) >= 16
    error_message = "Use a passphrase of at least 16 characters."
  }
}

# --- Regions and sizes ------------------------------------------------------------------------
variable "droplet_region" {
  description = "Region for the platform Droplet, its volume and VPC."
  type        = string
  default     = "nyc3"
}

variable "backup_region" {
  description = "Region for the backup and dumps buckets (and the weekly restore-test Droplet). Must differ from droplet_region."
  type        = string
  default     = "sfo3"
}

variable "droplet_size" {
  type    = string
  default = "s-2vcpu-4gb"
}

variable "volume_size_gb" {
  description = "Block Storage Volume for Postgres data. Can grow later; never shrinks."
  type        = number
  default     = 20
}

variable "vpc_ip_range" {
  type    = string
  default = "10.30.0.0/20"
}

# --- Access -----------------------------------------------------------------------------------
variable "ssh_public_key" {
  description = "Public key to register for root/admin SSH (contents, e.g. 'ssh-ed25519 AAAA...'). Leave empty to use ssh_key_fingerprint."
  type        = string
  default     = ""
}

variable "ssh_key_fingerprint" {
  description = "Fingerprint of an SSH key already on your DigitalOcean account. Used instead of ssh_public_key."
  type        = string
  default     = ""
}

variable "admin_cidrs" {
  description = "Addresses allowed to SSH (port 22), e.g. [\"203.0.113.7/32\"]. Empty closes SSH; use Tailscale SSH instead."
  type        = list(string)
  default     = []
}

variable "alert_email" {
  description = "Where DigitalOcean Monitoring sends disk, CPU and memory alerts."
  type        = string
}

# --- Platform ---------------------------------------------------------------------------------
variable "admin_user" {
  description = "Admin user created by provision.sh (root SSH login is disabled)."
  type        = string
}

variable "app_databases" {
  description = "One Postgres database (with owner/app/readonly roles) per app."
  type        = list(string)
  default     = ["barnbooks"]
  validation {
    condition     = alltrue([for a in var.app_databases : can(regex("^[a-z][a-z0-9_]*$", a))])
    error_message = "App names must be lowercase identifiers."
  }
}

variable "farm_site_domain" {
  type = string
}

variable "acme_email" {
  description = "Let's Encrypt account email (certificate expiry notices)."
  type        = string
}

variable "db_mem_limit" {
  type    = string
  default = "1g"
}

# --- GitHub -----------------------------------------------------------------------------------
variable "github_owner" {
  type    = string
  default = "saferthanhouses"
}

variable "github_repository" {
  type    = string
  default = "tdf"
}

variable "repo_branch" {
  description = "Branch the Droplet deploys from."
  type        = string
  default     = "main"
}

variable "restore_test_do_token" {
  description = "DigitalOcean token for the restore-test workflow, scoped to creating and deleting Droplets (create it by hand; there is no API for tokens)."
  type        = string
  sensitive   = true
}

variable "no_pii_databases" {
  description = "Databases the restore test may dump without a sanitize script."
  type        = list(string)
  default     = []
}

# --- Not managed here yet: Tailscale and Healthchecks.io --------------------------------------
variable "ts_authkey_host" {
  description = "Tailscale auth key for the host. Empty: run 'tailscale up --ssh' on the Droplet."
  type        = string
  default     = ""
  sensitive   = true
}

variable "ts_authkey_apps" {
  description = "Tailscale auth keys for private apps' sidecars, by app name (e.g. { barnbooks = \"tskey-...\" })."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "hc_backup_url" {
  type      = string
  default   = ""
  sensitive = true
}

variable "hc_restore_url" {
  type      = string
  default   = ""
  sensitive = true
}

# --- Spaces -----------------------------------------------------------------------------------
variable "backup_bucket" {
  description = "Bucket names are global across DigitalOcean; change these if they're taken."
  type        = string
  default     = "tdf-pg-backups"
}

variable "dumps_bucket" {
  type    = string
  default = "tdf-pg-dumps"
}

variable "dumps_retention_days" {
  description = "Sanitized dumps from the restore test are deleted after this many days."
  type        = number
  default     = 28
}
