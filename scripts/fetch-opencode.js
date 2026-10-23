const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const version = "1.19.4"
const name = process.platform === "win32" ? "opencode.exe" : "opencode"
const destDir = path.join("vendor", "opencode")
const dest = path.join(destDir, name)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-fetch-"))

try {
  const install = spawnSync("npm", ["install", "--prefix", tmp, `opencode-ai@${version}`], {
    stdio: "inherit",
    shell: true,
  })
  if (install.status !== 0) process.exit(install.status ?? 1)
  const src = path.join(tmp, "node_modules", "opencode-ai", "bin", "opencode.exe")
  fs.mkdirSync(destDir, { recursive: true })
  fs.copyFileSync(src, dest)
  fs.chmodSync(dest, 0o755)
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

const check = spawnSync(dest, ["--version"], { encoding: "utf8" })
if (check.status !== 0) {
  console.error(check.stderr || "opencode --version failed")
  process.exit(check.status ?? 1)
}
console.log(String(check.stdout).trim())
