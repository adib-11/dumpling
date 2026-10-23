import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from "electron"
import path from "node:path"
import { readBrainFolder, writeBrainFolder } from "./brain-config"
import { createSecondBrain, defaultSecondBrainFolder } from "./create-second-brain"
import { enableLinuxAutostart } from "./login-item"
import { trayMenuItems, type TrayMenuItem } from "./tray-menu"

let tray: Tray | null = null
let wizard: BrowserWindow | null = null

function configPath(): string {
  return path.join(app.getPath("userData"), "config.json")
}

function templatesDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "templates")
  return path.join(__dirname, "..", "templates")
}

function iconFile(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "assets", "icon.png")
  return path.join(__dirname, "..", "assets", "icon.png")
}

function enableLogin(): void {
  if (!app.isPackaged) return
  try {
    if (process.platform === "linux") {
      const configHome = process.env.XDG_CONFIG_HOME || path.join(app.getPath("home"), ".config")
      enableLinuxAutostart(configHome, process.env.APPIMAGE || process.execPath)
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
    height: 320,
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
  const image = nativeImage.createFromPath(iconFile()).resize({ width: 22, height: 22 })
  if (image.isEmpty()) throw new Error(`Tray icon is missing or unreadable: ${iconFile()}`)
  if (process.platform === "darwin") image.setTemplateImage(true)
  tray = new Tray(image)
  if (process.platform !== "darwin") {
    tray.on("click", () => tray?.popUpContextMenu())
  }
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
    if (!readBrainFolder(configPath())) openWizard()
  })

  app.on("window-all-closed", () => {
    // The tray keeps the process alive.
  })

  app.on("before-quit", () => {
    tray?.destroy()
    tray = null
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
      const created = await createSecondBrain(chosen, { templatesDir: templatesDir() })
      writeBrainFolder(configPath(), chosen)
      rebuildMenu()
      wizard?.close()
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
    if (!readBrainFolder(configPath())) openWizard()
  })
}

start()
