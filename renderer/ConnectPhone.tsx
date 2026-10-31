import { BotForm } from "./BotForm"

// Shown on Today until a bot is connected.
export function ConnectPhone({ onConnected }: { onConnected: () => void }) {
  return (
    <section className="card" aria-labelledby="connect-title">
      <h2 id="connect-title">Connect your phone</h2>
      <p>
        Send Dumps and <code>/ask</code> from Telegram. Open BotFather, send <code>/newbot</code>, and paste the token
        it gives you. The bot chat lives on Telegram's servers until the app saves each message and deletes it from the
        chat.
      </p>
      <BotForm inputId="token" onConnected={onConnected} />
    </section>
  )
}
