import { engineOf, missingKey, runEngine, textOf, type Engine } from "./engine"
import type { AgentRunner } from "./ingest-now"

// Runs the ask skill on one Recall or Persona question (spec §8). The answer is relayed verbatim:
// the skill cites Page names and ends it with "Filed up to <date>".

// A hung opencode would hold up the Telegram drain, so a question gets a bounded run.
const askTimeoutMs = 2 * 60 * 1000

export type AskResult = { status: "ok"; answer: string } | { status: "failed"; reason: string }

export async function askQuestion(options: {
  brain: string
  // The Engine, or an OpenAI key alone for the OpenAI Key Engine.
  engine?: Engine
  apiKey?: string
  question: string
  runner: AgentRunner
}): Promise<AskResult> {
  const engine = engineOf(options)
  const missing = missingKey(engine)
  if (missing) return { status: "failed", reason: missing }
  const secret = engine.key.trim()
  const question = secret === "" ? options.question : options.question.split(secret).join("[redacted]")
  const run = await runEngine(engine, options.runner, {
    args: [
      "--agent",
      "ask",
      "--format",
      "json",
      `Read .agents/skills/ask/SKILL.md and follow it. Answer this question: ${question}`,
    ],
    cwd: options.brain,
    signal: AbortSignal.timeout(askTimeoutMs),
  })
  if (run.code !== 0) return { status: "failed", reason: `runner exited ${run.code}` }
  const answer = textOf(run.stdout)
  if (answer.trim() === "") return { status: "failed", reason: "the runner returned no answer" }
  return { status: "ok", answer }
}
