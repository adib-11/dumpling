import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { acceptApiKey, checkKey, checkOpenAiKey, keyFileName, loadApiKey, type Cipher } from "../src/api-key"

const key = "sk-test-secret-not-real"

function xorCipher(): Cipher {
  const mask = 0x5a
  return {
    encryptString(plain: string): Buffer {
      const bytes = Buffer.from(plain, "utf8")
      return Buffer.from(bytes.map((byte) => byte ^ mask))
    },
    decryptString(encrypted: Buffer): string {
      return Buffer.from(encrypted.map((byte) => byte ^ mask)).toString("utf8")
    },
  }
}

test("the key check is one call and the key stays out of the URL and the error", async () => {
  const seen: { url?: string; authorization?: string } = {}
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.url = String(input)
    const headers = new Headers(init?.headers)
    seen.authorization = headers.get("authorization") ?? ""
    return new Response(JSON.stringify({ error: `echo ${key}` }), { status: 401 })
  }
  const rejected = await checkOpenAiKey(key, fetchImpl)
  assert.deepEqual(rejected, { ok: false, error: "OpenAI rejected that key." })
  assert.equal(rejected.ok === false && rejected.error.includes(key), false)
  assert.equal(seen.url, "https://api.openai.com/v1/models")
  assert.equal(seen.url?.includes(key), false)
  assert.equal(seen.authorization, `Bearer ${key}`)

  const offline: typeof fetch = async () => {
    throw new Error(`network ${key}`)
  }
  const down = await checkOpenAiKey(key, offline)
  assert.deepEqual(down, { ok: false, error: "Could not reach OpenAI." })

  const okFetch: typeof fetch = async () => new Response("{}", { status: 200 })
  assert.deepEqual(await checkOpenAiKey(`  ${key}  `, okFetch), { ok: true })
  assert.deepEqual(await checkOpenAiKey("  ", okFetch), { ok: false, error: "Paste a key." })
})

test("the saved key is ciphertext and round-trips", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "api-key-")), "openai-key.bin")
  const cipher = xorCipher()
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), "brain-"))
  const saved = await acceptApiKey("openai", key, file, cipher, async () => new Response("{}", { status: 200 }))
  assert.deepEqual(saved, { ok: true })
  assert.equal(fs.readFileSync(file).includes(Buffer.from(key)), false)
  assert.equal(loadApiKey(file, cipher), key)
  assert.equal(loadApiKey(path.join(brain, "missing.bin"), cipher), null)

  const rejected = await acceptApiKey("openai", key, file, cipher, async () => new Response("no", { status: 401 }))
  assert.equal(rejected.ok, false)
})

test("each provider's key is checked with one call to that provider, and a bad key names the provider", async () => {
  const seen: { url: string; headers: Headers }[] = []
  const reject = (status: number): typeof fetch => async (input, init) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) })
    return new Response(JSON.stringify({ error: { message: `bad ${key}` } }), { status })
  }

  assert.deepEqual(await checkKey("gemini", key, reject(400)), { ok: false, error: "Gemini rejected that key." })
  assert.deepEqual(await checkKey("anthropic", key, reject(401)), { ok: false, error: "Anthropic rejected that key." })
  assert.deepEqual(await checkKey("openrouter", key, reject(401)), { ok: false, error: "OpenRouter rejected that key." })
  assert.deepEqual(await checkKey("gemini", key, reject(403)), { ok: false, error: "Gemini rejected that key." })
  assert.deepEqual(await checkKey("anthropic", key, reject(500)), { ok: false, error: "Could not check the key with Anthropic." })
  assert.deepEqual(await checkKey("openrouter", key, reject(400)), { ok: false, error: "Could not check the key with OpenRouter." })

  assert.deepEqual(seen.slice(0, 3).map((call) => call.url), [
    "https://generativelanguage.googleapis.com/v1beta/models",
    "https://api.anthropic.com/v1/models",
    "https://openrouter.ai/api/v1/key",
  ])
  assert.equal(seen[0].headers.get("x-goog-api-key"), key)
  assert.equal(seen[1].headers.get("x-api-key"), key)
  assert.equal(seen[1].headers.get("anthropic-version"), "2023-06-01")
  assert.equal(seen[2].headers.get("authorization"), `Bearer ${key}`)
  assert.equal(seen.some((call) => call.url.includes(key)), false)

  const offline: typeof fetch = async () => {
    throw new Error("offline")
  }
  assert.deepEqual(await checkKey("openrouter", key, offline), { ok: false, error: "Could not reach OpenRouter." })
  assert.deepEqual(await checkKey("gemini", key, async () => new Response("{}", { status: 200 })), { ok: true })
})

test("each provider's key is kept in its own file, and OpenAI keeps the file it had", () => {
  assert.equal(keyFileName("openai"), "openai-key.bin")
  assert.equal(keyFileName("gemini"), "gemini-key.bin")
})
