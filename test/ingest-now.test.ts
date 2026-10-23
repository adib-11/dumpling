import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { exec } from "dugite"
import { createSecondBrain } from "../src/create-second-brain"
import { ingestNow, spawnOpencode, type AgentRun } from "../src/ingest-now"

const templates = path.join(__dirname, "..", "templates")
const key = "sk-test-secret-not-real"
const today = "2026-10-23"
const now = new Date("2026-10-23T12:00:00.000Z")

async function brainWith(dump: string, body: string, sidecar?: string): Promise<string> {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-now-"))
  await createSecondBrain(brain, templates)
  fs.writeFileSync(path.join(brain, "inbox", dump), body)
  if (sidecar !== undefined) {
    fs.writeFileSync(path.join(brain, "inbox", dump.replace(/\.md$/, ".fetched.md")), sidecar)
  }
  return brain
}

function contains(dir: string, needle: string): boolean {
  const bytes = Buffer.from(needle)
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (contains(full, needle)) return true
    } else if (fs.readFileSync(full).includes(bytes)) return true
  }
  return false
}

test("ingest now files a Dump, commits, logs the cost, and keeps the key out of the folder and argv", async () => {
  const dump = "2026-10-08-090000-mac.md"
  const brain = await brainWith(
    dump,
    "---\ncaptured: 2026-10-08T09:00:00+06:00\nkind: text\n---\nCafe thought\n",
    "---\nstatus: fetched\n---\nsidecar\n",
  )
  const calls: AgentRun[] = []
  const result = await ingestNow({
    brain,
    apiKey: key,
    today,
    now,
    runner: async (run) => {
      calls.push(run)
      const stem = /inbox\/(\S+)\.md/.exec(run.args.at(-1) ?? "")?.[1]
      fs.appendFileSync(path.join(brain, "vault", "wiki", "log.md"), `- Raw: [[${stem}]]\n`)
      fs.mkdirSync(path.join(brain, "vault", "wiki", "topics"), { recursive: true })
      fs.writeFileSync(
        path.join(brain, "vault", "wiki", "topics", "cafe.md"),
        "---\nsummary: A cafe.\nupdated: 2026-10-23\n---\n# Cafe\n",
      )
      return {
        code: 0,
        stdout: `{"type":"step_finish","part":{"cost":0.01}}\n{"type":"step_finish","part":{"cost":0.02}}\n${key}\n`,
      }
    },
  })

  assert.equal(result.status, "ok")
  assert.equal(result.dumps, 1)
  assert.equal(result.cost, 0.03)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args.slice(0, -1), [
    "run",
    "-m",
    "openai/gpt-5.6-luna",
    "--agent",
    "ingest",
    "--format",
    "json",
  ])
  assert.equal(
    calls[0].args.at(-1),
    "Read .agents/skills/ingest/SKILL.md and follow it. File these Dumps: inbox/2026-10-08-090000-mac.md",
  )
  assert.equal(calls[0].args.join("\n").includes(key), false)
  assert.equal(calls[0].env.OPENAI_API_KEY, key)

  assert.equal(fs.existsSync(path.join(brain, "inbox", dump)), false)
  assert.equal(fs.existsSync(path.join(brain, "inbox", "2026-10-08-090000-mac.fetched.md")), false)
  assert.equal(
    fs.readFileSync(path.join(brain, "vault", "raw", "2026", "10", dump), "utf8").includes("Cafe thought"),
    true,
  )
  assert.equal(
    fs.existsSync(path.join(brain, "vault", "raw", "2026", "10", "2026-10-08-090000-mac.fetched.md")),
    true,
  )
  assert.equal(fs.readFileSync(path.join(brain, "vault", "wiki", "index.md"), "utf8").includes("[[cafe]]"), true)

  const log = await exec(["log", "-1", "--format=%s"], brain)
  assert.equal(log.stdout.trim(), "ingest: 2026-10-23, 1 Dumps")
  assert.equal(
    fs.readFileSync(path.join(brain, ".state", "runs.tsv"), "utf8"),
    "when\tstatus\tdumps\tcost\tcheck\n2026-10-23T12:00:00.000Z\tok\t1\t0.0300\tok\n",
  )
  assert.equal(contains(brain, key), false)
})

test("a chunk that fails check-ingest gets one fix pass and is then filed", async () => {
  const dump = "2026-10-08-093000-mac.md"
  const brain = await brainWith(dump, "---\ncaptured: 2026-10-08T09:30:00+06:00\nkind: text\n---\nno log yet\n")
  const prompts: string[] = []
  const result = await ingestNow({
    brain,
    apiKey: key,
    today,
    now,
    runner: async (run) => {
      const prompt = run.args.at(-1) ?? ""
      prompts.push(prompt)
      if (!prompt.includes("problems")) {
        fs.writeFileSync(path.join(brain, "vault", "wiki", "topics.md"), "partial\n")
        return { code: 0, stdout: '{"type":"step_finish","part":{"cost":0.01}}\n' }
      }
      fs.appendFileSync(path.join(brain, "vault", "wiki", "log.md"), "- Raw: [[2026-10-08-093000-mac]]\n")
      return { code: 0, stdout: '{"type":"step_finish","part":{"cost":0.02}}\n' }
    },
  })

  assert.equal(prompts.length, 2)
  assert.match(prompts[1], /log\.md has no entry with "- Raw: \[\[2026-10-08-093000-mac\]\]"/)
  assert.match(prompts[1], /change nothing else/)
  assert.equal(result.status, "ok")
  assert.equal(result.cost, 0.03)
  assert.equal(fs.existsSync(path.join(brain, "vault", "raw", "2026", "10", dump)), true)
  assert.equal(
    fs.readFileSync(path.join(brain, ".state", "runs.tsv"), "utf8").endsWith("\tok\t1\t0.0300\tfixed\n"),
    true,
  )
})

test("dumps are filed oldest first in chunks of 25", async () => {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-chunks-"))
  await createSecondBrain(brain, templates)
  for (let i = 1; i <= 26; i++) {
    const name = `2026-09-01-${String(i).padStart(6, "0")}-mac.md`
    fs.writeFileSync(path.join(brain, "inbox", name), `---\nkind: text\n---\nd${i}\n`)
  }
  const prompts: string[] = []
  const result = await ingestNow({
    brain,
    apiKey: key,
    today,
    now,
    runner: async (run) => {
      const prompt = run.args.at(-1) ?? ""
      prompts.push(prompt)
      for (const stem of prompt.matchAll(/inbox\/(\S+)\.md/g)) {
        fs.appendFileSync(path.join(brain, "vault", "wiki", "log.md"), `- Raw: [[${stem[1]}]]\n`)
      }
      fs.appendFileSync(path.join(brain, "vault", "wiki", "topics.md"), "filed\n")
      return { code: 0, stdout: '{"type":"step_finish","part":{"cost":0.01}}\n' }
    },
  })

  assert.equal(result.status, "ok")
  assert.equal(result.dumps, 26)
  assert.equal(prompts.length, 2)
  assert.equal(prompts[0].includes("2026-09-01-000001-mac.md"), true)
  assert.equal(prompts[0].includes("2026-09-01-000025-mac.md"), true)
  assert.equal(prompts[0].includes("2026-09-01-000026-mac.md"), false)
  assert.equal(prompts[1].includes("2026-09-01-000026-mac.md"), true)
  assert.equal(prompts[1].includes("2026-09-01-000025-mac.md"), false)
  const log = await exec(["log", "--format=%s"], brain)
  assert.match(log.stdout, /^ingest: 2026-10-23, 1 Dumps\ningest: 2026-10-23, 25 Dumps\n/)
  assert.equal(fs.readdirSync(path.join(brain, "vault", "raw", "2026", "09")).length, 26)
})

test("a second Ingest now does not start while one is running", async () => {
  const brain = await brainWith("2026-10-08-110000-mac.md", "---\nkind: text\n---\nslow\n")
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let started!: () => void
  const startedP = new Promise<void>((resolve) => {
    started = resolve
  })
  const first = ingestNow({
    brain,
    apiKey: key,
    today,
    now,
    runner: async () => {
      started()
      await gate
      fs.appendFileSync(path.join(brain, "vault", "wiki", "log.md"), "- Raw: [[2026-10-08-110000-mac]]\n")
      fs.appendFileSync(path.join(brain, "vault", "wiki", "topics.md"), "x\n")
      return { code: 0, stdout: '{"type":"step_finish","part":{"cost":0}}\n' }
    },
  })
  await startedP
  let secondRan = false
  const second = await ingestNow({
    brain,
    apiKey: key,
    today,
    now,
    runner: async () => {
      secondRan = true
      return { code: 0, stdout: "" }
    },
  })
  assert.equal(second.status, "already-running")
  assert.equal(secondRan, false)
  release()
  assert.equal((await first).status, "ok")

  fs.writeFileSync(path.join(brain, "inbox", "2026-10-08-110100-mac.md"), "---\nkind: text\n---\nnext\n")
  let thirdRan = false
  const third = await ingestNow({
    brain,
    apiKey: key,
    today,
    now,
    runner: async () => {
      thirdRan = true
      fs.appendFileSync(path.join(brain, "vault", "wiki", "log.md"), "- Raw: [[2026-10-08-110100-mac]]\n")
      fs.appendFileSync(path.join(brain, "vault", "wiki", "topics.md"), "y\n")
      return { code: 0, stdout: "" }
    },
  })
  assert.equal(thirdRan, true)
  assert.equal(third.status, "ok")
})

test("an empty key does not start the runner", async () => {
  const dump = "2026-10-08-103000-mac.md"
  const brain = await brainWith(dump, "---\nkind: text\n---\nno key\n")
  let ran = false
  const result = await ingestNow({
    brain,
    apiKey: "  ",
    today,
    now,
    runner: async () => {
      ran = true
      return { code: 0, stdout: "" }
    },
  })
  assert.equal(ran, false)
  assert.equal(result.status, "failed")
  assert.equal(fs.existsSync(path.join(brain, "inbox", dump)), true)
  const messages = await exec(["log", "--format=%s"], brain)
  assert.equal(messages.stdout.includes("ingest:"), false)
})

test("a failed runner leaves the Dump in inbox and stashes the chunk", async () => {
  const dump = "2026-10-08-120000-mac.md"
  const brain = await brainWith(dump, "---\nkind: text\n---\nfails\n")
  const result = await ingestNow({
    brain,
    apiKey: key,
    today,
    now,
    runner: async () => {
      fs.writeFileSync(path.join(brain, "vault", "wiki", "partial.md"), "partial\n")
      return { code: 3, stdout: '{"type":"step_finish","part":{"cost":0.01}}\n' }
    },
  })

  assert.equal(result.status, "failed")
  assert.equal(result.dumps, 0)
  assert.equal(fs.existsSync(path.join(brain, "inbox", dump)), true)
  assert.equal(fs.existsSync(path.join(brain, "vault", "wiki", "partial.md")), false)
  const messages = await exec(["log", "--format=%s"], brain)
  assert.equal(messages.stdout.includes("ingest:"), false)
  const stash = await exec(["stash", "list"], brain)
  assert.match(stash.stdout, /failed ingest/)
  const stashed = await exec(["stash", "show", "-u", "--name-only"], brain)
  assert.match(stashed.stdout, /vault\/wiki\/partial\.md/)
  assert.equal(contains(brain, key), false)
})

test("a quote of the key is not passed as an opencode argument", async () => {
  const dump = "2026-10-08-140000-mac.md"
  const brain = await brainWith(dump, "---\nkind: text\n---\nordinary note\n")
  const prompts: string[] = []
  await ingestNow({
    brain,
    apiKey: key,
    today,
    now,
    runner: async (run) => {
      const prompt = run.args.at(-1) ?? ""
      prompts.push(prompt)
      if (!prompt.includes("problems")) {
        fs.appendFileSync(path.join(brain, "vault", "wiki", "log.md"), "- Raw: [[2026-10-08-140000-mac]]\n")
        fs.writeFileSync(
          path.join(brain, "vault", "wiki", "topics.md"),
          `- 2026-10-08: "${key}" ([[2026-10-08-140000-mac|Dump 8 Oct]])\n`,
        )
      } else {
        fs.writeFileSync(path.join(brain, "vault", "wiki", "topics.md"), "clean\n")
      }
      return { code: 0, stdout: "" }
    },
  })
  assert.equal(prompts.length, 2)
  assert.equal(prompts[1].includes(key), false)
  assert.equal(prompts[1].includes("[redacted]"), true)
})

test("the opencode process arguments do not include the key", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-argv-"))
  const script = path.join(dir, "fake-opencode.js")
  const out = path.join(dir, "out.json")
  fs.writeFileSync(
    script,
    `const fs = require("node:fs")
fs.writeFileSync(process.argv[2], JSON.stringify({ argv: process.argv, env: process.env.OPENAI_API_KEY }))
`,
  )
  const run: AgentRun = {
    args: [script, out, "run", "-m", "openai/gpt-5.6-luna", "--agent", "ingest", "--format", "json", "File these Dumps"],
    env: { ...process.env, OPENAI_API_KEY: key },
    cwd: dir,
  }
  const result = await spawnOpencode(process.execPath, run, spawn)
  assert.equal(result.code, 0)
  const recorded = JSON.parse(fs.readFileSync(out, "utf8")) as { argv: string[]; env: string }
  assert.equal(recorded.env, key)
  assert.equal(recorded.argv.some((arg: string) => arg.includes(key)), false)
})
