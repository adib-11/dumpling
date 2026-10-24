import assert from "node:assert/strict"
import test from "node:test"
import { openAiMedia } from "../src/openai-media"

const key = "sk-test-voice"

test("a voice note is sent to gpt-transcribe and a photo to the image model, with the key only in the header", async () => {
  const seen: { url: string; auth: string }[] = []
  const fetchImpl: typeof fetch = async (url, init) => {
    const auth = new Headers(init?.headers).get("authorization") ?? ""
    const target = String(url)
    seen.push({ url: target, auth })
    if (init?.body instanceof FormData) {
      assert.equal(init.body.get("model"), "gpt-transcribe")
      assert.equal(init.body.get("response_format"), "text")
      const file = init.body.get("file")
      assert.ok(file instanceof Blob)
      assert.equal(await file.text(), "OggS-voice")
      return new Response("আজকে milk কিনব", { status: 200 })
    }
    const json = JSON.parse(String(init?.body)) as {
      model?: string
      messages?: { content?: { type?: string; image_url?: { url?: string } }[] }[]
    }
    assert.equal(json.model, "gpt-5.6-luna")
    assert.equal(JSON.stringify(json).includes(key), false)
    const image = json.messages?.[0]?.content?.find((part) => part.type === "image_url")?.image_url?.url ?? ""
    assert.equal(image, `data:image/jpeg;base64,${Buffer.from("jpeg-bytes").toString("base64")}`)
    return new Response(JSON.stringify({ choices: [{ message: { content: "রসিদ\nReceipt total 42" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }

  const media = openAiMedia(key, fetchImpl)

  assert.equal(await media.transcribe(Buffer.from("OggS-voice")), "আজকে milk কিনব")
  assert.equal(await media.readImage(Buffer.from("jpeg-bytes")), "রসিদ\nReceipt total 42")
  assert.deepEqual(
    seen.map((call) => call.url),
    ["https://api.openai.com/v1/audio/transcriptions", "https://api.openai.com/v1/chat/completions"],
  )
  assert.deepEqual(
    seen.map((call) => call.auth),
    [`Bearer ${key}`, `Bearer ${key}`],
  )
})

test("a failed transcription response is not kept as text", async () => {
  const fetchImpl: typeof fetch = async () => new Response("sk-test-voice", { status: 500 })
  await assert.rejects(() => openAiMedia(key, fetchImpl).transcribe(Buffer.from("OggS")), /gpt-transcribe failed: 500/)
})
