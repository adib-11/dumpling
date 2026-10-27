import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  readBrainFolder,
  readEngineChoice,
  readTelegramChat,
  writeBrainFolder,
  writeEngineChoice,
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
})
