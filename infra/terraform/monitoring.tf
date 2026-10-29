# Droplet alerts go to email and/or Slack. With neither set, no alert policies are created.
locals {
  # Whether Slack is configured isn't secret (only its URL is), so it can decide what gets created.
  slack_enabled      = nonsensitive(var.alert_slack != null)
  alert_destinations = var.alert_email != "" || local.slack_enabled

  alerts = {
    disk   = { type = "v1/insights/droplet/disk_utilization_percent", value = 80, description = "Platform disk above 80%" }
    cpu    = { type = "v1/insights/droplet/cpu", value = 85, description = "Platform CPU above 85%" }
    memory = { type = "v1/insights/droplet/memory_utilization_percent", value = 90, description = "Platform memory above 90%" }
  }
}

resource "digitalocean_monitor_alert" "platform" {
  for_each    = local.alert_destinations ? local.alerts : {}
  type        = each.value.type
  compare     = "GreaterThan"
  value       = each.value.value
  window      = "5m"
  description = each.value.description
  entities    = [tostring(digitalocean_droplet.platform.id)]
  enabled     = true

  alerts {
    email = var.alert_email != "" ? [var.alert_email] : []

    dynamic "slack" {
      for_each = local.slack_enabled ? [1] : []
      content {
        channel = var.alert_slack.channel
        url     = var.alert_slack.url
      }
    }
  }
}
