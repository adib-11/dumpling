import fs from "node:fs"

type Config = {
  brainFolder?: unknown
}

export function readBrainFolder(configPath: string): string | null {
  let raw: string
  try {
    raw = fs.readFileSync(configPath, "utf8")
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
  try {
    const parsed = JSON.parse(raw) as Config
    return typeof parsed.brainFolder === "string" && parsed.brainFolder.length > 0
      ? parsed.brainFolder
      : null
  } catch {
    return null
  }
}

export function writeBrainFolder(configPath: string, folder: string): void {
  fs.writeFileSync(configPath, JSON.stringify({ brainFolder: folder }, null, 2) + "\n")
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
