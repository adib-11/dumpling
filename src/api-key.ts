import fs from "node:fs"
import path from "node:path"
import { keyProviders, type Provider } from "./engine"

export type Cipher = {
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

export type KeyResult = { ok: true } | { ok: false; error: string }

// One cheap call per provider that only a good key passes. The key goes in a header, never the URL.
// `rejected` are the statuses that mean a bad key: Gemini answers 400 API_KEY_INVALID, or 403 for a key without
// the API.
const keyChecks: Record<Provider, { url: string; headers: (key: string) => Record<string, string>; rejected?: number[] }> = {
  openai: { url: "https://api.openai.com/v1/models", headers: (key) => ({ Authorization: `Bearer ${key}` }) },
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/models", headers: (key) => ({ "x-goog-api-key": key }), rejected: [400, 401, 403] },
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  },
  openrouter: { url: "https://openrouter.ai/api/v1/key", headers: (key) => ({ Authorization: `Bearer ${key}` }) },
}

// The error never quotes the provider's reply, which may echo part of the key.
export async function checkKey(provider: Provider, key: string, fetchImpl: typeof fetch = fetch): Promise<KeyResult> {
  const trimmed = key.trim()
  if (trimmed === "") return { ok: false, error: "Paste a key." }
  const { label } = keyProviders[provider]
  let response: Response
  try {
    response = await fetchImpl(keyChecks[provider].url, {
      method: "GET",
      redirect: "manual",
      headers: keyChecks[provider].headers(trimmed),
    })
  } catch {
    return { ok: false, error: `Could not reach ${label}.` }
  }
  if (response.status === 200) return { ok: true }
  if ((keyChecks[provider].rejected ?? [401, 403]).includes(response.status)) return { ok: false, error: `${label} rejected that key.` }
  return { ok: false, error: `Could not check the key with ${label}.` }
}

export function checkOpenAiKey(key: string, fetchImpl: typeof fetch = fetch): Promise<KeyResult> {
  return checkKey("openai", key, fetchImpl)
}

// In the app's settings folder. OpenAI keeps the file it had before there were other providers.
export function keyFileName(provider: Provider): string {
  return `${provider}-key.bin`
}

export function saveApiKey(file: string, key: string, cipher: Cipher): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, cipher.encryptString(key.trim()), { mode: 0o600 })
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
  provider: Provider,
  key: string,
  file: string,
  cipher: Cipher,
  fetchImpl: typeof fetch,
): Promise<KeyResult> {
  const checked = await checkKey(provider, key, fetchImpl)
  if (!checked.ok) return checked
  saveApiKey(file, key, cipher)
  return { ok: true }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}
