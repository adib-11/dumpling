import fs from "node:fs"
import path from "node:path"
import { exec } from "dugite"

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export async function checkIngest(brain: string, dumps: string[]): Promise<string[]> {
  const log = read(path.join(brain, "vault", "wiki", "log.md"))
  const problems: string[] = []
  for (const dump of dumps) {
    const needle = `- Raw: [[${stemOf(dump)}]]`
    if (!log.includes(needle)) {
      problems.push(`log.md has no entry with "${needle}" for ${dump}`)
    }
  }
  for (const added of await addedLines(brain)) {
    problems.push(...lineProblems(brain, added.file, added.line))
  }
  return problems
}

function stemOf(dump: string): string {
  return path.posix.basename(dump.replaceAll("\\", "/"), ".md")
}

async function addedLines(brain: string): Promise<{ file: string; line: string }[]> {
  const diff = await git(
    ["-c", "core.quotePath=false", "diff", "-U0", "--no-color", "--", "vault/wiki", ":!vault/wiki/index.md", ":!vault/wiki/digests", ":!vault/wiki/log.md"],
    brain,
  )
  let text = diff
  const untracked = await git(
    ["ls-files", "-z", "-o", "--exclude-standard", "--", "vault/wiki", ":!vault/wiki/digests"],
    brain,
  )
  for (const file of untracked.split("\0").filter((name) => name.length > 0)) {
    const normalized = file.replaceAll("\\", "/")
    text += `+++ b/${normalized}\n`
    for (const line of read(path.join(brain, normalized)).split("\n")) {
      text += `+${line.replace(/\r$/, "")}\n`
    }
  }
  const added: { file: string; line: string }[] = []
  let file = ""
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "")
    const header = /^\+\+\+ b\/(.*)/.exec(line)
    if (header) {
      file = header[1].replaceAll("\\", "/")
      continue
    }
    if (file.length > 0 && line.startsWith("+")) added.push({ file, line: line.slice(1) })
  }
  return added
}

function lineProblems(brain: string, file: string, line: string): string[] {
  const problems: string[] = []
  const cite = /\[\[(\d{4}-\d\d-\d\d-\d{6}-[a-z0-9]+)(?:\|([^\]]*))?\]\]/g
  let match: RegExpExecArray | null
  while ((match = cite.exec(line))) {
    const name = match[1]
    const label = match[2]
    const dumpFile = findDump(brain, name)
    if (!dumpFile) {
      problems.push(`${file}: [[${name}]] names no Dump`)
      continue
    }
    if (label === undefined) continue
    const day = `${Number(name.slice(8, 10))} ${months[Number(name.slice(5, 7)) - 1]}`
    const want = /^addendum_to:\s*\S/m.test(read(path.join(brain, dumpFile)))
      ? `Addendum ${day}`
      : label === `Addendum ${day}`
        ? label
        : `Dump ${day}`
    if (label !== want) problems.push(`${file}: cite ${name} as [[${name}|${want}]], not |${label}`)
  }

  const quoted = /\[\[(\d{4}-\d\d-\d\d-\d{6}-[a-z0-9]+)\|/.exec(line)
  if (!quoted) return problems
  const dumpFile = findDump(brain, quoted[1])
  if (!dumpFile) return problems
  const src = read(path.join(brain, dumpFile)) + read(path.join(brain, dumpFile.replace(/\.md$/, ".fetched.md")))
  const quote = /"([^"]{4,})"( *\[)?/g
  let found: RegExpExecArray | null
  while ((found = quote.exec(line))) {
    const text = found[1]
    if (!src.includes(text)) {
      problems.push(`${file}: quote "${text}" is not word for word in ${dumpFile}; copy it exactly`)
    }
    if (/\p{scx=Bengali}/u.test(text) && !found[2]) {
      problems.push(`${file}: quote "${text}" needs an [English gloss] right after it`)
    }
  }
  return problems
}

function findDump(brain: string, name: string): string | undefined {
  const candidates = [
    path.posix.join("inbox", `${name}.md`),
    path.posix.join("vault", "raw", name.slice(0, 4), name.slice(5, 7), `${name}.md`),
  ]
  return candidates.find((rel) => fs.existsSync(path.join(brain, rel)))
}

export function read(file: string): string {
  try {
    return fs.readFileSync(file, "utf8")
  } catch (error) {
    if (isMissing(error)) return ""
    throw error
  }
}

async function git(args: string[], cwd: string): Promise<string> {
  const result = await exec(args, cwd)
  if (result.exitCode > 1) throw new Error(result.stderr || result.stdout || `git ${args[0]} failed`)
  return result.stdout
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
