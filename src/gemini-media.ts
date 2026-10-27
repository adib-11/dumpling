const prompt = "Transcribe this voice note exactly, in the language or languages spoken. Reply with the transcript only."

// The Owner's Gemini key, already read from the OS keychain. It is sent only as a header. `model` is the Gemini
// Key Engine's, as opencode names it (google/<id>).
export function geminiTranscribe(key: string, model: string, fetchImpl: typeof fetch = fetch): (audio: Buffer) => Promise<string> {
  const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model.replace(/^google\//, "")}:generateContent`
  return async (audio) => {
    const response = await fetchImpl(generateUrl, {
      method: "POST",
      redirect: "manual",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "audio/ogg", data: audio.toString("base64") } }] }],
      }),
    })
    if (response.status !== 200) throw new Error(`Gemini transcription failed: ${response.status}`)
    const json = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("").trim()
    if (!text) throw new Error("empty transcript")
    return text
  }
}
