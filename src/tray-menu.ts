export type TrayMenuItem = {
  label: string
  action?: "open" | "ingest" | "undo" | "ask" | "remote" | "update" | "report" | "quit"
  enabled: boolean
}

// First run and connecting the phone happen in the main window, which Open Dumpling opens.
export function trayMenuItems(
  brainFolder: string | null,
  backupFailed = false,
  unsaved: string | null = null,
  newVersion: string | null = null,
): TrayMenuItem[] {
  const open = { label: "Open Dumpling", action: "open" as const, enabled: true }
  const update = newVersion
    ? [{ label: `New version ${newVersion}…`, action: "update" as const, enabled: true }]
    : []
  const report = { label: "Report a problem", action: "report" as const, enabled: true }
  if (brainFolder) {
    return [
      open,
      { label: brainFolder, enabled: false },
      ...(unsaved ? [{ label: unsaved, enabled: false }] : []),
      ...(backupFailed ? [{ label: "Backup push failed", enabled: false }] : []),
      { label: "Ingest now", action: "ingest", enabled: true },
      { label: "Undo last Ingest", action: "undo", enabled: true },
      { label: "Ask…", action: "ask", enabled: true },
      { label: "Backup remote…", action: "remote", enabled: true },
      ...update,
      report,
      { label: "Quit", action: "quit", enabled: true },
    ]
  }
  return [
    open,
    ...update,
    report,
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

export type TrayIcon = { file: string; template: boolean }

// The tray image for a state, as a path under assets/ (drawn by scripts/make-icons.js). A Mac menu bar icon is
// a template image in one colour, which macOS tints; its failing and not-drained variants differ in shape. The
// Windows and Linux trays show the colour logo with a red or amber dot.
export function trayIcon(state: TrayHealth, platform: NodeJS.Platform): TrayIcon {
  if (platform === "darwin") return { file: `tray/${state}Template.png`, template: true }
  return { file: `tray/${state}.${platform === "win32" ? "ico" : "png"}`, template: false }
}
