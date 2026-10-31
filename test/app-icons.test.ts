import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { readPng } from "./png"

const root = path.join(__dirname, "..")
const build = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).build

// Apple's icns element types that hold a PNG, and the pixel size of each.
const icnsSizes: Record<string, number> = {
  icp4: 16,
  icp5: 32,
  icp6: 64,
  ic07: 128,
  ic08: 256,
  ic09: 512,
  ic10: 1024,
  ic11: 32,
  ic12: 64,
  ic13: 256,
  ic14: 512,
}

test("the Mac app icon holds every size macOS uses, 16 to 1024 px", () => {
  const data = fs.readFileSync(path.join(root, build.mac.icon))
  assert.equal(data.toString("latin1", 0, 4), "icns")
  assert.equal(data.readUInt32BE(4), data.length)
  const found: Record<string, number> = {}
  for (let offset = 8; offset < data.length; ) {
    const type = data.toString("latin1", offset, offset + 4)
    const length = data.readUInt32BE(offset + 4)
    const png = readPng(data.subarray(offset + 8, offset + length))
    assert.equal(png.width, png.height, type)
    found[type] = png.width
    offset += length
  }
  assert.deepEqual(found, icnsSizes)
})

test("the Windows app icon holds 16 to 256 px", () => {
  const data = fs.readFileSync(path.join(root, build.win.icon))
  assert.equal(data.readUInt16LE(2), 1, "an icon, not a cursor")
  const sizes: number[] = []
  for (let i = 0; i < data.readUInt16LE(4); i++) {
    const entry = 6 + i * 16
    const size = data[entry] || 256
    const png = readPng(data.subarray(data.readUInt32LE(entry + 12), data.readUInt32LE(entry + 12) + data.readUInt32LE(entry + 8)))
    assert.equal(png.width, size)
    assert.equal(png.height, size)
    sizes.push(size)
  }
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256])
})

test("the Linux app icons are one PNG per size, 16 to 512 px, named NxN", () => {
  const folder = path.join(root, build.linux.icon)
  const sizes = [16, 32, 48, 64, 128, 256, 512]
  assert.deepEqual(fs.readdirSync(folder).sort(), sizes.map((size) => `${size}x${size}.png`).sort())
  for (const size of sizes) {
    const png = readPng(fs.readFileSync(path.join(folder, `${size}x${size}.png`)))
    assert.deepEqual([png.width, png.height], [size, size])
  }
})
