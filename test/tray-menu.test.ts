import assert from "node:assert/strict"
import test from "node:test"
import { trayHealth, trayMenuItems } from "../src/tray-menu"

test("the tray menu quits, reports a problem, and offers setup until a folder is chosen", () => {
  assert.deepEqual(trayMenuItems(null, false), [
    { label: "Choose folder…", action: "setup", enabled: true },
    { label: "Report a problem", action: "report", enabled: true },
    { label: "Quit", action: "quit", enabled: true },
  ])

  assert.deepEqual(trayMenuItems("/home/ada/Documents/Dumpling", true), [
    { label: "/home/ada/Documents/Dumpling", enabled: false },
    { label: "Ingest now", action: "ingest", enabled: true },
    { label: "Undo last Ingest", action: "undo", enabled: true },
    { label: "Ask…", action: "ask", enabled: true },
    { label: "Backup remote…", action: "remote", enabled: true },
    { label: "Report a problem", action: "report", enabled: true },
    { label: "Quit", action: "quit", enabled: true },
  ])
})

test("the tray shows a voice note that could not be transcribed", () => {
  assert.deepEqual(trayMenuItems("/home/ada/Documents/Dumpling", true, false, "Voice note not transcribed"), [
    { label: "/home/ada/Documents/Dumpling", enabled: false },
    { label: "Voice note not transcribed", enabled: false },
    { label: "Ingest now", action: "ingest", enabled: true },
    { label: "Undo last Ingest", action: "undo", enabled: true },
    { label: "Ask…", action: "ask", enabled: true },
    { label: "Backup remote…", action: "remote", enabled: true },
    { label: "Report a problem", action: "report", enabled: true },
    { label: "Quit", action: "quit", enabled: true },
  ])
})

test("the tray menu offers to connect Telegram until a chat is connected", () => {
  assert.deepEqual(trayMenuItems("/home/ada/Documents/Dumpling", false), [
    { label: "/home/ada/Documents/Dumpling", enabled: false },
    { label: "Ingest now", action: "ingest", enabled: true },
    { label: "Undo last Ingest", action: "undo", enabled: true },
    { label: "Ask…", action: "ask", enabled: true },
    { label: "Connect Telegram…", action: "setup", enabled: true },
    { label: "Backup remote…", action: "remote", enabled: true },
    { label: "Report a problem", action: "report", enabled: true },
    { label: "Quit", action: "quit", enabled: true },
  ])
})

test("the tray menu shows a failed backup push", () => {
  assert.deepEqual(trayMenuItems("/home/ada/Documents/Dumpling", true, true), [
    { label: "/home/ada/Documents/Dumpling", enabled: false },
    { label: "Backup push failed", enabled: false },
    { label: "Ingest now", action: "ingest", enabled: true },
    { label: "Undo last Ingest", action: "undo", enabled: true },
    { label: "Ask…", action: "ask", enabled: true },
    { label: "Backup remote…", action: "remote", enabled: true },
    { label: "Report a problem", action: "report", enabled: true },
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
