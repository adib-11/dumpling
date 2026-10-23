import { exec } from "dugite"

// The Owner's opt-in backup. The app pushes only to this remote, and only when it is set.
const remote = "backup"
const pushTimeoutMs = 5 * 60 * 1000

export async function backupRemote(brain: string): Promise<string | null> {
  const result = await exec(["remote", "get-url", remote], brain)
  return result.exitCode === 0 ? result.stdout.trim() : null
}

// A blank URL removes the remote, which turns pushing off.
export async function setBackupRemote(brain: string, url: string): Promise<void> {
  const wanted = url.trim()
  if (wanted.startsWith("-")) throw new Error("That is not a git remote URL.")
  const current = await backupRemote(brain)
  if (wanted === "" && current === null) return
  const args =
    wanted === "" ? ["remote", "remove", remote] : ["remote", current === null ? "add" : "set-url", remote, wanted]
  const result = await exec(args, brain)
  if (result.exitCode !== 0) throw new Error(hideCredentials(result.stderr) || "git remote failed")
}

// Returns null when no remote is set, so nothing was pushed.
export type PushResult = { ok: true } | { ok: false; error: string }

export async function pushBackup(brain: string): Promise<PushResult | null> {
  try {
    if ((await backupRemote(brain)) === null) return null
    const result = await exec(["push", "--quiet", remote, "HEAD"], brain, {
      env: { GIT_TERMINAL_PROMPT: "0" },
      signal: AbortSignal.timeout(pushTimeoutMs),
    })
    if (result.exitCode === 0) return { ok: true }
    return { ok: false, error: hideCredentials(result.stderr || result.stdout) || "git push failed" }
  } catch (error) {
    return { ok: false, error: hideCredentials(error instanceof Error ? error.message : "git push failed") }
  }
}

// Remote URLs can carry a user and token. They must never reach a log, the tray or a notification.
export function hideCredentials(text: string): string {
  return text.replace(/(\w+:\/\/)[^\s/]*@/g, "$1").trim()
}
