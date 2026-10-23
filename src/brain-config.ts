import fs from "node:fs"

type Config = {
  brainFolder?: unknown
  telegramChat?: unknown
}

export function readBrainFolder(configPath: string): string | null {
  const { brainFolder } = readConfig(configPath)
  return typeof brainFolder === "string" && brainFolder.length > 0 ? brainFolder : null
}

export function writeBrainFolder(configPath: string, folder: string): void {
  writeConfig(configPath, { ...readConfig(configPath), brainFolder: folder })
}

export function readTelegramChat(configPath: string): number | null {
  const { telegramChat } = readConfig(configPath)
  return Number.isSafeInteger(telegramChat) ? (telegramChat as number) : null
}

export function writeTelegramChat(configPath: string, chat: number): void {
  writeConfig(configPath, { ...readConfig(configPath), telegramChat: chat })
}

function readConfig(configPath: string): Config {
  let raw: string
  try {
    raw = fs.readFileSync(configPath, "utf8")
  } catch (error) {
    if (isMissing(error)) return {}
    throw error
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === "object" && parsed !== null ? (parsed as Config) : {}
  } catch {
    return {}
  }
}

function writeConfig(configPath: string, config: Config): void {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
