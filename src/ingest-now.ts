import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { exec } from "dugite"
import { checkIngest } from "./check-ingest"
import { pushBackup, type PushResult } from "./git-remote"
import { type Bot } from "./telegram"
import { writeIndex } from "./write-index"

const gitName = "Second Brain"
const gitEmail = "second-brain@localhost"
const chunkSize = 25
const running = new Set<string>()

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
  bot?: Bot
  chat?: number
}): Promise<IngestResult> {
  // The app is single-instance, so an in-process lock is enough, and a crash or quit never leaves it held.
  const lock = path.resolve(options.brain)
  if (running.has(lock)) return { status: "already-running", dumps: 0, cost: 0 }
  running.add(lock)

  const now = options.now ?? new Date()
  const today = options.today ?? localDate(now)
  let status: IngestResult["status"] = "ok"
  let dumpsFiled = 0
  let cost = 0
  let check = "ok"
  let reason: string | undefined
  let followUp: IngestResult["followUp"]
  const fail = async (why: string) => {
    await stashChunk(options.brain, now)
    status = "failed"
    reason = why
  }

  try {
    try {
      const dumps = listDumps(options.brain)
      // check-ingest and the no-change check read the wiki's uncommitted lines as the agent's.
      if (dumps.length > 0) await commitOwnerEdits(options.brain)
      if (dumps.length > 0 && options.apiKey.trim() === "") {
        await fail("OpenAI API key is missing")
      } else {
        for (let i = 0; i < dumps.length; i += chunkSize) {
          const chunk = dumps.slice(i, i + chunkSize)
          const ask = async (prompt: string) => {
            const secret = options.apiKey.trim()
            const safePrompt = secret === "" ? prompt : prompt.split(secret).join("[redacted]")
            const run = await options.runner({
              args: ["run", "-m", "openai/gpt-5.6-luna", "--agent", "ingest", "--format", "json", safePrompt],
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

    if (options.bot && options.chat !== undefined) {
      followUp = await sendFollowUps(options.brain, options.bot, options.chat)
    }
    record(options.brain, now, status, dumpsFiled, cost, check)
    // Last and best-effort: a failed push rolls nothing back, and the next Ingest pushes again.
    const pushed = await pushBackup(options.brain)
    return { status, dumps: dumpsFiled, cost, reason, ...(pushed && { push: pushed }), ...(followUp && { followUp }) }
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
    { env: gitEnv() },
  )
  if (stashed.exitCode !== 0) throw new Error(stashed.stderr || stashed.stdout || "git stash failed")
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
  await commit(brain, `follow-up: ${sent}`, paths)
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

async function commit(brain: string, message: string, paths = ["inbox", "vault"]): Promise<void> {
  const env = gitEnv()
  const added = await exec(["add", "--", ...paths], brain, { env })
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
