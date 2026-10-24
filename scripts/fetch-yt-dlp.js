const { spawnSync } = require("node:child_process")
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

// yt-dlp reads YouTube captions, and it needs deno to solve YouTube's JavaScript.
// Pinned releases, each checked against the SHA-256 its release publishes.
const ytDlpVersion = "2026.10.21"
const denoVersion = "v2.9.7"
const builds = {
  darwin: {
    ytDlp: ["yt-dlp_macos", "7a6fe71d7d680f1fb0ac18d4949873d77db2859e90017c0f44bd94b23be4ee40"],
    deno: ["deno-aarch64-apple-darwin.zip", "5cd46d6268f6f78f5d88bdc7159d20bd44cdaa4b3303474839f87ec6fe7ae25c"],
  },
  linux: {
    ytDlp: ["yt-dlp_linux", "d8bd33fca9d5b23bd5b9952b3fca36db5c46331933fda9f598a3da14ce2c243f"],
    deno: ["deno-x86_64-unknown-linux-gnu.zip", "c6527f24f4b16031d3ae4fa9f658d5f11534c8d84ce7dc8502420280919c3490"],
  },
  win32: {
    ytDlp: ["yt-dlp.exe", "33121d192d706e62f684a06f80918e3f3a8ba52ac3a65213b6951c39c7d9f555"],
    deno: ["deno-x86_64-pc-windows-msvc.zip", "a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238"],
  },
}

async function download(url, sha256) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const got = crypto.createHash("sha256").update(bytes).digest("hex")
  if (got !== sha256) throw new Error(`${url}: SHA-256 ${got}, expected ${sha256}`)
  return bytes
}

function version(bin) {
  const check = spawnSync(bin, ["--version"], { encoding: "utf8" })
  if (check.status !== 0) throw new Error(check.stderr || `${bin} --version failed`)
  return String(check.stdout).trim().split("\n")[0]
}

async function main() {
  const build = builds[process.platform]
  if (!build) throw new Error(`No yt-dlp and deno build for ${process.platform}`)
  const exe = process.platform === "win32" ? ".exe" : ""

  const ytDlpDir = path.join("vendor", "yt-dlp")
  const ytDlp = path.join(ytDlpDir, `yt-dlp${exe}`)
  const [ytDlpFile, ytDlpSum] = build.ytDlp
  fs.mkdirSync(ytDlpDir, { recursive: true })
  fs.writeFileSync(
    ytDlp,
    await download(`https://github.com/yt-dlp/yt-dlp/releases/download/${ytDlpVersion}/${ytDlpFile}`, ytDlpSum),
  )
  fs.chmodSync(ytDlp, 0o700)

  const denoDir = path.join("vendor", "deno")
  const [zipFile, zipSum] = build.deno
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deno-fetch-"))
  try {
    const zip = path.join(tmp, zipFile)
    fs.writeFileSync(
      zip,
      await download(`https://github.com/denoland/deno/releases/download/${denoVersion}/${zipFile}`, zipSum),
    )
    fs.mkdirSync(denoDir, { recursive: true })
    // Windows' own tar reads zip files; Git's tar, which may come first on PATH, does not.
    // Unix calls /usr/bin/unzip by absolute path so PATH is not searched.
    const unzip =
      process.platform === "win32"
        ? spawnSync(path.join(process.env.SystemRoot, "System32", "tar.exe"), ["-xf", zip, "-C", denoDir], { stdio: "inherit" })
        : spawnSync("/usr/bin/unzip", ["-o", "-q", zip, "-d", denoDir], { stdio: "inherit" })
    if (unzip.status !== 0) throw new Error(`could not unzip ${zipFile}`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  const deno = path.join(denoDir, `deno${exe}`)
  fs.chmodSync(deno, 0o700)

  console.log(`yt-dlp ${version(ytDlp)}`)
  console.log(version(deno))
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
