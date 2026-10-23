export type TrayMenuItem = {
  label: string
  action?: "setup" | "quit"
  enabled: boolean
}

export function trayMenuItems(brainFolder: string | null, telegramConnected: boolean): TrayMenuItem[] {
  if (brainFolder) {
    return [
      { label: brainFolder, enabled: false },
      ...(telegramConnected
        ? []
        : [{ label: "Connect Telegram…", action: "setup" as const, enabled: true }]),
      { label: "Quit", action: "quit", enabled: true },
    ]
  }
  return [
    { label: "Choose folder…", action: "setup", enabled: true },
    { label: "Quit", action: "quit", enabled: true },
  ]
}
