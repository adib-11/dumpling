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
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { acceptApiKey, keyFileName, loadApiKey } from "./api-key"
import { askQuestion, type AskResult } from "./ask"
import {
  readBrainFolder,
  readEngineChoice,
  readOpenAtLogin,
  readTelegramChat,
  writeBrainFolder,
  writeEngineChoice,
  writeOpenAtLogin,
  writeTelegramChat,
} from "./brain-config"
import { createSecondBrain, defaultSecondBrainFolder, openSecondBrain } from "./create-second-brain"
import { pollTelegram, type Asker } from "./drain-telegram"
import { engineMedia, freeEngine, isProvider, keyEngine, keyProviders, offeredProviders, type Engine, type Provider } from "./engine"
import { ytDlpAt } from "./fetch-link"
import { backupRemote, hideCredentials, setBackupRemote } from "./git-remote"
import { ingestNow, lastIngestError, lastIngestStatus, spawnOpencode, undoLastIngest, type IngestResult } from "./ingest-now"
import { disableLinuxAutostart, enableLinuxAutostart } from "./login-item"
import { windowState, type Tab, type WindowState } from "./main-window"
import { problemReportUrl, systemName } from "./report-problem"
import { claimDailyIngest, readDrain, rememberDrain } from "./schedule"
import { isSecretName, moveSettings, oldAppName } from "./settings-move"
import { connectBot, ingestBot, telegramBot } from "./telegram"
import { trayHealth, trayMenuItems, type TrayHealth, type TrayMenuItem } from "./tray-menu"
import { newerRelease, type NewRelease } from "./update-check"

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null
// The /start wait, and the id of the bot it reads. That bot's poll waits until it is done.
let connecting: { abort: AbortController; bot: string | null } | null = null
// A token checked with getMe, kept here until /start connects it, so the bot in use stays until then.
let checkedToken: string | null = null
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
        const engine = currentEngine()
        return engine ? engineMedia(engine, (run) => spawnOpencode(opencodeBin(), run)) : undefined
      },
      onUnsaved(notice) {
        if (notice === unsaved) return
        unsaved = notice
        rebuildMenu()
      },
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

async function runIngest(fromTray: boolean): Promise<void> {
  const folder = readBrainFolder(configPath())
  if (!folder) {
    if (fromTray) openMainWindow()
    return
  }
  const engine = currentEngine()
  if (!engine) {
    if (fromTray) openMainWindow()
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
      engine,
      runner: (run) => spawnOpencode(bin, run),
      links: { fetch, ytDlp: ytDlpAt(vendorBin("yt-dlp"), vendorBin("deno")) },
      notify: (text, offer) => notify(redact(text, engine.key), offer),
      ...ingestBot(loadToken(), readTelegramChat(configPath())),
      daily: !fromTray,
    })
    if (result.status === "failed") console.error(redact(result.reason ?? "Ingest failed.", engine.key))
    showPush(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ingest failed."
    console.error(redact(message, engine.key))
    notify(redact(`Ingest failed: ${message}`, engine.key))
  }
  refreshHealth()
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
    return result.filePaths[0]
  })

  ipcMain.handle("window:create", async (_event, folder: unknown) => {
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

  ipcMain.handle("window:open-botfather", () => shell.openExternal("https://t.me/BotFather"))

  ipcMain.handle("window:folder", () => readBrainFolder(configPath()))

  // Settings points the app at another second brain, or makes one in an empty folder. The old folder stays as it is.
  ipcMain.handle("window:change-folder", async (_event, folder: unknown) => {
    if (typeof folder !== "string" || folder.trim() === "") {
      return { ok: false as const, error: "Choose a folder." }
    }
    const chosen = folder.trim()
    try {
      const { created } = await openSecondBrain(chosen, resourcePath("templates"))
      writeBrainFolder(configPath(), chosen)
      backupFailed = false
      rebuildMenu()
      await restartPolling()
      refreshHealth()
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

const oldSecrets = process.argv.find((arg) => arg.startsWith(readOldFlag))
if (oldSecrets !== undefined) printOldSecrets(oldSecrets.slice(readOldFlag.length).split(","))
else start()

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
