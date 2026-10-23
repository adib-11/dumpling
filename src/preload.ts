import { contextBridge, ipcRenderer } from "electron"

export type WizardResult = { ok: true; commit: string } | { ok: false; error: string }
export type TokenResult = { ok: true; username: string } | { ok: false; error: string }
export type ConnectResult = { ok: true } | { ok: false; error: string }

contextBridge.exposeInMainWorld("wizard", {
  defaultFolder: (): Promise<string> => ipcRenderer.invoke("wizard:default-folder"),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("wizard:pick-folder"),
  hasFolder: (): Promise<boolean> => ipcRenderer.invoke("wizard:has-folder"),
  create: (folder: string): Promise<WizardResult> => ipcRenderer.invoke("wizard:create", folder),
  openBotFather: (): Promise<void> => ipcRenderer.invoke("wizard:open-botfather"),
  checkToken: (token: string): Promise<TokenResult> => ipcRenderer.invoke("wizard:check-token", token),
  waitStart: (): Promise<ConnectResult> => ipcRenderer.invoke("wizard:wait-start"),
})
