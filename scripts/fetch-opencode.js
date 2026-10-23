const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

function npmCli() {
  const binDir = path.dirname(process.execPath)
  const candidates = [
    path.join(binDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(binDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ]
  const found = candidates.find((file) => fs.existsSync(file))
  if (!found) {
    console.error("npm-cli.js was not next to this Node install")
    process.exit(1)
  }
  return found
}

const version = "1.19.4"
const name = process.platform === "win32" ? "opencode.exe" : "opencode"
const destDir = path.join("vendor", "opencode")
const dest = path.join(destDir, name)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-fetch-"))

try {
  const install = spawnSync(process.execPath, [npmCli(), "install", "--prefix", tmp, `opencode-ai@${version}`], {
    stdio: "inherit",
  })
  if (install.status !== 0) process.exit(install.status ?? 1)
  const src = path.join(tmp, "node_modules", "opencode-ai", "bin", "opencode.exe")
  fs.mkdirSync(destDir, { recursive: true })
  fs.copyFileSync(src, dest)
  fs.chmodSync(dest, 0o700)
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

const check = spawnSync(dest, ["--version"], { encoding: "utf8" })
if (check.status !== 0) {
  console.error(check.stderr || "opencode --version failed")
  process.exit(check.status ?? 1)
}
console.log(String(check.stdout).trim())
