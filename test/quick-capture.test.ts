import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { exec } from "dugite"
import { decode, encode } from "jpeg-js"
import { lockBrain } from "../src/brain-lock"
import { createSecondBrain } from "../src/create-second-brain"
import { commitNewDumps } from "../src/drain-telegram"
import { listInbox } from "../src/inbox"
import { quickCapture } from "../src/quick-capture"

process.env.TZ = "Asia/Dhaka"
const templates = path.join(__dirname, "..", "templates")
// 2026-10-21 14:00:00 in Dhaka (+06:00).
const now = new Date("2026-10-21T14:00:00+06:00")

async function setup() {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), "quick-capture-"))
  await createSecondBrain(brain, templates)
  return brain
}

async function git(brain: string, ...args: string[]): Promise<string> {
  const result = await exec(args, brain)
  assert.equal(result.exitCode, 0, result.stderr)
  return result.stdout
}

function inbox(brain: string): string[] {
  return fs.readdirSync(path.join(brain, "inbox")).filter((name) => name !== ".gitkeep").sort()
}

function jpeg(width: number, height: number): Buffer {
  const data = Buffer.alloc(width * height * 4, 200)
  return Buffer.from(encode({ data, width, height }, 80).data)
}

const reader = (text: string) => ({
  calls: [] as Buffer[],
  async readImage(image: Buffer) {
    this.calls.push(image)
    return text
  },
})

test("typed text becomes a desktop Dump named from its time, committed alone", async () => {
  const brain = await setup()
  const before = (await git(brain, "rev-list", "--count", "HEAD")).trim()

  const result = await quickCapture(brain, { text: "  call the dentist\n" }, { now })

  assert.deepEqual(result, { ok: true })
  assert.deepEqual(inbox(brain), ["2026-10-21-140000-desktop.md"])
  assert.equal(
    fs.readFileSync(path.join(brain, "inbox", "2026-10-21-140000-desktop.md"), "utf8"),
    ["---", "captured: 2026-10-21T14:00:00+06:00", "device: desktop", "kind: text", "---", "call the dentist", ""].join("\n"),
  )
  assert.equal((await git(brain, "rev-list", "--count", "HEAD")).trim(), String(Number(before) + 1))
  assert.equal((await git(brain, "log", "-1", "--format=%s")).trim(), "capture: 2026-10-21-140000-desktop")
  assert.equal((await git(brain, "status", "--porcelain")).trim(), "")
  assert.equal(fs.existsSync(path.join(brain, ".state", "2026-10-21-140000-desktop.md")), false)
})

test("a pasted link is a link Dump with its url", async () => {
  const brain = await setup()

  await quickCapture(brain, { text: "https://example.com/post?a=1" }, { now })

  const [dump] = listInbox(brain)
  assert.equal(dump.kind, "link")
  assert.equal(dump.device, "desktop")
  assert.match(fs.readFileSync(path.join(brain, "inbox", `${dump.name}.md`), "utf8"), /^url: https:\/\/example\.com\/post\?a=1$/m)
})

test("two Dumps in the same second get different names and a commit each", async () => {
  const brain = await setup()

  await quickCapture(brain, { text: "one" }, { now })
  await quickCapture(brain, { text: "two" }, { now })

  assert.deepEqual(inbox(brain), ["2026-10-21-140000-desktop.md", "2026-10-21-140001-desktop.md"])
  assert.deepEqual((await git(brain, "log", "-2", "--format=%s")).trim().split("\n"), [
    "capture: 2026-10-21-140001-desktop",
    "capture: 2026-10-21-140000-desktop",
  ])
})

test("nothing typed and no image saves nothing", async () => {
  const brain = await setup()

  const result = await quickCapture(brain, { text: "  \n " }, { now })

  assert.equal(result.ok, false)
  assert.deepEqual(inbox(brain), [])
})

test("an image becomes a JPEG about 1200 px wide beside a Dump holding its text and the caption", async () => {
  const brain = await setup()
  const media = reader("a receipt for 12 dollars")

  const result = await quickCapture(brain, { text: "lunch", image: jpeg(2400, 1200) }, { now, media })

  assert.deepEqual(result, { ok: true })
  assert.deepEqual(inbox(brain), ["2026-10-21-140000-desktop.jpg", "2026-10-21-140000-desktop.md"])
  const saved = decode(fs.readFileSync(path.join(brain, "inbox", "2026-10-21-140000-desktop.jpg")), { useTArray: true })
  assert.deepEqual([saved.width, saved.height], [1200, 600])
  assert.equal(media.calls.length, 1)
  assert.equal(decode(media.calls[0], { useTArray: true }).width, 1200)
  assert.equal(
    fs.readFileSync(path.join(brain, "inbox", "2026-10-21-140000-desktop.md"), "utf8"),
    [
      "---",
      "captured: 2026-10-21T14:00:00+06:00",
      "device: desktop",
      "kind: image",
      "image: 2026-10-21-140000-desktop.jpg",
      "---",
      "lunch",
      "",
      "## Image text",
      "",
      "a receipt for 12 dollars",
      "",
    ].join("\n"),
  )
  assert.equal((await git(brain, "log", "-1", "--format=%s")).trim(), "capture: 2026-10-21-140000-desktop")
  assert.equal((await git(brain, "show", "--name-only", "--format=", "HEAD")).trim().split("\n").length, 2)
})

test("a small image keeps its size", async () => {
  const brain = await setup()

  await quickCapture(brain, { text: "", image: jpeg(300, 200) }, { now, media: reader("") })

  const saved = decode(fs.readFileSync(path.join(brain, "inbox", "2026-10-21-140000-desktop.jpg")), { useTArray: true })
  assert.deepEqual([saved.width, saved.height], [300, 200])
})

test("an image that cannot be read saves nothing and says why", async () => {
  const brain = await setup()

  const failing = await quickCapture(brain, { text: "", image: jpeg(10, 10) }, {
    now,
    media: {
      async readImage() {
        throw new Error("503")
      },
    },
  })
  const noEngine = await quickCapture(brain, { text: "", image: jpeg(10, 10) }, { now })
  const notAJpeg = await quickCapture(brain, { text: "", image: Buffer.from("not an image") }, { now, media: reader("x") })

  for (const result of [failing, noEngine, notAJpeg]) assert.equal(result.ok, false)
  assert.deepEqual(inbox(brain), [])
  assert.equal((await git(brain, "status", "--porcelain")).trim(), "")
})

test("during an Ingest the Dump waits in the Inbox uncommitted, and the next commit takes it", async () => {
  const brain = await setup()
  const unlock = lockBrain(brain)!

  const result = await quickCapture(brain, { text: "while ingesting" }, { now })
  unlock()

  assert.deepEqual(result, { ok: true })
  assert.deepEqual(inbox(brain), ["2026-10-21-140000-desktop.md"])
  assert.match(await git(brain, "status", "--porcelain"), /inbox/)
  await commitNewDumps(brain)
  assert.equal((await git(brain, "status", "--porcelain")).trim(), "")
})

test("a Dump the drain left uncommitted is not swept into the capture commit", async () => {
  const brain = await setup()
  fs.writeFileSync(path.join(brain, "inbox", "2026-10-21-130000-telegram.md"), "---\ndevice: telegram\n---\nleft\n")

  await quickCapture(brain, { text: "mine" }, { now })

  assert.deepEqual((await git(brain, "show", "--name-only", "--format=", "HEAD")).trim().split("\n"), [
    "inbox/2026-10-21-140000-desktop.md",
  ])
})
