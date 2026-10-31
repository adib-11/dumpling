import fs from "node:fs"
import path from "node:path"
import { readDump, type DumpFile } from "./dump"

// What the Today tab shows (spec §5), read from the folder: the Dump files, `vault/wiki/log.md`,
// `open-threads.md`, `vault/telegram-questions.md` and `.state/runs.tsv`. Nothing is cached, so it is
// always what the files say.

export type TodayDump = {
  name: string
  captured: string | null
  device: string
  kind: string
  // The first words of the Dump, on one line.
  preview: string
}

export type TodayView = {
  // Dumps captured today, waiting or already filed, oldest first.
  captured: TodayDump[]
  // Dumps Ingest filed today, with the main Page each went to (null for "no material").
  filed: (TodayDump & { title: string | null })[]
  // Set when the newest Ingest failed.
  failure: { when: string; reason: string; stash: string | null } | null
  // Follow-up questions sent on Telegram that no Addendum answers yet.
  followUps: TodayDump[]
  openThreads: { text: string; date: string | null; page: string | null }[]
  stats: {
    // The seven days ending today.
    dumpsThisWeek: number
    // Summed over this calendar month's runs, failed ones too.
    costThisMonth: number
    pages: number
    lastIngest: { when: string; status: string } | null
  }
}

const previewChars = 140
const pageFolders = ["people", "works", "topics", "projects", "places"]

export function readToday(brain: string, now: Date): TodayView {
  const today = localDay(now)
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
  // A Dump's file name carries its capture date, so only files from about a week back are opened.
  const recent = scanDumps(brain, localDay(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 1)))
  const week = recent.filter((dump) => dump.captured !== null && dump.captured >= weekStart)
  const runs = readRuns(brain)
  const newest = runs.at(-1)
  return {
    captured: recent
      .filter((dump) => dump.captured !== null && localDay(dump.captured) === today)
      .sort((a, b) => a.captured!.getTime() - b.captured!.getTime())
      .map((dump) => line(dump.name, dump.fields, dump.text)),
    filed: filedOn(brain, today),
    failure:
      newest?.status === "failed"
        ? { when: newest.when, reason: newest.reason || "Ingest failed.", stash: newest.stash || null }
        : null,
    followUps: waitingFollowUps(brain),
    openThreads: openThreads(brain),
    stats: {
      dumpsThisWeek: week.length,
      costThisMonth: round4(
        runs
          .filter((run) => {
            const when = new Date(run.when)
            return when.getFullYear() === now.getFullYear() && when.getMonth() === now.getMonth()
          })
          .reduce((sum, run) => sum + run.cost, 0),
      ),
      pages: countPages(brain),
      lastIngest: newest ? { when: newest.when, status: newest.status } : null,
    },
  }
}

// ponytail: opens every Dump named from `since` on, and lists every filed Dump's folder; index them if
// vault/raw/ grows past tens of thousands.
function scanDumps(brain: string, since: string): DumpFile[] {
  const found: DumpFile[] = []
  for (const dir of [path.join(brain, "inbox"), path.join(brain, "inbox", "failed"), path.join(brain, "vault", "raw")]) {
    if (!fs.existsSync(dir)) continue
    for (const entry of fs.readdirSync(dir, { recursive: true, encoding: "utf8" })) {
      const name = path.basename(entry, ".md")
      // inbox/ is read without descending, since inbox/failed/ is its own root.
      if (!entry.endsWith(".md") || entry.endsWith(".fetched.md") || name < since) continue
      if (dir.endsWith("inbox") && entry !== path.basename(entry)) continue
      found.push(readDump(path.join(dir, entry)))
    }
  }
  return found
}

function line(name: string, fields: Record<string, string>, text = ""): TodayDump {
  return {
    name,
    captured: fields.captured ?? null,
    device: fields.device ?? "",
    kind: fields.kind ?? "text",
    preview: preview(text),
  }
}

function preview(text: string): string {
  const one = text.replace(/\s+/g, " ").trim()
  return one.length > previewChars ? `${one.slice(0, previewChars)}…` : one
}

// A filed or waiting Dump by name: in the Inbox, given up on, or filed under vault/raw/YYYY/MM/.
function findDump(brain: string, name: string): DumpFile | undefined {
  const candidates = [
    path.join(brain, "inbox", `${name}.md`),
    path.join(brain, "inbox", "failed", `${name}.md`),
    path.join(brain, "vault", "raw", name.slice(0, 4), name.slice(5, 7), `${name}.md`),
  ]
  const file = candidates.find((each) => fs.existsSync(each))
  return file ? readDump(file) : undefined
}

function describe(brain: string, name: string): TodayDump {
  const dump = findDump(brain, name)
  return dump ? line(name, dump.fields, dump.text) : line(name, {})
}

function filedOn(brain: string, day: string): TodayView["filed"] {
  const file = path.join(brain, "vault", "wiki", "log.md")
  if (!fs.existsSync(file)) return []
  // The newest entry per Dump, so an Undo and a re-file list it once.
  const entries = new Map<string, string | null>()
  for (const chunk of fs.readFileSync(file, "utf8").split(/^(?=## \[)/m)) {
    const heading = /^## \[(\d{4}-\d{2}-\d{2})\] ingest \| (.*)$/m.exec(chunk)
    const name = /^- Raw: \[\[([^\]|]+)/m.exec(chunk)?.[1]
    if (heading?.[1] !== day || !name) continue
    entries.delete(name)
    entries.set(name, heading[2].startsWith("no material:") ? null : heading[2].trim())
  }
  return [...entries].map(([name, title]) => ({ ...describe(brain, name), title }))
}

function waitingFollowUps(brain: string): TodayDump[] {
  const file = path.join(brain, "vault", "telegram-questions.md")
  if (!fs.existsSync(file)) return []
  const asked = new Set<string>()
  for (const entry of fs.readFileSync(file, "utf8").split("\n")) {
    const name = entry.trim().split(/\s+/)[1]
    if (name) asked.add(name)
  }
  if (asked.size === 0) return []
  // An answer comes after its question's Dump, so nothing older is opened.
  const first = [...asked].sort()[0]
  const answered = new Set(
    scanDumps(brain, first)
      .map((dump) => dump.fields.addendum_to)
      .filter((name) => name !== undefined),
  )
  return [...asked].sort().filter((name) => !answered.has(name)).map((name) => describe(brain, name))
}

function openThreads(brain: string): TodayView["openThreads"] {
  const file = path.join(brain, "vault", "wiki", "open-threads.md")
  if (!fs.existsSync(file)) return []
  const threads: TodayView["openThreads"] = []
  for (const each of fs.readFileSync(file, "utf8").split("\n")) {
    const open = /^- \[ \] (.+)$/.exec(each)
    if (!open) continue
    const dated = /^(.*?) \((\d{4}-\d{2}-\d{2})(?:,.*)?\)\s*$/.exec(open[1])
    const page = /→ \[\[(?:[^\]|]+\|)?([^\]]+)\]\]/.exec(open[1])
    threads.push({ text: dated ? dated[1] : open[1], date: dated?.[2] ?? null, page: page?.[1] ?? null })
  }
  return threads
}

function countPages(brain: string): number {
  let pages = 0
  for (const folder of pageFolders) {
    const dir = path.join(brain, "vault", "wiki", folder)
    if (!fs.existsSync(dir)) continue
    pages += fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".md")).length
  }
  return pages
}

type Run = { when: string; status: string; cost: number; stash: string; reason: string }

// .state/runs.tsv, oldest first. A line that is cut short or does not read is skipped.
function readRuns(brain: string): Run[] {
  const file = path.join(brain, ".state", "runs.tsv")
  if (!fs.existsSync(file)) return []
  const runs: Run[] = []
  for (const each of fs.readFileSync(file, "utf8").split("\n")) {
    const [when, status, , cost, , stash = "", reason = ""] = each.split("\t")
    if (!status || Number.isNaN(new Date(when).getTime()) || !Number.isFinite(Number(cost))) continue
    runs.push({ when, status, cost: Number(cost), stash, reason })
  }
  return runs
}

function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
