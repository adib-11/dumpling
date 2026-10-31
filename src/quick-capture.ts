import fs from "node:fs"
import path from "node:path"
import { brainLocked } from "./brain-lock"
import { git } from "./create-second-brain"
import { downscaleJpeg, localTime, writeDump, type MediaReader } from "./drain-telegram"
import type { Outcome } from "./main-window"

// Quick capture (spec v0.2 §6): the Owner types, pastes a link or drops an image in the capture box, and it becomes
// a plain Dump with `device: desktop`, as a Telegram message does. An Addendum from the computer is out of v0.2.

export type CaptureInput = {
  // The Owner's words. With an image they are its caption.
  text: string
  // The image as a JPEG (the caller converts what the Owner pasted).
  image?: Buffer
}

export type CaptureOptions = {
  // Reads the text out of an image. Without it an image cannot be captured.
  media?: Pick<MediaReader, "readImage">
  now?: Date
}

// Saves one Dump and commits it alone (`capture: <name>`). During an Ingest or Undo the Dump waits in inbox/
// uncommitted, as a drained one does, and the next drain or Ingest commits it. Nothing is saved on an error.
export async function quickCapture(brain: string, input: CaptureInput, options: CaptureOptions = {}): Promise<Outcome> {
  const words = input.text.trim()
  if (words === "" && !input.image) return { ok: false, error: "Type something or paste an image." }
  try {
    const when = Math.floor((options.now ?? new Date()).getTime() / 1000)
    const stem = freeStem(brain, when)
    const files = input.image ? await saveImage(brain, stem, when, words, input.image, options.media) : saveText(brain, stem, when, words)
    if (!brainLocked(brain)) {
      await git(["add", "--", ...files], brain)
      await git(["commit", "-m", `capture: ${stem}`, "--no-gpg-sign", "--", ...files], brain)
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save the Dump." }
  }
}

function saveText(brain: string, stem: string, when: number, words: string): string[] {
  const url = /https?:\/\/\S+/.exec(words)?.[0]
  writeDump(brain, stem, render(when, url ? "link" : "text", words, url ? [`url: ${url}`] : []))
  return [`inbox/${stem}.md`]
}

async function saveImage(
  brain: string,
  stem: string,
  when: number,
  caption: string,
  image: Buffer,
  media: CaptureOptions["media"],
): Promise<string[]> {
  if (!media) throw new Error("Set up the Engine to read images.")
  let jpeg: Buffer
  try {
    jpeg = downscaleJpeg(image)
  } catch {
    throw new Error("Could not read that image. Use a JPEG or PNG.")
  }
  let text: string
  try {
    text = (await media.readImage(jpeg)).trim()
  } catch {
    throw new Error("Could not read the text in that image. Try again.")
  }
  const section = text ? `## Image text\n\n${text}` : ""
  const body = caption && section ? `${caption}\n\n${section}` : caption || section
  writeDump(brain, stem, render(when, "image", body, [`image: ${stem}.jpg`]), { name: `${stem}.jpg`, data: jpeg })
  return [`inbox/${stem}.jpg`, `inbox/${stem}.md`]
}

function render(when: number, kind: string, body: string, fields: string[]): string {
  return ["---", `captured: ${localTime(when).iso}`, "device: desktop", `kind: ${kind}`, ...fields, "---", body, ""].join("\n")
}

// A second Dump in the same second takes the next free second, as a drained message does.
function freeStem(brain: string, when: number): string {
  let stem = `${localTime(when).stem}-desktop`
  while (fs.existsSync(path.join(brain, "inbox", `${stem}.md`))) {
    when++
    stem = `${localTime(when).stem}-desktop`
  }
  return stem
}
