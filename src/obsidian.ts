import path from "node:path"

// The link that opens a Page in Obsidian: by file path, which works when `vault/` is open as a vault there.
// Whether Obsidian is installed is the main process's question, since it needs Electron.
export function obsidianUrl(brain: string, pageId: string): string {
  // The folder keeps the separators of the system it is on, whatever system this runs on.
  const system = brain.includes("\\") && !brain.includes("/") ? path.win32 : path.posix
  const file = system.join(brain, "vault", "wiki", ...`${pageId}.md`.split("/"))
  return `obsidian://open?path=${encodeURIComponent(file)}`
}
