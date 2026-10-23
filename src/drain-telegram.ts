import fs from "node:fs"
import path from "node:path"
import { git } from "./create-second-brain"
import { longPollSeconds, type Bot, type Update } from "./telegram"

// Turns the Owner's Telegram messages into Dumps in inbox/, following bin/drain-telegram (spec §5).

// Returns the offset for the next poll, which confirms this batch. The offset is never stored: after a quiet
// week update ids may jump, and a restart simply gets the unconfirmed updates again.
export async function drainTelegram(
  bot: Bot,
  folder: string,
  chat: number,
  offset?: number,
): Promise<number | undefined> {
  const updates = (await bot("getUpdates", { offset, timeout: longPollSeconds })) as Update[]
  const known = updates.length ? savedMessages(folder) : new Set<string>()
  const toDelete: number[] = []
  for (const { message } of updates) {
    // ponytail: only text is captured. Voice, photos and files stay visible in the chat but are confirmed,
    // so the drain never sees them again; the Owner resends them once they are supported.
    if (message?.chat.id !== chat || !message.text) continue
    toDelete.push(message.message_id)
    // Keyed on the text too: a newly connected bot numbers its messages from 1 again.
    if (known.has(`${message.message_id}\n${message.text}`)) continue
    let when = message.date
    while (fs.existsSync(path.join(folder, "inbox", `${localTime(when).stem}-telegram.md`))) when++
    const stem = `${localTime(when).stem}-telegram`
    const url = /https?:\/\/\S+/.exec(message.text)?.[0]
    const dump = [
      "---",
      `captured: ${localTime(message.date).iso}`,
      "device: telegram",
      `kind: ${url ? "link" : "text"}`,
      ...(url ? [`url: ${url}`] : []),
      `telegram_message_id: ${message.message_id}`,
      "---",
      message.text,
      "",
    ].join("\n")
    // Written outside inbox/ first, so a half-written Dump is never committed.
    const temp = path.join(folder, ".state", `${stem}.md`)
    fs.mkdirSync(path.dirname(temp), { recursive: true })
    fs.writeFileSync(temp, dump)
    fs.renameSync(temp, path.join(folder, "inbox", `${stem}.md`))
  }
  if (updates.length) await commitNewDumps(folder)
  for (const id of toDelete) {
    try {
      await bot("deleteMessage", { chat_id: chat, message_id: id })
    } catch (error) {
      console.error(`drain-telegram: message ${id}: saved, but could not delete it from the bot`, error)
    }
  }
  return updates.length ? updates[updates.length - 1].update_id + 1 : offset
}

// Long-polls the bot until stopped. A failed poll is retried; its batch stays unconfirmed, so nothing is lost.
// onDrained runs after each successful poll.
export async function pollTelegram(
  bot: Bot,
  folder: string,
  chat: number,
  stop: AbortSignal,
  retryMs = 5000,
  onDrained: () => void = () => {},
): Promise<void> {
  let offset: number | undefined
  while (!stop.aborted) {
    try {
      offset = await drainTelegram(bot, folder, chat, offset)
      onDrained()
    } catch (error) {
      console.error("drain-telegram: poll failed", error)
      await new Promise((resolve) => setTimeout(resolve, retryMs))
    }
  }
}

// Commits every Dump not yet in git, including any a failed commit left behind, and nothing else.
export async function commitNewDumps(folder: string): Promise<void> {
  const status = await git(["status", "--porcelain", "-z", "--untracked-files=all", "--", "inbox"], folder)
  const fresh = status
    .split("\0")
    .filter((entry) => entry.startsWith("?? ") && entry.endsWith(".md"))
    .map((entry) => entry.slice(3))
  if (!fresh.length) return
  await git(["add", "--", ...fresh], folder)
  await git(["commit", "-m", `drain: ${fresh.length} Dumps`, "--no-gpg-sign", "--", ...fresh], folder)
}

// Each saved message as "<telegram_message_id>\n<text>".
// ponytail: reads every Dump on each non-empty poll; keep an id index if vault/raw/ grows past tens of thousands.
function savedMessages(folder: string): Set<string> {
  const saved = new Set<string>()
  for (const dir of ["inbox", "vault/raw"]) {
    const root = path.join(folder, dir)
    if (!fs.existsSync(root)) continue
    for (const name of fs.readdirSync(root, { recursive: true, encoding: "utf8" })) {
      if (!name.endsWith(".md")) continue
      const dump = /^---\n[^]*?^telegram_message_id: (\d+)\n[^]*?^---\n([^]*)\n$/m.exec(
        fs.readFileSync(path.join(root, name), "utf8"),
      )
      if (dump) saved.add(`${dump[1]}\n${dump[2]}`)
    }
  }
  return saved
}

const pad = (n: number) => String(n).padStart(2, "0")

// A Unix time as the file stem ("2026-10-21-140000") and the captured time ("2026-10-21T14:00:00+06:00").
function localTime(seconds: number): { stem: string; iso: string } {
  const d = new Date(seconds * 1000)
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = [d.getHours(), d.getMinutes(), d.getSeconds()].map(pad)
  const offset = -d.getTimezoneOffset()
  const zone = `${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  return { stem: `${date}-${time.join("")}`, iso: `${date}T${time.join(":")}${zone}` }
}
