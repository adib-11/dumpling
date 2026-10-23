import assert from "node:assert/strict"
import test from "node:test"
import { trayHealth, trayMenuItems } from "../src/tray-menu"

test("the tray menu quits, and offers setup until a folder is chosen", () => {
  assert.deepEqual(trayMenuItems(null, false), [
    { label: "Choose folder…", action: "setup", enabled: true },
    { label: "Quit", action: "quit", enabled: true },
  ])

  assert.deepEqual(trayMenuItems("/home/ada/Documents/Second Brain", true), [
    { label: "/home/ada/Documents/Second Brain", enabled: false },
    { label: "Ingest now", action: "ingest", enabled: true },
    { label: "Undo last Ingest", action: "undo", enabled: true },
    { label: "Quit", action: "quit", enabled: true },
  ])
})

test("the tray menu offers to connect Telegram until a chat is connected", () => {
  assert.deepEqual(trayMenuItems("/home/ada/Documents/Second Brain", false), [
    { label: "/home/ada/Documents/Second Brain", enabled: false },
    { label: "Ingest now", action: "ingest", enabled: true },
    { label: "Undo last Ingest", action: "undo", enabled: true },
    { label: "Connect Telegram…", action: "setup", enabled: true },
    { label: "Quit", action: "quit", enabled: true },
  ])
})

test("the tray shows failing after a failed Ingest, and not drained after 20 h without a drain", () => {
  const now = new Date("2026-10-23T12:00:00Z")
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600 * 1000)

  assert.equal(trayHealth("ok", hoursAgo(1), now), "ok")
  assert.equal(trayHealth(null, null, now), "ok")
  assert.equal(trayHealth("failed", hoursAgo(1), now), "failing")
  assert.equal(trayHealth("ok", hoursAgo(19.9), now), "ok")
  assert.equal(trayHealth("ok", hoursAgo(20.1), now), "not-drained")
  assert.equal(trayHealth("failed", hoursAgo(21), now), "failing")
})
