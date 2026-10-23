// The Owner's own Telegram bot, through the Bot API.

export type TelegramFile = {
  file_id: string
  file_size?: number
  file_name?: string
  mime_type?: string
  width?: number
}

export type TelegramMessage = {
  message_id: number
  date: number
  chat: { id: number; type: string }
  text?: string
  caption?: string
  voice?: TelegramFile
  audio?: TelegramFile
  photo?: TelegramFile[]
  document?: TelegramFile
}

export type Bot = ((method: string, params?: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>) & {
  file(fileId: string): Promise<Buffer>
}

export type Update = {
  update_id: number
  message?: TelegramMessage
}

export const longPollSeconds = 25

export function telegramBot(token: string, base = "https://api.telegram.org"): Bot {
  // The token goes in the URL path, so only the BotFather shape is let through.
  if (!/^\d+:[\w-]+$/.test(token)) throw new Error("That is not a bot token.")
  const call = async (method: string, params: Record<string, unknown> = {}, signal?: AbortSignal) => {
    // A long poll that outlives sleep can hang on a dead connection, so every call has a deadline.
    const deadline = AbortSignal.timeout((Number(params.timeout ?? 0) + 10) * 1000)
    const response = await fetch(`${base}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    })
    const reply = (await response.json()) as { ok: boolean; result?: unknown; description?: string }
    if (!reply.ok) throw new Error(`Telegram ${method} failed: ${reply.description ?? response.status}`)
    return reply.result
  }
  const bot = call as Bot
  bot.file = async (fileId: string) => {
    const info = (await bot("getFile", { file_id: fileId })) as { file_path?: string }
    const filePath = info.file_path ?? ""
    // The path is appended to the bot URL. A `..` or absolute path would leave that URL.
    if (!filePath || filePath.startsWith("/") || filePath.includes("..")) {
      throw new Error("Telegram file path was refused.")
    }
    const response = await fetch(`${base}/file/bot${token}/${filePath}`, {
      signal: AbortSignal.timeout(60_000),
      referrerPolicy: "no-referrer",
    })
    if (!response.ok) throw new Error(`Telegram file download failed: ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }
  return bot
}

// Waits for the Owner's /start in a private chat and returns that chat, the only one the app accepts.
export async function connectBot(bot: Bot, stop: AbortSignal): Promise<number> {
  let offset: number | undefined
  for (;;) {
    const updates = (await bot("getUpdates", { offset, timeout: longPollSeconds }, stop)) as Update[]
    for (const { update_id, message } of updates) {
      offset = update_id + 1
      if (message?.chat.type !== "private" || !/^\/start\b/.test(message.text ?? "")) continue
      // Confirm the /start, so the drain never saves it as a Dump.
      await bot("getUpdates", { offset, timeout: 0 }, stop)
      await bot("sendMessage", { chat_id: message.chat.id, text: "Connected" }, stop)
      return message.chat.id
    }
  }
}
