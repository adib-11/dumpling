import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { readBrainFolder, writeBrainFolder } from "../src/brain-config"

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
