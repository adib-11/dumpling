import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { engineMedia, freeEngine, freeModels, keyEngine, keyProviders, missingKey, offeredProviders, openAiEngine, runCost, runEngine } from "../src/engine"
import type { AgentRun } from "../src/ingest-now"

const limit = '{"type":"error","error":{"name":"APIError","data":{"message":"Too Many Requests","statusCode":429,"responseBody":"{\\"type\\":\\"FreeUsageLimitError\\"}"}}}'
const gone = '{"type":"error","error":{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details."}}}'
const answer = '{"type":"text","part":{"type":"text","text":"ok"}}'

test("the Free Engine runs only the zero-retention free models, with no key in the environment", () => {
  assert.deepEqual(freeModels, ["opencode/deepseek-v4.1-flash-free", "opencode/glm-5.3-flash-free"])
  assert.deepEqual(freeEngine.models, freeModels)
})

test("a 429 on the default free model tries the fallback once", async () => {
  const calls: AgentRun[] = []
  const result = await runEngine(freeEngine, async (run) => {
    calls.push(run)
    return calls.length === 1 ? { code: 1, stdout: limit } : { code: 0, stdout: answer }
  }, { args: ["--format", "json", "hi"], cwd: "/brain", signal: new AbortController().signal })

  assert.equal(result.code, 0)
  assert.equal(result.unavailable, false)
  assert.deepEqual(calls.map((run) => run.args.slice(0, 3)), [
    ["run", "-m", freeModels[0]],
    ["run", "-m", freeModels[1]],
  ])
  assert.deepEqual(calls[0].args.slice(3), ["--format", "json", "hi"])
  assert.equal(calls[0].cwd, "/brain")
  assert.equal(calls[0].env.OPENAI_API_KEY, process.env.OPENAI_API_KEY)
})

test("when both free models are gone or limited, no other model is tried", async () => {
  const models: string[] = []
  const result = await runEngine(freeEngine, async (run) => {
    models.push(run.args[2])
    return { code: 1, stdout: models.length === 1 ? gone : limit }
  }, { args: ["hi"], cwd: "/brain", signal: new AbortController().signal })

  assert.deepEqual(models, [...freeModels])
  assert.equal(result.unavailable, true)
})

test("any other failure does not fall back", async () => {
  let runs = 0
  const result = await runEngine(freeEngine, async () => {
    runs++
    return { code: 3, stdout: "" }
  }, { args: ["hi"], cwd: "/brain", signal: new AbortController().signal })

  assert.equal(runs, 1)
  assert.equal(result.code, 3)
  assert.equal(result.unavailable, false)
})

test("the OpenAI Key Engine passes its key in the environment only", async () => {
  const calls: AgentRun[] = []
  await runEngine(openAiEngine("sk-test"), async (run) => {
    calls.push(run)
    return { code: 1, stdout: limit }
  }, { args: ["hi"], cwd: "/brain", signal: new AbortController().signal })

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, ["run", "-m", "openai/gpt-5.6-luna", "hi"])
  assert.equal(calls[0].env.OPENAI_API_KEY, "sk-test")
})

test("the Free Engine reads a photo's text through opencode with the image attached, and takes no audio", async () => {
  const jpeg = Buffer.from("fake-jpeg")
  let seen: { args: string[]; file: Buffer; cwd: string } | undefined
  const media = engineMedia(freeEngine, async (run) => {
    const file = path.join(run.cwd, run.args[run.args.indexOf("-f") + 1])
    seen = { args: run.args, file: fs.readFileSync(file), cwd: run.cwd }
    return { code: 0, stdout: '{"type":"text","part":{"type":"text","text":"Receipt total 42"}}\n' }
  })

  assert.equal(media.transcribe, undefined)
  assert.equal(await media.readImage(jpeg), "Receipt total 42")
  assert.deepEqual(seen?.args.slice(0, 5), ["run", "-m", freeModels[0], "--format", "json"])
  assert.equal(seen?.file.equals(jpeg), true)
  assert.equal(fs.existsSync(seen?.cwd ?? ""), false)
})

test("a failed photo read throws, so the drain keeps the photo in the chat", async () => {
  const media = engineMedia(freeEngine, async () => ({ code: 1, stdout: "" }))
  await assert.rejects(() => media.readImage(Buffer.from("x")), /image read failed/)
})

test("each Key Engine passes its key to opencode in its provider's environment variable only", async () => {
  const seen: AgentRun[] = []
  for (const provider of ["openai", "gemini", "anthropic", "openrouter"] as const) {
    await runEngine(keyEngine(provider, "key-secret"), async (run) => {
      seen.push(run)
      return { code: 0, stdout: answer }
    }, { args: ["hi"], cwd: "/brain", signal: new AbortController().signal })
  }

  assert.deepEqual(seen.map((run) => run.args[2]), [
    "openai/gpt-5.6-luna",
    "google/gemini-3.5-flash-lite",
    "anthropic/claude-haiku-5-5",
    "openrouter/openai/gpt-5.6-luna",
  ])
  assert.deepEqual(
    seen.map((run) => Object.keys(run.env).filter((name) => run.env[name] === "key-secret")),
    [["OPENAI_API_KEY"], ["GOOGLE_GENERATIVE_AI_API_KEY"], ["ANTHROPIC_API_KEY"], ["OPENROUTER_API_KEY"]],
  )
  assert.equal(seen.some((run) => run.args.join(" ").includes("key-secret")), false)
})

test("a Key Engine with no key cannot run, and names its provider", () => {
  assert.equal(missingKey(keyEngine("anthropic", " ")), "Anthropic API key is missing")
  assert.equal(missingKey(keyEngine("openai", "")), "OpenAI API key is missing")
  assert.equal(missingKey(freeEngine), undefined)
})

test("Gemini transcribes a voice note; Anthropic and OpenRouter take no audio and read photos through opencode", () => {
  const runner = async () => ({ code: 0, stdout: answer })
  assert.equal(typeof engineMedia(keyEngine("gemini", "g-key"), runner).transcribe, "function")
  assert.equal(engineMedia(keyEngine("anthropic", "a-key"), runner).transcribe, undefined)
  assert.equal(engineMedia(keyEngine("openrouter", "o-key"), runner).transcribe, undefined)
})

test("a photo on a Key Engine without its own image call is read through opencode on that Engine's model and key", async () => {
  let seen: AgentRun | undefined
  const media = engineMedia(keyEngine("anthropic", "a-key"), async (run) => {
    seen = run
    return { code: 0, stdout: '{"type":"text","part":{"type":"text","text":"Menu"}}\n' }
  })
  assert.equal(await media.readImage(Buffer.from("jpeg")), "Menu")
  assert.equal(seen?.args[2], "anthropic/claude-haiku-5-5")
  assert.equal(seen?.env.ANTHROPIC_API_KEY, "a-key")
})

test("a step's tokens are priced with its model's cost table; a step with no tokens keeps opencode's cost", () => {
  const step = (part: object) => JSON.stringify({ type: "step_finish", part })
  const stdout = [
    step({ tokens: { input: 1_000_000, output: 100_000, reasoning: 100_000, cache: { read: 1_000_000, write: 0 } }, cost: 9 }),
    step({ cost: 0.5 }),
    "not json",
  ].join("\n")
  // claude-haiku-5-5: $0.1 in, $0.5 out (reasoning too), $0.01 cache read, per million tokens.
  assert.equal(runCost(stdout, "anthropic/claude-haiku-5-5"), 0.1 + 0.1 + 0.01 + 0.5)
  assert.equal(runCost(stdout, "opencode/glm-5.3-flash-free"), 9.5)
})

test("every Key Engine has a default model and a cost table, and only a provider whose model passed the fixtures is offered", () => {
  for (const provider of Object.values(keyProviders)) {
    assert.match(provider.model, /^[a-z]+\/\S+$/)
    assert.equal(provider.prices.input > 0 && provider.prices.output > 0, true)
  }
  assert.deepEqual(
    offeredProviders().map((provider) => provider.id),
    Object.entries(keyProviders).filter(([, provider]) => provider.fixtures !== null).map(([id]) => id),
  )
  assert.equal(offeredProviders().some((provider) => provider.id === "openai"), true)
})
