import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { loadApiKey, type Cipher } from "../src/api-key"
import { readBrainFolder, readEngineChoice, readTelegramChat } from "../src/brain-config"
import { moveSettings } from "../src/settings-move"

// Each cipher stands for one app name's keychain entry: what one seals, the other cannot open.
function cipher(mask: number): Cipher {
  const flip = (bytes: Buffer) => Buffer.from(bytes.map((byte) => byte ^ mask))
  return {
    encryptString: (plain) => flip(Buffer.from(plain, "utf8")),
    decryptString: (sealed) => flip(sealed).toString("utf8"),
  }
}

const oldCipher = cipher(0x11)
const newCipher = cipher(0x5a)
const key = "sk-test-not-real"
const token = "123456:test-token-not-real"

function oldInstall(): { from: string; to: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "app-data-"))
  const from = path.join(root, "second-brain-app")
  const to = path.join(root, "Dumpling")
  fs.mkdirSync(from)
  fs.writeFileSync(
    path.join(from, "config.json"),
    JSON.stringify({ brainFolder: "/home/ada/Documents/Second Brain", engine: "openai", telegramChat: 42 }),
  )
  fs.writeFileSync(path.join(from, "openai-key.bin"), oldCipher.encryptString(key))
  fs.writeFileSync(path.join(from, "telegram-token"), oldCipher.encryptString(token))
  return { from, to }
}

// What the app's child process does: open each old secret with the old app name's keychain entry.
function readWithOldName(from: string) {
  return async (names: string[]) =>
    Object.fromEntries(names.map((name) => [name, oldCipher.decryptString(fs.readFileSync(path.join(from, name)))]))
}

test("an install from before the rename keeps its folder, Engine, chat, key and token", async () => {
  const { from, to } = oldInstall()

  const result = await moveSettings({ from, to, readOld: readWithOldName(from), cipher: newCipher })

  assert.deepEqual(result, { moved: true, lost: [] })
  const config = path.join(to, "config.json")
  assert.equal(readBrainFolder(config), "/home/ada/Documents/Second Brain")
  assert.equal(readEngineChoice(config), "openai")
  assert.equal(readTelegramChat(config), 42)
  assert.equal(loadApiKey(path.join(to, "openai-key.bin"), newCipher), key)
  assert.equal(newCipher.decryptString(fs.readFileSync(path.join(to, "telegram-token"))), token)
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(to, "telegram-token")).mode & 0o777, 0o600)
    assert.equal(fs.statSync(path.join(to, "openai-key.bin")).mode & 0o777, 0o600)
  }
  // Moved, not copied: an old copy of the app still installed must not poll the same bot.
  assert.deepEqual(fs.readdirSync(from), [])
})

test("the move runs once and never overwrites the new settings", async () => {
  const { from, to } = oldInstall()
  fs.mkdirSync(to)
  fs.writeFileSync(path.join(to, "config.json"), JSON.stringify({ brainFolder: "/home/ada/Documents/Dumpling" }))
  let asked = false
  const readOld = async () => {
    asked = true
    return {}
  }

  assert.deepEqual(await moveSettings({ from, to, readOld, cipher: newCipher }), { moved: false, lost: [] })
  assert.equal(asked, false)
  assert.equal(readBrainFolder(path.join(to, "config.json")), "/home/ada/Documents/Dumpling")
  assert.equal(fs.existsSync(path.join(from, "telegram-token")), true)
})

test("a new install has nothing to move", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "app-data-"))
  const to = path.join(root, "Dumpling")
  const result = await moveSettings({ from: path.join(root, "second-brain-app"), to, readOld: async () => ({}), cipher: newCipher })
  assert.deepEqual(result, { moved: false, lost: [] })
  assert.equal(fs.existsSync(to), false)
})

test("a secret the old name cannot open is named, and the old folder keeps everything", async () => {
  const { from, to } = oldInstall()
  // The keychain refused the token, say: only the key opened.
  const readOld = async () => ({ "openai-key.bin": key })

  const result = await moveSettings({ from, to, readOld, cipher: newCipher })

  assert.deepEqual(result, { moved: true, lost: ["telegram-token"] })
  assert.equal(readBrainFolder(path.join(to, "config.json")), "/home/ada/Documents/Second Brain")
  assert.equal(loadApiKey(path.join(to, "openai-key.bin"), newCipher), key)
  assert.equal(fs.existsSync(path.join(to, "telegram-token")), false)
  assert.deepEqual(fs.readdirSync(from).sort(), ["config.json", "openai-key.bin", "telegram-token"])
})

test("a reader that fails loses every secret but keeps the folder", async () => {
  const { from, to } = oldInstall()
  const readOld = async () => {
    throw new Error("child process exited 1")
  }

  const result = await moveSettings({ from, to, readOld, cipher: newCipher })

  assert.deepEqual(result, { moved: true, lost: ["openai-key.bin", "telegram-token"] })
  assert.equal(readBrainFolder(path.join(to, "config.json")), "/home/ada/Documents/Second Brain")
})

test("without a keychain no secret is read or written", async () => {
  const { from, to } = oldInstall()
  let asked = false
  const readOld = async () => {
    asked = true
    return {}
  }

  const result = await moveSettings({ from, to, readOld, cipher: null })

  assert.equal(asked, false)
  assert.deepEqual(result, { moved: true, lost: ["openai-key.bin", "telegram-token"] })
  assert.deepEqual(fs.readdirSync(to), ["config.json"])
})
