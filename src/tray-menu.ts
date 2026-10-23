export type TrayMenuItem = {
  label: string
  action?: "setup" | "ingest" | "remote" | "quit"
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
