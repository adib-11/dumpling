import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { acceptApiKey, checkOpenAiKey, loadApiKey, type Cipher } from "../src/api-key"

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
  assert.deepEqual(rejected, { ok: false, error: "That key was rejected." })
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
  const saved = await acceptApiKey(key, file, cipher, async () => new Response("{}", { status: 200 }))
  assert.deepEqual(saved, { ok: true })
  assert.equal(fs.readFileSync(file).includes(Buffer.from(key)), false)
  assert.equal(loadApiKey(file, cipher), key)
  assert.equal(loadApiKey(path.join(brain, "missing.bin"), cipher), null)

  const rejected = await acceptApiKey(key, file, cipher, async () => new Response("no", { status: 401 }))
  assert.equal(rejected.ok, false)
})
