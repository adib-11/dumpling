import type { AgentRunner } from "./ingest-now"

// Runs the ask skill on one Recall or Persona question (spec §8). The answer is relayed verbatim:
// the skill cites Page names and ends it with "Filed up to <date>".

// A hung opencode would hold up the Telegram drain, so a question gets a bounded run.
const askTimeoutMs = 2 * 60 * 1000

export type AskResult = { status: "ok"; answer: string } | { status: "failed"; reason: string }

export async function askQuestion(options: {
  brain: string
  apiKey: string
  question: string
  runner: AgentRunner
}): Promise<AskResult> {
  const secret = options.apiKey.trim()
  if (secret === "") return { status: "failed", reason: "OpenAI API key is missing" }
  const question = options.question.split(secret).join("[redacted]")
  const run = await options.runner({
    args: [
      "run",
      "-m",
      "openai/gpt-5.6-luna",
      "--agent",
      "ask",
      "--format",
      "json",
      `Read .agents/skills/ask/SKILL.md and follow it. Answer this question: ${question}`,
    ],
    env: { ...process.env, OPENAI_API_KEY: options.apiKey },
    cwd: options.brain,
    signal: AbortSignal.timeout(askTimeoutMs),
  })
  if (run.code !== 0) return { status: "failed", reason: `runner exited ${run.code}` }
  const answer = answerFromStdout(run.stdout)
  if (answer.trim() === "") return { status: "failed", reason: "the runner returned no answer" }
  return { status: "ok", answer }
}

// opencode streams one JSON event per line and emits only finished assistant text parts: a part must
// carry a time.end to be emitted, and the user's prompt part never gets one, so every text event here
// is a piece of the answer.
function answerFromStdout(stdout: string): string {
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
