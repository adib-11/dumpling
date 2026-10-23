import fs from "node:fs"
import path from "node:path"

export function enableLinuxAutostart(configHome: string, execPath: string): void {
  const directory = path.join(configHome, "autostart")
  fs.mkdirSync(directory, { recursive: true })
  const exec = execPath.includes(" ") ? `"${execPath}"` : execPath
  const entry = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Second Brain",
    `Exec=${exec}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n")
  fs.writeFileSync(path.join(directory, "second-brain.desktop"), entry)
}
