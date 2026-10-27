import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { MediaReader } from "./drain-telegram"
import type { AgentRun, AgentRunner } from "./ingest-now"
import { geminiTranscribe } from "./gemini-media"
import { openAiMedia } from "./openai-media"

// The free models whose terms say zero retention and no training (spec §3), the default first and the fallback
// second, as scripts/ingest-fixtures.js ranked them on 2026-10-27 (deepseek 57/58 checks; glm 54/58, after a
// first run that filed nothing). A model leaves this list when its terms change.
export const freeModels = ["opencode/deepseek-v4.1-flash-free", "opencode/glm-5.3-flash-free"] as const

// USD per million tokens, from opencode's models.dev catalogue on 2026-10-27. Reasoning is priced as output.
// ponytail: the long-context tiers are not priced, so a prompt over 100k (Haiku) or 272k (GPT) tokens is under-costed.
type Prices = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Provider = "openai" | "gemini" | "anthropic" | "openrouter"

// `fixtures` is the default model's v1 fixture pass rate from scripts/ingest-fixtures.js; setup offers a provider
// only once it has one. `audio` is true when the Key Engine transcribes a voice note.
type KeyProvider = {
  label: string
  model: string
  env: string
  keysUrl: string
  prices: Prices
  fixtures: string | null
  audio: boolean
}

// The Key Engines: each one's default model, the env variable opencode reads its key from, and its cost table.
export const keyProviders: Record<Provider, KeyProvider> = {
  openai: {
    label: "OpenAI",
    model: "openai/gpt-5.6-luna",
    env: "OPENAI_API_KEY",
    keysUrl: "https://platform.openai.com/api-keys",
    prices: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
    fixtures: "shipped in v0.1 on the v1 fixture run (shareable §1); no pass rate was kept",
    audio: true,
  },
  gemini: {
    label: "Gemini",
    model: "google/gemini-3.5-flash-lite",
    env: "GOOGLE_GENERATIVE_AI_API_KEY",
    keysUrl: "https://aistudio.google.com/apikey",
    prices: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
    // 2026-10-27: 13 Dumps filed in 1.5 min for $0.10; the miss was a Bangla quote without an English gloss.
    fixtures: "57/58",
    audio: true,
  },
  anthropic: {
    label: "Anthropic",
    model: "anthropic/claude-haiku-5-5",
    env: "ANTHROPIC_API_KEY",
    keysUrl: "https://console.anthropic.com/settings/keys",
    prices: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    fixtures: null,
    audio: false,
  },
  openrouter: {
    label: "OpenRouter",
    model: "openrouter/openai/gpt-5.6-luna",
    env: "OPENROUTER_API_KEY",
    keysUrl: "https://openrouter.ai/settings/keys",
    prices: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
    fixtures: null,
    audio: false,
  },
}

export function isProvider(name: unknown): name is Provider {
  return typeof name === "string" && Object.hasOwn(keyProviders, name)
}

// The providers setup offers, in order.
export function offeredProviders(): { id: Provider; label: string; model: string; audio: boolean }[] {
  return Object.entries(keyProviders)
    .filter(([, provider]) => provider.fixtures !== null)
    .map(([id, provider]) => ({ id: id as Provider, label: provider.label, model: provider.model, audio: provider.audio }))
}

// The model that runs Ingest, Ask and the photo and voice reader. `models` are tried in order; only a 429 or a
// gone model moves to the next.
export type Engine = { name: "free" | Provider; models: readonly string[]; key: string }

export const freeEngine: Engine = { name: "free", models: freeModels, key: "" }

export function keyEngine(provider: Provider, key: string): Engine {
  return { name: provider, models: [keyProviders[provider].model], key }
}

export function openAiEngine(key: string): Engine {
  return keyEngine("openai", key)
}

// An OpenAI key alone, as Ingest and Ask took before Engines, is the OpenAI Key Engine.
export function engineOf(options: { engine?: Engine; apiKey?: string }): Engine {
  return options.engine ?? openAiEngine(options.apiKey ?? "")
}

// Why a Key Engine cannot run, before any call. The Free Engine always can.
export function missingKey(engine: Engine): string | undefined {
  if (engine.name === "free" || engine.key.trim() !== "") return undefined
  return `${keyProviders[engine.name].label} API key is missing`
}

// One `opencode run` on one model. The key goes in the environment, never in the arguments.
export function engineRun(engine: Engine, model: string, args: string[], cwd: string, signal: AbortSignal): AgentRun {
  const env = engine.name === "free" ? { ...process.env } : { ...process.env, [keyProviders[engine.name].env]: engine.key }
  return { args: ["run", "-m", model, ...args], env, cwd, signal }
}

type Tokens = { input: number; output: number; reasoning?: number; cache?: { read?: number; write?: number } }

// The cost of one run on `model`. A step's tokens are priced with the model's cost table, so the cost does not
// depend on opencode's catalogue; a step with no tokens, or a model with no table, keeps opencode's cost.
export function runCost(stdout: string, model: string): number {
  const prices = Object.values(keyProviders).find((provider) => provider.model === model)?.prices
  let sum = 0
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue
    try {
      const event = JSON.parse(line) as { type?: string; part?: { cost?: number; tokens?: Tokens } }
      if (event.type !== "step_finish") continue
      const tokens = event.part?.tokens
      if (prices && tokens) {
        sum +=
          (tokens.input * prices.input +
            (tokens.output + (tokens.reasoning ?? 0)) * prices.output +
            (tokens.cache?.read ?? 0) * prices.cacheRead +
            (tokens.cache?.write ?? 0) * prices.cacheWrite) /
          1e6
      } else if (typeof event.part?.cost === "number") sum += event.part.cost
    } catch {
      // The runner's other lines are not a cost.
    }
  }
  return sum
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

// The photo and voice reader. OpenAI reads both with direct calls. Any other Engine reads a photo through the
// same opencode run, with the image attached, in an empty folder so no brain config or file is in reach. Of
// those, only Gemini takes audio (keyProviders' `audio`), with a direct call; the rest have no transcribe.
export function engineMedia(engine: Engine, runner: AgentRunner): MediaReader {
  if (engine.name === "openai") return openAiMedia(engine.key)
  const reader: MediaReader = {
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
  return engine.name === "gemini" ? { ...reader, transcribe: geminiTranscribe(engine.key, engine.models[0]) } : reader
}
