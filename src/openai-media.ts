import type { MediaReader } from "./drain-telegram"

const transcribeUrl = "https://api.openai.com/v1/audio/transcriptions"
const imageUrl = "https://api.openai.com/v1/chat/completions"
const imageModel = "gpt-5.6-luna"

// The Owner's key, already read from the OS keychain. It is sent only as a header.
export function openAiMedia(key: string, fetchImpl: typeof fetch = fetch): Required<MediaReader> {
  return {
    async transcribe(audio: Buffer) {
      const body = new FormData()
      body.append("model", "gpt-transcribe")
      body.append("response_format", "text")
      body.append("file", new Blob([new Uint8Array(audio)], { type: "audio/ogg" }), "voice.ogg")
      const response = await fetchImpl(transcribeUrl, {
        method: "POST",
        redirect: "manual",
        headers: { Authorization: `Bearer ${key}` },
        body,
      })
      if (response.status !== 200) throw new Error(`gpt-transcribe failed: ${response.status}`)
      const text = (await response.text()).trim()
      if (!text) throw new Error("empty transcript")
      return text
    },
    async readImage(jpeg: Buffer) {
      const response = await fetchImpl(imageUrl, {
        method: "POST",
        redirect: "manual",
        headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: imageModel,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Transcribe the text in this image exactly, keeping each script as written. Reply with the text only. If there is no text, reply with nothing.",
                },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } },
              ],
            },
          ],
        }),
      })
      if (response.status !== 200) throw new Error(`image read failed: ${response.status}`)
      const json = (await response.json()) as { choices?: { message?: { content?: string } }[] }
      return json.choices?.[0]?.message?.content?.trim() ?? ""
    },
  }
}
