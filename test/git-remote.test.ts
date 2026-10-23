import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { exec } from "dugite"
import { createSecondBrain } from "../src/create-second-brain"
import { backupRemote, setBackupRemote } from "../src/git-remote"
import { ingestNow, type AgentRunner } from "../src/ingest-now"

const templates = path.join(__dirname, "..", "templates")
const key = "sk-test-secret-not-real"
const now = new Date("2026-10-23T12:00:00.000Z")

async function brainWithDump(): Promise<string> {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), "git-remote-"))
  await createSecondBrain(brain, templates)
  fs.writeFileSync(path.join(brain, "inbox", "2026-10-08-090000-mac.md"), "---\nkind: text\n---\nCafe thought\n")
  return brain
}

const files: AgentRunner = async (run) => {
  fs.appendFileSync(path.join(run.cwd, "vault", "wiki", "log.md"), "- Raw: [[2026-10-08-090000-mac]]\n")
  fs.appendFileSync(path.join(run.cwd, "vault", "wiki", "topics.md"), "filed\n")
  return { code: 0, stdout: "" }
}

test("with a remote set, each Ingest commit reaches it", async () => {
  const brain = await brainWithDump()
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "git-remote-bare-"))
  await exec(["init", "--bare", "-b", "main"], remote)
  await setBackupRemote(brain, remote)
  assert.equal(await backupRemote(brain), remote)

  const result = await ingestNow({ brain, apiKey: key, now, runner: files })

  assert.equal(result.status, "ok")
  assert.equal(result.push, "ok")
  const local = await exec(["rev-parse", "HEAD"], brain)
  const pushed = await exec(["rev-parse", "main"], remote)
  assert.equal(pushed.stdout, local.stdout)
  assert.match((await exec(["log", "-1", "--format=%s", "main"], remote)).stdout, /^ingest: /)
})

test("with the remote unreachable, Ingest still files, and the failure hides the URL's credentials", async () => {
  const brain = await brainWithDump()
  await setBackupRemote(brain, "https://ada:hunter2@127.0.0.1:1/brain.git")

  const result = await ingestNow({ brain, apiKey: key, now, runner: files })

  assert.equal(result.status, "ok")
  assert.equal(result.dumps, 1)
  assert.equal((await exec(["log", "-1", "--format=%s"], brain)).stdout.startsWith("ingest: "), true)
  assert.equal(result.push, "failed")
  assert.ok(result.pushError)
  assert.equal(result.pushError.includes("hunter2"), false)
})

test("with no remote set, the app never pushes", async () => {
  const brain = await brainWithDump()

  const result = await ingestNow({ brain, apiKey: key, now, runner: files })

  assert.equal(result.status, "ok")
  assert.equal(result.push, undefined)
  assert.equal(await backupRemote(brain), null)
})

test("clearing the remote turns pushing off", async () => {
  const brain = await brainWithDump()
  await setBackupRemote(brain, "https://example.com/brain.git")
  await setBackupRemote(brain, "  ")

  assert.equal(await backupRemote(brain), null)
  assert.equal((await ingestNow({ brain, apiKey: key, now, runner: files })).push, undefined)
})

test("a remote URL that looks like an option is refused", async () => {
  const brain = await brainWithDump()
  await assert.rejects(setBackupRemote(brain, "--upload-pack=touch pwned"))
  assert.equal(await backupRemote(brain), null)
})
