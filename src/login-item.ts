import fs from "node:fs"
import path from "node:path"

export function enableLinuxAutostart(
  configHome: string,
  execPath: string,
  extractAndRun = false,
): void {
  const directory = path.join(configHome, "autostart")
  fs.mkdirSync(directory, { recursive: true })
  // Desktop Entry quoting: escape " ` $ \ inside quotes, then the string-level \ escape, and % as %%.
  const quoted = `"${execPath.replace(/[\\"`$]/g, "\\$&")}"`.replace(/\\/g, "\\\\").replace(/%/g, "%%")
  const exec = extractAndRun ? `env APPIMAGE_EXTRACT_AND_RUN=1 ${quoted}` : quoted
  const entry = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Dumpling",
    `Exec=${exec}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n")
  fs.writeFileSync(path.join(directory, "dumpling.desktop"), entry)
  // The entry the app wrote as Second Brain would start the old AppImage too.
  fs.rmSync(path.join(directory, "second-brain.desktop"), { force: true })
}
