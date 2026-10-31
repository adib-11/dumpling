import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { trayHealth, trayIcon, trayMenuItems } from "../src/tray-menu"
import { colours, readPng, type Png } from "./png"

test("the tray menu opens Dumpling, reports a problem and quits before first run is done", () => {
  assert.deepEqual(trayMenuItems(null), [
    { label: "Open Dumpling", action: "open", enabled: true },
    { label: "Report a problem", action: "report", enabled: true },
    { label: "Quit", action: "quit", enabled: true },
  ])

  assert.deepEqual(trayMenuItems("/home/ada/Documents/Dumpling"), [
    { label: "Open Dumpling", action: "open", enabled: true },
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
  assert.deepEqual(trayMenuItems("/home/ada/Documents/Dumpling", false, "Voice note not transcribed"), [
    { label: "Open Dumpling", action: "open", enabled: true },
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

test("the tray menu shows a failed backup push", () => {
  assert.deepEqual(trayMenuItems("/home/ada/Documents/Dumpling", true), [
    { label: "Open Dumpling", action: "open", enabled: true },
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

const assets = path.join(__dirname, "..", "assets")
const states = ["ok", "failing", "not-drained"] as const

test("the Mac tray icon is one colour, so macOS can tint it, at 22 x 16 with a Retina copy, for each state", () => {
  const drawn = new Set<string>()
  for (const state of states) {
    const icon = trayIcon(state, "darwin")
    assert.equal(icon.template, true)
    const file = path.join(assets, icon.file)
    assert.match(icon.file, /Template\.png$/, "Electron also treats a *Template file as a template image")
    const one = readPng(fs.readFileSync(file))
    const two = readPng(fs.readFileSync(file.replace(/\.png$/, "@2x.png")))
    assert.deepEqual([one.width, one.height, two.width, two.height], [22, 16, 44, 32])
    assert.deepEqual([...colours(one)], ["0,0,0"])
    assert.deepEqual([...colours(two)], ["0,0,0"])
    drawn.add(two.rgba.toString("base64"))
  }
  assert.equal(drawn.size, 3, "failing and not drained differ from ok, and from each other, in shape")
})

test("the Windows and Linux tray icons are the colour logo, with a red dot for failing and an amber dot for not drained", () => {
  const ok = readPng(fs.readFileSync(path.join(assets, trayIcon("ok", "linux").file)))
  const failing = readPng(fs.readFileSync(path.join(assets, trayIcon("failing", "linux").file)))
  const notDrained = readPng(fs.readFileSync(path.join(assets, trayIcon("not-drained", "linux").file)))
  const corner = (png: Png) => {
    const at = ((png.height - 5) * png.width + (png.width - 5)) * 4
    return [...png.rgba.subarray(at, at + 4)]
  }
  assert.deepEqual(corner(failing), [0xd3, 0x2f, 0x2f, 255])
  assert.deepEqual(corner(notDrained), [0xe8, 0x9b, 0x00, 255])
  assert.notDeepEqual(corner(ok), corner(failing))
  assert.ok(colours(ok).size > 10, "the logo, not a one-colour glyph")

  for (const state of states) {
    const icon = trayIcon(state, "win32")
    assert.equal(icon.template, false)
    assert.match(icon.file, /\.ico$/)
    assert.equal(fs.readFileSync(path.join(assets, icon.file)).readUInt16LE(2), 1)
    assert.equal(trayIcon(state, "linux").template, false)
  }
})
