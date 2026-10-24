import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  safeStorage,
  shell,
  Tray,
} from "electron"
import fs from "node:fs"
import path from "node:path"
import { acceptApiKey, loadApiKey } from "./api-key"
import { askQuestion, type AskResult } from "./ask"
import { readBrainFolder, readTelegramChat, writeBrainFolder, writeTelegramChat } from "./brain-config"
import { createSecondBrain, defaultSecondBrainFolder } from "./create-second-brain"
import { pollTelegram, type Asker } from "./drain-telegram"
import { backupRemote, hideCredentials, setBackupRemote } from "./git-remote"
import { ingestNow, lastIngestStatus, spawnOpencode, undoLastIngest, type IngestResult } from "./ingest-now"
import { enableLinuxAutostart } from "./login-item"
import { claimDailyIngest, readDrain, rememberDrain } from "./schedule"
import { connectBot, ingestBot, telegramBot } from "./telegram"
import { trayHealth, trayMenuItems, type TrayHealth, type TrayMenuItem } from "./tray-menu"

const openaiKeysUrl = "https://platform.openai.com/api-keys"

let tray: Tray | null = null
let wizard: BrowserWindow | null = null
let askBox: BrowserWindow | null = null
let connecting: AbortController | null = null
let polling = false
let lastDrained: Date | null = null
let awakeSince = Date.now()
let health: TrayHealth = "ok"
let wizardStep: "remote" | null = null
let backupFailed = false

function configPath(): string {
  return path.join(app.getPath("userData"), "config.json")
}

function keyFile(): string {
  return path.join(app.getPath("userData"), "openai-key.bin")
}

function tokenPath(): string {
  return path.join(app.getPath("userData"), "telegram-token")
}

function keychainReady(): boolean {
  const plainText =
    process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text"
  return safeStorage.isEncryptionAvailable() && !plainText
}

function storedKey(): string | null {
  try {
    if (!keychainReady()) return null
    return loadApiKey(keyFile(), safeStorage)
  } catch {
    return null
  }
}

// The bot token is kept encrypted by safeStorage, whose key lives in the OS keychain. It is never written
// to the second brain folder, a log or a command line.
function saveToken(token: string): void {
  if (!keychainReady()) {
    throw new Error("No OS keychain is available to keep the bot token.")
  }
  fs.writeFileSync(tokenPath(), safeStorage.encryptString(token), { mode: 0o600 })
}

function loadToken(): string | null {
  try {
    return safeStorage.decryptString(fs.readFileSync(tokenPath()))
  } catch {
    return null
  }
}

function opencodeBin(): string {
  const name = process.platform === "win32" ? "opencode.exe" : "opencode"
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "vendor")
  return path.join(root, "opencode", name)
}

function redact(text: string, secret: string): string {
  return secret === "" ? text : text.split(secret).join("[redacted]")
}

function telegramConnected(): boolean {
  return readTelegramChat(configPath()) !== null && loadToken() !== null
}

function setupStep(): "folder" | "key" | "bot" | null {
  if (readBrainFolder(configPath()) === null) return "folder"
  if (storedKey() === null) return "key"
  if (!telegramConnected()) return "bot"
  return null
}

function startPolling(): void {
  const folder = readBrainFolder(configPath())
  const chat = readTelegramChat(configPath())
  const token = loadToken()
  if (polling || !folder || chat === null || !token) return
  polling = true
  lastDrained = readDrain(drainStamp(folder)) ?? new Date()
  // The daily Ingest starts right after a drain, so it files what Telegram held overnight.
  void pollTelegram(telegramBot(token), folder, chat, new AbortController().signal, asker(), undefined, () => {
    const now = new Date()
    lastDrained = now
    rememberDrain(drainStamp(folder), now)
    dailyIngest()
    refreshHealth()
  })
}

function drainStamp(folder: string): string {
  return path.join(folder, ".state", "drained")
}

function dailyIngest(): void {
  const folder = readBrainFolder(configPath())
  if (!folder || storedKey() === null) return
  if (claimDailyIngest(path.join(folder, ".state", "daily-ingest"), new Date())) void runIngest(false)
}

function notify(body: string): void {
  if (Notification.isSupported()) new Notification({ title: "Second Brain", body }).show()
}

function trayImage(state: TrayHealth): Electron.NativeImage {
  const name = state === "ok" ? "icon.png" : `icon-${state}.png`
  const icon = resourcePath("assets", name)
  const image = nativeImage.createFromPath(icon).resize({ width: 22, height: 22 })
  if (image.isEmpty()) throw new Error(`Tray icon is missing or unreadable: ${icon}`)
  // A template image is drawn in one colour, which would hide the warning dot.
  if (process.platform === "darwin" && state === "ok") image.setTemplateImage(true)
  return image
}

function refreshHealth(): void {
  const folder = readBrainFolder(configPath())
  const next = trayHealth(folder ? lastIngestStatus(folder) : null, polling ? lastDrained : null, new Date())
  if (next === health || !tray) return
  health = next
  tray.setImage(trayImage(health))
  tray.setToolTip(
    health === "failing"
      ? "Second Brain: the last Ingest failed"
      : health === "not-drained"
        ? "Second Brain: Telegram not drained for 20 h"
        : "Second Brain",
  )
  if (health === "not-drained") notify("Telegram has not drained for 20 h. Messages older than 24 h are lost.")
}

// Answers one /ask question from Telegram by running the ask skill (spec §4).
function asker(): Asker {
  return async (question) => {
    const result = await runAsk(question)
    if (result.status === "failed") throw new Error(result.reason)
    return result.answer
  }
}

// The one path every question takes: the tray Ask box and Telegram /ask both run this.
async function runAsk(question: string): Promise<AskResult> {
  const folder = readBrainFolder(configPath())
  const apiKey = storedKey()
  if (!folder || !apiKey) return { status: "failed", reason: "The app is not set up." }
  return askQuestion({
    brain: folder,
    apiKey,
    question,
    runner: (run) => spawnOpencode(opencodeBin(), run),
  })
}

function resourcePath(...parts: string[]): string {
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..")
  return path.join(root, ...parts)
}

function enableLogin(): void {
  if (!app.isPackaged) return
  try {
    if (process.platform === "linux") {
      const configHome = process.env.XDG_CONFIG_HOME || path.join(app.getPath("home"), ".config")
      enableLinuxAutostart(
        configHome,
        process.env.APPIMAGE || process.execPath,
        process.env.APPIMAGE_EXTRACT_AND_RUN === "1",
      )
      return
    }
    app.setLoginItemSettings({ openAtLogin: true })
  } catch (error) {
    console.error("Could not register the login item.", error)
  }
}

function openWizard(step: "remote" | null = null): void {
  if (wizard && step !== null) {
    wizardStep = step
    wizard.reload()
  }
  if (wizard) {
    wizard.show()
    wizard.focus()
    return
  }
  if (process.platform === "darwin") void app.dock?.show()
  wizardStep = step
  wizard = new BrowserWindow({
    width: 520,
    height: 420,
    resizable: false,
    autoHideMenuBar: true,
    title: "Second Brain",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  wizard.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  wizard.webContents.on("will-navigate", (event) => event.preventDefault())
  void wizard.loadFile(path.join(__dirname, "wizard.html"))
  wizard.on("closed", () => {
    connecting?.abort()
    wizard = null
    wizardStep = null
    if (process.platform === "darwin" && !askBox) app.dock?.hide()
  })
}

function openAsk(): void {
  if (setupStep()) {
    openWizard()
    return
  }
  if (askBox) {
    askBox.show()
    askBox.focus()
    return
  }
  if (process.platform === "darwin") void app.dock?.show()
  askBox = new BrowserWindow({
    width: 560,
    height: 520,
    autoHideMenuBar: true,
    title: "Ask",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  askBox.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  askBox.webContents.on("will-navigate", (event) => event.preventDefault())
  void askBox.loadFile(path.join(__dirname, "ask.html"))
  askBox.on("closed", () => {
    askBox = null
    if (process.platform === "darwin" && !wizard) app.dock?.hide()
  })
}

function toMenuItem(item: TrayMenuItem): Electron.MenuItemConstructorOptions {
  return {
    label: item.label,
    enabled: item.enabled,
    click:
      item.action === "quit"
        ? () => app.quit()
        : item.action === "setup"
          ? () => openWizard()
          : item.action === "ingest"
            ? () => {
                void runIngest(true)
              }
            : item.action === "undo"
              ? () => {
                  void undoFromTray()
                }
              : item.action === "remote"
                ? () => openWizard("remote")
                : item.action === "ask"
                  ? () => openAsk()
                  : undefined,
  }
}

function rebuildMenu(): void {
  if (!tray) return
  const folder = readBrainFolder(configPath())
  tray.setContextMenu(
    Menu.buildFromTemplate(trayMenuItems(folder, telegramConnected(), backupFailed).map(toMenuItem)),
  )
}

function createTray(): void {
  tray = new Tray(trayImage("ok"))
  tray.setToolTip("Second Brain")
  if (process.platform !== "darwin") {
    tray.on("click", () => tray?.popUpContextMenu())
  }
  rebuildMenu()
  refreshHealth()
}

async function runIngest(fromTray: boolean): Promise<void> {
  const folder = readBrainFolder(configPath())
  if (!folder) {
    if (fromTray) openWizard()
    return
  }
  const apiKey = storedKey()
  if (!apiKey) {
    if (fromTray) openWizard()
    return
  }
  const bin = opencodeBin()
  if (!fs.existsSync(bin)) {
    notify("Ingest stopped: the opencode binary is missing.")
    return
  }
  try {
    const result = await ingestNow({
      brain: folder,
      apiKey,
      runner: (run) => spawnOpencode(bin, run),
      notify: (text) => notify(redact(text, apiKey)),
      ...ingestBot(loadToken(), readTelegramChat(configPath())),
    })
    if (result.status === "failed") console.error(redact(result.reason ?? "Ingest failed.", apiKey))
    showPush(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ingest failed."
    console.error(redact(message, apiKey))
    notify(redact(`Ingest failed: ${message}`, apiKey))
  }
  refreshHealth()
}

async function undoFromTray(): Promise<void> {
  const folder = readBrainFolder(configPath())
  if (!folder) return
  try {
    const result = await undoLastIngest(folder)
    notify(
      result.status === "ok"
        ? "Undid the last Ingest. Its Dumps are back in inbox/."
        : result.status === "nothing"
          ? "There is no Ingest to undo."
          : result.status === "already-running"
            ? "Ingest is running. Undo again when it is done."
            : `Undo failed, nothing changed: ${result.reason}`,
    )
  } catch (error) {
    notify(`Undo failed: ${errorMessage(error, "unknown error")}`)
  }
}

// A failed push shows in the tray until a push succeeds, and notifies once.
function showPush(result: IngestResult): void {
  if (!result.push) return
  if (!result.push.ok) {
    console.error(`Backup push failed: ${result.push.error}`)
    if (!backupFailed && Notification.isSupported()) {
      new Notification({ title: "Second Brain", body: "Backup push failed. Ingest still filed everything." }).show()
    }
  }
  backupFailed = !result.push.ok
  rebuildMenu()
}

function start(): void {
  if (process.platform === "win32") app.setAppUserModelId("app.second-brain")

  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  app.on("second-instance", () => {
    if (setupStep()) openWizard()
  })

  app.on("window-all-closed", () => {
    // The tray keeps the process alive.
  })

  app.on("before-quit", () => {
    tray?.destroy()
    tray = null
  })

  ipcMain.handle("wizard:start", () => wizardStep ?? setupStep() ?? "bot")

  ipcMain.handle("ask:question", async (_event, question: unknown) => {
    if (typeof question !== "string" || question.trim() === "") {
      return { ok: false as const, error: "Type a question." }
    }
    const result = await runAsk(question.trim()).catch((error: unknown) => ({
      status: "failed" as const,
      reason: errorMessage(error, "Could not answer."),
    }))
    return result.status === "ok"
      ? { ok: true as const, answer: result.answer }
      : { ok: false as const, error: result.reason }
  })

  ipcMain.handle("wizard:backup-remote", async () => {
    const folder = readBrainFolder(configPath())
    return folder !== null && (await backupRemote(folder)) !== null
  })

  ipcMain.handle("wizard:save-remote", async (_event, url: unknown) => {
    const folder = readBrainFolder(configPath())
    if (!folder) return { ok: false as const, error: "Choose a folder first." }
    if (typeof url !== "string") return { ok: false as const, error: "Paste a git remote URL." }
    try {
      await setBackupRemote(folder, url)
      backupFailed = false
      rebuildMenu()
      wizard?.close()
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, error: hideCredentials(errorMessage(error, "Could not set the remote.")) }
    }
  })

  ipcMain.handle("wizard:open-key-page", () => shell.openExternal(openaiKeysUrl))

  ipcMain.handle("wizard:save-key", async (_event, key: unknown) => {
    if (typeof key !== "string") return { ok: false as const, error: "Paste a key." }
    if (!keychainReady()) {
      return { ok: false as const, error: "The OS keychain is not available." }
    }
    const result = await acceptApiKey(key, keyFile(), safeStorage, fetch)
    if (result.ok && telegramConnected()) wizard?.close()
    return result
  })

  ipcMain.handle("wizard:default-folder", () =>
    defaultSecondBrainFolder(app.getPath("home"), app.getPath("documents")),
  )

  ipcMain.handle("wizard:pick-folder", async () => {
    const current = readBrainFolder(configPath())
    const result = await dialog.showOpenDialog({
      title: "Choose a folder for the second brain",
      defaultPath:
        current ?? defaultSecondBrainFolder(app.getPath("home"), app.getPath("documents")),
      properties: ["openDirectory", "createDirectory"],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle("wizard:create", async (_event, folder: unknown) => {
    if (typeof folder !== "string" || folder.trim() === "") {
      return { ok: false as const, error: "Choose a folder." }
    }
    const chosen = folder.trim()
    try {
      const created = await createSecondBrain(chosen, resourcePath("templates"))
      writeBrainFolder(configPath(), chosen)
      rebuildMenu()
      return { ok: true as const, commit: created.commit }
    } catch (error) {
      return { ok: false as const, error: errorMessage(error, "Could not create the folder.") }
    }
  })

  ipcMain.handle("wizard:open-botfather", () => shell.openExternal("https://t.me/BotFather"))

  ipcMain.handle("wizard:check-token", async (_event, pasted: unknown) => {
    try {
      if (typeof pasted !== "string") throw new Error("Paste the bot token.")
      const token = pasted.trim()
      const me = (await telegramBot(token)("getMe")) as { username: string }
      saveToken(token)
      return { ok: true as const, username: me.username }
    } catch (error) {
      return { ok: false as const, error: errorMessage(error, "Could not check the token.") }
    }
  })

  ipcMain.handle("wizard:wait-start", async () => {
    const token = loadToken()
    if (!token) return { ok: false as const, error: "Check the bot token first." }
    connecting?.abort()
    connecting = new AbortController()
    try {
      const chat = await connectBot(telegramBot(token), connecting.signal)
      writeTelegramChat(configPath(), chat)
      rebuildMenu()
      startPolling()
      wizard?.close()
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, error: errorMessage(error, "Could not reach the bot.") }
    }
  })

  void app.whenReady().then(() => {
    enableLogin()
    if (process.platform === "darwin") app.dock?.hide()
    createTray()
    startPolling()
    if (setupStep()) openWizard()
    powerMonitor.on("resume", () => {
      awakeSince = Date.now()
    })
    // With a bot, each drain starts the daily Ingest (startPolling). Without one, or with Telegram out of
    // reach for 5 minutes since the last start or wake, the clock does: the drain is best-effort.
    const tick = () => {
      const drainedOrAwake = Math.max(lastDrained?.getTime() ?? 0, awakeSince)
      if (!polling || Date.now() - drainedOrAwake > 5 * 60 * 1000) dailyIngest()
      refreshHealth()
    }
    tick()
    setInterval(tick, 60 * 1000)
  })
}

start()

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
