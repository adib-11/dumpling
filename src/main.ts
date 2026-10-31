import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  safeStorage,
  shell,
  Tray,
} from "electron"
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { acceptApiKey, keyFileName, loadApiKey } from "./api-key"
import { askQuestion, type AskResult } from "./ask"
import {
  readBrainFolder,
  readCaptureShortcut,
  readEngineChoice,
  readOpenAtLogin,
  readTelegramChat,
  writeBrainFolder,
  writeCaptureShortcut,
  writeEngineChoice,
  writeOpenAtLogin,
  writeTelegramChat,
} from "./brain-config"
import { createSecondBrain, defaultSecondBrainFolder, openSecondBrain, secondBrainPath } from "./create-second-brain"
import { pollTelegram, type Asker } from "./drain-telegram"
import { engineMedia, freeEngine, isProvider, keyEngine, keyProviders, offeredProviders, type Engine, type Provider } from "./engine"
import { ytDlpAt } from "./fetch-link"
import { backupRemote, hideCredentials, setBackupRemote } from "./git-remote"
import { ingestNow, lastIngestError, lastIngestStatus, spawnOpencode, undoLastIngest, type IngestResult } from "./ingest-now"
import { deleteDump, editDump, listInbox } from "./inbox"
import { disableLinuxAutostart, enableLinuxAutostart } from "./login-item"
import { windowState, type Tab, type WindowState } from "./main-window"
import { obsidianUrl } from "./obsidian"
import { listPages, readPage, searchPages } from "./pages"
import { quickCapture } from "./quick-capture"
import { problemReportUrl, systemName } from "./report-problem"
import { claimDailyIngest, readDrain, rememberDrain } from "./schedule"
import { createCaptureShortcut } from "./shortcut"
import { isSecretName, moveSettings, oldAppName } from "./settings-move"
import { connectBot, ingestBot, telegramBot } from "./telegram"
import { readToday } from "./today"
import { trayHealth, trayIcon, trayMenuItems, type TrayHealth, type TrayMenuItem } from "./tray-menu"
import { newerRelease, type NewRelease } from "./update-check"

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null
let captureWindow: BrowserWindow | null = null
// The /start wait, and the id of the bot it reads. That bot's poll waits until it is done.
let connecting: { abort: AbortController; bot: string | null } | null = null
// A token checked with getMe, kept here until /start connects it, so the bot in use stays until then.
let checkedToken: string | null = null
// The last folder the OS folder picker returned, normalized. Settings changes the folder only to this one.
let pickedFolder: string | null = null
// The running Telegram poll, stopped and started again when Settings changes the bot or the folder.
let poll: { stop: AbortController; done: Promise<void> } | null = null
let unsaved: string | null = null
let lastDrained: Date | null = null
let awakeSince = Date.now()
let health: TrayHealth = "ok"
// The tab the main window opens on, taken by the renderer once it has loaded.
let pendingTab: Tab | null = null
let backupFailed = false
let newRelease: NewRelease | null = null

function configPath(): string {
  return path.join(app.getPath("userData"), "config.json")
}

function keyFile(provider: Provider): string {
  return path.join(app.getPath("userData"), keyFileName(provider))
}

function tokenPath(): string {
  return path.join(app.getPath("userData"), "telegram-token")
}

// The child process that opens the secrets sealed under the old app name (settings-move.ts) gets this flag
// and the file names, comma-separated. It prints them opened, as JSON, to its stdout pipe and exits.
const readOldFlag = "--read-old-settings="

function oldSettingsFolder(): string {
  return path.join(app.getPath("appData"), oldAppName)
}

// safeStorage seals with a key kept per app name (and, on Windows, in the settings folder's Local State), so
// only a process named second-brain-app, on the old settings folder, can open the old secrets.
function readOldSecrets(names: string[]): Promise<Record<string, string>> {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const appArgs = app.isPackaged ? [] : [app.getAppPath()]
  const child = spawn(process.execPath, [...appArgs, `${readOldFlag}${names.join(",")}`], {
    env,
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  })
  // A keychain prompt waits for the Owner, so the limit is generous.
  const timer = setTimeout(() => child.kill(), 5 * 60 * 1000)
  return new Promise((resolve, reject) => {
    const out: Buffer[] = []
    child.stdout?.on("data", (chunk: Buffer) => out.push(chunk))
    child.on("error", reject)
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(`exited ${code}`))
      try {
        resolve(JSON.parse(Buffer.concat(out).toString("utf8")) as Record<string, string>)
      } catch (error) {
        reject(error)
      }
    })
  })
}

// The child process's whole run. It never takes the single instance lock, opens a window or a tray.
function printOldSecrets(names: string[]): void {
  app.setName(oldAppName)
  app.setPath("userData", oldSettingsFolder())
  void app.whenReady().then(() => {
    if (process.platform === "darwin") app.dock?.hide()
    const opened: Record<string, string> = {}
    for (const name of names.filter(isSecretName)) {
      try {
        opened[name] = safeStorage.decryptString(fs.readFileSync(path.join(oldSettingsFolder(), name)))
      } catch {
        // Left out: the parent names it as not moved.
      }
    }
    process.stdout.write(JSON.stringify(opened), () => app.exit(0))
  })
}

// Once, on the first start after the rename (spec §7). The second brain folder stays where it is.
async function moveOldSettings(): Promise<void> {
  try {
    const result = await moveSettings({
      from: oldSettingsFolder(),
      to: app.getPath("userData"),
      readOld: readOldSecrets,
      cipher: keychainReady() ? safeStorage : null,
    })
    if (!result.moved) return
    // An old login item would start the Second Brain app as well. Windows names it by the old app id.
    if (process.platform === "win32" && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: false, name: "app.second-brain" })
    }
    const lost = result.lost.map((name) => (name === "telegram-token" ? "bot token" : "key"))
    if (lost.length > 0) {
      notify(`Moved the settings from Second Brain, but not the ${[...new Set(lost)].join(" or ")}. Add it again in the Dumpling window.`)
    }
  } catch (error) {
    console.error("Could not move the settings from Second Brain.", error)
  }
}

function keychainReady(): boolean {
  const plainText =
    process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text"
  return safeStorage.isEncryptionAvailable() && !plainText
}

function storedKey(provider: Provider): string | null {
  try {
    if (!keychainReady()) return null
    return loadApiKey(keyFile(provider), safeStorage)
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

// A bot token starts with the bot's id: "<id>:<secret>".
function botId(token: string | null): string | null {
  return token?.split(":")[0] ?? null
}

function vendorBin(name: string): string {
  const exe = process.platform === "win32" ? `${name}.exe` : name
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "vendor")
  return path.join(root, name, exe)
}

function opencodeBin(): string {
  return vendorBin("opencode")
}

// The Owner's one Engine, or null before first run chooses one. An install from before Engines with a key has
// the OpenAI Key Engine.
function currentEngine(): Engine | null {
  const choice = readEngineChoice(configPath())
  if (choice === "free") return freeEngine
  const provider = choice ?? "openai"
  const key = storedKey(provider)
  return key ? keyEngine(provider, key) : null
}

// Reads photos and voice notes with the current Engine, or undefined before one is set up.
function currentMedia(): ReturnType<typeof engineMedia> | undefined {
  const engine = currentEngine()
  return engine ? engineMedia(engine, (run) => spawnOpencode(opencodeBin(), run)) : undefined
}

function redact(text: string, secret: string): string {
  return secret === "" ? text : text.split(secret).join("[redacted]")
}

function telegramConnected(): boolean {
  return readTelegramChat(configPath()) !== null && loadToken() !== null
}

function currentWindowState(): WindowState {
  return windowState({
    folder: readBrainFolder(configPath()),
    engine: currentEngine() !== null,
    bot: telegramConnected(),
  })
}

function firstRunDone(): boolean {
  return currentWindowState().step === "today"
}

function startPolling(): void {
  const folder = readBrainFolder(configPath())
  const chat = readTelegramChat(configPath())
  const token = loadToken()
  if (poll || !folder || chat === null || !token) return
  if (connecting && connecting.bot === botId(token)) return
  lastDrained = readDrain(drainStamp(folder)) ?? new Date()
  const stop = new AbortController()
  // The daily Ingest starts right after a drain, so it files what Telegram held overnight.
  const done = pollTelegram(
    telegramBot(token),
    folder,
    chat,
    stop.signal,
    asker(),
    undefined,
    () => {
      const now = new Date()
      lastDrained = now
      rememberDrain(drainStamp(folder), now)
      dailyIngest()
      refreshHealth()
    },
    {
      // Read on each drain, so a key added later transcribes the next voice note.
      get media() {
        return currentMedia()
      },
      onUnsaved(notice) {
        if (notice === unsaved) return
        unsaved = notice
        rebuildMenu()
      },
      onSaved: broadcastChange,
    },
  )
  poll = { stop, done }
}

// Waits for the poll to confirm what it saved, so the next poll does not save it again.
async function stopPolling(): Promise<void> {
  const running = poll
  if (!running) return
  running.stop.abort()
  await running.done
  if (poll === running) poll = null
  lastDrained = null
}

async function restartPolling(): Promise<void> {
  await stopPolling()
  startPolling()
}

// Tells the main window that the folder changed under it, so Today and Inbox read it again.
function broadcastChange(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("window:changed")
}

function drainStamp(folder: string): string {
  return path.join(folder, ".state", "drained")
}

function dailyIngest(): void {
  const folder = readBrainFolder(configPath())
  if (!folder || currentEngine() === null) return
  if (claimDailyIngest(path.join(folder, ".state", "daily-ingest"), new Date())) void runIngest(false)
}

// "add-key" offers to add a key: a button where the system shows one, and a click on the notification anywhere.
function notify(body: string, offer?: "add-key"): void {
  if (!Notification.isSupported()) return
  const notice = new Notification({
    title: "Dumpling",
    body,
    ...(offer && { actions: [{ type: "button" as const, text: "Add a key" }] }),
  })
  if (offer) {
    notice.on("click", () => openMainWindow("settings"))
    notice.on("action", () => openMainWindow("settings"))
  }
  notice.show()
}

function trayImage(state: TrayHealth): Electron.NativeImage {
  const icon = trayIcon(state, process.platform)
  const file = resourcePath("assets", icon.file)
  // Electron loads the @2x copy beside a PNG by itself.
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) throw new Error(`Tray icon is missing or unreadable: ${file}`)
  image.setTemplateImage(icon.template)
  return image
}

// The taskbar icon of a window on Windows and Linux. A Mac window takes the app's Dock icon.
function windowIcon(): string | undefined {
  if (process.platform === "darwin") return undefined
  return resourcePath("assets", process.platform === "win32" ? "icon.ico" : path.join("icons", "512x512.png"))
}

function refreshHealth(): void {
  const folder = readBrainFolder(configPath())
  const next = trayHealth(folder ? lastIngestStatus(folder) : null, poll ? lastDrained : null, new Date())
  if (next === health || !tray) return
  health = next
  tray.setImage(trayImage(health))
  tray.setToolTip(trayTip())
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

// The one path every question takes: the Ask tab and Telegram /ask both run this.
async function runAsk(question: string): Promise<AskResult> {
  const folder = readBrainFolder(configPath())
  const engine = currentEngine()
  if (!folder || !engine) return { status: "failed", reason: "The app is not set up." }
  return askQuestion({
    brain: folder,
    engine,
    question,
    runner: (run) => spawnOpencode(opencodeBin(), run),
  })
}

function resourcePath(...parts: string[]): string {
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..")
  return path.join(root, ...parts)
}

// The packaged app opens at login unless Settings turned it off. Throws when the system refuses.
function applyLogin(): void {
  if (!app.isPackaged) return
  const on = readOpenAtLogin(configPath())
  if (process.platform === "linux") {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(app.getPath("home"), ".config")
    if (!on) {
      disableLinuxAutostart(configHome)
      return
    }
    enableLinuxAutostart(
      configHome,
      process.env.APPIMAGE || process.execPath,
      process.env.APPIMAGE_EXTRACT_AND_RUN === "1",
    )
    return
  }
  app.setLoginItemSettings({ openAtLogin: on })
}

// The Dock icon shows while the main window is open; the app stays in the menu bar either way.
function updateDock(): void {
  if (process.platform !== "darwin") return
  if (mainWindow) void app.dock?.show()
  else app.dock?.hide()
}

function openMainWindow(tab: Tab | null = null): void {
  if (mainWindow) {
    if (tab) mainWindow.webContents.send("window:tab", tab)
    mainWindow.show()
    mainWindow.focus()
    return
  }
  pendingTab = tab
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 560,
    minHeight: 420,
    autoHideMenuBar: true,
    title: "Dumpling",
    icon: windowIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  updateDock()
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault())
  void mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"))
  mainWindow.on("closed", () => {
    connecting?.abort.abort()
    mainWindow = null
    pendingTab = null
    updateDock()
  })
}

// The global shortcut opens this small box from any app (spec v0.2 §6). Before a folder is chosen it opens the
// main window instead, which asks for one.
function openCapture(): void {
  if (!readBrainFolder(configPath())) {
    openMainWindow()
    return
  }
  if (captureWindow) {
    captureWindow.show()
    captureWindow.focus()
    return
  }
  const box = new BrowserWindow({
    width: 480,
    height: 220,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: "Dumpling capture",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  captureWindow = box
  box.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  box.webContents.on("will-navigate", (event) => event.preventDefault())
  box.once("ready-to-show", () => {
    if (process.platform === "darwin") app.focus({ steal: true })
    box.show()
    box.focus()
  })
  box.on("closed", () => {
    captureWindow = null
  })
  void box.loadFile(path.join(__dirname, "renderer", "index.html"), { hash: "capture" })
}

const captureShortcut = createCaptureShortcut(globalShortcut, process.platform, openCapture)

// The bytes the Owner pasted or dropped as a JPEG, whatever format they were in (a pasted screenshot is a PNG, which
// quickCapture's baseline-JPEG decoder cannot read). Resized here first so a huge screenshot is never decoded whole;
// quickCapture then sizes it to 1200 px as it does a Telegram photo.
function imageToJpeg(bytes: Uint8Array): Buffer | null {
  let image = nativeImage.createFromBuffer(Buffer.from(bytes))
  if (image.isEmpty()) return null
  if (image.getSize().width > 1200) image = image.resize({ width: 1200, quality: "good" })
  return image.toJPEG(85)
}

// Before first run is done the window shows first run instead.
function openAsk(): void {
  openMainWindow(firstRunDone() ? "ask" : null)
}

function toMenuItem(item: TrayMenuItem): Electron.MenuItemConstructorOptions {
  return {
    label: item.label,
    enabled: item.enabled,
    click:
      item.action === "quit"
        ? () => app.quit()
        : item.action === "open"
          ? () => openMainWindow()
          : item.action === "ingest"
            ? () => {
                void runIngest(true)
              }
            : item.action === "undo"
              ? () => {
                  void undoFromTray()
                }
              : item.action === "remote"
                ? () => openMainWindow("settings")
                : item.action === "ask"
                  ? () => openAsk()
                  : item.action === "update"
                    ? () => {
                        if (newRelease) void shell.openExternal(newRelease.url)
                      }
                    : item.action === "report"
                      ? () => reportProblem()
                      : undefined,
  }
}

function rebuildMenu(): void {
  if (!tray) return
  const folder = readBrainFolder(configPath())
  const items = trayMenuItems(folder, backupFailed, unsaved, newRelease?.version ?? null)
  tray.setContextMenu(Menu.buildFromTemplate(items.map(toMenuItem)))
  tray.setToolTip(trayTip())
}

// A voice note or photo waiting in the chat is named first; it is the thing the Owner can act on now.
function trayTip(): string {
  if (unsaved) return unsaved
  if (health === "failing") return "Dumpling: the last Ingest failed"
  if (health === "not-drained") return "Dumpling: Telegram not drained for 20 h"
  return "Dumpling"
}

function createTray(): void {
  tray = new Tray(trayImage("ok"))
  tray.setToolTip("Dumpling")
  if (process.platform !== "darwin") {
    tray.on("click", () => tray?.popUpContextMenu())
  }
  rebuildMenu()
  refreshHealth()
}

// Returns how the run ended, or "not-set-up" when there is no folder, Engine or opencode to run it with.
async function runIngest(fromTray: boolean): Promise<IngestResult["status"] | "not-set-up"> {
  const folder = readBrainFolder(configPath())
  if (!folder) {
    if (fromTray) openMainWindow()
    return "not-set-up"
  }
  const engine = currentEngine()
  if (!engine) {
    if (fromTray) openMainWindow()
    return "not-set-up"
  }
  const bin = opencodeBin()
  if (!fs.existsSync(bin)) {
    notify("Ingest stopped: the opencode binary is missing.")
    return "not-set-up"
  }
  let status: IngestResult["status"] = "failed"
  try {
    const result = await ingestNow({
      brain: folder,
      engine,
      runner: (run) => spawnOpencode(bin, run),
      links: { fetch, ytDlp: ytDlpAt(vendorBin("yt-dlp"), vendorBin("deno")) },
      notify: (text, offer) => notify(redact(text, engine.key), offer),
      ...ingestBot(loadToken(), readTelegramChat(configPath())),
      daily: !fromTray,
    })
    status = result.status
    if (result.status === "failed") console.error(redact(result.reason ?? "Ingest failed.", engine.key))
    showPush(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ingest failed."
    console.error(redact(message, engine.key))
    notify(redact(`Ingest failed: ${message}`, engine.key))
  }
  refreshHealth()
  broadcastChange()
  return status
}

// The issue carries the version, the system and the last Ingest error, and no Dump or Page text.
function reportProblem(): void {
  const folder = readBrainFolder(configPath())
  let lastError: ReturnType<typeof lastIngestError> = null
  try {
    lastError = folder ? lastIngestError(folder) : null
  } catch (error) {
    console.error("Could not read the last Ingest error.", error)
  }
  void shell.openExternal(
    problemReportUrl({
      version: app.getVersion(),
      system: systemName(process.platform, process.getSystemVersion(), process.arch),
      lastError,
      folder,
      home: app.getPath("home"),
    }),
  )
}

async function checkForUpdate(): Promise<void> {
  const found = await newerRelease(app.getVersion(), fetch)
  if (found?.version === newRelease?.version) return
  newRelease = found
  rebuildMenu()
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
  broadcastChange()
}

// A failed push shows in the tray until a push succeeds, and notifies once.
function showPush(result: IngestResult): void {
  if (!result.push) return
  if (!result.push.ok) {
    console.error(`Backup push failed: ${result.push.error}`)
    if (!backupFailed && Notification.isSupported()) {
      new Notification({ title: "Dumpling", body: "Backup push failed. Ingest still filed everything." }).show()
    }
  }
  backupFailed = !result.push.ok
  rebuildMenu()
}

function start(): void {
  if (process.platform === "win32") app.setAppUserModelId("app.dumpling")

  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  app.on("second-instance", () => openMainWindow())

  app.on("window-all-closed", () => {
    // The tray keeps the process alive.
  })

  app.on("will-quit", () => globalShortcut.unregisterAll())

  app.on("before-quit", () => {
    tray?.destroy()
    tray = null
  })

  ipcMain.handle("window:state", () => currentWindowState())

  ipcMain.handle("window:engine", () => currentEngine()?.name ?? null)

  ipcMain.handle("window:ready", () => {
    const tab = pendingTab
    pendingTab = null
    return tab
  })

  ipcMain.handle("window:ask", async (_event, question: unknown) => {
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

  ipcMain.handle("window:backup-remote", async () => {
    const folder = readBrainFolder(configPath())
    return folder !== null && (await backupRemote(folder)) !== null
  })

  ipcMain.handle("window:save-remote", async (_event, url: unknown) => {
    const folder = readBrainFolder(configPath())
    if (!folder) return { ok: false as const, error: "Choose a folder first." }
    if (typeof url !== "string") return { ok: false as const, error: "Paste a git remote URL." }
    try {
      await setBackupRemote(folder, url)
      backupFailed = false
      rebuildMenu()
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, error: hideCredentials(errorMessage(error, "Could not set the remote.")) }
    }
  })

  ipcMain.handle("capture:save", async (_event, text: unknown, image: unknown) => {
    const folder = readBrainFolder(configPath())
    if (!folder) return { ok: false as const, error: "Choose a folder first." }
    if (typeof text !== "string") return { ok: false as const, error: "Type something or paste an image." }
    let jpeg: Buffer | undefined
    if (image !== null && image !== undefined) {
      if (!(image instanceof Uint8Array) || image.byteLength > maxImageBytes) {
        return { ok: false as const, error: "That image is too large or not an image." }
      }
      jpeg = imageToJpeg(image) ?? undefined
      if (!jpeg) return { ok: false as const, error: "Could not read that image. Use a JPEG or PNG." }
    }
    const result = await quickCapture(folder, { text, image: jpeg }, { media: currentMedia() })
    if (result.ok) {
      broadcastChange()
      captureWindow?.close()
    }
    return result
  })

  ipcMain.handle("capture:close", () => {
    captureWindow?.close()
  })

  ipcMain.handle("window:capture-shortcut", () => ({ ...captureShortcut.status(), platform: process.platform }))

  ipcMain.handle("window:set-capture-shortcut", (_event, accelerator: unknown) => {
    if (typeof accelerator !== "string") return { ok: false as const, error: "Press a shortcut." }
    const result = captureShortcut.change(accelerator)
    if (result.ok) writeCaptureShortcut(configPath(), accelerator)
    return result
  })

  ipcMain.handle("pages:list", () => {
    const folder = readBrainFolder(configPath())
    return folder ? listPages(folder) : []
  })

  ipcMain.handle("pages:read", async (_event, id: unknown) => {
    const folder = readBrainFolder(configPath())
    return folder && typeof id === "string" ? readPage(folder, id) : null
  })

  ipcMain.handle("pages:search", (_event, query: unknown) => {
    const folder = readBrainFolder(configPath())
    return folder && typeof query === "string" ? searchPages(folder, query) : []
  })

  ipcMain.handle("pages:obsidian-installed", () => app.getApplicationNameForProtocol("obsidian://") !== "")

  ipcMain.handle("pages:open-in-obsidian", (_event, id: unknown) => {
    const folder = readBrainFolder(configPath())
    if (!folder || typeof id !== "string") return
    // Only a listed Page gets a link, so the renderer cannot point Obsidian at another file.
    const listed = listPages(folder).some((group) => group.pages.some((page) => page.id === id))
    if (listed) return shell.openExternal(obsidianUrl(folder, id))
  })

  ipcMain.handle("pages:open-link", (_event, url: unknown) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) return shell.openExternal(url)
  })

  ipcMain.handle("window:today", () => {
    const folder = readBrainFolder(configPath())
    return folder ? readToday(folder, new Date()) : null
  })

  ipcMain.handle("window:inbox", () => {
    const folder = readBrainFolder(configPath())
    return folder ? listInbox(folder) : []
  })

  ipcMain.handle("window:edit-dump", async (_event, name: unknown, text: unknown) => {
    const folder = readBrainFolder(configPath())
    if (!folder) return { ok: false as const, error: "Choose a folder first." }
    if (typeof name !== "string" || typeof text !== "string") return { ok: false as const, error: "Type some text." }
    const result = await editDump(folder, name, text)
    broadcastChange()
    return result
  })

  ipcMain.handle("window:delete-dump", async (_event, name: unknown) => {
    const folder = readBrainFolder(configPath())
    if (!folder) return { ok: false as const, error: "Choose a folder first." }
    if (typeof name !== "string") return { ok: false as const, error: "Choose a Dump." }
    const result = await deleteDump(folder, name)
    broadcastChange()
    return result
  })

  ipcMain.handle("window:retry-ingest", async () => {
    const status = await runIngest(true)
    if (status === "already-running") return { ok: false as const, error: "Ingest is already running." }
    if (status === "not-set-up") return { ok: false as const, error: "Ingest cannot start: finish setting up the Engine first." }
    return { ok: true as const }
  })

  ipcMain.handle("window:providers", () => offeredProviders())

  ipcMain.handle("window:open-key-page", (_event, provider: unknown) => {
    if (isProvider(provider)) return shell.openExternal(keyProviders[provider].keysUrl)
  })

  ipcMain.handle("window:save-key", async (_event, chosen: unknown, key: unknown) => {
    // The renderer's value only picks an entry; the id used for the key file comes from the app's own list.
    const provider = offeredProviders().find((offered) => offered.id === chosen)?.id
    if (!provider) return { ok: false as const, error: "Choose a provider." }
    if (typeof key !== "string") return { ok: false as const, error: "Paste a key." }
    if (!keychainReady()) {
      return { ok: false as const, error: "The OS keychain is not available." }
    }
    const result = await acceptApiKey(provider, key, keyFile(provider), safeStorage, fetch)
    if (result.ok) writeEngineChoice(configPath(), provider)
    return result
  })

  ipcMain.handle("window:start-free", () => {
    writeEngineChoice(configPath(), "free")
  })

  ipcMain.handle("window:default-folder", () =>
    defaultSecondBrainFolder(app.getPath("home"), app.getPath("documents")),
  )

  ipcMain.handle("window:pick-folder", async () => {
    const current = readBrainFolder(configPath())
    const result = await dialog.showOpenDialog({
      title: "Choose a folder for the second brain",
      defaultPath:
        current ?? defaultSecondBrainFolder(app.getPath("home"), app.getPath("documents")),
      properties: ["openDirectory", "createDirectory"],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    pickedFolder = secondBrainPath(result.filePaths[0])
    return pickedFolder
  })

  ipcMain.handle("window:create", async (_event, folder: unknown) => {
    if (typeof folder !== "string" || folder.trim() === "") {
      return { ok: false as const, error: "Choose a folder." }
    }
    try {
      const chosen = secondBrainPath(folder.trim())
      const created = await createSecondBrain(chosen, resourcePath("templates"))
      writeBrainFolder(configPath(), chosen)
      rebuildMenu()
      return { ok: true as const, commit: created.commit }
    } catch (error) {
      return { ok: false as const, error: errorMessage(error, "Could not create the folder.") }
    }
  })

  ipcMain.handle("window:open-botfather", () => shell.openExternal("https://t.me/BotFather"))

  ipcMain.handle("window:folder", () => readBrainFolder(configPath()))

  // Settings points the app at another second brain, or makes one in an empty folder. The old folder stays as it is.
  // It takes only the folder the OS picker just returned, never a path typed or sent by the renderer.
  ipcMain.handle("window:change-folder", async (_event, folder: unknown) => {
    if (typeof folder !== "string" || folder.trim() === "") {
      return { ok: false as const, error: "Choose a folder." }
    }
    try {
      const chosen = secondBrainPath(folder.trim())
      if (chosen !== pickedFolder) return { ok: false as const, error: "Choose the folder with Browse." }
      const { created } = await openSecondBrain(chosen, resourcePath("templates"))
      pickedFolder = null
      writeBrainFolder(configPath(), chosen)
      backupFailed = false
      rebuildMenu()
      await restartPolling()
      refreshHealth()
      broadcastChange()
      return { ok: true as const, created }
    } catch (error) {
      return { ok: false as const, error: errorMessage(error, "Could not use that folder.") }
    }
  })

  ipcMain.handle("window:open-at-login", () => readOpenAtLogin(configPath()))

  ipcMain.handle("window:set-open-at-login", (_event, on: unknown) => {
    if (typeof on !== "boolean") return { ok: false as const, error: "Choose on or off." }
    const before = readOpenAtLogin(configPath())
    writeOpenAtLogin(configPath(), on)
    try {
      applyLogin()
      return { ok: true as const }
    } catch (error) {
      writeOpenAtLogin(configPath(), before)
      return { ok: false as const, error: errorMessage(error, "The system did not take the change.") }
    }
  })

  ipcMain.handle("window:check-token", async (_event, pasted: unknown) => {
    try {
      if (typeof pasted !== "string") throw new Error("Paste the bot token.")
      const token = pasted.trim()
      const me = (await telegramBot(token)("getMe")) as { username: string }
      if (!keychainReady()) throw new Error("No OS keychain is available to keep the bot token.")
      checkedToken = token
      return { ok: true as const, username: me.username }
    } catch (error) {
      return { ok: false as const, error: errorMessage(error, "Could not check the token.") }
    }
  })

  // The bot in use keeps polling until the new one's /start arrives. When the token is for that same bot its
  // poll stops while connectBot reads the updates, since Telegram serves one getUpdates per bot at a time.
  ipcMain.handle("window:wait-start", async () => {
    const token = checkedToken
    if (!token) return { ok: false as const, error: "Check the bot token first." }
    connecting?.abort.abort()
    const attempt = { abort: new AbortController(), bot: botId(token) }
    connecting = attempt
    if (botId(loadToken()) === attempt.bot) await stopPolling()
    try {
      const chat = await connectBot(telegramBot(token), attempt.abort.signal)
      if (connecting === attempt) connecting = null
      saveToken(token)
      writeTelegramChat(configPath(), chat)
      checkedToken = null
      rebuildMenu()
      await restartPolling()
      return { ok: true as const }
    } catch (error) {
      if (connecting === attempt) connecting = null
      startPolling()
      return { ok: false as const, error: errorMessage(error, "Could not reach the bot.") }
    }
  })

  void app.whenReady().then(async () => {
    await moveOldSettings()
    try {
      applyLogin()
    } catch (error) {
      console.error("Could not register the login item.", error)
    }
    if (process.platform === "darwin") app.dock?.hide()
    createTray()
    captureShortcut.start(readCaptureShortcut(configPath()))
    startPolling()
    if (!firstRunDone()) openMainWindow()
    powerMonitor.on("resume", () => {
      awakeSince = Date.now()
    })
    // With a bot, each drain starts the daily Ingest (startPolling). Without one, or with Telegram out of
    // reach for 5 minutes since the last start or wake, the clock does: the drain is best-effort.
    const tick = () => {
      const drainedOrAwake = Math.max(lastDrained?.getTime() ?? 0, awakeSince)
      if (!poll || Date.now() - drainedOrAwake > 5 * 60 * 1000) dailyIngest()
      refreshHealth()
    }
    tick()
    setInterval(tick, 60 * 1000)
    void checkForUpdate()
    setInterval(() => void checkForUpdate(), 24 * 3600 * 1000)
  })
}

// A pasted or dropped image over this is refused before it is decoded. The capture box refuses the same size
// (renderer/Capture.tsx), so it can say so without a round trip.
const maxImageBytes = 20 * 1024 * 1024

const oldSecrets = process.argv.find((arg) => arg.startsWith(readOldFlag))
if (oldSecrets !== undefined) printOldSecrets(oldSecrets.slice(readOldFlag.length).split(","))
else start()

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
