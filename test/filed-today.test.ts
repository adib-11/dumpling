import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createSecondBrain } from "../src/create-second-brain"
import { filedToday } from "../src/filed-today"
import { ingestNow, type AgentRun } from "../src/ingest-now"
import { telegramBot } from "../src/telegram"
import { fakeBotApi } from "./fake-bot-api"

process.env.TZ = "Asia/Dhaka"
const templates = path.join(__dirname, "..", "templates")
const key = "sk-test-secret-not-real"
const today = "2026-10-23"
const now = new Date("2026-10-23T12:00:00.000Z")
const dumps = ["2026-10-22-090000-telegram", "2026-10-22-100000-telegram", "2026-10-22-110000-telegram"]

async function setup() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "filed-today-"))
  await createSecondBrain(folder, templates)
  const api = await fakeBotApi()
  return { folder, api, bot: telegramBot(api.token, api.url) }
}

function writeDump(folder: string, name: string): void {
  const captured = `${name.slice(0, 10)}T${name.slice(11, 13)}:${name.slice(13, 15)}:${name.slice(15, 17)}+06:00`
  fs.writeFileSync(path.join(folder, "inbox", `${name}.md`), `---\ncaptured: ${captured}\ndevice: telegram\nkind: text\n---\nhi\n`)
}

// Writes the log.md entries and Open threads the ingest skill would for the three Dumps.
async function logRunner(run: AgentRun): Promise<{ code: number; stdout: string }> {
  const wiki = path.join(run.cwd, "vault", "wiki")
  const [first, second, third] = dumps
  fs.appendFileSync(
    path.join(wiki, "log.md"),
    [
      `## [${today}] ingest | Dune`,
      "- Disposition: New",
      `- Raw: [[${first}]]`,
      "- Created: [[dune|Dune]]",
      "- Updated: [[nadia|Nadia]], open-threads",
      "- Rule change: file a cinema as a place, not a topic",
      `## [${today}] ingest | Arrival`,
      "- Disposition: New; Update",
      `- Raw: [[${second}]]`,
      "- Created: [[arrival|Arrival]]",
      "- Updated: [[dune|Dune]], [[nadia|Nadia]]",
      "- Flags: new tag sci-fi; unfetched link",
      `## [${today}] ingest | no material: ${third}`,
      "- Disposition: No material (bare link, unfetched)",
      `- Raw: [[${third}]]`,
      "- Flags: unfetched link",
      "",
    ].join("\n"),
  )
  fs.appendFileSync(
    path.join(wiki, "open-threads.md"),
    `- [ ] Book tickets (2026-10-22, [[${first}|Dump 22 Oct]])\n- [ ] Call Nadia (2026-10-22, [[${first}|Dump 22 Oct]], → [[nadia|Nadia]])\n`,
  )
  fs.appendFileSync(path.join(wiki, "topics", "dune.md"), "filed\n")
  return { code: 0, stdout: "" }
}

test("a daily Ingest with Dumps sends one Filed today message whose counts match log.md", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)
  // An older entry for another Dump is not today's.
  fs.appendFileSync(
    path.join(folder, "vault", "wiki", "log.md"),
    "## [2026-10-20] ingest | Heat\n- Raw: [[2026-10-20-090000-telegram]]\n- Created: [[heat|Heat]]\n",
  )
  for (const name of dumps) {
    writeDump(folder, name)
  }

  const result = await ingestNow({ brain: folder, apiKey: key, today, now, bot, chat: 111, daily: true, runner: logRunner })

  assert.equal(result.status, "ok")
  const sent = api.calls.filter((call) => call.method === "sendMessage").map((call) => call.params)
  assert.deepEqual(sent, [
    {
      chat_id: 111,
      text: [
        "Filed today",
        "Dumps: 3 filed, 0 failed.",
        "Pages: 2 created, 1 updated.",
        "Unfetched links: 2.",
        "Open threads added: 2.",
        "Rule changes Ingest proposes:",
        "- file a cinema as a place, not a topic",
      ].join("\n"),
    },
  ])
})

test("a day with an empty inbox/ sends nothing, and neither does a manual Ingest", async (t) => {
  const { folder, api, bot } = await setup()
  t.after(api.close)

  await ingestNow({ brain: folder, apiKey: key, today, now, bot, chat: 111, daily: true, runner: logRunner })
  writeDump(folder, dumps[0])
  await ingestNow({ brain: folder, apiKey: key, today, now, bot, chat: 111, runner: logRunner })

  assert.equal(api.calls.some((call) => call.method === "sendMessage"), false)
})

test("the failed Dumps are counted, and nothing filed is no message", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "filed-today-"))
  fs.mkdirSync(path.join(folder, "vault", "wiki"), { recursive: true })
  fs.writeFileSync(path.join(folder, "vault", "wiki", "log.md"), `# Log\n## [${today}] ingest | Dune\n- Raw: [[${dumps[0]}]]\n- Updated: [[dune|Dune]]\n`)
  assert.equal(
    filedToday(folder, [dumps[0]], 25),
    "Filed today\nDumps: 1 filed, 25 failed.\nPages: 0 created, 1 updated.\nUnfetched links: 0.\nOpen threads added: 0.",
  )
  assert.equal(filedToday(folder, [], 25), undefined)
})
