import fs from "node:fs"
import path from "node:path"
import { lockBrain } from "./brain-lock"
import { git } from "./create-second-brain"
import { commitNewDumps } from "./drain-telegram"
import { parseDump, readDump, withText } from "./dump"
import type { Outcome } from "./main-window"

// A Dump waiting for the next Ingest (spec §5, Inbox).
export type InboxDump = {
  name: string
  captured: string | null
  device: string
  kind: string
  text: string
}

// Every Dump in inbox/, oldest first. Sidecars (<name>.fetched.md) and images are not Dumps.
export function listInbox(brain: string): InboxDump[] {
  return dumpNames(brain).map((name) => {
    const dump = readDump(path.join(brain, "inbox", `${name}.md`))
    return {
      name,
      captured: dump.fields.captured ?? null,
      device: dump.fields.device ?? "",
      kind: dump.fields.kind ?? "text",
      text: dump.text,
    }
  })
}

const running: Outcome = { ok: false, error: "Ingest is running. Try again when it is done." }

// Rewrites the Owner's words of one Dump; its frontmatter and any image text stay. One commit.
export async function editDump(brain: string, name: string, text: string): Promise<Outcome> {
  if (text.trim() === "") return { ok: false, error: "A Dump needs some text. Delete it instead." }
  return change(brain, name, `edit: ${name}`, (file, files) => {
    const dump = parseDump(name, fs.readFileSync(file, "utf8"))
    const next = withText(dump, text)
    if (next === fs.readFileSync(file, "utf8")) return false
    fs.writeFileSync(file, next)
    return files
  })
}

// Removes one Dump with its image and link sidecar. One commit.
export async function deleteDump(brain: string, name: string): Promise<Outcome> {
  return change(brain, name, `delete: ${name}`, (_file, files) => {
    for (const each of files) fs.rmSync(path.join(brain, each), { force: true })
    return files
  })
}

// Runs one change on a Dump under the Ingest lock, so it never races a run that is moving the Dump, and
// commits what it touched and nothing else. `apply` returns the files it changed, or false for no change.
async function change(
  brain: string,
  name: string,
  message: string,
  apply: (file: string, files: string[]) => string[] | false,
): Promise<Outcome> {
  const unlock = lockBrain(brain)
  if (!unlock) return running
  try {
    // The name must be a Dump listed in inbox/, never a path the caller made up.
    if (!dumpNames(brain).includes(name)) return { ok: false, error: "That Dump is not in the Inbox any more." }
    // A Dump the drain has not committed yet goes in first, so this change is a commit of its own.
    await commitNewDumps(brain)
    const files = fs
      .readdirSync(path.join(brain, "inbox"))
      .filter((each) => each.startsWith(`${name}.`))
      .map((each) => `inbox/${each}`)
    const changed = apply(path.join(brain, "inbox", `${name}.md`), files)
    if (!changed) return { ok: true }
    await git(["add", "-A", "--", ...changed], brain)
    await git(["commit", "-m", message, "--no-gpg-sign", "--", ...changed], brain)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not change the Dump." }
  } finally {
    unlock()
  }
}

function dumpNames(brain: string): string[] {
  const inbox = path.join(brain, "inbox")
  if (!fs.existsSync(inbox)) return []
  return fs
    .readdirSync(inbox)
    .filter((name) => name.endsWith(".md") && !name.endsWith(".fetched.md"))
    .sort()
    .map((name) => name.slice(0, -3))
}
