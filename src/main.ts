import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, safeStorage, shell, Tray } from "electron"
import fs from "node:fs"
import path from "node:path"
import { acceptApiKey, loadApiKey } from "./api-key"
import { readBrainFolder, writeBrainFolder } from "./brain-config"
import { createSecondBrain, defaultSecondBrainFolder } from "./create-second-brain"
import { ingestNow, spawnOpencode } from "./ingest-now"
import { enableLinuxAutostart } from "./login-item"
import { trayMenuItems, type TrayMenuItem } from "./tray-menu"

const openaiKeysUrl = "https://platform.openai.com/api-keys"

let tray: Tray | null = null
let wizard: BrowserWindow | null = null

function configPath(): string {
  return path.join(app.getPath("userData"), "config.json")
}

function keyFile(): string {
  return path.join(app.getPath("userData"), "openai-key.bin")
}

function storedKey(): string | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    return loadApiKey(keyFile(), safeStorage)
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

function openWizard(): void {
  if (wizard) {
    wizard.show()
    wizard.focus()
    return
  }
  if (process.platform === "darwin") void app.dock?.show()
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
    wizard = null
    if (process.platform === "darwin") app.dock?.hide()
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
                void ingestFromTray()
              }
            : undefined,
  }
}

function rebuildMenu(): void {
  if (!tray) return
  const folder = readBrainFolder(configPath())
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuItems(folder).map(toMenuItem)))
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
    if (result.status === "failed") {
      dialog.showErrorBox("Second Brain", redact(result.reason ?? "Ingest failed.", apiKey))
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ingest failed."
    dialog.showErrorBox("Second Brain", redact(message, apiKey))
  }
}

function start(): void {
  if (process.platform === "win32") app.setAppUserModelId("app.second-brain")

  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  app.on("second-instance", () => {
    if (readBrainFolder(configPath()) === null || storedKey() === null) openWizard()
  })

  app.on("window-all-closed", () => {
    // The tray keeps the process alive.
  })

  app.on("before-quit", () => {
    tray?.destroy()
    tray = null
  })

  ipcMain.handle("wizard:start", () => (readBrainFolder(configPath()) ? "key" : "folder"))

  ipcMain.handle("wizard:open-key-page", () => shell.openExternal(openaiKeysUrl))

  ipcMain.handle("wizard:save-key", async (_event, key: unknown) => {
    if (typeof key !== "string") return { ok: false as const, error: "Paste a key." }
    if (!safeStorage.isEncryptionAvailable()) {
      return { ok: false as const, error: "The OS keychain is not available." }
    }
    const result = await acceptApiKey(key, keyFile(), safeStorage, fetch)
    if (result.ok) wizard?.close()
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
      const message = error instanceof Error ? error.message : "Could not create the folder."
      return { ok: false as const, error: message }
    }
  })

  void app.whenReady().then(() => {
    enableLogin()
    if (process.platform === "darwin") app.dock?.hide()
    createTray()
    if (readBrainFolder(configPath()) === null || storedKey() === null) openWizard()
  })
}

start()
