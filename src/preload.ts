import { contextBridge, ipcRenderer } from "electron"
import type { DumplingApi, Tab } from "./main-window"

export type AskReply = { ok: true; answer: string } | { ok: false; error: string }

contextBridge.exposeInMainWorld("ask", {
  question: (question: string): Promise<AskReply> => ipcRenderer.invoke("ask:question", question),
})

const dumpling: DumplingApi = {
  state: () => ipcRenderer.invoke("window:state"),
  engine: () => ipcRenderer.invoke("window:engine"),
  onTab: (show) => {
    ipcRenderer.on("window:tab", (_event, tab: Tab) => show(tab))
    void ipcRenderer.invoke("window:ready").then((tab: Tab | null) => {
      if (tab) show(tab)
    })
  },
  defaultFolder: () => ipcRenderer.invoke("window:default-folder"),
  pickFolder: () => ipcRenderer.invoke("window:pick-folder"),
  create: (folder) => ipcRenderer.invoke("window:create", folder),
  providers: () => ipcRenderer.invoke("window:providers"),
  startFree: () => ipcRenderer.invoke("window:start-free"),
  saveKey: (provider, key) => ipcRenderer.invoke("window:save-key", provider, key),
  openKeyPage: (provider) => ipcRenderer.invoke("window:open-key-page", provider),
  openBotFather: () => ipcRenderer.invoke("window:open-botfather"),
  checkToken: (token) => ipcRenderer.invoke("window:check-token", token),
  waitStart: () => ipcRenderer.invoke("window:wait-start"),
  backupRemote: () => ipcRenderer.invoke("window:backup-remote"),
  saveRemote: (url) => ipcRenderer.invoke("window:save-remote", url),
  pages: () => ipcRenderer.invoke("pages:list"),
  page: (id) => ipcRenderer.invoke("pages:read", id),
  searchPages: (query) => ipcRenderer.invoke("pages:search", query),
  obsidianInstalled: () => ipcRenderer.invoke("pages:obsidian-installed"),
  openInObsidian: (id) => ipcRenderer.invoke("pages:open-in-obsidian", id),
  openLink: (url) => ipcRenderer.invoke("pages:open-link", url),
}

contextBridge.exposeInMainWorld("dumpling", dumpling)
