import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { exec } from "dugite"
import { checkIngest } from "./check-ingest"
import { writeIndex } from "./write-index"

const gitName = "Second Brain"
const gitEmail = "second-brain@localhost"
const chunkSize = 25

export type AgentRun = {
  args: string[]
  env: NodeJS.ProcessEnv
  cwd: string
}

export type AgentRunner = (run: AgentRun) => Promise<{ code: number; stdout: string }>

export type IngestResult = {
  status: "ok" | "failed" | "already-running"
  dumps: number
  cost: number
  reason?: string
}

type SpawnLike = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ReturnType<typeof nodeSpawn>

export async function spawnOpencode(
  bin: string,
  run: AgentRun,
  spawnImpl: SpawnLike = nodeSpawn,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(bin, run.args, {
      cwd: run.cwd,
      env: run.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const out: Buffer[] = []
    child.stdout?.on("data", (chunk: Buffer) => out.push(chunk))
    child.stderr?.on("data", () => {})
    child.on("error", reject)
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString("utf8") }))
  })
}

export async function ingestNow(options: {
  brain: string
  apiKey: string
  runner: AgentRunner
  today?: string
  now?: Date
  model?: string
}): Promise<IngestResult> {
  // ponytail: one lock directory per brain in tmp. A crash holds it until reboot.
  const lockDir = path.join(
    os.tmpdir(),
    `second-brain-ingest-${createHash("sha256").update(path.resolve(options.brain)).digest("hex").slice(0, 16)}.lock`,
  )
  try {
    fs.mkdirSync(lockDir)
  } catch (error) {
    if (isCode(error, "EEXIST")) return { status: "already-running", dumps: 0, cost: 0 }
    throw error
  }

  const now = options.now ?? new Date()
  const today = options.today ?? localDate(now)
  const model = options.model ?? "gpt-5.6-luna"
  let status: IngestResult["status"] = "ok"
  let dumpsFiled = 0
  let cost = 0
  let check = "ok"
  let reason: string | undefined
  const fail = async (why: string) => {
    await stashChunk(options.brain, now)
    status = "failed"
    reason = why
  }

  try {
    try {
      const dumps = listDumps(options.brain)
    if (dumps.length > 0 && options.apiKey.trim() === "") {
      await fail("OpenAI API key is missing")
    } else {
      for (let i = 0; i < dumps.length; i += chunkSize) {
        const chunk = dumps.slice(i, i + chunkSize)
        const ask = async (prompt: string) => {
          const secret = options.apiKey.trim()
          const safePrompt = secret === "" ? prompt : prompt.split(secret).join("[redacted]")
          const run = await options.runner({
            args: ["run", "-m", `openai/${model}`, "--agent", "ingest", "--format", "json", safePrompt],
            env: { ...process.env, OPENAI_API_KEY: options.apiKey },
            cwd: options.brain,
          })
          cost = round4(cost + costOf(run.stdout))
          return run
        }
        const filed = await ask(
          `Read .agents/skills/ingest/SKILL.md and follow it. File these Dumps: ${chunk.join(" ")}`,
        )
        if (filed.code !== 0) {
          await fail(`runner exited ${filed.code}`)
          break
        }
        if (!(await wikiChanged(options.brain))) {
          await fail("runner changed nothing in vault/wiki/")
          break
        }
        const problems = await checkIngest(options.brain, chunk)
        if (problems.length > 0) {
          const fix = await ask(
            `Read .agents/skills/ingest/SKILL.md. You filed these Dumps: ${chunk.join(" ")}. A check found these problems in the Pages you wrote. Fix each one, change nothing else, then stop.\n${problems.join("\n")}`,
          )
          if (fix.code !== 0) {
            await fail(`runner exited ${fix.code}`)
            break
          }
          const left = await checkIngest(options.brain, chunk)
          check = left.length > 0 ? "failed" : "fixed"
        }
        writeIndex(options.brain)
        for (const dump of chunk) moveDump(options.brain, dump)
        await commit(options.brain, `ingest: ${today}, ${chunk.length} Dumps`)
        dumpsFiled += chunk.length
      }
    }
  } catch (error) {
    status = "failed"
    reason = error instanceof Error ? error.message : "ingest failed"
    try {
      await stashChunk(options.brain, now)
    } catch {
      // The chunk is already failed. Losing the stash must not hide that.
    }
  }

  record(options.brain, now, status, dumpsFiled, cost, check)
    return { status, dumps: dumpsFiled, cost, reason }
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true })
  }
}

function listDumps(brain: string): string[] {
  const inbox = path.join(brain, "inbox")
  if (!fs.existsSync(inbox)) return []
  return fs
    .readdirSync(inbox)
    .filter((name) => name.endsWith(".md") && !name.endsWith(".fetched.md"))
    .sort()
    .map((name) => `inbox/${name}`)
}

function moveDump(brain: string, dump: string): void {
  const stem = path.posix.basename(dump, ".md")
  const dest = path.join(brain, "vault", "raw", stem.slice(0, 4), stem.slice(5, 7))
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(path.join(brain, "inbox"))) {
    if (name.startsWith(`${stem}.`)) fs.renameSync(path.join(brain, "inbox", name), path.join(dest, name))
  }
}

function costOf(stdout: string): number {
  let sum = 0
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue
    try {
      const event = JSON.parse(line) as { type?: string; part?: { cost?: number } }
      if (event.type === "step_finish" && typeof event.part?.cost === "number") sum += event.part.cost
    } catch {
      // The runner's other lines are not a cost.
    }
  }
  return sum
}

function record(brain: string, now: Date, status: string, dumps: number, cost: number, check: string): void {
  const file = path.join(brain, ".state", "runs.tsv")
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (!fs.existsSync(file)) fs.writeFileSync(file, "when\tstatus\tdumps\tcost\tcheck\n")
  fs.appendFileSync(file, `${now.toISOString()}\t${status}\t${dumps}\t${cost.toFixed(4)}\t${check}\n`)
}

async function stashChunk(brain: string, now: Date): Promise<void> {
  const status = await exec(["status", "--porcelain", "--", ".", ":!inbox"], brain)
  if (status.exitCode !== 0) throw new Error(status.stderr || "git status failed")
  if (status.stdout.trim() === "") return
  const stamp = now.toISOString().slice(0, 19).replace("T", " ")
  const stashed = await exec(
    ["stash", "push", "-q", "-u", "-m", `failed ingest ${stamp}`, "--", ".", ":!inbox"],
    brain,
    {
      env: {
        GIT_AUTHOR_NAME: gitName,
        GIT_AUTHOR_EMAIL: gitEmail,
        GIT_COMMITTER_NAME: gitName,
        GIT_COMMITTER_EMAIL: gitEmail,
      },
    },
  )
  if (stashed.exitCode !== 0) throw new Error(stashed.stderr || stashed.stdout || "git stash failed")
}

async function wikiChanged(brain: string): Promise<boolean> {
  const result = await exec(["status", "--porcelain", "--", "vault/wiki"], brain)
  if (result.exitCode !== 0) throw new Error(result.stderr || "git status failed")
  return result.stdout.trim().length > 0
}

async function commit(brain: string, message: string): Promise<void> {
  const env = {
    GIT_AUTHOR_NAME: gitName,
    GIT_AUTHOR_EMAIL: gitEmail,
    GIT_COMMITTER_NAME: gitName,
    GIT_COMMITTER_EMAIL: gitEmail,
  }
  const added = await exec(["add", "--", "inbox", "vault"], brain, { env })
  if (added.exitCode !== 0) throw new Error(added.stderr || "git add failed")
  const committed = await exec(["commit", "-m", message, "--no-gpg-sign"], brain, { env })
  if (committed.exitCode !== 0) throw new Error(committed.stderr || committed.stdout || "git commit failed")
}

function localDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}
