import { inflateSync } from "node:zlib"

export type Png = { width: number; height: number; rgba: Buffer }

// Reads an 8-bit RGBA, non-interlaced PNG, the only kind scripts/make-icons.js writes.
export function readPng(data: Buffer): Png {
  if (!data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error("not a PNG")
  }
  let offset = 8
  let width = 0
  let height = 0
  const idat: Buffer[] = []
  while (offset < data.length) {
    const length = data.readUInt32BE(offset)
    const type = data.toString("latin1", offset + 4, offset + 8)
    const body = data.subarray(offset + 8, offset + 8 + length)
    if (type === "IHDR") {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error("not 8-bit RGBA, non-interlaced")
    }
    if (type === "IDAT") idat.push(body)
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const rgba = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? rgba[y * stride + x - 4] : 0
      const up = y > 0 ? rgba[(y - 1) * stride + x] : 0
      const corner = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0
      rgba[y * stride + x] = (line[x] + predict(filter, left, up, corner)) & 0xff
    }
  }
  return { width, height, rgba }
}

function predict(filter: number, left: number, up: number, corner: number): number {
  if (filter === 0) return 0
  if (filter === 1) return left
  if (filter === 2) return up
  if (filter === 3) return (left + up) >> 1
  const guess = left + up - corner
  const [a, b, c] = [Math.abs(guess - left), Math.abs(guess - up), Math.abs(guess - corner)]
  return a <= b && a <= c ? left : b <= c ? up : corner
}

// The distinct colours of the pixels that are not fully transparent, as "r,g,b".
export function colours(png: Png): Set<string> {
  const seen = new Set<string>()
  for (let i = 0; i < png.rgba.length; i += 4) {
    if (png.rgba[i + 3] > 0) seen.add(`${png.rgba[i]},${png.rgba[i + 1]},${png.rgba[i + 2]}`)
  }
  return seen
}
