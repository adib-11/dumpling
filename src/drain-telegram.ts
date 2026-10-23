import fs from "node:fs"
import path from "node:path"
import { decode, encode } from "jpeg-js"
import { git } from "./create-second-brain"
import { longPollSeconds, type Bot, type TelegramFile, type TelegramMessage, type Update } from "./telegram"

// Turns the Owner's Telegram messages into Dumps in inbox/, following bin/drain-telegram (spec §5).

// Voice is transcribed through this. Tests pass a fake; the app passes the Owner's key. Nothing here calls OpenAI itself.
export type MediaReader = {
  transcribe(audio: Buffer): Promise<string>
  readImage(jpeg: Buffer): Promise<string>
}

// Returns the offset for the next poll, which confirms this batch. The offset is never stored: after a quiet
// week update ids may jump, and a restart simply gets the unconfirmed updates again.
// A message that cannot be saved is not confirmed: the returned offset is that update's id, so the next poll
// receives it again and it stays in the chat.
export async function drainTelegram(
  bot: Bot,
  folder: string,
  chat: number,
  offset?: number,
  media?: MediaReader,
  onUnsaved?: (notice: string | null) => void,
): Promise<number | undefined> {
  const updates = (await bot("getUpdates", { offset, timeout: longPollSeconds })) as Update[]
  const known = updates.length ? savedMessages(folder) : emptyKnown()
  const toDelete: number[] = []
  for (const update of updates) {
    const message = update.message
    if (message?.chat.id !== chat) continue
    const outcome = await capture(bot, folder, message, known, media)
    if (outcome.status === "retry") {
      if (toDelete.length) await commitNewDumps(folder)
      await deleteSaved(bot, chat, toDelete)
      onUnsaved?.(outcome.notice)
      return update.update_id
    }
    if (outcome.status === "saved" || outcome.status === "duplicate") toDelete.push(message.message_id)
  }
  if (updates.length) await commitNewDumps(folder)
  await deleteSaved(bot, chat, toDelete)
  onUnsaved?.(null)
  return updates.length ? updates[updates.length - 1].update_id + 1 : offset
}

// Long-polls the bot until stopped. A failed poll is retried; its batch stays unconfirmed, so nothing is lost.
export async function pollTelegram(
  bot: Bot,
  folder: string,
  chat: number,
  stop: AbortSignal,
  retryMs = 5000,
  options?: { media?: MediaReader; onUnsaved?: (notice: string | null) => void },
): Promise<void> {
  let offset: number | undefined
  while (!stop.aborted) {
    let blocked = false
    try {
      offset = await drainTelegram(bot, folder, chat, offset, options?.media, (notice) => {
        blocked = notice !== null
        options?.onUnsaved?.(notice)
      })
      // The failed update is still waiting, so getUpdates would return it at once. Wait before spending another call.
      if (blocked && !stop.aborted) await new Promise((resolve) => setTimeout(resolve, retryMs))
    } catch (error) {
      console.error("drain-telegram: poll failed", error)
      await new Promise((resolve) => setTimeout(resolve, retryMs))
    }
  }
}

// Telegram drops an update after 24 h. After 12 h a failed voice note or photo is saved as a placeholder instead, so the file id is not lost.
const giveUpSeconds = 12 * 60 * 60
// The Bot API will not download a file larger than this.
const maxBytes = 20 * 1024 * 1024

type Known = { body: Set<string>; file: Set<string> }

function emptyKnown(): Known {
  return { body: new Set(), file: new Set() }
}

type CaptureResult = { status: "saved" | "duplicate" | "skip" } | { status: "retry"; notice: string }

// "saved" was written, "duplicate" is already a Dump, "skip" is not a Dump (a sticker), "retry" stays in the chat.
async function capture(
  bot: Bot,
  folder: string,
  message: TelegramMessage,
  known: Known,
  media: MediaReader | undefined,
): Promise<CaptureResult> {
  const attached = message.voice ?? message.audio ?? largestPhoto(message.photo) ?? message.document
  if (attached && (attached.file_size ?? 0) > maxBytes) {
    if (known.file.has(`${message.message_id}\n${attached.file_id}`)) return { status: "duplicate" }
    const words = message.caption ?? message.text ?? ""
    const mb = Math.floor((attached.file_size ?? 0) / 1024 / 1024)
    remember(
      folder,
      message,
      known,
      attached.file_id,
      "text",
      `file too large for bot: ${attached.file_name ?? "file"}, ${mb} MB${words ? `\n\n${words}` : ""}`,
    )
    return { status: "saved" }
  }
  const picture = largestPhoto(message.photo) ?? imageDocument(message)
  if (picture) return captureImage(bot, folder, message, picture, known, media)
  const voice = message.voice ?? message.audio
  if (voice) return captureVoice(bot, folder, message, voice.file_id, known, media)
  if (message.document) {
    if (known.file.has(`${message.message_id}\n${message.document.file_id}`)) return { status: "duplicate" }
    const words = message.caption ?? ""
    const name = message.document.file_name ?? "file"
    remember(
      folder,
      message,
      known,
      message.document.file_id,
      "text",
      `file sent to bot, not saved: ${name}${words ? `\n\n${words}` : ""}`,
    )
    return { status: "saved" }
  }
  if (!message.text) return { status: "skip" }
  // Keyed on the text too: a newly connected bot numbers its messages from 1 again.
  if (known.body.has(`${message.message_id}\n${message.text}`)) return { status: "duplicate" }
  const stem = freeStem(folder, message.date)
  const url = /https?:\/\/\S+/.exec(message.text)?.[0]
  writeDump(folder, stem, renderDump(message, url ? "link" : "text", message.text, url ? [`url: ${url}`] : []))
  known.body.add(`${message.message_id}\n${message.text}`)
  return { status: "saved" }
}

function largestPhoto(photos: TelegramFile[] | undefined): TelegramFile | undefined {
  let best: TelegramFile | undefined
  for (const photo of photos ?? []) {
    if (!best || (photo.file_size ?? photo.width ?? 0) >= (best.file_size ?? best.width ?? 0)) best = photo
  }
  return best
}

function imageDocument(message: TelegramMessage): TelegramFile | undefined {
  return message.document?.mime_type?.startsWith("image/") ? message.document : undefined
}

async function captureVoice(
  bot: Bot,
  folder: string,
  message: TelegramMessage,
  fileId: string,
  known: Known,
  media: MediaReader | undefined,
): Promise<CaptureResult> {
  // The file id is the content key. The transcript is not known until after the paid call, and a new bot
  // reuses message ids.
  if (known.file.has(`${message.message_id}\n${fileId}`)) return { status: "duplicate" }
  const caption = message.caption ?? ""
  let transcript: string
  try {
    if (!media) throw new Error("no OpenAI key")
    transcript = (await media.transcribe(await bot.file(fileId))).trim()
    if (!transcript) throw new Error("empty transcript")
  } catch (error) {
    if (giveUp(folder, message, known, fileId, caption, "voice note not transcribed")) return { status: "saved" }
    console.error(`drain-telegram: message ${message.message_id}: voice note not transcribed`, error)
    return { status: "retry", notice: "Voice note not transcribed" }
  }
  const body = caption ? `${transcript}\n\n${caption}` : transcript
  remember(folder, message, known, fileId, "voice", body)
  return { status: "saved" }
}

async function captureImage(
  bot: Bot,
  folder: string,
  message: TelegramMessage,
  photo: TelegramFile,
  known: Known,
  media: MediaReader | undefined,
): Promise<CaptureResult> {
  const fileId = photo.file_id
  if (known.file.has(`${message.message_id}\n${fileId}`)) return { status: "duplicate" }
  const caption = message.caption ?? ""
  try {
    if (!media) throw new Error("no OpenAI key")
    const jpeg = downscaleJpeg(await bot.file(fileId))
    const text = (await media.readImage(jpeg)).trim()
    const section = text ? `## Image text\n\n${text}` : ""
    const body = caption && section ? `${caption}\n\n${section}` : caption || section
    const stem = freeStem(folder, message.date)
    writeDump(
      folder,
      stem,
      renderDump(message, "image", body, [
        `image: ${stem}.jpg`,
        `telegram_message_id: ${message.message_id}`,
        `telegram_file_id: ${fileId}`,
      ]),
      jpeg,
    )
    known.file.add(`${message.message_id}\n${fileId}`)
    known.body.add(`${message.message_id}\n${body}`)
    return { status: "saved" }
  } catch (error) {
    if (giveUp(folder, message, known, fileId, caption, "photo not downloaded or not readable")) return { status: "saved" }
    console.error(`drain-telegram: message ${message.message_id}: photo not saved`, error)
    return { status: "retry", notice: "Photo not saved" }
  }
}

// ponytail: jpeg-js decodes baseline JPEG only. A progressive photo stays in the chat, then becomes a placeholder after 12 h; switch to sharp if that shows up.
function downscaleJpeg(input: Buffer): Buffer {
  const decoded = decode(input, { useTArray: true, formatAsRGBA: true })
  const width = decoded.width > 1200 ? 1200 : decoded.width
  const height = decoded.width > 1200 ? Math.max(1, Math.round((decoded.height * 1200) / decoded.width)) : decoded.height
  const data = width === decoded.width ? decoded.data : resample(decoded.data, decoded.width, decoded.height, width, height)
  return Buffer.from(encode({ data, width, height }, 80).data)
}

function resample(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const dst = new Uint8Array(dw * dh * 4)
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh))
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw))
      const from = (sy * sw + sx) * 4
      dst.set(src.subarray(from, from + 4), (y * dw + x) * 4)
    }
  }
  return dst
}

function giveUp(
  folder: string,
  message: TelegramMessage,
  known: Known,
  fileId: string,
  caption: string,
  reason: string,
): boolean {
  if (Date.now() / 1000 - message.date <= giveUpSeconds) return false
  remember(folder, message, known, fileId, "text", `${reason}, file_id ${fileId}${caption ? `\n\n${caption}` : ""}`)
  return true
}

function remember(
  folder: string,
  message: TelegramMessage,
  known: Known,
  fileId: string,
  kind: string,
  body: string,
): void {
  const stem = freeStem(folder, message.date)
  writeDump(
    folder,
    stem,
    renderDump(message, kind, body, [`telegram_message_id: ${message.message_id}`, `telegram_file_id: ${fileId}`]),
  )
  known.file.add(`${message.message_id}\n${fileId}`)
  known.body.add(`${message.message_id}\n${body}`)
}

function renderDump(message: TelegramMessage, kind: string, body: string, fields: string[]): string {
  const id = `telegram_message_id: ${message.message_id}`
  const lines = fields.includes(id) ? fields : [...fields, id]
  return ["---", `captured: ${localTime(message.date).iso}`, "device: telegram", `kind: ${kind}`, ...lines, "---", body, ""].join(
    "\n",
  )
}

function writeDump(folder: string, stem: string, contents: string, jpeg?: Buffer): void {
  // Written outside inbox/ first, image before the Dump, so a half-written pair is never committed.
  const dir = path.join(folder, ".state")
  fs.mkdirSync(dir, { recursive: true })
  if (jpeg) {
    const image = path.join(dir, `${stem}.jpg`)
    fs.writeFileSync(image, jpeg)
    fs.renameSync(image, path.join(folder, "inbox", `${stem}.jpg`))
  }
  const temp = path.join(dir, `${stem}.md`)
  fs.writeFileSync(temp, contents)
  fs.renameSync(temp, path.join(folder, "inbox", `${stem}.md`))
}

function freeStem(folder: string, date: number): string {
  let when = date
  let stem = `${localTime(when).stem}-telegram`
  while (fs.existsSync(path.join(folder, "inbox", `${stem}.md`))) {
    when++
    stem = `${localTime(when).stem}-telegram`
  }
  return stem
}

async function deleteSaved(bot: Bot, chat: number, ids: number[]): Promise<void> {
  for (const id of ids) {
    try {
      await bot("deleteMessage", { chat_id: chat, message_id: id })
    } catch (error) {
      console.error(`drain-telegram: message ${id}: saved, but could not delete it from the bot`, error)
    }
  }
}

// Commits every Dump not yet in git, including any a failed commit left behind, and nothing else.
async function commitNewDumps(folder: string): Promise<void> {
  const status = await git(["status", "--porcelain", "-z", "--untracked-files=all", "--", "inbox"], folder)
  const fresh = status
    .split("\0")
    .filter((entry) => entry.startsWith("?? ") && (entry.endsWith(".md") || entry.endsWith(".jpg")))
    .map((entry) => entry.slice(3))
  const dumps = fresh.filter((entry) => entry.endsWith(".md"))
  if (!dumps.length) return
  await git(["add", "--", ...fresh], folder)
  await git(["commit", "-m", `drain: ${dumps.length} Dumps`, "--no-gpg-sign", "--", ...fresh], folder)
}

// Each saved message as "<telegram_message_id>\n<text>", plus "<id>\n<file id>" for voice and photos.
// ponytail: reads every Dump on each non-empty poll; keep an id index if vault/raw/ grows past tens of thousands.
function savedMessages(folder: string): Known {
  const saved = emptyKnown()
  for (const dir of ["inbox", "vault/raw"]) {
    const root = path.join(folder, dir)
    if (!fs.existsSync(root)) continue
    for (const name of fs.readdirSync(root, { recursive: true, encoding: "utf8" })) {
      if (!name.endsWith(".md")) continue
      const text = fs.readFileSync(path.join(root, name), "utf8")
      const dump = /^---\n[^]*?^telegram_message_id: (\d+)\n[^]*?^---\n([^]*)\n$/m.exec(text)
      if (!dump) continue
      saved.body.add(`${dump[1]}\n${dump[2]}`)
      const file = /^telegram_file_id: (\S+)$/m.exec(text)
      if (file) saved.file.add(`${dump[1]}\n${file[1]}`)
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
