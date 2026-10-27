import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createSecondBrain } from "../src/create-second-brain"
import { askQuestion, type AskResult } from "../src/ask"
import { freeEngine, freeModels } from "../src/engine"
import type { AgentRun } from "../src/ingest-now"

const templates = path.join(__dirname, "..", "templates")
const key = "sk-test-secret-not-real"

async function brain(): Promise<string> {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "ask-"))
  await createSecondBrain(folder, templates)
  return folder
}

test("ask runs the ask skill through opencode and returns the answer from its text events", async () => {
  const folder = await brain()
  const calls: AgentRun[] = []
  const result = await askQuestion({
    brain: folder,
    apiKey: key,
    question: "what do I think about mechanical keyboards?",
    runner: async (run) => {
      calls.push(run)
      return {
        code: 0,
        stdout: [
          '{"type":"step_start","part":{}}',
          '{"type":"text","part":{"type":"text","text":"Recall."}}',
          '{"type":"tool_use","part":{"tool":"read"}}',
          '{"type":"text","part":{"type":"text","text":"You like them ([[mechanical-keyboards]]).\\n\\nFiled up to 2026-10-23"}}',
          '{"type":"step_finish","part":{"cost":0.01}}',
          "not json",
        ].join("\n"),
      }
    },
  })

  assert.deepEqual(result, {
    status: "ok",
    answer: "Recall.\nYou like them ([[mechanical-keyboards]]).\n\nFiled up to 2026-10-23",
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, [
    "run",
    "-m",
    "openai/gpt-5.6-luna",
    "--agent",
    "ask",
    "--format",
    "json",
    "Read .agents/skills/ask/SKILL.md and follow it. Answer this question: what do I think about mechanical keyboards?",
  ])
  assert.equal(calls[0].cwd, folder)
  assert.equal(calls[0].env.OPENAI_API_KEY, key)
  assert.equal(calls[0].args.some((arg) => arg.includes(key)), false)
})

test("a failed run reports why, and an answer with no text is not ok", async () => {
  const folder = await brain()
  const failed: AskResult = await askQuestion({
    brain: folder,
    apiKey: key,
    question: "what do I know about X?",
    runner: async () => ({ code: 1, stdout: '{"type":"error","error":{}}' }),
  })
  assert.deepEqual(failed, { status: "failed", reason: "runner exited 1" })

  const silent: AskResult = await askQuestion({
    brain: folder,
    apiKey: key,
    question: "what do I know about X?",
    runner: async () => ({ code: 0, stdout: '{"type":"step_finish","part":{"cost":0}}' }),
  })
  assert.deepEqual(silent, { status: "failed", reason: "the runner returned no answer" })
})

test("a missing key fails before the runner starts", async () => {
  const folder = await brain()
  let ran = false
  const result = await askQuestion({
    brain: folder,
    apiKey: " ",
    question: "what do I know about X?",
    runner: async () => {
      ran = true
      return { code: 0, stdout: "" }
    },
  })
  assert.equal(ran, false)
  assert.deepEqual(result, { status: "failed", reason: "OpenAI API key is missing" })
})

test("a question that quotes the key is not passed to the runner as an argument", async () => {
  const folder = await brain()
  const prompts: string[] = []
  const result = await askQuestion({
    brain: folder,
    apiKey: key,
    question: `what did I say about ${key}?`,
    runner: async (run) => {
      prompts.push(run.args.at(-1) ?? "")
      return { code: 0, stdout: `{"type":"text","part":{"type":"text","text":"Nothing."}}` }
    },
  })
  assert.equal(result.status, "ok")
  assert.equal(prompts[0].includes(key), false)
  assert.equal(prompts[0].includes("[redacted]"), true)
})

test("with Start free and no key, /ask answers from the Pages, on the fallback when the default is limited", async () => {
  const folder = await brain()
  const calls: AgentRun[] = []
  const result = await askQuestion({
    brain: folder,
    engine: freeEngine,
    question: "what do I think about tea?",
    runner: async (run) => {
      calls.push(run)
      return calls.length === 1
        ? { code: 1, stdout: '{"type":"error","error":{"name":"APIError","data":{"statusCode":429}}}' }
        : { code: 0, stdout: '{"type":"text","part":{"type":"text","text":"You like it ([[tea]])."}}' }
    },
  })

  assert.deepEqual(result, { status: "ok", answer: "You like it ([[tea]])." })
  assert.deepEqual(calls.map((run) => run.args.slice(0, 5)), [
    ["run", "-m", freeModels[0], "--agent", "ask"],
    ["run", "-m", freeModels[1], "--agent", "ask"],
  ])
  assert.equal(calls[1].cwd, folder)
})
