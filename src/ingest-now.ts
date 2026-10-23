import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { exec } from "dugite"
import { checkIngest } from "./check-ingest"
import { commitNewDumps } from "./drain-telegram"
import { writeIndex } from "./write-index"

const gitName = "Second Brain"
const gitEmail = "second-brain@localhost"
const chunkSize = 25
// Per agent run. Node timers stand still while the computer sleeps, so this is awake time, as in bin/ingest.
const chunkTimeoutMs = 20 * 60 * 1000
const running = new Set<string>()

export type AgentRun = {
  args: string[]
  env: NodeJS.ProcessEnv
  cwd: string
  signal: AbortSignal
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
      signal: run.signal,
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
  timeoutMs?: number
  notify?: (text: string) => void
}): Promise<IngestResult> {
  // The app is single-instance, so an in-process lock is enough, and a crash or quit never leaves it held.
  const lock = path.resolve(options.brain)
  if (running.has(lock)) return { status: "already-running", dumps: 0, cost: 0 }
  running.add(lock)

  const now = options.now ?? new Date()
  const today = options.today ?? localDate(now)
  const limit = options.timeoutMs ?? chunkTimeoutMs
  const notify = options.notify ?? (() => {})
  let status: IngestResult["status"] = "ok"
  let dumpsFiled = 0
  let cost = 0
  let check = "ok"
  let reason: string | undefined

  // Runs the agent once. Returns why it failed, if it did.
  const ask = async (prompt: string): Promise<string | undefined> => {
    const secret = options.apiKey.trim()
    const safePrompt = secret === "" ? prompt : prompt.split(secret).join("[redacted]")
    const alarm = new AbortController()
    const timer = setTimeout(() => alarm.abort(), limit)
    const timedOut = `timed out after ${limit / 1000}s`
    try {
      const run = await options.runner({
        args: ["run", "-m", "openai/gpt-5.6-luna", "--agent", "ingest", "--format", "json", safePrompt],
        env: { ...process.env, OPENAI_API_KEY: options.apiKey },
        cwd: options.brain,
        signal: alarm.signal,
      })
      cost = round4(cost + costOf(run.stdout))
      if (alarm.signal.aborted) return timedOut
      return run.code === 0 ? undefined : `runner exited ${run.code}`
    } catch (error) {
      if (alarm.signal.aborted) return timedOut
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  // Files one chunk. Returns why it failed, if it did.
  const fileChunk = async (chunk: string[]): Promise<string | undefined> => {
    const why = await ask(
      `Read .agents/skills/ingest/SKILL.md and follow it. File these Dumps: ${chunk.join(" ")}`,
    )
    if (why) return why
    if (!(await wikiChanged(options.brain))) return "runner changed nothing in vault/wiki/"
    const problems = await checkIngest(options.brain, chunk)
    if (problems.length > 0) {
      const fixWhy = await ask(
        `Read .agents/skills/ingest/SKILL.md. You filed these Dumps: ${chunk.join(" ")}. A check found these problems in the Pages you wrote. Fix each one, change nothing else, then stop.\n${problems.join("\n")}`,
      )
      if (fixWhy) return fixWhy
      const left = await checkIngest(options.brain, chunk)
      check = left.length > 0 ? "failed" : "fixed"
      // ponytail: problems left after the fix pass are filed anyway and only surfaced, as in bin/ingest.
      if (left.length > 0) notify("Ingest: check-ingest still finds problems after the fix pass.")
    }
    try {
      writeIndex(options.brain)
    } catch (error) {
      return `index.md failed: ${error instanceof Error ? error.message : error}`
    }
    return undefined
  }

  try {
    try {
      let pending = listDumps(options.brain)
      if (pending.length > 0) {
        // check-ingest and the no-change check read the wiki's uncommitted lines as the agent's.
        await commitOwnerEdits(options.brain)
        // In git before the agent runs, so Undo last Ingest can put them back in inbox/.
        await commitNewDumps(options.brain)
      }
      if (pending.length > 0 && options.apiKey.trim() === "") {
        // Never counted against the Dumps.
        status = "failed"
        reason = "OpenAI API key is missing"
        notify("Ingest stopped: the OpenAI API key is missing.")
      }
      const fails = readFails(options.brain)
      while (status === "ok" && pending.length > 0) {
        // Oldest first, up to 25. A Dump that failed twice is retried alone (v1 §6).
        let chunk = pending.slice(0, chunkSize)
        const poison = chunk.find((dump) => (fails.get(stemOf(dump)) ?? 0) >= 2)
        if (poison) chunk = [poison]
        const why = await fileChunk(chunk)
        if (why) {
          // The chunk's edits go to a stash, never a reset, and its Dumps stay in inbox/.
          const stash = await stashChunk(options.brain, now)
          status = "failed"
          reason = why
          notify(`Ingest failed: ${why}. ${chunk.length} Dumps stay in inbox/.${stash ? ` Stash: ${stash}.` : ""}`)
          for (const dump of chunk) fails.set(stemOf(dump), (fails.get(stemOf(dump)) ?? 0) + 1)
          // Two failed chunks, then two failures alone.
          const stem = stemOf(chunk[0])
          if (chunk.length === 1 && (fails.get(stem) ?? 0) >= 4) {
            moveDump(options.brain, chunk[0], path.join("inbox", "failed"))
            await commit(options.brain, `failed: ${stem}`, "inbox/failed")
            fails.delete(stem)
            notify(`Ingest gave up on ${stem} and moved it to inbox/failed/.`)
          }
          writeFails(options.brain, fails)
          break
        }
        for (const dump of chunk) {
          const stem = stemOf(dump)
          moveDump(options.brain, dump, path.join("vault", "raw", stem.slice(0, 4), stem.slice(5, 7)))
          fails.delete(stem)
        }
        writeFails(options.brain, fails)
        await commit(options.brain, `ingest: ${today}, ${chunk.length} Dumps`, "vault")
        dumpsFiled += chunk.length
        pending = pending.filter((dump) => !chunk.includes(dump))
      }
    } catch (error) {
      status = "failed"
      reason = error instanceof Error ? error.message : "ingest failed"
      let stash: string | undefined
      try {
        stash = await stashChunk(options.brain, now)
      } catch {
        // The chunk is already failed. Losing the stash must not hide that.
      }
      notify(`Ingest failed: ${reason}.${stash ? ` Stash: ${stash}.` : ""}`)
    }

    record(options.brain, now, status, dumpsFiled, cost, check)
    return { status, dumps: dumpsFiled, cost, reason }
  } finally {
    running.delete(lock)
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

// Reverts the newest `ingest:` commit not reverted yet, which restores the wiki and puts its Dumps back in
// inbox/. A revert that would touch a later edit is aborted, so it changes nothing.
export async function undoLastIngest(
  brain: string,
): Promise<{ status: "ok" | "nothing" | "failed" | "already-running"; reason?: string }> {
  const lock = path.resolve(brain)
  if (running.has(lock)) return { status: "already-running" }
  running.add(lock)
  try {
    await commitOwnerEdits(brain)
    const reverted = await exec(["log", "--format=%b", "--grep=^This reverts commit "], brain)
    const done = new Set([...reverted.stdout.matchAll(/This reverts commit ([0-9a-f]+)/g)].map((m) => m[1]))
    const ingests = await exec(["log", "--format=%H", "--grep=^ingest: "], brain)
    const last = ingests.stdout.split("\n").find((sha) => sha !== "" && !done.has(sha))
    if (!last) return { status: "nothing" }
    const result = await exec(["revert", "--no-edit", "--no-gpg-sign", last], brain, { env: gitEnv() })
    if (result.exitCode === 0) return { status: "ok" }
    await exec(["revert", "--abort"], brain)
    return { status: "failed", reason: result.stderr || result.stdout || "git revert failed" }
  } finally {
    running.delete(lock)
  }
}

function stemOf(dump: string): string {
  return path.posix.basename(dump, ".md")
}

// Moves the Dump and any sidecars to dest, a folder relative to the brain.
function moveDump(brain: string, dump: string, dest: string): void {
  const stem = stemOf(dump)
  fs.mkdirSync(path.join(brain, dest), { recursive: true })
  for (const name of fs.readdirSync(path.join(brain, "inbox"))) {
    if (name.startsWith(`${stem}.`)) fs.renameSync(path.join(brain, "inbox", name), path.join(brain, dest, name))
  }
}

// Per-Dump failure counts, "<stem> <count>" a line. .state/ is gitignored, so a stash never takes it.
function readFails(brain: string): Map<string, number> {
  const file = path.join(brain, ".state", "fails")
  if (!fs.existsSync(file)) return new Map()
  const fails = new Map<string, number>()
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const [stem, count] = line.split(" ")
    if (stem && Number(count) > 0) fails.set(stem, Number(count))
  }
  return fails
}

function writeFails(brain: string, fails: Map<string, number>): void {
  fs.mkdirSync(path.join(brain, ".state"), { recursive: true })
  fs.writeFileSync(path.join(brain, ".state", "fails"), [...fails].map(([stem, n]) => `${stem} ${n}\n`).join(""))
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

// Returns the stash's name, or nothing when there was nothing to stash.
async function stashChunk(brain: string, now: Date): Promise<string | undefined> {
  const status = await exec(["status", "--porcelain", "--", ".", ":!inbox"], brain)
  if (status.exitCode !== 0) throw new Error(status.stderr || "git status failed")
  if (status.stdout.trim() === "") return undefined
  const name = `failed ingest ${now.toISOString().slice(0, 19).replace("T", " ")}`
  const stashed = await exec(
    ["stash", "push", "-q", "-u", "-m", name, "--", ".", ":!inbox"],
    brain,
    { env: gitEnv() },
  )
  if (stashed.exitCode !== 0) throw new Error(stashed.stderr || stashed.stdout || "git stash failed")
  return name
}

async function wikiChanged(brain: string): Promise<boolean> {
  const result = await exec(["status", "--porcelain", "--", "vault/wiki"], brain)
  if (result.exitCode !== 0) throw new Error(result.stderr || "git status failed")
  return result.stdout.trim().length > 0
}

function gitEnv(): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: gitName,
    GIT_AUTHOR_EMAIL: gitEmail,
    GIT_COMMITTER_NAME: gitName,
    GIT_COMMITTER_EMAIL: gitEmail,
  }
}

async function commitOwnerEdits(brain: string): Promise<void> {
  const env = gitEnv()
  const added = await exec(["add", "-A", "--", ".", ":!inbox"], brain, { env })
  if (added.exitCode !== 0) throw new Error(added.stderr || "git add failed")
  const staged = await exec(["diff", "--cached", "--quiet"], brain)
  if (staged.exitCode === 0) return
  if (staged.exitCode !== 1) throw new Error(staged.stderr || "git diff failed")
  const committed = await exec(["commit", "-m", "owner edits", "--no-gpg-sign"], brain, { env })
  if (committed.exitCode !== 0) throw new Error(committed.stderr || committed.stdout || "git commit failed")
}

// Commits what moved out of inbox/ and everything under dest. A Dump that arrived during the run is not
// in git yet, so it stays out of this commit, and an Undo of it never deletes that Dump.
async function commit(brain: string, message: string, dest: string): Promise<void> {
  const env = gitEnv()
  for (const args of [["add", "-A", "--", dest], ["add", "-u", "--", "inbox"]]) {
    const added = await exec(args, brain, { env })
    if (added.exitCode !== 0) throw new Error(added.stderr || "git add failed")
  }
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
