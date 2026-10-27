import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { MediaReader } from "./drain-telegram"
import type { AgentRun, AgentRunner } from "./ingest-now"
import { openAiMedia } from "./openai-media"

// The free models whose terms say zero retention and no training (spec §3), the default first and the fallback
// second, as scripts/ingest-fixtures.js ranked them on 2026-10-27 (deepseek 57/58 checks; glm 54/58, after a
// first run that filed nothing). A model leaves this list when its terms change.
export const freeModels = ["opencode/deepseek-v4.1-flash-free", "opencode/glm-5.3-flash-free"] as const

// The model that runs Ingest, Ask and the photo and voice reader. `models` are tried in order; only a 429 or a
// gone model moves to the next.
export type Engine = { name: "free" | "openai"; models: readonly string[]; key: string }

export const freeEngine: Engine = { name: "free", models: freeModels, key: "" }

export function openAiEngine(key: string): Engine {
  return { name: "openai", models: ["openai/gpt-5.6-luna"], key }
}

// An OpenAI key alone, as Ingest and Ask took before Engines, is the OpenAI Key Engine.
export function engineOf(options: { engine?: Engine; apiKey?: string }): Engine {
  return options.engine ?? openAiEngine(options.apiKey ?? "")
}

// Why a Key Engine cannot run, before any call. The Free Engine always can.
export function missingKey(engine: Engine): string | undefined {
  return engine.name === "openai" && engine.key.trim() === "" ? "OpenAI API key is missing" : undefined
}

// One `opencode run` on one model. The key goes in the environment, never in the arguments.
export function engineRun(engine: Engine, model: string, args: string[], cwd: string, signal: AbortSignal): AgentRun {
  const env = engine.name === "openai" ? { ...process.env, OPENAI_API_KEY: engine.key } : { ...process.env }
  return { args: ["run", "-m", model, ...args], env, cwd, signal }
}

// opencode reports a 429 (FreeUsageLimitError on the free models) and a gone model as an error event; a gone
// model shows only as UnknownError on stdout.
// ponytail: opencode retries a 429 itself, honouring Retry-After, so a long wait ends as a timeout, not a fallback.
export function unavailable(stdout: string): boolean {
  for (const line of stdout.split("\n")) {
    if (!line.includes('"type":"error"')) continue
    if (/"statusCode":429|FreeUsageLimitError|ModelNotFound|"name":"UnknownError"/.test(line)) return true
  }
  return false
}

// Runs a prompt with no side effects worth undoing on the Engine, trying each of its models at most once.
// `unavailable` is true when every model was limited or gone.
export async function runEngine(
  engine: Engine,
  runner: AgentRunner,
  run: { args: string[]; cwd: string; signal: AbortSignal },
): Promise<{ code: number; stdout: string; unavailable: boolean }> {
  const outputs: string[] = []
  let code = 1
  for (const model of engine.models) {
    const result = await runner(engineRun(engine, model, run.args, run.cwd, run.signal))
    outputs.push(result.stdout)
    code = result.code
    if (code === 0 || run.signal.aborted || !unavailable(result.stdout)) {
      return { code, stdout: outputs.join("\n"), unavailable: false }
    }
  }
  return { code, stdout: outputs.join("\n"), unavailable: true }
}

// opencode streams one JSON event per line and emits only finished assistant text parts: a part must
// carry a time.end to be emitted, and the user's prompt part never gets one, so every text event here
// is a piece of the answer.
export function textOf(stdout: string): string {
  const parts: string[] = []
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue
    try {
      const event = JSON.parse(line) as { type?: string; part?: { text?: unknown } }
      if (event.type === "text" && typeof event.part?.text === "string") parts.push(event.part.text)
    } catch {
      // The runner's other lines are not the answer.
    }
  }
  return parts.join("\n").trim()
}

const imagePrompt =
  "Transcribe the text in this image exactly, keeping each script as written. Reply with the text only. If there is no text, reply with nothing."
const imageTimeoutMs = 2 * 60 * 1000

// The photo and voice reader. A Key Engine calls its provider directly. The Free Engine reads a photo through
// the same opencode run, with the image attached, in an empty folder so no brain config or file is in reach;
// it takes no audio, so it has no transcribe.
export function engineMedia(engine: Engine, runner: AgentRunner): MediaReader {
  if (engine.name === "openai") return openAiMedia(engine.key)
  return {
    async readImage(jpeg) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "second-brain-image-"))
      try {
        fs.writeFileSync(path.join(dir, "photo.jpg"), jpeg)
        const run = await runEngine(engine, runner, {
          args: ["--format", "json", imagePrompt, "-f", "photo.jpg"],
          cwd: dir,
          signal: AbortSignal.timeout(imageTimeoutMs),
        })
        if (run.code !== 0) throw new Error(`image read failed: runner exited ${run.code}`)
        return textOf(run.stdout)
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    },
  }
}
