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
  description = "Region for the platform Droplet, its volume and VPC. Check it has capacity first (see README: First-run gotchas)."
  type        = string
  default     = "tor1"
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
  description = "Public key to register for root/admin SSH: the whole line of e.g. ~/.ssh/id_ed25519.pub. Leave empty to use ssh_key_fingerprint."
  type        = string
  default     = ""
  validation {
    condition     = var.ssh_public_key == "" || can(regex("^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)) [A-Za-z0-9+/]{40,}={0,3}( .*)?$", trimspace(var.ssh_public_key)))
    error_message = "ssh_public_key isn't a valid public key. Paste the whole line from: cat ~/.ssh/id_ed25519.pub"
  }
}

variable "ssh_key_fingerprint" {
  description = "Fingerprint of an SSH key already on your DigitalOcean account. Used instead of ssh_public_key."
  type        = string
  default     = ""
}

variable "admin_cidrs" {
  description = "Addresses allowed to SSH (port 22), e.g. your IP as [\"<ip>/32\"] (find it with: curl -4 ifconfig.me). Empty closes SSH; use Tailscale SSH instead."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for c in var.admin_cidrs : can(cidrhost(c, 0))])
    error_message = "Each admin_cidrs entry must be a CIDR: your IP plus /32, e.g. [\"<your-ip>/32\"]."
  }
  validation {
    # 192.0.2.0/24, 198.51.100.0/24 and 203.0.113.0/24 are reserved for documentation, so they're never
    # anyone's real address: an entry in them is a placeholder left in terraform.tfvars.
    condition = alltrue([
      for c in var.admin_cidrs : !can(cidrhost(c, 0)) ||
      !contains(["192.0.2.0", "198.51.100.0", "203.0.113.0"], cidrhost("${split("/", c)[0]}/24", 0))
    ])
    error_message = "admin_cidrs still has a documentation placeholder. Use your real IP: curl -4 ifconfig.me"
  }
}

variable "alert_email" {
  description = "Email for Droplet disk/CPU/memory alerts. Must be a verified DigitalOcean user: your login email or an accepted team member (a team contact email isn't enough). Empty: no email alerts."
  type        = string
  default     = ""
  validation {
    condition     = var.alert_email == "" || (can(regex("^[^@ ]+@[^@ ]+\\.[^@ ]+$", var.alert_email)) && !can(regex("@example\\.(com|org|net)$", var.alert_email)))
    error_message = "alert_email must be empty or a real, DigitalOcean-verified address."
  }
}

variable "alert_slack" {
  description = "Slack incoming webhook for Droplet alerts, e.g. { channel = \"#alerts\", url = \"https://hooks.slack.com/services/...\" }. Null: no Slack alerts."
  type = object({
    channel = string
    url     = string
  })
  default   = null
  sensitive = true
}

# --- Platform ---------------------------------------------------------------------------------
variable "admin_user" {
  description = "Admin user created by provision.sh (root SSH login is disabled)."
  type        = string
  validation {
    condition     = can(regex("^[a-z_][a-z0-9_-]{0,31}$", var.admin_user))
    error_message = "admin_user must be a Linux username: lowercase letters, digits, - or _, no spaces (e.g. \"joe\")."
  }
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
  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", var.farm_site_domain)) && !can(regex("(^|\\.)example\\.(com|org|net)$", var.farm_site_domain))
    error_message = "farm_site_domain must be your real domain (lowercase), not the example placeholder."
  }
}

variable "acme_email" {
  description = "Let's Encrypt account email (certificate expiry notices)."
  type        = string
  validation {
    condition     = can(regex("^[^@ ]+@[^@ ]+\\.[^@ ]+$", var.acme_email)) && !can(regex("@example\\.(com|org|net)$", var.acme_email))
    error_message = "acme_email must be a real address you read, not the example placeholder."
  }
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
  description = "DigitalOcean token for the restore-test workflow, created by hand (there is no API for tokens) with custom scopes droplet:create, droplet:read, droplet:delete, ssh_key:read, tag:create and tag:read."
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
