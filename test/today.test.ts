import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createSecondBrain } from "../src/create-second-brain"
import { readToday } from "../src/today"

process.env.TZ = "Asia/Dhaka"
const templates = path.join(__dirname, "..", "templates")
// 18:00 on Friday 23 Oct 2026 in Dhaka.
const now = new Date("2026-10-23T12:00:00.000Z")

async function setup() {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), "today-"))
  await createSecondBrain(brain, templates)
  return brain
}

function dump(dir: string, name: string, body: string, extra: string[] = []): void {
  const captured = `${name.slice(0, 10)}T${name.slice(11, 13)}:${name.slice(13, 15)}:${name.slice(15, 17)}+06:00`
  const device = name.split("-").at(-1)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${name}.md`),
    ["---", `captured: ${captured}`, `device: ${device}`, "kind: text", ...extra, "---", body, ""].join("\n"),
  )
}

const waiting = (brain: string, name: string, body = "hi", extra: string[] = []) =>
  dump(path.join(brain, "inbox"), name, body, extra)

const filed = (brain: string, name: string, body = "hi", extra: string[] = []) =>
  dump(path.join(brain, "vault", "raw", name.slice(0, 4), name.slice(5, 7)), name, body, extra)

function runs(brain: string, ...rows: string[][]): void {
  fs.mkdirSync(path.join(brain, ".state"), { recursive: true })
  fs.writeFileSync(
    path.join(brain, ".state", "runs.tsv"),
    ["when\tstatus\tdumps\tcost\tcheck\tstash\treason", ...rows.map((row) => row.join("\t")), ""].join("\n"),
  )
}

function log(brain: string, ...entries: string[]): void {
  fs.appendFileSync(path.join(brain, "vault", "wiki", "log.md"), `${entries.join("\n")}\n`)
}

test("a new folder has an empty Today", async () => {
  const brain = await setup()
  assert.deepEqual(readToday(brain, now), {
    captured: [],
    filed: [],
    failure: null,
    followUps: [],
    openThreads: [],
    stats: { dumpsThisWeek: 0, costThisMonth: 0, pages: 0, lastIngest: null },
  })
})

test("Today lists the Dumps captured today, waiting or already filed, and not yesterday's", async () => {
  const brain = await setup()
  waiting(brain, "2026-10-23-090000-telegram", "a thought\n\nsecond paragraph")
  filed(brain, "2026-10-23-100000-desktop", "filed one", ["kind: link"])
  waiting(brain, "2026-10-22-235900-telegram", "yesterday")
  fs.writeFileSync(path.join(brain, "inbox", "2026-10-23-090000-telegram.fetched.md"), "---\nstatus: fetched\n---\nsidecar\n")

  const view = readToday(brain, now)

  assert.deepEqual(
    view.captured.map((each) => [each.name, each.device, each.captured, each.preview]),
    [
      ["2026-10-23-090000-telegram", "telegram", "2026-10-23T09:00:00+06:00", "a thought second paragraph"],
      ["2026-10-23-100000-desktop", "desktop", "2026-10-23T10:00:00+06:00", "filed one"],
    ],
  )
})

test("a long Dump shows a short preview", async () => {
  const brain = await setup()
  waiting(brain, "2026-10-23-090000-telegram", "word ".repeat(100))

  const [only] = readToday(brain, now).captured

  assert.ok(only.preview.length <= 141)
  assert.ok(only.preview.endsWith("…"))
})

test("Today lists the Dumps Ingest filed today from log.md, with the Page each went to", async () => {
  const brain = await setup()
  filed(brain, "2026-10-21-090000-telegram", "old dump")
  filed(brain, "2026-10-22-090000-telegram", "to Dune")
  filed(brain, "2026-10-22-100000-telegram", "empty")
  log(
    brain,
    "## [2026-10-20] ingest | Older",
    "- Raw: [[2026-10-21-090000-telegram]]",
    "## [2026-10-23] ingest | Dune",
    "- Disposition: New",
    "- Raw: [[2026-10-22-090000-telegram]]",
    "- Created: [[dune|Dune]]",
    "## [2026-10-23] ingest | no material: 2026-10-22-100000-telegram",
    "- Disposition: No material (empty Dump)",
    "- Raw: [[2026-10-22-100000-telegram]]",
  )

  const view = readToday(brain, now)

  assert.deepEqual(
    view.filed.map((each) => [each.name, each.title, each.preview]),
    [
      ["2026-10-22-090000-telegram", "Dune", "to Dune"],
      ["2026-10-22-100000-telegram", null, "empty"],
    ],
  )
})

test("a Dump filed twice today (an Undo, then a refile) is listed once", async () => {
  const brain = await setup()
  filed(brain, "2026-10-22-090000-telegram")
  log(
    brain,
    "## [2026-10-23] ingest | First",
    "- Raw: [[2026-10-22-090000-telegram]]",
    "## [2026-10-23] ingest | Second",
    "- Raw: [[2026-10-22-090000-telegram]]",
  )

  assert.deepEqual(readToday(brain, now).filed.map((each) => each.title), ["Second"])
})

test("a Dump the log names but whose file is gone is still listed, with no preview", async () => {
  const brain = await setup()
  log(brain, "## [2026-10-23] ingest | Dune", "- Raw: [[2026-10-22-090000-telegram]]")

  assert.deepEqual(readToday(brain, now).filed.map((each) => [each.name, each.preview]), [["2026-10-22-090000-telegram", ""]])
})

test("Today shows the newest run when it failed, with its reason and stash", async () => {
  const brain = await setup()
  runs(
    brain,
    ["2026-10-22T10:00:00.000Z", "failed", "0", "0.0000", "ok", "", "runner exited 1"],
    ["2026-10-23T03:00:00.000Z", "failed", "0", "0.0100", "ok", "failed ingest 2026-10-23 09:00:00", "timed out after 1200s"],
  )

  assert.deepEqual(readToday(brain, now).failure, {
    when: "2026-10-23T03:00:00.000Z",
    reason: "timed out after 1200s",
    stash: "failed ingest 2026-10-23 09:00:00",
  })
})

test("a failure with no reason still says it failed", async () => {
  const brain = await setup()
  runs(brain, ["2026-10-23T03:00:00.000Z", "failed", "0", "0.0000", "ok", "", ""])

  assert.deepEqual(readToday(brain, now).failure, { when: "2026-10-23T03:00:00.000Z", reason: "Ingest failed.", stash: null })
})

test("a later good run clears the failure", async () => {
  const brain = await setup()
  runs(
    brain,
    ["2026-10-22T10:00:00.000Z", "failed", "0", "0.0000", "ok", "", "runner exited 1"],
    ["2026-10-23T03:00:00.000Z", "ok", "2", "0.0100", "ok", "", ""],
  )

  assert.equal(readToday(brain, now).failure, null)
})

test("Follow-ups waiting are the questions sent that no Addendum answers yet", async () => {
  const brain = await setup()
  filed(brain, "2026-10-20-090000-telegram", "a podcast link")
  filed(brain, "2026-10-21-090000-telegram", "a film")
  filed(brain, "2026-10-22-090000-telegram", "a book")
  waiting(brain, "2026-10-22-120000-telegram", "loved it", ["addendum_to: 2026-10-21-090000-telegram"])
  filed(brain, "2026-10-22-130000-telegram", "meh", ["addendum_to: 2026-10-20-090000-telegram"])
  fs.writeFileSync(
    path.join(brain, "vault", "telegram-questions.md"),
    "9001 2026-10-20-090000-telegram\n9002 2026-10-21-090000-telegram\n9003 2026-10-22-090000-telegram\n",
  )

  assert.deepEqual(
    readToday(brain, now).followUps.map((each) => [each.name, each.preview]),
    [["2026-10-22-090000-telegram", "a book"]],
  )
})

test("an Addendum older than the question does not answer it", async () => {
  const brain = await setup()
  filed(brain, "2026-10-22-090000-telegram", "a book")
  filed(brain, "2026-10-21-090000-telegram", "stray", ["addendum_to: 2026-10-22-090000-telegram"])
  fs.writeFileSync(path.join(brain, "vault", "telegram-questions.md"), "9003 2026-10-22-090000-telegram\n")

  assert.deepEqual(readToday(brain, now).followUps.map((each) => each.name), ["2026-10-22-090000-telegram"])
})

test("Open threads are the unticked lines of open-threads.md", async () => {
  const brain = await setup()
  fs.appendFileSync(
    path.join(brain, "vault", "wiki", "open-threads.md"),
    [
      "- [ ] Pay the internet bill (2026-09-15, [[2026-09-15-080000-iphone|Dump 15 Sep]])",
      "- [x] Call Nadia (2026-09-16, [[2026-09-16-080000-iphone|Dump 16 Sep]], → [[nadia|Nadia]])",
      "- [ ] Watch Dune again (2026-09-14, [[2026-09-14-231000-iphone|Dump 14 Sep]], → [[dune-part-two|Dune: Part Two]])",
      "- [ ] A line the Owner wrote by hand",
      "",
    ].join("\n"),
  )

  assert.deepEqual(readToday(brain, now).openThreads, [
    { text: "Pay the internet bill", date: "2026-09-15", page: null },
    { text: "Watch Dune again", date: "2026-09-14", page: "Dune: Part Two" },
    { text: "A line the Owner wrote by hand", date: null, page: null },
  ])
})

test("Dumps this week counts the seven days ending today, waiting or filed", async () => {
  const brain = await setup()
  waiting(brain, "2026-10-23-090000-telegram")
  filed(brain, "2026-10-20-090000-telegram")
  filed(brain, "2026-10-17-000100-telegram")
  filed(brain, "2026-10-16-235900-telegram")
  fs.mkdirSync(path.join(brain, "inbox", "failed"), { recursive: true })
  dump(path.join(brain, "inbox", "failed"), "2026-10-18-090000-telegram", "gave up")

  assert.equal(readToday(brain, now).stats.dumpsThisWeek, 4)
})

test("Engine cost this month sums this month's runs by the local calendar", async () => {
  const brain = await setup()
  runs(
    brain,
    ["2026-09-30T17:00:00.000Z", "ok", "1", "0.5000", "ok", "", ""],
    ["2026-09-30T18:30:00.000Z", "ok", "1", "0.2500", "ok", "", ""],
    ["2026-10-10T03:00:00.000Z", "ok", "5", "0.1234", "ok", "", ""],
    ["2026-10-23T03:00:00.000Z", "failed", "0", "0.0100", "ok", "", "runner exited 1"],
  )

  // 18:30 UTC on 30 Sep is 00:30 on 1 Oct in Dhaka.
  assert.equal(readToday(brain, now).stats.costThisMonth, 0.3834)
})

test("Pages counts the Page files under the five Page folders and not me.md, index.md or log.md", async () => {
  const brain = await setup()
  const wiki = path.join(brain, "vault", "wiki")
  for (const file of ["people/nadia.md", "works/dune.md", "works/arrival.md", "topics/sleep.md", "places/star-cineplex.md"]) {
    fs.writeFileSync(path.join(wiki, file), "---\nsummary: x\n---\n")
  }

  assert.equal(readToday(brain, now).stats.pages, 5)
})

test("the last Ingest is the newest run, good or failed", async () => {
  const brain = await setup()
  runs(
    brain,
    ["2026-10-22T03:00:00.000Z", "ok", "3", "0.1000", "ok", "", ""],
    ["2026-10-23T03:00:00.000Z", "failed", "0", "0.0000", "ok", "", "runner exited 1"],
  )

  assert.deepEqual(readToday(brain, now).stats.lastIngest, { when: "2026-10-23T03:00:00.000Z", status: "failed" })
})

test("a run log line cut short or mangled is skipped", async () => {
  const brain = await setup()
  runs(brain, ["2026-10-22T03:00:00.000Z", "ok", "3", "0.1000", "ok", "", ""], ["garbage"], ["2026-10-23T03:00:00.000Z", "ok", "x", "nan"])

  const { stats } = readToday(brain, now)

  assert.equal(stats.costThisMonth, 0.1)
  assert.deepEqual(stats.lastIngest, { when: "2026-10-22T03:00:00.000Z", status: "ok" })
})
