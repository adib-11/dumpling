import fs from "node:fs"
import { isProvider, type Engine } from "./engine"
import { defaultShortcut, isAccelerator } from "./shortcut"

type Config = {
  brainFolder?: unknown
  telegramChat?: unknown
  engine?: unknown
  openAtLogin?: unknown
  captureShortcut?: unknown
}

export type EngineChoice = Engine["name"]

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

// Null until the Owner picks one in setup.
export function readEngineChoice(configPath: string): EngineChoice | null {
  const { engine } = readConfig(configPath)
  return engine === "free" || isProvider(engine) ? engine : null
}

export function writeEngineChoice(configPath: string, engine: EngineChoice): void {
  writeConfig(configPath, { ...readConfig(configPath), engine })
}

// On until the Owner turns it off in Settings.
export function readOpenAtLogin(configPath: string): boolean {
  return readConfig(configPath).openAtLogin !== false
}

export function writeOpenAtLogin(configPath: string, openAtLogin: boolean): void {
  writeConfig(configPath, { ...readConfig(configPath), openAtLogin })
}

// The accelerator that opens the capture box: the default until Settings changes it.
export function readCaptureShortcut(configPath: string): string {
  const { captureShortcut } = readConfig(configPath)
  return typeof captureShortcut === "string" && isAccelerator(captureShortcut) ? captureShortcut : defaultShortcut
}

export function writeCaptureShortcut(configPath: string, captureShortcut: string): void {
  writeConfig(configPath, { ...readConfig(configPath), captureShortcut })
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
