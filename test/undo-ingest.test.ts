import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { exec } from "dugite"
import { createSecondBrain } from "../src/create-second-brain"
import { ingestNow, undoLastIngest, type AgentRunner } from "../src/ingest-now"

const templates = path.join(__dirname, "..", "templates")
const now = new Date("2026-10-23T12:00:00.000Z")

function good(brain: string): AgentRunner {
  return async (run) => {
    for (const stem of (run.args.at(-1) ?? "").matchAll(/inbox\/(\S+)\.md/g)) {
      fs.appendFileSync(path.join(brain, "vault", "wiki", "log.md"), `- Raw: [[${stem[1]}]]\n`)
      fs.writeFileSync(path.join(brain, "vault", "wiki", "topics", `${stem[1]}.md`), "---\nsummary: x\n---\n")
    }
    return { code: 0, stdout: "" }
  }
}

async function brainWithIngest(stem: string): Promise<string> {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), "undo-ingest-"))
  await createSecondBrain(brain, templates)
  await file(brain, stem)
  return brain
}

async function file(brain: string, stem: string): Promise<void> {
  fs.writeFileSync(path.join(brain, "inbox", `${stem}.md`), "---\nkind: text\n---\nnote\n")
  fs.writeFileSync(path.join(brain, "inbox", `${stem}.fetched.md`), "---\nstatus: fetched\n---\nside\n")
  const result = await ingestNow({ brain, apiKey: "sk-test", now, runner: good(brain) })
  assert.equal(result.status, "ok")
}

function wiki(brain: string): string {
  return fs.readFileSync(path.join(brain, "vault", "wiki", "index.md"), "utf8") + fs.readFileSync(path.join(brain, "vault", "wiki", "log.md"), "utf8")
}

test("Undo last Ingest restores the wiki and puts the Dumps back in inbox, one Ingest at a time", async () => {
  const brain = await brainWithIngest("2026-10-08-090000-mac")
  const afterFirst = wiki(brain)
  await file(brain, "2026-10-09-090000-mac")
  fs.appendFileSync(path.join(brain, "vault", "wiki", "me.md"), "- mine\n")

  assert.equal((await undoLastIngest(brain)).status, "ok")
  assert.equal(wiki(brain), afterFirst)
  assert.equal(fs.existsSync(path.join(brain, "vault", "wiki", "topics", "2026-10-09-090000-mac.md")), false)
  assert.equal(fs.existsSync(path.join(brain, "inbox", "2026-10-09-090000-mac.md")), true)
  assert.equal(fs.existsSync(path.join(brain, "inbox", "2026-10-09-090000-mac.fetched.md")), true)
  assert.equal(fs.existsSync(path.join(brain, "vault", "raw", "2026", "10", "2026-10-09-090000-mac.md")), false)
  assert.match(fs.readFileSync(path.join(brain, "vault", "wiki", "me.md"), "utf8"), /- mine/)

  assert.equal((await undoLastIngest(brain)).status, "ok")
  assert.equal(fs.existsSync(path.join(brain, "inbox", "2026-10-08-090000-mac.md")), true)
  assert.equal(fs.existsSync(path.join(brain, "vault", "wiki", "topics", "2026-10-08-090000-mac.md")), false)
  assert.equal((await exec(["status", "--porcelain"], brain)).stdout, "")

  assert.equal((await undoLastIngest(brain)).status, "nothing")
})

test("an Undo that would overwrite a later edit changes nothing", async () => {
  const brain = await brainWithIngest("2026-10-08-090000-mac")
  fs.appendFileSync(path.join(brain, "vault", "wiki", "topics", "2026-10-08-090000-mac.md"), "the Owner's edit\n")

  const result = await undoLastIngest(brain)

  assert.equal(result.status, "failed")
  assert.equal((await exec(["status", "--porcelain"], brain)).stdout, "")
  assert.match(fs.readFileSync(path.join(brain, "vault", "wiki", "topics", "2026-10-08-090000-mac.md"), "utf8"), /the Owner's edit/)
  assert.equal(fs.existsSync(path.join(brain, "vault", "raw", "2026", "10", "2026-10-08-090000-mac.md")), true)
})
