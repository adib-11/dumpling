import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { enableLinuxAutostart } from "../src/login-item"

test("Linux login writes an XDG autostart entry that runs the AppImage", () => {
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), "xdg-config-"))
  enableLinuxAutostart(configHome, "/home/ada/Second Brain.AppImage")

  assert.equal(
    fs.readFileSync(path.join(configHome, "autostart", "second-brain.desktop"), "utf8"),
    [
      "[Desktop Entry]",
      "Type=Application",
      "Name=Second Brain",
      'Exec="/home/ada/Second Brain.AppImage"',
      "Terminal=false",
      "X-GNOME-Autostart-enabled=true",
      "",
    ].join("\n"),
  )
})

test("Linux login keeps the no-FUSE launch for the next boot", () => {
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), "xdg-config-"))
  enableLinuxAutostart(configHome, "/home/ada/Second-Brain.AppImage", true)

  const entry = fs.readFileSync(path.join(configHome, "autostart", "second-brain.desktop"), "utf8")
  assert.match(entry, /^Exec=env APPIMAGE_EXTRACT_AND_RUN=1 \/home\/ada\/Second-Brain\.AppImage$/m)
})
