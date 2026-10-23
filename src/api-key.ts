import fs from "node:fs"
import path from "node:path"

export type Cipher = {
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

export type KeyResult = { ok: true } | { ok: false; error: string }

const modelsUrl = "https://api.openai.com/v1/models"

export async function checkOpenAiKey(key: string, fetchImpl: typeof fetch = fetch): Promise<KeyResult> {
  const trimmed = key.trim()
  if (trimmed === "") return { ok: false, error: "Paste a key." }
  let response: Response
  try {
    response = await fetchImpl(modelsUrl, {
      method: "GET",
      redirect: "manual",
      headers: { Authorization: `Bearer ${trimmed}` },
    })
  } catch {
    return { ok: false, error: "Could not reach OpenAI." }
  }
  if (response.status === 200) return { ok: true }
  if (response.status === 401) return { ok: false, error: "That key was rejected." }
  return { ok: false, error: "Could not check the key." }
}

export function saveApiKey(file: string, key: string, cipher: Cipher): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, cipher.encryptString(key.trim()))
}

export function loadApiKey(file: string, cipher: Cipher): string | null {
  try {
    return cipher.decryptString(fs.readFileSync(file))
  } catch (error) {
    if (isCode(error, "ENOENT")) return null
    throw error
  }
}

export async function acceptApiKey(
  key: string,
  file: string,
  cipher: Cipher,
  fetchImpl: typeof fetch,
): Promise<KeyResult> {
  const checked = await checkOpenAiKey(key, fetchImpl)
  if (!checked.ok) return checked
  saveApiKey(file, key, cipher)
  return { ok: true }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}
