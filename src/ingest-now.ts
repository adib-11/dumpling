import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { exec } from "dugite"
import { lockBrain } from "./brain-lock"
import { checkIngest } from "./check-ingest"
import { commitNewDumps } from "./drain-telegram"
import { engineOf, engineRun, missingKey, runCost, unavailable, type Engine } from "./engine"
import { fetchLinks, type LinkTools } from "./fetch-link"
import { filedToday } from "./filed-today"
import { pushBackup, type PushResult } from "./git-remote"
import { type Bot } from "./telegram"
import { writeIndex } from "./write-index"

const gitName = "Second Brain"
const gitEmail = "second-brain@localhost"
const chunkSize = 25
// Per agent run. Node timers stand still while the computer sleeps, so this is awake time, as in bin/ingest.
const chunkTimeoutMs = 20 * 60 * 1000

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
  push?: PushResult
  followUp?: { sent: number; partial: boolean }
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
      // opencode takes its project from PWD before cwd, and PWD is whatever launched the app.
      env: { ...run.env, PWD: run.cwd },
      signal: run.signal,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const out: Buffer[] = []
    child.stdout?.on("data", (chunk: Buffer) => out.push(chunk))
    child.stderr?.on("data", () => {})
    // On a timeout, wait for "close", so nothing writes to the brain while the chunk is stashed.
    child.on("error", (error) => {
      if (!run.signal.aborted) reject(error)
    })
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString("utf8") }))
  })
}

export async function ingestNow(options: {
  brain: string
  // The Engine, or an OpenAI key alone for the OpenAI Key Engine.
  engine?: Engine
  apiKey?: string
  runner: AgentRunner
  links?: LinkTools
  today?: string
  now?: Date
  timeoutMs?: number
  // "add-key" when a key would let the run go on: the notification offers to add one.
  notify?: (text: string, offer?: "add-key") => void
  bot?: Bot
  chat?: number
  // The scheduled Ingest also sends the "Filed today" message.
  daily?: boolean
}): Promise<IngestResult> {
  const unlock = lockBrain(options.brain)
  if (!unlock) return { status: "already-running", dumps: 0, cost: 0 }

  const now = options.now ?? new Date()
  const today = options.today ?? localDate(now)
  const limit = options.timeoutMs ?? chunkTimeoutMs
  const notify = options.notify ?? (() => {})
  const engine = engineOf(options)
  // The Engine's model in use. A 429 or a gone model moves to the next for the rest of the run.
  let modelIndex = 0
  let limited = false
  // This chunk is on the fallback after a 429 or a gone model.
  let fellBack = false
  let status: IngestResult["status"] = "ok"
  let cost = 0
  let check = "ok"
  let reason: string | undefined
  let stash: string | undefined
  let followUp: IngestResult["followUp"]
  let pending: string[] = []
  const filed: string[] = []
  let failed = 0

  // Runs the agent once. Returns why it failed, if it did.
  const ask = async (prompt: string): Promise<string | undefined> => {
    const secret = engine.key.trim()
    const safePrompt = secret === "" ? prompt : prompt.split(secret).join("[redacted]")
    const alarm = new AbortController()
    const timer = setTimeout(() => alarm.abort(), limit)
    const timedOut = `timed out after ${limit / 1000}s`
    limited = false
    try {
      const run = await options.runner(
        engineRun(engine, engine.models[modelIndex], ["--agent", "ingest", "--format", "json", safePrompt], options.brain, alarm.signal),
      )
      cost = round4(cost + runCost(run.stdout, engine.models[modelIndex]))
      if (alarm.signal.aborted) return timedOut
      limited = run.code !== 0 && unavailable(run.stdout)
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
      pending = listDumps(options.brain)
      if (pending.length > 0) {
        // check-ingest and the no-change check read the wiki's uncommitted lines as the agent's.
        await commitOwnerEdits(options.brain)
        // In git before the agent runs, so Undo last Ingest can put them back in inbox/.
        await commitNewDumps(options.brain)
      }
      if (options.links) {
        await fetchLinks(
          pending.map((dump) => path.join(options.brain, dump)),
          options.links,
        )
      }
      const missing = missingKey(engine)
      if (pending.length > 0 && missing) {
        // Never counted against the Dumps.
        status = "failed"
        failed = pending.length
        reason = missing
        notify(`Ingest stopped: the ${missing}.`)
      }
      const fails = readFails(options.brain)
      while (status === "ok" && pending.length > 0) {
        // Oldest first, up to 25. A Dump that failed twice is retried alone (v1 §6).
        let chunk = pending.slice(0, chunkSize)
        const poison = chunk.find((dump) => (fails.get(stemOf(dump)) ?? 0) >= 2)
        if (poison) chunk = [poison]
        const why = await fileChunk(chunk)
        if (why && limited && modelIndex + 1 < engine.models.length) {
          // The fallback refiles the chunk from scratch, so the default's edits go to a stash first.
          stash = (await stashChunk(options.brain, now)) ?? stash
          modelIndex += 1
          fellBack = true
          continue
        }
        if (why) {
          // The chunk's edits go to a stash, never a reset, and its Dumps stay in inbox/.
          stash = await stashChunk(options.brain, now)
          status = "failed"
          failed = chunk.length
          if (engine.name === "free" && (limited || fellBack)) {
            // Not the Dumps' fault, so nothing counts against them. A key would file them.
            reason = "the free models are unavailable"
            const stashed = stash ? ` Stash: ${stash}.` : ""
            notify(`Ingest failed: ${reason}. ${chunk.length} Dumps stay in inbox/.${stashed} Add a key to keep filing.`, "add-key")
            break
          }
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
        fellBack = false
        for (const dump of chunk) {
          const stem = stemOf(dump)
          moveDump(options.brain, dump, path.join("vault", "raw", stem.slice(0, 4), stem.slice(5, 7)))
          fails.delete(stem)
          filed.push(stem)
        }
        writeFails(options.brain, fails)
        await commit(options.brain, `ingest: ${today}, ${chunk.length} Dumps`, "vault")
        pending = pending.filter((dump) => !chunk.includes(dump))
      }
    } catch (error) {
      status = "failed"
      // Thrown mid-chunk, so every Dump still waiting may be part of it.
      failed = pending.length
      reason = error instanceof Error ? error.message : "ingest failed"
      try {
        stash = await stashChunk(options.brain, now)
      } catch {
        // The chunk is already failed. Losing the stash must not hide that.
      }
      notify(`Ingest failed: ${reason}.${stash ? ` Stash: ${stash}.` : ""}`)
    }

    if (options.bot && options.chat !== undefined) {
      try {
        followUp = await sendFollowUps(options.brain, options.bot, options.chat)
      } catch (error) {
        // The Dumps are filed. The run is still recorded and pushed, and the next Ingest sends what is left.
        followUp = { sent: 0, partial: true }
        notify(`Follow-ups failed: ${error instanceof Error ? error.message : error}`)
      }
      const text = options.daily ? filedToday(options.brain, filed, failed) : undefined
      if (text) {
        try {
          await options.bot("sendMessage", { chat_id: options.chat, text })
        } catch (error) {
          notify(`Filed today message failed: ${error instanceof Error ? error.message : error}`)
        }
      }
    }
    record(options.brain, now, [status, filed.length, cost.toFixed(4), check, stash ?? "", reason ?? ""])
    // Last and best-effort: a failed push rolls nothing back, and the next Ingest pushes again.
    const pushed = await pushBackup(options.brain)
    return { status, dumps: filed.length, cost, reason, ...(pushed && { push: pushed }), ...(followUp && { followUp }) }
  } finally {
    unlock()
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
  const unlock = lockBrain(brain)
  if (!unlock) return { status: "already-running" }
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
    unlock()
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

// One line per run: status, dumps, cost, check, stash, reason.
function record(brain: string, now: Date, fields: (string | number)[]): void {
  const file = path.join(brain, ".state", "runs.tsv")
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (!fs.existsSync(file)) fs.writeFileSync(file, "when\tstatus\tdumps\tcost\tcheck\tstash\treason\n")
  const line = [now.toISOString(), ...fields].map((field) => String(field).replace(/[\t\r\n]+/g, " "))
  fs.appendFileSync(file, `${line.join("\t")}\n`)
}

// The status of the newest run in .state/runs.tsv, or null before the first run.
export function lastIngestStatus(brain: string): string | null {
  const file = path.join(brain, ".state", "runs.tsv")
  if (!fs.existsSync(file)) return null
  const last = fs.readFileSync(file, "utf8").trimEnd().split("\n").at(-1) ?? ""
  return last.startsWith("when\t") ? null : (last.split("\t")[1] ?? null)
}

// Returns the stash's name, or nothing when there was nothing to stash.
async function stashChunk(brain: string, now: Date): Promise<string | undefined> {
  const status = await exec(["status", "--porcelain", "--", ".", ":!inbox"], brain)
  if (status.exitCode !== 0) throw new Error(status.stderr || "git status failed")
  if (status.stdout.trim() === "") return undefined
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, "0"))
  const name = `failed ingest ${localDate(now)} ${time.join(":")}`
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

// "<dump name>\t<question>" in vault/follow-ups.md. Not a Telegram Dump, an Addendum, or a Dump
// already asked: drop the line. A failed send stays for the next Ingest.
async function sendFollowUps(
  brain: string,
  bot: Bot,
  chat: number,
): Promise<IngestResult["followUp"]> {
  const file = path.join(brain, "vault", "follow-ups.md")
  if (!fs.existsSync(file)) return undefined
  const asked = askedNames(brain)
  const keep: string[] = []
  let sent = 0
  let changed = false
  let partial = false
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line === "" || line.startsWith("#")) continue
    const tab = line.indexOf("\t")
    const name = tab === -1 ? "" : line.slice(0, tab)
    const question = tab === -1 ? "" : line.slice(tab + 1)
    if (name === "" || question === "") {
      keep.push(line)
      continue
    }
    const dump = dumpFile(brain, name)
    if (!dump) {
      keep.push(line)
      continue
    }
    const fields = frontmatterFields(fs.readFileSync(dump, "utf8"))
    if (asked.has(name) || fields.device !== "telegram" || fields.addendum_to) {
      changed = true
      continue
    }
    const messageId = Number(fields.telegram_message_id)
    if (!fields.telegram_message_id || !Number.isInteger(messageId)) {
      keep.push(line)
      continue
    }
    try {
      const result = (await bot("sendMessage", {
        chat_id: chat,
        text: question,
        reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
        reply_markup: { force_reply: true },
      })) as { message_id?: number }
      if (typeof result?.message_id !== "number") {
        keep.push(line)
        partial = true
        continue
      }
      fs.appendFileSync(path.join(brain, "vault", "telegram-questions.md"), `${result.message_id} ${name}\n`)
      asked.add(name)
      sent += 1
      changed = true
    } catch {
      keep.push(line)
      partial = true
    }
  }
  if (!changed) return { sent, partial }
  fs.writeFileSync(file, ["# Follow-ups", ...keep, ""].join("\n"))
  const paths = ["vault/follow-ups.md"]
  if (fs.existsSync(path.join(brain, "vault", "telegram-questions.md"))) paths.push("vault/telegram-questions.md")
  await commit(brain, `follow-up: ${sent}`, ...paths)
  return { sent, partial }
}

function askedNames(brain: string): Set<string> {
  const file = path.join(brain, "vault", "telegram-questions.md")
  const asked = new Set<string>()
  if (!fs.existsSync(file)) return asked
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const name = line.trim().split(/\s+/)[1]
    if (name) asked.add(name)
  }
  return asked
}

function dumpFile(brain: string, name: string): string | undefined {
  const candidates = [
    path.join(brain, "inbox", `${name}.md`),
    path.join(brain, "vault", "raw", name.slice(0, 4), name.slice(5, 7), `${name}.md`),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate))
}

function frontmatterFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const lines = text.split("\n")
  if (lines[0] !== "---") return fields
  for (let i = 1; i < lines.length && lines[i] !== "---"; i++) {
    const sep = lines[i].indexOf(":")
    if (sep === -1) continue
    fields[lines[i].slice(0, sep)] = lines[i].slice(sep + 1).trim()
  }
  return fields
}

// Commits what moved out of inbox/ and everything under dest. A Dump that arrived during the run is not
// in git yet, so it stays out of this commit, and an Undo of it never deletes that Dump.
async function commit(brain: string, message: string, ...dest: string[]): Promise<void> {
  const env = gitEnv()
  for (const args of [["add", "-A", "--", ...dest], ["add", "-u", "--", "inbox"]]) {
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
