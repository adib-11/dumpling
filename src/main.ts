import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, shell, Tray } from "electron"
import fs from "node:fs"
import path from "node:path"
import { acceptApiKey, loadApiKey } from "./api-key"
import { askQuestion } from "./ask"
import { readBrainFolder, readTelegramChat, writeBrainFolder, writeTelegramChat } from "./brain-config"
import { createSecondBrain, defaultSecondBrainFolder } from "./create-second-brain"
import { pollTelegram, type Asker } from "./drain-telegram"
import { backupRemote, hideCredentials, setBackupRemote } from "./git-remote"
import { ingestNow, spawnOpencode, type IngestResult } from "./ingest-now"
import { enableLinuxAutostart } from "./login-item"
import { connectBot, telegramBot } from "./telegram"
import { trayMenuItems, type TrayMenuItem } from "./tray-menu"

const openaiKeysUrl = "https://platform.openai.com/api-keys"

let tray: Tray | null = null
let wizard: BrowserWindow | null = null
let askBox: BrowserWindow | null = null
let connecting: AbortController | null = null
let polling = false
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
  void pollTelegram(telegramBot(token), folder, chat, new AbortController().signal, asker())
}

// Answers one /ask question from Telegram by running the ask skill (spec §4).
function asker(): Asker {
  return async (question) => {
    const folder = readBrainFolder(configPath())
    const apiKey = storedKey()
    if (!folder || !apiKey) throw new Error("The app is not set up.")
    const result = await askQuestion({
      brain: folder,
      apiKey,
      question,
      runner: (run) => spawnOpencode(opencodeBin(), run),
    })
    if (result.status === "failed") throw new Error(result.reason)
    return result.answer
  }
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
          : item.action === "remote"
            ? () => openWizard("remote")
            : item.action === "ask"
              ? () => openAsk()
              : item.action === "ingest"
                ? () => {
                    void ingestFromTray()
                  }
                : undefined,
  }
}

function rebuildMenu(): void {
  if (!tray) return
  const folder = readBrainFolder(configPath())
  tray.setContextMenu(
    Menu.buildFromTemplate(trayMenuItems(folder, telegramConnected(), backupFailed).map(toMenuItem)),
  )
  tray.setToolTip("Second Brain")
}

function createTray(): void {
  const icon = resourcePath("assets", "icon.png")
  const image = nativeImage.createFromPath(icon).resize({ width: 22, height: 22 })
  if (image.isEmpty()) throw new Error(`Tray icon is missing or unreadable: ${icon}`)
  if (process.platform === "darwin") image.setTemplateImage(true)
  tray = new Tray(image)
  if (process.platform !== "darwin") {
    tray.on("click", () => tray?.popUpContextMenu())
  }
  rebuildMenu()
}

async function ingestFromTray(): Promise<void> {
  const folder = readBrainFolder(configPath())
  if (!folder) {
    openWizard()
    return
  }
  const apiKey = storedKey()
  if (!apiKey) {
    openWizard()
    return
  }
  const bin = opencodeBin()
  if (!fs.existsSync(bin)) {
    dialog.showErrorBox("Second Brain", "The opencode binary is missing.")
    return
  }
  try {
    const result = await ingestNow({
      brain: folder,
      apiKey,
      runner: (run) => spawnOpencode(bin, run),
    })
    if (result.status === "failed") console.error(redact(result.reason ?? "Ingest failed.", apiKey))
    showPush(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ingest failed."
    console.error(redact(message, apiKey))
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
    const folder = readBrainFolder(configPath())
    const apiKey = storedKey()
    if (typeof question !== "string" || question.trim() === "") {
      return { ok: false as const, error: "Type a question." }
    }
    if (!folder || !apiKey) return { ok: false as const, error: "Set up the app first." }
    try {
      const result = await askQuestion({
        brain: folder,
        apiKey,
        question: question.trim(),
        runner: (run) => spawnOpencode(opencodeBin(), run),
      })
      return result.status === "ok"
        ? { ok: true as const, answer: result.answer }
        : { ok: false as const, error: result.reason }
    } catch (error) {
      return { ok: false as const, error: errorMessage(error, "Could not answer.") }
    }
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
  })
}

start()

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
