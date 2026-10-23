export type TrayMenuItem = {
  label: string
  action?: "setup" | "ingest" | "quit"
  enabled: boolean
}

export function trayMenuItems(brainFolder: string | null): TrayMenuItem[] {
  if (brainFolder) {
    return [
      { label: brainFolder, enabled: false },
      { label: "Ingest now", action: "ingest", enabled: true },
      { label: "Quit", action: "quit", enabled: true },
    ]
  }
  return [
    { label: "Choose folder…", action: "setup", enabled: true },
    { label: "Quit", action: "quit", enabled: true },
  ]
}
