import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createSecondBrain } from "../src/create-second-brain"
import { drainTelegram } from "../src/drain-telegram"
import { connectBot, telegramBot } from "../src/telegram"
import { fakeBotApi, message } from "./fake-bot-api"

process.env.TZ = "Asia/Dhaka"

test("a malformed token is refused, and a token never appears in an error", async (t) => {
  const api = await fakeBotApi()
  t.after(api.close)

  assert.throws(() => telegramBot("123:abc/../../x", api.url), /not a bot token/)
  await assert.rejects(telegramBot("123:wrong-token", api.url)("getMe"), (error: Error) => {
    assert.equal(error.message, "Telegram getMe failed: Unauthorized")
    return true
  })
  assert.equal(api.calls.length, 1)
})

test("the first /start in a private chat connects that chat; the /start is not saved, what follows is", async (t) => {
  const api = await fakeBotApi()
  t.after(api.close)
  const bot = telegramBot(api.token, api.url)
  api.updates = [
    { update_id: 1, message: { message_id: 5, date: 1792569600, chat: { id: -100, type: "group" }, text: "/start" } },
    message(2, 6, 1792569600, { text: "hello" }, 222),
    message(3, 7, 1792569660, { text: "/start" }, 111),
    message(4, 8, 1792569720, { text: "first thought" }, 111),
  ]

  const chat = await connectBot(bot, new AbortController().signal)

  assert.equal(chat, 111)
  const sent = api.calls.filter((call) => call.method === "sendMessage").map((call) => call.params)
  assert.deepEqual(sent, [{ chat_id: 111, text: "Connected" }])
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "connect-"))
  await createSecondBrain(folder, path.join(__dirname, "..", "templates"))
  await drainTelegram(bot, folder, 111)
  assert.deepEqual(fs.readdirSync(path.join(folder, "inbox")), [".gitkeep", "2026-10-21-140200-telegram.md"])
})
