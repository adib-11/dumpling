import assert from "node:assert/strict"
import test from "node:test"
import { trayMenuItems } from "../src/tray-menu"

test("the tray menu quits, and offers setup until a folder is chosen", () => {
  assert.deepEqual(trayMenuItems(null, false), [
    { label: "Choose folder…", action: "setup", enabled: true },
    { label: "Quit", action: "quit", enabled: true },
  ])

  assert.deepEqual(trayMenuItems("/home/ada/Documents/Second Brain", true), [
    { label: "/home/ada/Documents/Second Brain", enabled: false },
    { label: "Quit", action: "quit", enabled: true },
  ])
})

test("the tray menu offers to connect Telegram until a chat is connected", () => {
  assert.deepEqual(trayMenuItems("/home/ada/Documents/Second Brain", false), [
    { label: "/home/ada/Documents/Second Brain", enabled: false },
    { label: "Connect Telegram…", action: "setup", enabled: true },
    { label: "Quit", action: "quit", enabled: true },
  ])
})
