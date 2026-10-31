import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  readBrainFolder,
  readCaptureShortcut,
  readEngineChoice,
  readOpenAtLogin,
  readTelegramChat,
  writeBrainFolder,
  writeCaptureShortcut,
  writeEngineChoice,
  writeOpenAtLogin,
  writeTelegramChat,
} from "../src/brain-config"

test("the chosen folder is remembered", () => {
  const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "brain-config-")), "config.json")
  assert.equal(readBrainFolder(configPath), null)

  writeBrainFolder(configPath, "/home/ada/Documents/Second Brain")

  assert.equal(readBrainFolder(configPath), "/home/ada/Documents/Second Brain")
})

test("a corrupt config is treated as no folder", () => {
  const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "brain-config-")), "config.json")
  fs.writeFileSync(configPath, "{")
  assert.equal(readBrainFolder(configPath), null)
})

test("the connected chat is remembered alongside the folder", () => {
  const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "brain-config-")), "config.json")
  writeBrainFolder(configPath, "/home/ada/Documents/Second Brain")
  assert.equal(readTelegramChat(configPath), null)

  writeTelegramChat(configPath, 111)

  assert.equal(readTelegramChat(configPath), 111)
  assert.equal(readBrainFolder(configPath), "/home/ada/Documents/Second Brain")
})

test("the chosen Engine is remembered, and none is chosen at first", () => {
  const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "brain-config-")), "config.json")
  writeBrainFolder(configPath, "/home/ada/Documents/Second Brain")
  assert.equal(readEngineChoice(configPath), null)

  writeEngineChoice(configPath, "free")

  assert.equal(readEngineChoice(configPath), "free")
  assert.equal(readBrainFolder(configPath), "/home/ada/Documents/Second Brain")
  writeEngineChoice(configPath, "openai")
  assert.equal(readEngineChoice(configPath), "openai")
  writeEngineChoice(configPath, "gemini")
  assert.equal(readEngineChoice(configPath), "gemini")
  fs.writeFileSync(configPath, JSON.stringify({ engine: "mistral" }))
  assert.equal(readEngineChoice(configPath), null)
})

test("open at login is on until the Owner turns it off", () => {
  const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "brain-config-")), "config.json")
  writeBrainFolder(configPath, "/home/ada/Documents/Dumpling")
  assert.equal(readOpenAtLogin(configPath), true)

  writeOpenAtLogin(configPath, false)

  assert.equal(readOpenAtLogin(configPath), false)
  assert.equal(readBrainFolder(configPath), "/home/ada/Documents/Dumpling")
  writeOpenAtLogin(configPath, true)
  assert.equal(readOpenAtLogin(configPath), true)
})

test("the capture shortcut is the default until the Owner changes it, and a bad stored one is ignored", () => {
  const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "brain-config-")), "config.json")
  writeBrainFolder(configPath, "/home/ada/Documents/Dumpling")
  assert.equal(readCaptureShortcut(configPath), "Control+Alt+Space")

  writeCaptureShortcut(configPath, "Control+Alt+K")

  assert.equal(readCaptureShortcut(configPath), "Control+Alt+K")
  assert.equal(readBrainFolder(configPath), "/home/ada/Documents/Dumpling")
  fs.writeFileSync(configPath, JSON.stringify({ captureShortcut: "K" }))
  assert.equal(readCaptureShortcut(configPath), "Control+Alt+Space")
})
