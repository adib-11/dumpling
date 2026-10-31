import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { enableLinuxAutostart } from "../src/login-item"

test("Linux login writes an XDG autostart entry that runs the AppImage", () => {
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), "xdg-config-"))
  enableLinuxAutostart(configHome, "/home/ada/Dumpling 0.2.AppImage")

  assert.equal(
    fs.readFileSync(path.join(configHome, "autostart", "dumpling.desktop"), "utf8"),
    [
      "[Desktop Entry]",
      "Type=Application",
      "Name=Dumpling",
      'Exec="/home/ada/Dumpling 0.2.AppImage"',
      "Terminal=false",
      "X-GNOME-Autostart-enabled=true",
      "",
    ].join("\n"),
  )
})

test("Linux login keeps the no-FUSE launch for the next boot", () => {
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), "xdg-config-"))
  enableLinuxAutostart(configHome, "/home/ada/Dumpling.AppImage", true)

  const entry = fs.readFileSync(path.join(configHome, "autostart", "dumpling.desktop"), "utf8")
  assert.match(entry, /^Exec=env APPIMAGE_EXTRACT_AND_RUN=1 "\/home\/ada\/Dumpling\.AppImage"$/m)
})

test("Linux login escapes Desktop Entry reserved characters in the path", () => {
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), "xdg-config-"))
  enableLinuxAutostart(configHome, '/home/ada/100% "$HOME`\\.AppImage')

  const entry = fs.readFileSync(path.join(configHome, "autostart", "dumpling.desktop"), "utf8")
  assert.ok(entry.includes('Exec="/home/ada/100%% \\\\"\\\\$HOME\\\\`\\\\\\\\.AppImage"\n'), entry)
})

test("Linux login removes the autostart entry from before the rename", () => {
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), "xdg-config-"))
  fs.mkdirSync(path.join(configHome, "autostart"))
  fs.writeFileSync(path.join(configHome, "autostart", "second-brain.desktop"), "[Desktop Entry]\nName=Second Brain\n")
  enableLinuxAutostart(configHome, "/home/ada/Dumpling.AppImage")

  assert.deepEqual(fs.readdirSync(path.join(configHome, "autostart")), ["dumpling.desktop"])
})
