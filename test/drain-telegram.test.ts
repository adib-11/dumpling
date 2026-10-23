import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { exec } from "dugite"
import { createSecondBrain } from "../src/create-second-brain"
import { drainTelegram, pollTelegram } from "../src/drain-telegram"
import { telegramBot } from "../src/telegram"
import { fakeBotApi, message } from "./fake-bot-api"

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

function files(folder: string): string[] {
  return fs
    .readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .filter((name) => !name.startsWith(".git/"))
    .sort()
}

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

  void pollTelegram(bot, folder, 111, stop.signal, 10)
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
