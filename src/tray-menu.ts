export type TrayMenuItem = {
  label: string
  action?: "setup" | "ingest" | "undo" | "ask" | "remote" | "quit"
  enabled: boolean
}

export function trayMenuItems(
  brainFolder: string | null,
  telegramConnected: boolean,
  backupFailed = false,
  unsaved: string | null = null,
): TrayMenuItem[] {
  if (brainFolder) {
    return [
      { label: brainFolder, enabled: false },
      ...(unsaved ? [{ label: unsaved, enabled: false }] : []),
      ...(backupFailed ? [{ label: "Backup push failed", enabled: false }] : []),
      { label: "Ingest now", action: "ingest", enabled: true },
      { label: "Undo last Ingest", action: "undo", enabled: true },
      { label: "Ask…", action: "ask", enabled: true },
      ...(telegramConnected
        ? []
        : [{ label: "Connect Telegram…", action: "setup" as const, enabled: true }]),
      { label: "Backup remote…", action: "remote", enabled: true },
      { label: "Quit", action: "quit", enabled: true },
    ]
  }
  return [
    { label: "Choose folder…", action: "setup", enabled: true },
    { label: "Quit", action: "quit", enabled: true },
  ]
}

export type TrayHealth = "ok" | "failing" | "not-drained"

// Telegram keeps updates for 24 h, so the app warns at 20 h. lastDrained is null when no bot is connected.
const drainWarnMs = 20 * 3600 * 1000

export function trayHealth(lastIngest: string | null, lastDrained: Date | null, now: Date): TrayHealth {
  if (lastIngest === "failed") return "failing"
  if (lastDrained && now.getTime() - lastDrained.getTime() > drainWarnMs) return "not-drained"
  return "ok"
}
