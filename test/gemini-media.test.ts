import assert from "node:assert/strict"
import test from "node:test"
import { geminiTranscribe } from "../src/gemini-media"

const key = "gemini-test-key"

test("a voice note is sent to Gemini inline, with the key only in the header", async () => {
  let seen: { url: string; key: string | null; body: string } | undefined
  const fetchImpl: typeof fetch = async (url, init) => {
    seen = { url: String(url), key: new Headers(init?.headers).get("x-goog-api-key"), body: String(init?.body) }
    return Response.json({ candidates: [{ content: { parts: [{ text: "আজকে milk " }, { text: "কিনব" }] } }] })
  }

  assert.equal(await geminiTranscribe(key, "google/gemini-3.5-flash-lite", fetchImpl)(Buffer.from("OggS-voice")), "আজকে milk কিনব")
  assert.equal(seen?.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent")
  assert.equal(seen?.key, key)
  assert.equal(seen?.body.includes(key), false)
  const body = JSON.parse(seen?.body ?? "{}") as { contents: { parts: { inline_data?: { mime_type: string; data: string } }[] }[] }
  const audio = body.contents[0].parts.find((part) => part.inline_data)?.inline_data
  assert.deepEqual(audio, { mime_type: "audio/ogg", data: Buffer.from("OggS-voice").toString("base64") })
})

test("a failed or empty Gemini transcription is not kept as text", async () => {
  await assert.rejects(
    () => geminiTranscribe(key, "google/gemini-3.5-flash-lite", async () => new Response(key, { status: 400 }))(Buffer.from("OggS")),
    /Gemini transcription failed: 400/,
  )
  await assert.rejects(
    () => geminiTranscribe(key, "google/gemini-3.5-flash-lite", async () => Response.json({ candidates: [] }))(Buffer.from("OggS")),
    /empty transcript/,
  )
})
