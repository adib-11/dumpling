import http from "node:http"
import type { AddressInfo } from "node:net"

// A fake Telegram Bot API. getUpdates serves the queued updates from the last confirmed offset on, like Telegram.
export type FakeBotApi = {
  url: string
  token: string
  updates: unknown[]
  confirmed: number
  calls: { method: string; params: Record<string, unknown> }[]
  close: () => Promise<void>
}

export async function fakeBotApi(token = "123:secret-token"): Promise<FakeBotApi> {
  const fake: FakeBotApi = {
    url: "",
    token,
    updates: [],
    confirmed: 0,
    calls: [],
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
  const server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", () => {
      const [, bot, method] = req.url?.split("/") ?? []
      const params = body ? JSON.parse(body) : {}
      fake.calls.push({ method, params })
      const reply = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" })
        res.end(JSON.stringify(payload))
      }
      if (bot !== `bot${fake.token}`) return reply(401, { ok: false, description: "Unauthorized" })
      if (method === "getUpdates") {
        if (typeof params.offset === "number") fake.confirmed = params.offset
        const result = fake.updates.filter((u) => (u as { update_id: number }).update_id >= fake.confirmed)
        return reply(200, { ok: true, result })
      }
      if (method === "getMe") return reply(200, { ok: true, result: { id: 123, username: "brain_bot" } })
      return reply(200, { ok: true, result: true })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return fake
}

export function message(
  updateId: number,
  messageId: number,
  date: number,
  fields: Record<string, unknown>,
  chat = 111,
): unknown {
  return {
    update_id: updateId,
    message: { message_id: messageId, date, chat: { id: chat, type: "private" }, ...fields },
  }
}
