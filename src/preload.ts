import { contextBridge, ipcRenderer } from "electron"
import type { KeyResult } from "./api-key"

export type { KeyResult }
export type WizardResult = { ok: true; commit: string } | { ok: false; error: string }
export type TokenResult = { ok: true; username: string } | { ok: false; error: string }
export type ConnectResult = { ok: true } | { ok: false; error: string }

contextBridge.exposeInMainWorld("wizard", {
  start: (): Promise<"folder" | "key" | "bot" | "remote"> => ipcRenderer.invoke("wizard:start"),
  defaultFolder: (): Promise<string> => ipcRenderer.invoke("wizard:default-folder"),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("wizard:pick-folder"),
  create: (folder: string): Promise<WizardResult> => ipcRenderer.invoke("wizard:create", folder),
  saveKey: (key: string): Promise<KeyResult> => ipcRenderer.invoke("wizard:save-key", key),
  openKeyPage: (): Promise<void> => ipcRenderer.invoke("wizard:open-key-page"),
  openBotFather: (): Promise<void> => ipcRenderer.invoke("wizard:open-botfather"),
  checkToken: (token: string): Promise<TokenResult> => ipcRenderer.invoke("wizard:check-token", token),
  waitStart: (): Promise<ConnectResult> => ipcRenderer.invoke("wizard:wait-start"),
  backupRemote: (): Promise<boolean> => ipcRenderer.invoke("wizard:backup-remote"),
  saveRemote: (url: string): Promise<{ ok: true } | { ok: false; error: string }> => ipcRenderer.invoke("wizard:save-remote", url),
})
