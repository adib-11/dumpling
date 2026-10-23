import fs from "node:fs"
import path from "node:path"
import { git } from "./create-second-brain"
import { longPoll, type Bot } from "./telegram"

// Turns the Owner's Telegram messages into Dumps in inbox/, following bin/drain-telegram (spec §5).

type Message = { message_id: number; date: number; chat: { id: number }; text?: string }
type Update = { update_id: number; message?: Message }

// Returns the offset for the next poll, which confirms this batch. The offset is never stored: after a quiet
// week update ids may jump, and a restart simply gets the unconfirmed updates again.
export async function drainTelegram(
  bot: Bot,
  folder: string,
  chat: number,
  offset?: number,
): Promise<number | undefined> {
  const updates = (await bot("getUpdates", { offset, timeout: longPoll })) as Update[]
  const known = updates.length ? savedMessageIds(folder) : new Set<number>()
  const done: number[] = []
  let saved = 0
  for (const { message } of updates) {
    // ponytail: only text is captured; voice, photos and files stay in the chat, unsaved, until they are supported.
    if (message?.chat.id !== chat || !message.text) continue
    done.push(message.message_id)
    if (known.has(message.message_id)) continue
    let when = message.date
    while (fs.existsSync(path.join(folder, "inbox", `${stamp(when)}-telegram.md`))) when++
    const stem = `${stamp(when)}-telegram`
    const url = /https?:\/\/\S+/.exec(message.text)?.[0]
    const dump = [
      "---",
      `captured: ${isoTime(message.date)}`,
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
    saved++
  }
  if (saved) {
    await git(["add", "-A", "--", "inbox"], folder)
    await git(["commit", "-m", `drain: ${saved} Dumps`, "--no-gpg-sign", "--", "inbox"], folder)
  }
  for (const id of done) {
    try {
      await bot("deleteMessage", { chat_id: chat, message_id: id })
    } catch (error) {
      console.error(`drain-telegram: message ${id}: saved, but could not delete it from the bot`, error)
    }
  }
  return updates.length ? updates[updates.length - 1].update_id + 1 : offset
}

// Long-polls the bot until stopped. A failed poll is retried; its batch stays unconfirmed, so nothing is lost.
export async function pollTelegram(
  bot: Bot,
  folder: string,
  chat: number,
  stop: AbortSignal,
  retryMs = 5000,
): Promise<void> {
  let offset: number | undefined
  while (!stop.aborted) {
    try {
      offset = await drainTelegram(bot, folder, chat, offset)
    } catch (error) {
      console.error("drain-telegram: poll failed", error)
      await new Promise((resolve) => setTimeout(resolve, retryMs))
    }
  }
}

// ponytail: reads every Dump on each non-empty poll; keep an id index if vault/raw/ grows past tens of thousands.
function savedMessageIds(folder: string): Set<number> {
  const ids = new Set<number>()
  for (const dir of ["inbox", "vault/raw"]) {
    const root = path.join(folder, dir)
    if (!fs.existsSync(root)) continue
    for (const name of fs.readdirSync(root, { recursive: true, encoding: "utf8" })) {
      if (!name.endsWith(".md")) continue
      const id = /^telegram_message_id: (\d+)$/m.exec(fs.readFileSync(path.join(root, name), "utf8"))
      if (id) ids.add(Number(id[1]))
    }
  }
  return ids
}

const pad = (n: number) => String(n).padStart(2, "0")

function stamp(seconds: number): string {
  const d = new Date(seconds * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function isoTime(seconds: number): string {
  const d = new Date(seconds * 1000)
  const offset = -d.getTimezoneOffset()
  const sign = offset < 0 ? "-" : "+"
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${zone}`
}
