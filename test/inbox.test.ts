import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { exec } from "dugite"
import { lockBrain } from "../src/brain-lock"
import { createSecondBrain } from "../src/create-second-brain"
import { commitNewDumps } from "../src/drain-telegram"
import { deleteDump, editDump, listInbox } from "../src/inbox"

process.env.TZ = "Asia/Dhaka"
const templates = path.join(__dirname, "..", "templates")

async function setup() {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-"))
  await createSecondBrain(brain, templates)
  return brain
}

function dump(brain: string, name: string, body: string, extra: string[] = []): void {
  const captured = `${name.slice(0, 10)}T${name.slice(11, 13)}:${name.slice(13, 15)}:${name.slice(15, 17)}+06:00`
  const device = name.split("-").at(-1)
  fs.writeFileSync(
    path.join(brain, "inbox", `${name}.md`),
    ["---", `captured: ${captured}`, `device: ${device}`, "kind: text", ...extra, "---", body, ""].join("\n"),
  )
}

async function git(brain: string, ...args: string[]): Promise<string> {
  const result = await exec(args, brain)
  assert.equal(result.exitCode, 0, result.stderr)
  return result.stdout
}

async function subjects(brain: string): Promise<string[]> {
  return (await git(brain, "log", "--format=%s")).trim().split("\n")
}

test("the Inbox lists the Dumps waiting, oldest first, with their text and no sidecars", async () => {
  const brain = await setup()
  dump(brain, "2026-10-21-140000-telegram", "second thought\n\nwith a second paragraph")
  dump(brain, "2026-10-20-090000-desktop", "first thought")
  fs.writeFileSync(path.join(brain, "inbox", "2026-10-20-090000-desktop.fetched.md"), "---\nstatus: fetched\n---\nlinked text\n")
  fs.writeFileSync(path.join(brain, "inbox", "2026-10-21-140000-telegram.jpg"), "jpeg")

  const listed = listInbox(brain)

  assert.deepEqual(
    listed.map((each) => [each.name, each.device, each.kind, each.captured, each.text]),
    [
      ["2026-10-20-090000-desktop", "desktop", "text", "2026-10-20T09:00:00+06:00", "first thought"],
      ["2026-10-21-140000-telegram", "telegram", "text", "2026-10-21T14:00:00+06:00", "second thought\n\nwith a second paragraph"],
    ],
  )
})

test("the text of a Dump with image text is the Owner's words alone, and the image text is not editable", async () => {
  const brain = await setup()
  dump(brain, "2026-10-21-140000-telegram", "my caption\n\n## Image text\n\nOCR words", ["image: 2026-10-21-140000-telegram.jpg"])

  assert.equal(listInbox(brain)[0].text, "my caption")
})

test("an empty Inbox lists nothing", async () => {
  assert.deepEqual(listInbox(await setup()), [])
})

test("editing a Dump rewrites its text, keeps everything else, and is one commit of that Dump alone", async () => {
  const brain = await setup()
  dump(brain, "2026-10-21-140000-telegram", "old words\n\n## Image text\n\nOCR words", ["telegram_message_id: 10"])
  dump(brain, "2026-10-21-150000-telegram", "other")
  await commitNewDumps(brain)
  fs.writeFileSync(path.join(brain, "inbox", "2026-10-21-150000-telegram.md"), "---\ncaptured: x\n---\nhand edit in Obsidian\n")

  const result = await editDump(brain, "2026-10-21-140000-telegram", "new words")

  assert.deepEqual(result, { ok: true })
  assert.equal(
    fs.readFileSync(path.join(brain, "inbox", "2026-10-21-140000-telegram.md"), "utf8"),
    [
      "---",
      "captured: 2026-10-21T14:00:00+06:00",
      "device: telegram",
      "kind: text",
      "telegram_message_id: 10",
      "---",
      "new words",
      "",
      "## Image text",
      "",
      "OCR words",
      "",
    ].join("\n"),
  )
  assert.equal((await subjects(brain))[0], "edit: 2026-10-21-140000-telegram")
  assert.deepEqual((await git(brain, "show", "--name-only", "--format=", "HEAD")).trim().split("\n"), [
    "inbox/2026-10-21-140000-telegram.md",
  ])
})

test("editing a Dump that is not in git yet commits it first, so the edit is its own commit", async () => {
  const brain = await setup()
  dump(brain, "2026-10-21-140000-telegram", "old words")

  assert.deepEqual(await editDump(brain, "2026-10-21-140000-telegram", "new words"), { ok: true })

  assert.deepEqual((await subjects(brain)).slice(0, 2), ["edit: 2026-10-21-140000-telegram", "drain: 1 Dumps"])
  assert.equal(await git(brain, "status", "--porcelain"), "")
})

test("editing to the same text, or to blank text, changes nothing", async () => {
  const brain = await setup()
  dump(brain, "2026-10-21-140000-telegram", "same")
  await commitNewDumps(brain)
  const before = await subjects(brain)

  assert.deepEqual(await editDump(brain, "2026-10-21-140000-telegram", "same"), { ok: true })
  const blank = await editDump(brain, "2026-10-21-140000-telegram", "  \n ")

  assert.equal(blank.ok, false)
  assert.deepEqual(await subjects(brain), before)
  assert.equal(listInbox(brain)[0].text, "same")
})

test("deleting a Dump removes it and its image and link sidecar in one commit", async () => {
  const brain = await setup()
  dump(brain, "2026-10-21-140000-telegram", "gone soon")
  dump(brain, "2026-10-21-150000-telegram", "stays")
  fs.writeFileSync(path.join(brain, "inbox", "2026-10-21-140000-telegram.jpg"), "jpeg")
  fs.writeFileSync(path.join(brain, "inbox", "2026-10-21-140000-telegram.fetched.md"), "---\nstatus: unfetched\n---\n")
  await commitNewDumps(brain)

  assert.deepEqual(await deleteDump(brain, "2026-10-21-140000-telegram"), { ok: true })

  assert.deepEqual(fs.readdirSync(path.join(brain, "inbox")).sort(), [".gitkeep", "2026-10-21-150000-telegram.md"])
  assert.equal((await subjects(brain))[0], "delete: 2026-10-21-140000-telegram")
  assert.equal(await git(brain, "status", "--porcelain"), "")
})

test("deleting a Dump the drain has not committed yet leaves the folder clean", async () => {
  const brain = await setup()
  dump(brain, "2026-10-21-140000-telegram", "gone")

  assert.deepEqual(await deleteDump(brain, "2026-10-21-140000-telegram"), { ok: true })

  assert.deepEqual(listInbox(brain), [])
  assert.equal(await git(brain, "status", "--porcelain"), "")
})

test("an edit or delete during an Ingest changes nothing", async () => {
  const brain = await setup()
  dump(brain, "2026-10-21-140000-telegram", "old")
  await commitNewDumps(brain)
  const unlock = lockBrain(brain)
  assert.ok(unlock)

  const edited = await editDump(brain, "2026-10-21-140000-telegram", "new")
  const deleted = await deleteDump(brain, "2026-10-21-140000-telegram")
  unlock()

  assert.deepEqual([edited.ok, deleted.ok], [false, false])
  assert.equal(listInbox(brain)[0].text, "old")
  assert.match((edited as { error: string }).error, /Ingest is running/)
})

test("the lock is released after an edit, so an Ingest can run next", async () => {
  const brain = await setup()
  dump(brain, "2026-10-21-140000-telegram", "old")
  await editDump(brain, "2026-10-21-140000-telegram", "new")

  const unlock = lockBrain(brain)
  assert.ok(unlock)
  unlock()
})

test("only a Dump in inbox/ can be edited or deleted, never another file by path", async () => {
  const brain = await setup()
  fs.writeFileSync(path.join(brain, "outside.md"), "keep me")
  for (const name of ["../outside", "../../outside", "inbox/../outside", "nope", ".gitkeep", "2026-10-21-140000-telegram.fetched"]) {
    assert.equal((await editDump(brain, name, "x")).ok, false, name)
    assert.equal((await deleteDump(brain, name)).ok, false, name)
  }
  assert.equal(fs.readFileSync(path.join(brain, "outside.md"), "utf8"), "keep me")
})
