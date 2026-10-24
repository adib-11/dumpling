import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { exec } from "dugite"
import { checkIngest } from "../src/check-ingest"
import { createSecondBrain } from "../src/create-second-brain"
import { drainTelegram } from "../src/drain-telegram"
import { ingestNow, type AgentRun } from "../src/ingest-now"
import { ingestBot, telegramBot } from "../src/telegram"
import { fakeBotApi, message } from "./fake-bot-api"

process.env.TZ = "Asia/Dhaka"
const templates = path.join(__dirname, "..", "templates")
// 2026-10-21 14:00:00 in Dhaka (+06:00).
const at = 1792569600

async function setup() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "follow-up-"))
  await createSecondBrain(folder, templates)
  const api = await fakeBotApi()
  const bot = telegramBot(api.token, api.url)
  return { folder, api, bot }
}

test("a reply to an old message is an Addendum with that Dump's name and the reply's date", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  const original = "2026-10-21-120000-telegram"
  const filed = path.join(folder, "vault", "raw", "2026", "10")
  fs.mkdirSync(filed, { recursive: true })
  fs.writeFileSync(
    path.join(filed, `${original}.md`),
    [
      "---",
      "captured: 2026-10-21T12:00:00+06:00",
      "device: telegram",
      "kind: text",
      "telegram_message_id: 42",
      "---",
      "watched Dune",
      "",
    ].join("\n"),
  )
  api.updates = [
    message(1, 81, at + 86400, {
      text: "the sound was great",
      reply_to_message: { message_id: 42, text: "watched Dune" },
    }),
  ]

  await drainTelegram(bot, folder, 111)

  const addendum = "2026-10-22-140000-telegram"
  assert.equal(
    fs.readFileSync(path.join(folder, "inbox", `${addendum}.md`), "utf8"),
    [
      "---",
      "captured: 2026-10-22T14:00:00+06:00",
      "device: telegram",
      "kind: text",
      "telegram_message_id: 81",
      "addendum_to: 2026-10-21-120000-telegram",
      "---",
      "the sound was great",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(folder, "vault", "wiki", "works", "dune.md"),
    `- 2026-10-22: "the sound was great" ([[${addendum}|Dump 22 Oct]])\n`,
  )
  const problems = await checkIngest(folder, [])
  assert.ok(
    problems.some((line) =>
      line.includes(`cite ${addendum} as [[${addendum}|Addendum 22 Oct]], not |Dump 22 Oct`),
    ),
  )
})

test("a reply to the Follow-up question is an Addendum to the Dump it asked about", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  fs.writeFileSync(path.join(folder, "vault", "telegram-questions.md"), "9001 2026-10-21-120000-telegram\n")
  api.updates = [
    message(1, 81, at + 86400, {
      text: "the sound was great",
      reply_to_message: { message_id: 9001, text: "What did you think of it?" },
    }),
  ]

  await drainTelegram(bot, folder, 111)

  const addendum = fs.readFileSync(path.join(folder, "inbox", "2026-10-22-140000-telegram.md"), "utf8")
  assert.match(addendum, /^addendum_to: 2026-10-21-120000-telegram$/m)
  assert.match(addendum, /^captured: 2026-10-22T14:00:00\+06:00$/m)
  assert.match(addendum, /^the sound was great$/m)
})

test("a reply to a message that is not a Dump starts with re and the quoted line", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.updates = [
    message(1, 81, at, {
      text: "the sound was great",
      reply_to_message: { message_id: 7, text: "What did you think of it?\nmore" },
    }),
  ]

  await drainTelegram(bot, folder, 111)

  const dump = fs.readFileSync(path.join(folder, "inbox", "2026-10-21-140000-telegram.md"), "utf8")
  assert.equal(dump.includes("addendum_to:"), false)
  assert.match(dump, /^re What did you think of it\?\n\nthe sound was great$/m)
})

test("a reply to a message saved in the same drain is an Addendum", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.updates = [
    message(1, 10, at, { text: "watched Dune" }),
    message(2, 11, at + 60, {
      text: "the sound was great",
      reply_to_message: { message_id: 10, text: "watched Dune" },
    }),
  ]

  await drainTelegram(bot, folder, 111)

  const addendum = fs.readFileSync(path.join(folder, "inbox", "2026-10-21-140100-telegram.md"), "utf8")
  assert.match(addendum, /^addendum_to: 2026-10-21-140000-telegram$/m)
})

const key = "sk-test-secret-not-real"
const today = "2026-10-23"
const now = new Date("2026-10-23T12:00:00.000Z")
const question = "What did you think of it?"

function filingRunner(brain: string, queue?: string): (run: AgentRun) => Promise<{ code: number; stdout: string }> {
  return async (run) => {
    const prompt = run.args.at(-1) ?? ""
    for (const stem of prompt.matchAll(/inbox\/(\S+)\.md/g)) {
      fs.appendFileSync(path.join(brain, "vault", "wiki", "log.md"), `- Raw: [[${stem[1]}]]\n`)
    }
    fs.appendFileSync(path.join(brain, "vault", "wiki", "topics.md"), "filed\n")
    if (queue) fs.writeFileSync(path.join(brain, "vault", "follow-ups.md"), queue)
    return { code: 0, stdout: '{"type":"step_finish","part":{"cost":0.01}}\n' }
  }
}

test("a bare link gets one Follow-up, the answer is an Addendum, and a second Ingest does not ask again", async (t) => {
  const name = "2026-10-21-120000-telegram"
  const { folder, api, bot } = await setup()
  t.after(api.close)
  fs.writeFileSync(
    path.join(folder, "inbox", `${name}.md`),
    [
      "---",
      "captured: 2026-10-21T12:00:00+06:00",
      "device: telegram",
      "kind: link",
      "url: https://example.com/dune",
      "telegram_message_id: 42",
      "---",
      "https://example.com/dune",
      "",
    ].join("\n"),
  )

  const first = await ingestNow({
    brain: folder,
    apiKey: key,
    today,
    now,
    bot,
    chat: 111,
    runner: filingRunner(folder, `# Follow-ups\n${name}\t${question}\n${name}\t${question}\n`),
  })

  assert.equal(first.status, "ok")
  assert.equal(first.followUp?.sent, 1)
  assert.equal(first.followUp?.partial, false)
  assert.deepEqual(
    api.calls.filter((call) => call.method === "sendMessage").map((call) => call.params),
    [
      {
        chat_id: 111,
        text: question,
        reply_parameters: { message_id: 42, allow_sending_without_reply: true },
        reply_markup: { force_reply: true },
      },
    ],
  )
  assert.equal(
    fs.readFileSync(path.join(folder, "vault", "telegram-questions.md"), "utf8"),
    `9001 ${name}\n`,
  )
  assert.equal(fs.readFileSync(path.join(folder, "vault", "follow-ups.md"), "utf8").includes(name), false)
  const filed = fs.readFileSync(path.join(folder, "vault", "raw", "2026", "10", `${name}.md`), "utf8")
  assert.equal(filed.includes("telegram_question_id"), false)
  assert.match(filed, /^https:\/\/example\.com\/dune$/m)
  const commits = await exec(["log", "--format=%s"], folder)
  assert.match(commits.stdout, /^follow-up: 1\n/)
  assert.equal((await exec(["status", "--porcelain"], folder)).stdout, "")

  api.updates = [
    message(2, 81, at + 86400, {
      text: "the sound was great",
      reply_to_message: { message_id: 9001, text: question },
    }),
  ]
  await drainTelegram(bot, folder, 111)
  const answer = "2026-10-22-140000-telegram"
  const addendum = fs.readFileSync(path.join(folder, "inbox", `${answer}.md`), "utf8")
  assert.match(addendum, new RegExp(`^addendum_to: ${name}$`, "m"))
  assert.match(addendum, /^captured: 2026-10-22T14:00:00\+06:00$/m)
  fs.writeFileSync(
    path.join(folder, "vault", "wiki", "works", "dune.md"),
    `- 2026-10-22: "the sound was great" ([[${answer}|Dump 22 Oct]])\n`,
  )
  const problems = await checkIngest(folder, [])
  assert.ok(problems.some((line) => line.includes(`cite ${answer} as [[${answer}|Addendum 22 Oct]]`)))

  const sent = api.calls.filter((call) => call.method === "sendMessage").length
  const second = await ingestNow({
    brain: folder,
    apiKey: key,
    today,
    now,
    bot,
    chat: 111,
    runner: filingRunner(folder, `# Follow-ups\n${name}\t${question}\n${answer}\t${question}\n`),
  })
  assert.equal(second.status, "ok")
  assert.equal(api.calls.filter((call) => call.method === "sendMessage").length, sent)
  assert.equal(fs.existsSync(path.join(folder, "inbox", `${name}.md`)), false)
  assert.equal(fs.readFileSync(path.join(folder, "vault", "follow-ups.md"), "utf8").includes(name), false)
  assert.equal(fs.readFileSync(path.join(folder, "vault", "follow-ups.md"), "utf8").includes(answer), false)
})

test("a non-Telegram Dump and an Addendum queued by mistake are not sent", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  fs.writeFileSync(
    path.join(folder, "inbox", "2026-10-22-090000-mac.md"),
    "---\ncaptured: 2026-10-22T09:00:00+06:00\ndevice: mac\nkind: text\n---\nwatched Dune\n",
  )
  fs.writeFileSync(
    path.join(folder, "inbox", "2026-10-22-100000-telegram.md"),
    "---\ncaptured: 2026-10-22T10:00:00+06:00\ndevice: telegram\nkind: text\ntelegram_message_id: 70\naddendum_to: 2026-10-21-120000-telegram\n---\nlater\n",
  )
  const queued = ["2026-10-22-090000-mac", "2026-10-22-100000-telegram"].map((name) => `${name}\t${question}`).join("\n")

  await ingestNow({
    brain: folder,
    apiKey: key,
    today,
    now,
    bot,
    chat: 111,
    runner: filingRunner(folder, `# Follow-ups\n${queued}\n`),
  })

  assert.equal(api.calls.some((call) => call.method === "sendMessage"), false)
  const left = fs.readFileSync(path.join(folder, "vault", "follow-ups.md"), "utf8")
  assert.equal(left.includes("2026-10-22-090000-mac"), false)
  assert.equal(left.includes("2026-10-22-100000-telegram"), false)
  assert.equal(fs.existsSync(path.join(folder, "vault", "raw", "2026", "10", "2026-10-22-090000-mac.md")), true)
})

test("a failed send stays queued, files the Dump, and is reported partial", async (t) => {
  const name = "2026-10-22-110000-telegram"
  const { folder, api, bot } = await setup()
  t.after(api.close)
  api.failSend = true
  fs.writeFileSync(
    path.join(folder, "inbox", `${name}.md`),
    "---\ncaptured: 2026-10-22T11:00:00+06:00\ndevice: telegram\nkind: text\ntelegram_message_id: 43\n---\nwatched Arrival\n",
  )

  const result = await ingestNow({
    brain: folder,
    apiKey: key,
    today,
    now,
    bot,
    chat: 111,
    runner: filingRunner(folder, `# Follow-ups\n${name}\t${question}\n`),
  })

  const filed = path.join(folder, "vault", "raw", "2026", "10", `${name}.md`)
  assert.equal(result.status, "ok")
  assert.equal(result.followUp?.partial, true)
  assert.equal(result.followUp?.sent, 0)
  assert.equal(fs.existsSync(filed), true)
  assert.equal(fs.readFileSync(filed, "utf8").includes("telegram_question_id"), false)
  assert.match(fs.readFileSync(path.join(folder, "vault", "follow-ups.md"), "utf8"), new RegExp(name))
  assert.equal(fs.existsSync(path.join(folder, "vault", "telegram-questions.md")), false)
})

test("the bot and chat the daily and manual Ingest pass send the Follow-up, and no bot sends nothing", async (t) => {
  const name = "2026-10-22-120000-telegram"
  const { folder, api } = await setup()
  t.after(api.close)
  assert.deepEqual(ingestBot(api.token, null), {})
  assert.deepEqual(ingestBot(null, 111), {})
  fs.writeFileSync(
    path.join(folder, "inbox", `${name}.md`),
    "---\ncaptured: 2026-10-22T12:00:00+06:00\ndevice: telegram\nkind: text\ntelegram_message_id: 44\n---\nwatched Heat\n",
  )

  const result = await ingestNow({
    brain: folder,
    apiKey: key,
    today,
    now,
    runner: filingRunner(folder, `# Follow-ups\n${name}\t${question}\n`),
    ...ingestBot(api.token, 111, api.url),
  })

  assert.equal(result.followUp?.sent, 1)
  assert.equal(api.calls.filter((call) => call.method === "sendMessage").length, 1)
})

test("a Follow-up commit that fails still records the run and reports it partial", async (t) => {
  const name = "2026-10-22-130000-telegram"
  const { folder, api, bot } = await setup()
  t.after(api.close)
  const hook = path.join(folder, ".git", "hooks", "commit-msg")
  fs.writeFileSync(hook, '#!/bin/sh\ngrep -q "^follow-up" "$1" && exit 1\nexit 0\n', { mode: 0o755 })
  fs.writeFileSync(
    path.join(folder, "inbox", `${name}.md`),
    "---\ncaptured: 2026-10-22T13:00:00+06:00\ndevice: telegram\nkind: text\ntelegram_message_id: 45\n---\nwatched Ran\n",
  )
  const notes: string[] = []

  const result = await ingestNow({
    brain: folder,
    apiKey: key,
    today,
    now,
    bot,
    chat: 111,
    notify: (text) => notes.push(text),
    runner: filingRunner(folder, `# Follow-ups\n${name}\t${question}\n`),
  })

  assert.equal(result.status, "ok")
  assert.equal(result.dumps, 1)
  assert.equal(result.followUp?.partial, true)
  assert.ok(notes.some((note) => note.startsWith("Follow-ups failed:")))
  assert.match(fs.readFileSync(path.join(folder, ".state", "runs.tsv"), "utf8"), /\tok\t1\t/)
})

test("the ingest skill queues one Follow-up and files an Addendum by the Addendum's date", () => {
  const skill = fs.readFileSync(path.join(templates, ".agents", "skills", "ingest", "SKILL.md"), "utf8")
  for (const line of [
    "vault/follow-ups.md",
    "What did you think of it?",
    "works/",
    "people/",
    "topics/",
    "no Take",
    "to-do",
    "At most once",
    "daily message",
  ]) {
    assert.equal(skill.includes(line), true, line)
  }
  assert.equal(skill.includes("Shortcuts"), false)
  assert.equal(skill.includes("device: telegram"), false)
  assert.equal(skill.includes("Private Dump"), false)
  assert.equal(skill.includes("Digest"), false)
  assert.match(skill, /An Addendum is cited as/)
  assert.match(skill, /updates the Pages its original touched/)
})
