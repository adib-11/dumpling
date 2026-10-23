import { contextBridge, ipcRenderer } from "electron"

export type WizardResult = { ok: true; commit: string } | { ok: false; error: string }

contextBridge.exposeInMainWorld("wizard", {
  defaultFolder: (): Promise<string> => ipcRenderer.invoke("wizard:default-folder"),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("wizard:pick-folder"),
  create: (folder: string): Promise<WizardResult> => ipcRenderer.invoke("wizard:create", folder),
})
