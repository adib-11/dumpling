import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { exec } from "dugite"
import { createSecondBrain } from "../src/create-second-brain"
import { ingestNow, lastIngestStatus, type AgentRunner } from "../src/ingest-now"

process.env.TZ = "Asia/Dhaka"

// The failure cases of tests/ingest.sh in adib-11/second-brain, ported (sections 6, 6b, 7 and 8).

const templates = path.join(__dirname, "..", "templates")
const key = "sk-test-secret-not-real"
const today = "2026-10-23"
const now = new Date("2026-10-23T12:00:00.000Z")

async function brainWith(...dumps: [string, string][]): Promise<string> {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-failures-"))
  await createSecondBrain(brain, templates)
  for (const [name, body] of dumps) fs.writeFileSync(path.join(brain, "inbox", name), `---\nkind: text\n---\n${body}\n`)
  return brain
}

// Files each Dump in the prompt with a log.md entry, like the good stub runner.
function good(brain: string): AgentRunner {
  return async (run) => {
    for (const stem of (run.args.at(-1) ?? "").matchAll(/inbox\/(\S+)\.md/g)) {
      fs.appendFileSync(path.join(brain, "vault", "wiki", "log.md"), `- Raw: [[${stem[1]}]]\n`)
    }
    fs.appendFileSync(path.join(brain, "vault", "wiki", "topics.md"), "filed\n")
    return { code: 0, stdout: "" }
  }
}

function partial(brain: string): void {
  fs.writeFileSync(path.join(brain, "vault", "wiki", "partial.md"), "partial\n")
}

async function git(brain: string, ...args: string[]): Promise<string> {
  return (await exec(args, brain)).stdout
}

function fails(brain: string, stem: string): number | undefined {
  const file = path.join(brain, ".state", "fails")
  if (!fs.existsSync(file)) return undefined
  const line = fs.readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${stem} `))
  return line ? Number(line.split(" ")[1]) : undefined
}

test("each failure kind stashes the chunk, names the stash in a notification, and leaves the Dump in inbox", async () => {
  const dump = "2026-10-08-120000-mac.md"
  const brain = await brainWith([dump, "fails"])
  const kinds: [string, AgentRunner, string][] = [
    [
      "exit",
      async () => {
        partial(brain)
        return { code: 3, stdout: "" }
      },
      "runner exited 3",
    ],
    [
      "timeout",
      (run) => {
        partial(brain)
        return new Promise((resolve) => run.signal.addEventListener("abort", () => resolve({ code: 143, stdout: "" })))
      },
      "timed out after 0.05s",
    ],
    ["nochange", async () => ({ code: 0, stdout: "" }), "runner changed nothing in vault/wiki/"],
  ]
  for (const [kind, runner, want] of kinds) {
    const notices: string[] = []
    const stashes = (await git(brain, "stash", "list")).split("\n").length
    const result = await ingestNow({ brain, apiKey: key, today, now, runner, timeoutMs: 50, notify: (text) => notices.push(text) })

    assert.equal(result.status, "failed", kind)
    assert.equal(result.reason, want, kind)
    assert.equal(fs.existsSync(path.join(brain, "inbox", dump)), true, kind)
    assert.equal(await git(brain, "status", "--porcelain"), "", kind)
    assert.equal(notices.length, 1, kind)
    assert.match(notices[0], new RegExp(`^Ingest failed: ${want}\\. 1 Dumps stay in inbox/\\.`), kind)
    if (kind === "nochange") {
      assert.equal((await git(brain, "stash", "list")).split("\n").length, stashes, kind)
    } else {
      const name = (await git(brain, "stash", "list", "-1", "--format=%s")).trim().replace(/^On [^:]*: /, "")
      assert.equal(name, "failed ingest 2026-10-23 18:00:00")
      assert.equal(notices[0].endsWith(` Stash: ${name}.`), true, kind)
      assert.match(await git(brain, "stash", "show", "-u", "--name-only", "stash@{0}"), /vault\/wiki\/partial\.md/)
    }
    const run = fs.readFileSync(path.join(brain, ".state", "runs.tsv"), "utf8").split("\n").at(-2)?.split("\t")
    assert.deepEqual(run?.slice(1), ["failed", "0", "0.0000", "ok", kind === "nochange" ? "" : "failed ingest 2026-10-23 18:00:00", want], kind)
  }
  assert.equal(fails(brain, "2026-10-08-120000-mac"), 3)
  assert.equal(lastIngestStatus(brain), "failed")

  const result = await ingestNow({ brain, apiKey: key, today, now, runner: good(brain) })
  assert.equal(result.status, "ok")
  assert.equal(fs.existsSync(path.join(brain, "vault", "raw", "2026", "10", dump)), true)
  assert.equal(fails(brain, "2026-10-08-120000-mac"), undefined)
  assert.equal(lastIngestStatus(brain), "ok")
})

test("a brain that never ran Ingest has no last status", async () => {
  assert.equal(lastIngestStatus(await brainWith()), null)
})

test("a failure to write index.md fails the chunk like any other failure", async () => {
  const dump = "2026-10-08-130000-mac.md"
  const brain = await brainWith([dump, "index breaks"])
  fs.symlinkSync("nowhere", path.join(brain, "vault", "wiki", "topics", "broken.md"))
  const notices: string[] = []
  const result = await ingestNow({
    brain,
    apiKey: key,
    today,
    now,
    notify: (text) => notices.push(text),
    runner: async (run) => {
      await good(brain)(run)
      partial(brain)
      return { code: 0, stdout: "" }
    },
  })

  assert.equal(result.status, "failed")
  assert.match(result.reason ?? "", /^index\.md failed: /)
  assert.equal(fs.existsSync(path.join(brain, "inbox", dump)), true)
  assert.match(await git(brain, "stash", "show", "-u", "--name-only", "stash@{0}"), /vault\/wiki\/partial\.md/)
  assert.match(notices[0], /^Ingest failed: index\.md failed: /)
  assert.equal(fails(brain, "2026-10-08-130000-mac"), 1)

  fs.rmSync(path.join(brain, "vault", "wiki", "topics", "broken.md"))
  assert.equal((await ingestNow({ brain, apiKey: key, today, now, runner: good(brain) })).status, "ok")
  assert.equal(fs.existsSync(path.join(brain, "vault", "raw", "2026", "10", dump)), true)
})

test("a poison Dump ends in inbox/failed/ and the rest of its chunk is filed", async () => {
  const brain = await brainWith(
    ["2026-10-09-080000-mac.md", "fine one"],
    ["2026-10-09-090000-mac.md", "POISON"],
    ["2026-10-09-100000-mac.md", "fine two"],
  )
  const notices: string[] = []
  const poisoned: AgentRunner = async (run) => {
    for (const stem of (run.args.at(-1) ?? "").matchAll(/inbox\/(\S+\.md)/g)) {
      if (fs.readFileSync(path.join(brain, "inbox", stem[1]), "utf8").includes("POISON")) return { code: 1, stdout: "" }
    }
    return good(brain)(run)
  }
  for (let i = 0; i < 5; i++) {
    await ingestNow({ brain, apiKey: key, today, now, runner: poisoned, notify: (text) => notices.push(text) })
  }

  assert.equal(fs.existsSync(path.join(brain, "inbox", "failed", "2026-10-09-090000-mac.md")), true)
  assert.equal(fs.existsSync(path.join(brain, "inbox", "2026-10-09-090000-mac.md")), false)
  assert.match(await git(brain, "log", "--format=%s"), /^failed: 2026-10-09-090000-mac$/m)
  assert.equal(fs.existsSync(path.join(brain, "vault", "raw", "2026", "10", "2026-10-09-080000-mac.md")), true)
  assert.equal(fs.existsSync(path.join(brain, "vault", "raw", "2026", "10", "2026-10-09-100000-mac.md")), true)
  assert.equal(notices.includes("Ingest gave up on 2026-10-09-090000-mac and moved it to inbox/failed/."), true)
  assert.deepEqual(fs.readdirSync(path.join(brain, "inbox")).filter((name) => name.endsWith(".md")), [])
  assert.equal(await git(brain, "status", "--porcelain"), "")
  assert.equal(fails(brain, "2026-10-09-090000-mac"), undefined)
})

test("a missing key stops the run before any chunk, notifies, and counts nothing against the Dump", async () => {
  const dump = "2026-10-09-103000-mac.md"
  const brain = await brainWith([dump, "no key"])
  const notices: string[] = []
  const result = await ingestNow({ brain, apiKey: "", today, now, runner: good(brain), notify: (t) => notices.push(t) })

  assert.equal(result.status, "failed")
  assert.deepEqual(notices, ["Ingest stopped: the OpenAI API key is missing."])
  assert.equal(fs.readFileSync(path.join(brain, ".state", "runs.tsv"), "utf8").split("\n").at(-2)?.split("\t")[1], "failed")
  assert.equal(fails(brain, "2026-10-09-103000-mac"), undefined)
  assert.equal(fs.existsSync(path.join(brain, "inbox", dump)), true)
})
