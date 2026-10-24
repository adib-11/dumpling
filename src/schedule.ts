import fs from "node:fs"
import path from "node:path"

// v1 ran Ingest from launchd at 03:00, which a sleeping Mac runs at its first wake.
const dailyHour = 3

// True once a day: at the first call at or after 03:00 since the last claim. stampFile keeps that claim.
export function claimDailyIngest(stampFile: string, now: Date): boolean {
  const since = new Date(now)
  since.setHours(dailyHour, 0, 0, 0)
  if (since > now) since.setDate(since.getDate() - 1)
  let last = Number.NaN
  try {
    last = new Date(fs.readFileSync(stampFile, "utf8").trim()).getTime()
  } catch {
    // Never claimed.
  }
  if (last >= since.getTime()) return false
  fs.mkdirSync(path.dirname(stampFile), { recursive: true })
  fs.writeFileSync(stampFile, now.toISOString())
  return true
}

// The last successful Telegram drain. Survives a quit, so a switched-off computer still warns after 20 h.
export function readDrain(stampFile: string): Date | null {
  try {
    const date = new Date(fs.readFileSync(stampFile, "utf8").trim())
    return Number.isNaN(date.getTime()) ? null : date
  } catch {
    return null
  }
}

export function rememberDrain(stampFile: string, now: Date): void {
  fs.mkdirSync(path.dirname(stampFile), { recursive: true })
  fs.writeFileSync(stampFile, now.toISOString())
}
