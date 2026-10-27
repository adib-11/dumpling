# Shareable second brain: product spec

> Moved here on 2026-10-27 from the private repo adib-11/second-brain, where it was written. In this file, "this repo" means that private repo, and `v1.md` is its `docs/spec/v1.md`, which stays private. The next version is [`v0.2.md`](v0.2.md).

A version of this second brain that anyone can download from GitHub and try without a terminal or hand-built iOS Shortcuts. Written on 2026-10-23 after a grilling session with the maintainer (the Owner of this repo). It builds on `v1.md`; where this spec is silent, v1's rules hold. Vocabulary is from [`CONTEXT.md`](../../CONTEXT.md).

Each install is its own second brain with one **Owner**: whoever installs the app. "The maintainer" is the person who publishes it.

## 1. Decisions

- **Audience: anyone.** It is released free and open source on GitHub Releases and announced on the maintainer's socials. There is no App Store listing and no promise of support.
- **A desktop app for Mac, Windows and Linux, all three in the first release.** It is an Electron and TypeScript tray app (in the Mac menu bar, the Windows and Linux system tray). Any computer that is awake once a day will do. Phones only capture.
- **Telegram is the only capture channel, on every device**: phone, tablet and the Telegram desktop app. Each Owner makes their own bot with @BotFather. The Mac Quick Keys and the iOS Shortcuts are gone.
- **No server run by the maintainer.** A Dump leaves the Owner's computer only to go to Telegram (in transit, deleted after the drain) and to the Owner's own model provider.
- **The Owner brings their own OpenAI API key.** The default model is `gpt-5.6-luna` with the `check-ingest` fix pass (about $0.03 for 13 Dumps, from the v1 fixture run). Voice goes through `gpt-transcribe` on the same key. Cloud models are the default. Local models stay an option only: a test with Gemma 4 12B on a 16 GB M5 took 1 to 3 minutes per agent step.
- **No code signing anywhere.** The Mac build is not notarized; Owners approve it once in System Settings. The Windows build is unsigned; Owners click through SmartScreen. The README shows both steps with screenshots.
- **The engine is a bundled opencode binary** running the `ingest` and `ask` skills, with the `opencode.json` permission fences unchanged.
- **The app's code lives in a new public repo.** This repo is private and stays the maintainer's own setup. The app copies the skills from it, recording the source commit.
- **The vault format is the same as v1**, so the maintainer can later move this repo's `vault/` onto the app as it is. Until then this repo stays the maintainer's own setup.

## 2. Shapes compared

| | Setup by the Owner | Monthly cost | What leaves the device |
| --- | --- | --- | --- |
| **(a) Mac menu-bar app** | Download, approve in System Settings, paste an OpenAI key, make a bot with @BotFather, send `/start` | Owner: model, about $1 to $2. Maintainer: $0, or $99/yr to notarize | Dumps to Telegram (transit) and OpenAI |
| **(a′) Desktop app for Mac, Windows and Linux** (chosen) | As (a), on any of the three systems | As (a) | As (a) |
| **(b) Hosted bot and web app** | Sign up, open the shared bot, send `/start` | Maintainer: a server ($5 to $20) plus model cost for everyone, or keys held on the server. Owner: $0, or a subscription | Every Dump and Page lives on the maintainer's server, plus Telegram and the model provider |
| **(c) Native iOS and Mac app with CloudKit** | Install from TestFlight or the App Store, sign in to iCloud, paste an OpenAI key | Maintainer: $99/yr (required). Owner: model, plus iCloud storage beyond the free 5 GB | Dumps and Pages in the Owner's iCloud private database, plus the model provider |
| **(d) GitHub template run by Actions** (considered) | Make a private repo from the template, add 2 secrets, enable Actions | Owner: model; Actions about 720 of the 2,000 free minutes for hourly drains | The whole vault in the Owner's private GitHub repo, plus Telegram and OpenAI |

Model cost assumes about 10 Dumps a day at the fixture rate, plus a few minutes of voice and a few `/ask` questions. Measure it in the first weeks of use.

**(a) Mac menu-bar app.** This is closest to today: launchd becomes a login item, and the zsh and Perl scripts ship inside the app. It is Mac only, which fails the "anyone can try it" goal.

**(a′) Desktop app for Mac, Windows and Linux.** This is (a) without the Mac limit. The cost is porting the glue scripts to TypeScript so that Windows needs no zsh or Perl. Electron already bundles Node, which `defuddle` needs. `dugite` bundles git, so the Owner installs nothing.

**(b) Hosted bot and web app.** It needs the least setup, but the maintainer would hold every Owner's Dumps. That means accounts, data-protection duties, uptime and either a bill or a business. All of that is ruled out by the "no server run by the maintainer" decision.

**(c) Native iOS and Mac app with CloudKit.** It is Apple only, the paid developer account is mandatory, and iOS background limits make a daily Ingest on the phone unreliable, so in practice a Mac still does the work. Almost nothing in this repo carries over except the skills as prompts.

**(d) GitHub template run by Actions.** It needs no install and works with a phone only. It lost because:
- an `/ask` question would wait up to an hour for the next scheduled run;
- YouTube and LinkedIn often block GitHub's datacenter IP addresses;
- every Owner would need a GitHub account.

**Recommendation: (a′).** It is the only shape that works on any desktop, needs no server and no account beyond Telegram and OpenAI, and keeps the Owner's data on their own computer. It also reuses the most of this repo.

## 3. What the Owner sets up

A first-run wizard, with no terminal:

1. Download the build for their system from GitHub Releases and open it. On a Mac: Privacy & Security, then Open Anyway. On Windows: More info, then Run anyway.
2. Pick the folder for the second brain (default `Documents/Second Brain`).
3. Paste an OpenAI API key. The wizard links to the key page, checks the key with one cheap call, and stores it in the OS keychain (Electron `safeStorage`).
4. Make a bot. The wizard opens `t.me/BotFather`; the Owner sends `/newbot` and pastes the token. The wizard checks it with `getMe`.
5. Send `/start` to the new bot from the phone. The app saves that chat id as the only chat it accepts and replies "Connected".
6. Optional: open `vault/` in Obsidian; add a git remote for backup; or pick a folder that iCloud, Dropbox or OneDrive syncs.

The wizard reminds the Owner that OpenAI API data is not used for training by default and that the bot chat lives on Telegram's servers until the drain deletes it.

## 4. How it runs

- **Always on, while the computer is awake.** The app launches at login and long-polls Telegram, so Dumps land in `inbox/` within seconds and `/ask` gets an answer right away. A sleeping or switched-off computer answers nothing. Telegram keeps updates for 24 h, and the app warns if it has not drained for 20 h.
- **Ingest** runs once a day at the first wake, plus an "Ingest now" item in the tray menu. The pipeline is v1 §6 ported to TypeScript: lock, drain, fetch links, chunks of 25, `check-ingest` with one fix pass, move filed Dumps to `vault/raw/`, regenerate `index.md`, commit, send Follow-ups.
- **History.** The folder is a git repo driven by the bundled git. Every Ingest is a commit. "Undo last Ingest" reverts it. A failed chunk is stashed, never reset. Pushing to a remote is opt-in.
- **Asking.** A Telegram message that starts with `/ask` is a question, not a Dump. The app runs the `ask` skill and replies in the chat, citing Page names. The tray has an Ask box too. Every answer ends with `Filed up to <date>`.
- **Daily message.** After each Ingest the bot sends one "Filed today" message: Dumps filed, Pages touched, anything that failed. It stands in for the Digest.
- **Health.** The tray icon shows ok, failing or not drained. Failures raise a desktop notification. There are no Telegram alerts except the daily message.

## 5. What carries over from this repo

| Part | Fate |
| --- | --- |
| `bin/drain-telegram` | Ported to TypeScript with the same rules: drop other chats, never store the offset, `deleteMessage` after saving, `reply_to_message` becomes an Addendum, files over 20 MB become a placeholder Dump, voice through `gpt-transcribe`. A photo is downscaled to about 1200 px, and its text is read by an OpenAI image-capable model on the same key, replacing Apple Vision, which is Mac only. The iCloud raw-JSON source is dropped, because the app polls the bot itself. |
| `bin/fetch-link` | Ported route for route (v1 §7). `defuddle` as an npm dependency, `pdfjs-dist` in place of `pdftotext`, and `yt-dlp` plus `deno` shipped as per-OS binaries. One sidecar per Dump, never fetched twice. |
| `bin/check-ingest` | Ported to TypeScript, same checks (a `log.md` entry per Dump, real citations with the right label and date, verbatim quotes, glossed Bangla). It still makes a cheap model safe. |
| `bin/index`, `bin/ingest` | Ported. `bin/ingest` becomes the app's scheduler and pipeline. |
| `ingest` skill | Kept, with only these edits: drop the Shortcuts and Private Dump lines; Follow-ups apply to every Dump, since all are Telegram Dumps; rule changes are proposed in the daily message, not the Digest. |
| `ask` skill | Kept. Drop the cloud-session and git-crypt lines. Without `persona/STYLE.md`, Persona says the voice isn't available yet, as it does today. |
| `opencode.json` | Kept as is: edit only `vault/wiki/**` and `vault/follow-ups.md`, no bash, task, webfetch or websearch. |
| `AGENTS.md`, `CONTEXT.md` | Shipped into each folder. The app owns these and the skills, and overwrites them on update. |
| Not carried | `bin/drain-icloud`, `bin/dump`, `bin/digest`, `bin/review`, `bin/import-whatsapp`, `bin/private-guard`, `bin/health` (its checks become the tray status), the launchd plist, the Shortcuts docs, git-crypt. |

## 6. v1 cut list

**In:**

- The tray app on Mac, Windows and Linux, with the first-run wizard
- Telegram capture: text, voice, photos and links
- Addenda by reply
- One Follow-up per opinion-less Dump, through the bot
- Link fetching
- Daily and manual Ingest with `check-ingest`
- The Obsidian-compatible vault, with git history and Undo last Ingest
- Recall and Persona from `/ask` and the tray Ask box (Persona without the STYLE.md voice)
- The daily "Filed today" message
- Tray health and notifications
- An opt-in git remote

**Out of v1:**

- The weekly Digest and `review` (merges, tag renames and rule changes wait for them)
- Private Dumps
- WhatsApp import, the `voice` skill and STYLE.md
- Code signing and notarization
- Auto-update: unsigned Mac builds can't use Squirrel, so the app only links to a newer GitHub release
- Model providers other than OpenAI, and local models
- Instant answers while the computer sleeps
- A mobile app
- Any server run by the maintainer
- Search upgrades (v1 §14)

## 7. To test while building

- An unsigned Electron build on Apple silicon opens after Open Anyway. It must be at least ad-hoc signed, or macOS calls it damaged.
- The tray icon on GNOME, which needs AppIndicator support, and the AppImage on a plain Ubuntu.
- The opencode binary on Windows honours the `vault/wiki/**` edit glob, and the ported scripts handle Windows paths and Bangla file content.
- The size of the download with `yt-dlp`, `deno` and git bundled.
- The model cost per month on real use, against the estimate in section 2.
- Long-polling Telegram after sleep and wake on all three systems.
