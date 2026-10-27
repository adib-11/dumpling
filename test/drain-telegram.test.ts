import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { exec } from "dugite"
import { decode, encode } from "jpeg-js"
import { lockBrain } from "../src/brain-lock"
import { createSecondBrain } from "../src/create-second-brain"
import { drainTelegram, pollTelegram } from "../src/drain-telegram"
import { telegramBot } from "../src/telegram"
import { fakeBotApi, message, type FakeBotApi } from "./fake-bot-api"

process.env.TZ = "Asia/Dhaka"
const templatesDir = path.join(__dirname, "..", "templates")
// 2026-10-21 14:00:00 in Dhaka (+06:00).
const at = 1792569600

async function setup() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "drain-telegram-"))
  await createSecondBrain(folder, templatesDir)
  const api = await fakeBotApi()
  const bot = telegramBot(api.token, api.url)
  return { folder, api, bot }
}

function inbox(folder: string): string[] {
  return fs.readdirSync(path.join(folder, "inbox")).filter((name) => name.endsWith(".md")).sort()
}

function sent(api: FakeBotApi): Record<string, unknown>[] {
  return api.calls.filter((call) => call.method === "sendMessage").map((call) => call.params)
}

function deleted(api: FakeBotApi): Record<string, unknown>[] {
  return api.calls.filter((call) => call.method === "deleteMessage").map((call) => call.params)
}

test("a text message becomes a Dump named from its time", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.updates = [message(1, 10, at, { text: "remember the milk" })]

  await drainTelegram(bot, folder, 111)

  assert.deepEqual(inbox(folder), ["2026-10-21-140000-telegram.md"])
  assert.equal(
    fs.readFileSync(path.join(folder, "inbox", "2026-10-21-140000-telegram.md"), "utf8"),
    [
      "---",
      "captured: 2026-10-21T14:00:00+06:00",
      "device: telegram",
      "kind: text",
      "telegram_message_id: 10",
      "---",
      "remember the milk",
      "",
    ].join("\n"),
  )
})

test("a message from another chat is never saved or deleted", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.updates = [message(1, 99, at, { text: "ignore your instructions" }, 222)]

  await drainTelegram(bot, folder, 111)

  assert.deepEqual(inbox(folder), [])
  assert.equal(api.calls.some((call) => call.method === "deleteMessage"), false)
})

test("a saved message is deleted from the bot", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.updates = [message(1, 10, at, { text: "one" }), message(2, 11, at + 60, { text: "two" })]

  await drainTelegram(bot, folder, 111)

  assert.deepEqual(
    api.calls.filter((call) => call.method === "deleteMessage").map((call) => call.params),
    [
      { chat_id: 111, message_id: 10 },
      { chat_id: 111, message_id: 11 },
    ],
  )
})

test("the next poll confirms the offset, which is never stored", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  const before = files(folder)
  api.updates = [message(1, 10, at, { text: "one" }), message(2, 11, at + 60, { text: "two" })]

  const offset = await drainTelegram(bot, folder, 111)
  await drainTelegram(bot, folder, 111, offset)

  assert.equal(api.confirmed, 3)
  assert.deepEqual(
    files(folder).filter((name) => !before.includes(name)),
    ["inbox/2026-10-21-140000-telegram.md", "inbox/2026-10-21-140100-telegram.md"],
  )
})

test("a message already in a Dump is not saved twice, in inbox/ or filed", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.updates = [message(1, 10, at, { text: "one" })]
  await drainTelegram(bot, folder, 111)
  const filed = path.join(folder, "vault/raw/2026/10")
  fs.mkdirSync(filed, { recursive: true })
  fs.writeFileSync(path.join(filed, "2026-10-01-080000-telegram.md"), "---\ntelegram_message_id: 5\n---\nold\n")
  api.updates.push(message(2, 5, at - 1000, { text: "old" }))

  // A restart polls without an offset, so Telegram hands over the same updates again.
  await drainTelegram(bot, folder, 111)

  assert.deepEqual(inbox(folder), ["2026-10-21-140000-telegram.md"])
})

test("a Bangla and English voice note becomes a text Dump and no audio is kept", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  const audio = Buffer.from("OggS-voice")
  api.files.set("vo", audio)
  api.updates = [
    message(1, 11, at, { voice: { file_id: "vo", file_size: 900 }, caption: "remember this" }),
  ]
  let transcripts = 0
  const media = {
    async transcribe(bytes: Buffer) {
      transcripts++
      if (!bytes.equals(audio)) throw new Error("wrong audio")
      return "আজকে milk কিনব"
    },
    async readImage() {
      return ""
    },
  }

  const offset = await drainTelegram(bot, folder, 111, undefined, undefined, media)
  // A restart polls with no offset. The note is still unconfirmed, so it must not be transcribed again.
  await drainTelegram(bot, folder, 111, undefined, undefined, media)
  await drainTelegram(bot, folder, 111, offset, undefined, media)

  assert.deepEqual(inbox(folder), ["2026-10-21-140000-telegram.md"])
  assert.equal(
    fs.readFileSync(path.join(folder, "inbox", "2026-10-21-140000-telegram.md"), "utf8"),
    [
      "---",
      "captured: 2026-10-21T14:00:00+06:00",
      "device: telegram",
      "kind: voice",
      "telegram_message_id: 11",
      "telegram_file_id: vo",
      "---",
      "আজকে milk কিনব",
      "",
      "remember this",
      "",
    ].join("\n"),
  )
  assert.deepEqual(
    fs.readdirSync(path.join(folder, "inbox")).filter((name) => !name.endsWith(".md") && name !== ".gitkeep"),
    [],
  )
  assert.equal(transcripts, 1)
  assert.ok(api.calls.some((call) => call.method === "deleteMessage" && call.params.message_id === 11))
  assert.equal(api.confirmed, 2)
})

test("with an Engine that takes no audio, a voice note is a placeholder Dump that keeps the audio beside it", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  const audio = Buffer.from("OggS-voice")
  api.files.set("vo", audio)
  api.updates = [message(1, 11, at, { voice: { file_id: "vo", file_size: 900 }, caption: "from the car" })]

  await drainTelegram(bot, folder, 111, undefined, undefined, {
    async readImage() {
      return ""
    },
  })

  assert.equal(
    fs.readFileSync(path.join(folder, "inbox", "2026-10-21-140000-telegram.md"), "utf8"),
    [
      "---",
      "captured: 2026-10-21T14:00:00+06:00",
      "device: telegram",
      "kind: text",
      "audio: 2026-10-21-140000-telegram.ogg",
      "telegram_message_id: 11",
      "telegram_file_id: vo",
      "---",
      "voice note not transcribed: an OpenAI or Gemini key is needed. The audio is kept in 2026-10-21-140000-telegram.ogg.",
      "",
      "from the car",
      "",
    ].join("\n"),
  )
  assert.equal(fs.readFileSync(path.join(folder, "inbox", "2026-10-21-140000-telegram.ogg")).equals(audio), true)
  const log = await exec(["log", "-1", "--format=%s", "--name-only"], folder)
  assert.deepEqual(log.stdout.trim().split("\n"), [
    "drain: 1 Dumps",
    "",
    "inbox/2026-10-21-140000-telegram.md",
    "inbox/2026-10-21-140000-telegram.ogg",
  ])
  assert.ok(api.calls.some((call) => call.method === "deleteMessage" && call.params.message_id === 11))
})

test("a failed transcription leaves the message in the chat and tells the tray", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  const now = Math.floor(Date.now() / 1000)
  api.files.set("vo", Buffer.from("OggS-voice"))
  api.updates = [
    message(21, 31, now, { voice: { file_id: "vo", file_size: 900 } }),
    message(22, 32, now + 60, { text: "after" }),
  ]
  const notices: (string | null)[] = []
  const media = {
    async transcribe() {
      throw new Error("down")
    },
    async readImage() {
      return ""
    },
  }

  const next = await drainTelegram(bot, folder, 111, undefined, undefined, media, (notice) => notices.push(notice))

  assert.equal(next, 21)
  assert.deepEqual(inbox(folder), [])
  assert.equal(api.calls.some((call) => call.method === "deleteMessage"), false)
  assert.deepEqual(notices, ["Voice note not transcribed"])
  await drainTelegram(bot, folder, 111, next, undefined, media)
  assert.equal(api.confirmed, 21)
  assert.deepEqual(inbox(folder), [])
})

test("a voice note still failing after 12 hours is kept as a placeholder so its file id is not lost", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  const old = Math.floor(Date.now() / 1000) - 50_000
  api.files.set("vo", Buffer.from("OggS-voice"))
  api.updates = [
    message(23, 33, old, { voice: { file_id: "vo", file_size: 900 }, caption: "from the car" }),
    message(24, 34, old + 60, { text: "after old" }),
  ]
  const notices: (string | null)[] = []

  const next = await drainTelegram(
    bot,
    folder,
    111,
    undefined,
    undefined,
    {
      async transcribe() {
        throw new Error("down")
      },
      async readImage() {
        return ""
      },
    },
    (notice) => notices.push(notice),
  )

  assert.equal(next, 25)
  const dumps = inbox(folder).map((name) => fs.readFileSync(path.join(folder, "inbox", name), "utf8"))
  assert.ok(dumps.some((dump) => dump.includes("voice note not transcribed, file_id vo\n\nfrom the car\n")))
  assert.ok(dumps.some((dump) => dump.includes("after old\n")))
  assert.deepEqual(notices, [null])
  assert.ok(api.calls.some((call) => call.method === "deleteMessage" && call.params.message_id === 33))
})

test("a failed transcription waits for the next poll instead of calling the model again immediately", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  const stop = new AbortController()
  t.after(() => stop.abort())
  const now = Math.floor(Date.now() / 1000)
  api.files.set("vo", Buffer.from("OggS-voice"))
  api.updates = [message(21, 31, now, { voice: { file_id: "vo", file_size: 900 } })]
  let transcripts = 0
  void pollTelegram(bot, folder, 111, stop.signal, undefined, 500, undefined, {
    media: {
      async transcribe() {
        transcripts++
        throw new Error("down")
      },
      async readImage() {
        return ""
      },
    },
  })

  await until(() => transcripts >= 1)
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(transcripts, 1)
  assert.deepEqual(inbox(folder), [])
  assert.equal(api.calls.some((call) => call.method === "deleteMessage"), false)
})

test("a photo of a page becomes a Dump with a 1200 px JPEG and the text read from it, in both scripts", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.files.set("ph", wideJpeg(1600, 800))
  api.updates = [
    message(6, 14, at, {
      caption: "my receipt",
      photo: [
        { file_id: "small", width: 90, file_size: 10 },
        { file_id: "ph", width: 1600, file_size: 5000 },
      ],
    }),
  ]

  await drainTelegram(bot, folder, 111, undefined, undefined, {
    async transcribe() {
      throw new Error("not a voice note")
    },
    async readImage(jpeg: Buffer) {
      if (decode(jpeg).width !== 1200) throw new Error("the model was sent the full-size photo")
      return "রসিদ\nReceipt total 42"
    },
  })

  assert.equal(
    fs.readFileSync(path.join(folder, "inbox", "2026-10-21-140000-telegram.md"), "utf8"),
    [
      "---",
      "captured: 2026-10-21T14:00:00+06:00",
      "device: telegram",
      "kind: image",
      "image: 2026-10-21-140000-telegram.jpg",
      "telegram_message_id: 14",
      "telegram_file_id: ph",
      "---",
      "my receipt",
      "",
      "## Image text",
      "",
      "রসিদ",
      "Receipt total 42",
      "",
    ].join("\n"),
  )
  const jpeg = decode(fs.readFileSync(path.join(folder, "inbox", "2026-10-21-140000-telegram.jpg")))
  assert.equal(jpeg.width, 1200)
  assert.equal(jpeg.height, 600)
  const files = await exec(["ls-files"], folder)
  assert.ok(files.stdout.includes("inbox/2026-10-21-140000-telegram.jpg"))
  assert.equal(
    api.calls.some((call) => call.method === "getFile" && call.params.file_id === "small"),
    false,
  )
})

test("a photo still unreadable after 12 hours is kept as a placeholder so its file id is not lost", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  const old = Math.floor(Date.now() / 1000) - 50_000
  api.files.set("ph", wideJpeg(80, 40))
  api.updates = [message(25, 35, old, { caption: "the page", photo: [{ file_id: "ph", width: 80, file_size: 40 }] })]

  await drainTelegram(bot, folder, 111, undefined, undefined, {
    async transcribe() {
      return ""
    },
    async readImage() {
      throw new Error("down")
    },
  })

  const dump = fs.readFileSync(path.join(folder, "inbox", inbox(folder)[0]), "utf8")
  assert.match(dump, /photo not downloaded or not readable, file_id ph\n\nthe page\n$/)
  assert.equal(fs.readdirSync(path.join(folder, "inbox")).some((name) => name.endsWith(".jpg")), false)
})

test("a photo that cannot be read stays in the chat", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  const now = Math.floor(Date.now() / 1000)
  api.files.set("ph", wideJpeg(1600, 800))
  api.updates = [message(8, 16, now, { photo: [{ file_id: "ph", width: 1600, file_size: 5000 }] })]
  const notices: (string | null)[] = []

  const next = await drainTelegram(
    bot,
    folder,
    111,
    undefined,
    undefined,
    {
      async transcribe() {
        return ""
      },
      async readImage() {
        throw new Error("down")
      },
    },
    (notice) => notices.push(notice),
  )

  assert.equal(next, 8)
  assert.deepEqual(inbox(folder), [])
  assert.equal(api.calls.some((call) => call.method === "deleteMessage"), false)
  assert.deepEqual(notices, ["Photo not saved"])
})

test("an image the app cannot decode becomes a placeholder at once instead of blocking the chat", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.files.set("png", Buffer.from("\x89PNG not a jpeg"))
  const doc = { file_id: "png", file_size: 16, file_name: "scan.png", mime_type: "image/png" }
  api.updates = [message(9, 17, Math.floor(Date.now() / 1000), { document: doc })]
  const media = { transcribe: async () => "", readImage: async () => "" }

  assert.equal(await drainTelegram(bot, folder, 111, undefined, undefined, media), 10)

  const dump = fs.readFileSync(path.join(folder, "inbox", inbox(folder)[0]), "utf8")
  assert.match(dump, /photo not downloaded or not readable, file_id png\n$/)
  assert.ok(api.calls.some((call) => call.method === "deleteMessage"))
})

test("a file over 20 MB becomes a placeholder Dump and is not downloaded", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.updates = [
    message(7, 15, at, { document: { file_id: "huge", file_name: "film.mp4", file_size: 30_000_000 } }),
  ]

  const next = await drainTelegram(bot, folder, 111)

  assert.equal(next, 8)
  assert.match(
    fs.readFileSync(path.join(folder, "inbox", "2026-10-21-140000-telegram.md"), "utf8"),
    /^kind: text\ntelegram_message_id: 15\ntelegram_file_id: huge\n---\nfile too large for bot: film\.mp4, 28 MB\n$/m,
  )
  assert.equal(
    api.calls.some((call) => call.method === "getFile" || call.method === "file"),
    false,
  )
  assert.ok(api.calls.some((call) => call.method === "deleteMessage" && call.params.message_id === 15))
})

function wideJpeg(width: number, height: number): Buffer {
  const data = Buffer.alloc(width * height * 4, 255)
  return Buffer.from(encode({ data, width, height }, 80).data)
}

test("a smaller file is named in a Dump and not downloaded", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.updates = [message(9, 17, at, { document: { file_id: "pdf", file_name: "notes.pdf", file_size: 1000 } })]

  await drainTelegram(bot, folder, 111)

  assert.match(
    fs.readFileSync(path.join(folder, "inbox", "2026-10-21-140000-telegram.md"), "utf8"),
    /file sent to bot, not saved: notes\.pdf\n$/,
  )
  assert.equal(
    api.calls.some((call) => call.method === "getFile" || call.method === "file"),
    false,
  )
})

test("a text with a link is a link Dump", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.updates = [message(1, 10, at, { text: "loved this https://example.com/x and https://example.com/y" })]

  await drainTelegram(bot, folder, 111)

  const dump = fs.readFileSync(path.join(folder, "inbox", "2026-10-21-140000-telegram.md"), "utf8")
  assert.match(dump, /^kind: link\nurl: https:\/\/example\.com\/x\ntelegram_message_id: 10$/m)
})

test("each batch is committed as drain: N Dumps", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.updates = [
    message(1, 10, at, { text: "one" }),
    message(2, 99, at, { text: "stranger" }, 222),
    message(3, 11, at + 60, { text: "two" }),
  ]

  const offset = await drainTelegram(bot, folder, 111)
  await drainTelegram(bot, folder, 111, offset)

  const log = await exec(["log", "--format=%s"], folder)
  assert.deepEqual(log.stdout.trim().split("\n"), ["drain: 2 Dumps", "create second brain"])
  const status = await exec(["status", "--porcelain"], folder)
  assert.equal(status.stdout, "")
})

test("polling keeps going after a failed poll and saves new messages as they arrive", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  const stop = new AbortController()
  t.after(() => stop.abort())
  api.token = "999:other-token"

  void pollTelegram(bot, folder, 111, stop.signal, undefined, 10)
  await until(() => api.calls.length > 0)
  api.token = "123:secret-token"
  api.updates.push(message(1, 10, at, { text: "sent from the phone" }))

  await until(() => inbox(folder).length === 1)
  await until(() => api.calls.some((call) => call.method === "deleteMessage"))
})

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.ok(done())
}

test("an /ask message is answered in the chat and never becomes a Dump", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.updates = [message(1, 10, at, { text: "/ask what do I think about mechanical keyboards?" })]
  const questions: string[] = []

  const offset = await drainTelegram(bot, folder, 111, undefined, async (question) => {
    questions.push(question)
    return "Recall. You like them ([[mechanical-keyboards]]).\n\nFiled up to 2026-10-21"
  })
  await drainTelegram(bot, folder, 111, offset)

  assert.deepEqual(questions, ["what do I think about mechanical keyboards?"])
  assert.deepEqual(inbox(folder), [])
  assert.deepEqual(sent(api), [
    { chat_id: 111, text: "Recall. You like them ([[mechanical-keyboards]]).\n\nFiled up to 2026-10-21" },
  ])
  // The reply lands before the question leaves the chat.
  const methods = api.calls.map((call) => call.method)
  assert.ok(methods.indexOf("sendMessage") < methods.lastIndexOf("deleteMessage"))
  assert.deepEqual(deleted(api), [{ chat_id: 111, message_id: 10 }])
  const log = await exec(["log", "--format=%s"], folder)
  assert.equal(log.stdout.trim(), "create second brain")
  const status = await exec(["status", "--porcelain"], folder)
  assert.equal(status.stdout, "")
})

test("an /ask message without an asker still never becomes a Dump, and says so", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.updates = [message(1, 10, at, { text: "/ask what do I think about X?" })]

  await drainTelegram(bot, folder, 111)

  assert.deepEqual(inbox(folder), [])
  assert.deepEqual(sent(api), [{ chat_id: 111, text: "Could not answer that." }])
  assert.deepEqual(deleted(api), [{ chat_id: 111, message_id: 10 }])
})

test("a failed ask gets a short reply, and the batch still confirms", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.updates = [message(1, 10, at, { text: "/ask what do I know about Y?" })]

  const offset = await drainTelegram(bot, folder, 111, undefined, async () => {
    throw new Error("runner exited 1")
  })
  await drainTelegram(bot, folder, 111, offset)

  assert.deepEqual(sent(api), [{ chat_id: 111, text: "Could not answer that." }])
  assert.deepEqual(deleted(api), [{ chat_id: 111, message_id: 10 }])
  assert.deepEqual(inbox(folder), [])
})

test("a bare /ask asks for a question without running the ask skill", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.updates = [message(1, 10, at, { text: "/ask" })]
  let asked = false

  await drainTelegram(bot, folder, 111, undefined, async () => {
    asked = true
    return "never sent"
  })

  assert.equal(asked, false)
  assert.deepEqual(sent(api), [{ chat_id: 111, text: "Add a question after /ask." }])
  assert.deepEqual(deleted(api), [{ chat_id: 111, message_id: 10 }])
})

test("an /ask from another chat is never answered or deleted", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.updates = [message(1, 10, at, { text: "/ask what does adib think?" }, 222)]
  let asked = false

  await drainTelegram(bot, folder, 111, undefined, async () => {
    asked = true
    return "never"
  })

  assert.equal(asked, false)
  assert.deepEqual(sent(api), [])
  assert.deepEqual(deleted(api), [])
  assert.deepEqual(inbox(folder), [])
})

test("one batch can hold a Dump and a question", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.updates = [
    message(1, 10, at, { text: "remember the milk" }),
    message(2, 11, at + 60, { text: "/ask what do I think about milk?" }),
  ]
  const questions: string[] = []

  const offset = await drainTelegram(bot, folder, 111, undefined, async (question) => {
    questions.push(question)
    return "Recall. You buy it ([[milk]]).\n\nFiled up to 2026-10-21"
  })
  await drainTelegram(bot, folder, 111, offset)

  assert.deepEqual(questions, ["what do I think about milk?"])
  assert.deepEqual(inbox(folder), ["2026-10-21-140000-telegram.md"])
  const log = await exec(["log", "--format=%s"], folder)
  assert.deepEqual(log.stdout.trim().split("\n"), ["drain: 1 Dumps", "create second brain"])
  assert.deepEqual(deleted(api), [
    { chat_id: 111, message_id: 10 },
    { chat_id: 111, message_id: 11 },
  ])
})

test("an answer longer than one Telegram message is sent in pieces", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.updates = [message(1, 10, at, { text: "/ask show me everything about keyboards" })]
  const line = "a line of the answer, quoted from a Dump, with its citation\n"
  const answer = `Recall.\n${line.repeat(100)}Filed up to 2026-10-21`

  await drainTelegram(bot, folder, 111, undefined, async () => answer)

  const pieces = sent(api)
  assert.equal(pieces.length, 2)
  assert.ok(pieces.every((call) => (call.text as string).length <= 4096))
  assert.equal(pieces.map((call) => call.text as string).join("\n"), answer)
})

test("a new bot's message is saved even when an old Dump has the same message id", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  const filed = path.join(folder, "vault/raw/2026/10")
  fs.mkdirSync(filed, { recursive: true })
  fs.writeFileSync(path.join(filed, "2026-10-01-080000-telegram.md"), "---\ntelegram_message_id: 2\n---\nold\n")
  api.updates = [message(1, 2, at, { text: "new" })]

  await drainTelegram(bot, folder, 111)

  assert.deepEqual(inbox(folder), ["2026-10-21-140000-telegram.md"])
})

test("Dumps a failed commit left behind go in the next drain commit, and nothing else does", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  fs.writeFileSync(path.join(folder, "inbox", "2026-10-21-130000-telegram.md"), "---\ntelegram_message_id: 9\n---\nearlier\n")
  fs.writeFileSync(path.join(folder, "AGENTS.md"), "edited by the Owner\n")
  api.updates = [message(1, 10, at, { text: "one" })]

  await drainTelegram(bot, folder, 111)

  const log = await exec(["log", "-1", "--format=%s", "--name-only"], folder)
  assert.deepEqual(log.stdout.trim().split("\n"), [
    "drain: 2 Dumps",
    "",
    "inbox/2026-10-21-130000-telegram.md",
    "inbox/2026-10-21-140000-telegram.md",
  ])
})

function files(folder: string): string[] {
  return fs
    .readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .filter((name) => !name.startsWith(".git/"))
    .sort()
}

test("polling reports each successful drain, after its Dumps are saved", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  const stop = new AbortController()
  t.after(() => stop.abort())
  api.token = "999:other-token"
  const drained: number[] = []

  void pollTelegram(bot, folder, 111, stop.signal, undefined, 10, () => drained.push(inbox(folder).length))
  await until(() => api.calls.length > 1)
  assert.deepEqual(drained, [])
  api.updates.push(message(1, 10, at, { text: "sent from the phone" }))
  api.token = "123:secret-token"

  await until(() => drained.length > 0)
  assert.equal(drained[0], 1)
})

test("during an Ingest or Undo a drain saves the Dump but leaves git alone", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.updates = [message(1, 10, at, { text: "while filing" })]
  const unlock = lockBrain(folder)
  t.after(() => unlock?.())

  await drainTelegram(bot, folder, 111)

  assert.deepEqual(inbox(folder), ["2026-10-21-140000-telegram.md"])
  const status = await exec(["status", "--porcelain"], folder)
  assert.equal(status.stdout, "?? inbox/2026-10-21-140000-telegram.md\n")
})
