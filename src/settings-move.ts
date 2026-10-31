import fs from "node:fs"
import path from "node:path"
import { type Cipher } from "./api-key"

// The app was named second-brain-app before Dumpling, so its settings folder was <appData>/second-brain-app.
export const oldAppName = "second-brain-app"

const configName = "config.json"

// The files sealed with safeStorage: the bot token and one key file per provider.
export function isSecretName(name: string): boolean {
  return name === "telegram-token" || /^[a-z]+-key\.bin$/.test(name)
}

export type MoveResult = { moved: boolean; lost: string[] }

// Moves an install's settings from the old settings folder to the new one, once. The second brain folder
// stays where it is: config.json still names it. safeStorage seals with a key per app name, so `readOld`
// opens the old secrets under the old name and `cipher` seals them again under the new one. A null cipher
// means no keychain to seal with. config.json is written last, so a move cut short runs again.
export async function moveSettings(options: {
  from: string
  to: string
  readOld: (names: string[]) => Promise<Record<string, string>>
  cipher: Cipher | null
}): Promise<MoveResult> {
  const { from, to, cipher } = options
  const oldConfig = path.join(from, configName)
  if (fs.existsSync(path.join(to, configName)) || !fs.existsSync(oldConfig)) return { moved: false, lost: [] }

  const secrets = fs.readdirSync(from).filter(isSecretName).sort()
  let opened: Record<string, string> = {}
  if (cipher && secrets.length > 0) {
    try {
      opened = await options.readOld(secrets)
    } catch {
      opened = {}
    }
  }
  fs.mkdirSync(to, { recursive: true })
  const lost: string[] = []
  for (const name of secrets) {
    const plain = opened[name]
    if (!cipher || typeof plain !== "string" || !seal(path.join(to, name), plain, cipher)) lost.push(name)
  }
  fs.copyFileSync(oldConfig, path.join(to, configName))
  // With every secret moved, the old folder gives up its settings. With one lost, it keeps them all.
  if (lost.length === 0) {
    for (const name of [...secrets, configName]) fs.rmSync(path.join(from, name), { force: true })
  }
  return { moved: true, lost }
}

// Writes the sealed secret and reads it back, so nothing leaves the old folder until the new copy opens.
function seal(file: string, plain: string, cipher: Cipher): boolean {
  try {
    fs.writeFileSync(file, cipher.encryptString(plain), { mode: 0o600 })
    return cipher.decryptString(fs.readFileSync(file)) === plain
  } catch {
    fs.rmSync(file, { force: true })
    return false
  }
}
