// What the main window shows (spec §4). First run is a folder, then the Engine; the phone is never a gate.
// Shared by the main process, the preload and the renderer, so it imports types only.
import type { PageGroup, PageHit, PageView } from "./page-view"

export type WindowStep = "folder" | "engine" | "today"

export type WindowState = { step: WindowStep; connectPhone: boolean }

export function windowState(setup: { folder: string | null; engine: boolean; bot: boolean }): WindowState {
  if (setup.folder === null) return { step: "folder", connectPhone: false }
  if (!setup.engine) return { step: "engine", connectPhone: false }
  return { step: "today", connectPhone: !setup.bot }
}

export const tabs = ["today", "inbox", "pages", "ask", "settings"] as const

export type Tab = (typeof tabs)[number]

export type Outcome = { ok: true } | { ok: false; error: string }

export type OfferedProvider = { id: string; label: string; model: string; audio: boolean }

// The main window's bridge to the main process, exposed by the preload as window.dumpling.
export type DumplingApi = {
  state(): Promise<WindowState>
  // "free", a provider id, or null before first run picks one.
  engine(): Promise<string | null>
  // The tab the main process asked for when it opened or focused the window, if any.
  onTab(show: (tab: Tab) => void): void
  defaultFolder(): Promise<string>
  pickFolder(): Promise<string | null>
  create(folder: string): Promise<Outcome>
  providers(): Promise<OfferedProvider[]>
  startFree(): Promise<void>
  saveKey(provider: string, key: string): Promise<Outcome>
  openKeyPage(provider: string): Promise<void>
  openBotFather(): Promise<void>
  checkToken(token: string): Promise<{ ok: true; username: string } | { ok: false; error: string }>
  waitStart(): Promise<Outcome>
  backupRemote(): Promise<boolean>
  saveRemote(url: string): Promise<Outcome>
  // The Pages tab. All of it reads; no call changes a Page.
  pages(): Promise<PageGroup[]>
  // null when `id` is not a Page.
  page(id: string): Promise<PageView | null>
  searchPages(query: string): Promise<PageHit[]>
  obsidianInstalled(): Promise<boolean>
  openInObsidian(id: string): Promise<void>
  // Opens an http or https link in the browser; anything else is ignored.
  openLink(url: string): Promise<void>
}
