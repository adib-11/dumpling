# Dumpling

Dumpling: a second brain on your computer. It is a tray app. It is free and open source. There is no server and no support promise.

Send it a thought, a link, a voice note or a photo from Telegram on your phone. Once a day it files them into a wiki of markdown pages on your computer, written by a free model, with no key or account, or by a model on your own key. Ask it questions with `/ask` and it answers from what you filed.

## Start here

You need a Mac (Apple silicon), Windows or Linux computer that is awake at least once a day, and Telegram on your phone. The free Engine needs nothing else. With your own OpenAI API key instead, expect about $1 to $2 a month in OpenAI cost for 10 Dumps a day; `.state/runs.tsv` in your folder keeps the cost of each Ingest.

1. **Download.** Open the [latest release](https://github.com/adib-11/dumpling/releases/latest) and download the file for your system (see the table below).
2. **Open it.** The app is unsigned, so your system warns you once. Follow the steps for [Mac](#mac), [Windows](#windows) or [Linux](#linux). The app then sits in the menu bar (Mac) or system tray (Windows, Linux), and the Dumpling window opens.
3. **Choose a folder.** Keep the default, `Documents/Dumpling`, and choose Create.
4. **Choose the Engine.** Keep Start free and choose Continue. Or choose Use my own key, pick the provider, then Get a key to open its key page, create a key, paste it, and choose Save key. The app checks it with one call to that provider and keeps it in your system's keychain.
5. **Connect your phone.** You land on Today. Its Connect your phone card makes a Telegram bot: choose Open BotFather, send it `/newbot` in Telegram, pick any name, paste the token it gives you, and choose Check.
6. **Send `/start` to your new bot** from your phone. The bot replies "Connected" and the card goes away. Only this chat can send to it.
7. **Send your first Dump.** Send the bot any message, for example a thought or a link. Within seconds it disappears from the chat: it is saved in the folder's `inbox/`.
8. **File it.** Choose Ingest now in the tray menu. After a minute or two the Dump is filed into pages under `vault/wiki/` in your folder. Open `vault/` in [Obsidian](https://obsidian.md) to read them, or any text editor. Without Ingest now, the app files everything by itself once a day.
9. **Ask.** Send the bot `/ask what did I save today?`. It replies from your pages, naming the pages it used. Ask… in the tray menu opens the Ask tab of the Dumpling window, which does the same.

That is all. The rest of this page is detail.

## Download

| System | File | After download |
| --- | --- | --- |
| Mac (Apple silicon) | `Dumpling-<version>-arm64.dmg` (or the `.zip`) | Privacy & Security → Open Anyway |
| Windows | `Dumpling-<version>-x64.exe` | SmartScreen → More info → Run anyway |
| Linux | `Dumpling-<version>-x86_64.AppImage` | `chmod +x`, then run it |

### Mac

1. Open the dmg and drag Dumpling to Applications. (Or unzip the zip and move the app to Applications.)
2. Open the app. macOS says it cannot verify the developer.
3. Open System Settings → Privacy & Security, and choose Open Anyway.
4. Open the app again and confirm.

The build is ad-hoc signed (`codesign` identity `-`, hardened runtime off). It is not notarized. If macOS says the app is damaged, the download was blocked before it could be ad-hoc signed; do not right-click past that, and use a build whose signature is ad-hoc.

A screenshot of the Privacy & Security prompt is not in this README yet.

### Windows

1. Run the installer.
2. If SmartScreen appears, choose More info, then Run anyway.

The installer is unsigned. There is no Authenticode certificate.

A screenshot of the SmartScreen prompt is not in this README yet.

### Linux

```sh
chmod +x Dumpling-*-x86_64.AppImage
./Dumpling-*-x86_64.AppImage
```

On GNOME the tray icon uses AppIndicator. The AppImage ships `libappindicator`. Install and enable the AppIndicator extension (Ubuntu's "Ubuntu AppIndicators" extension, or "AppIndicator and KStatusNotifierItem Support"). Plain Ubuntu also needs FUSE (`fusermount` from the `fuse` package, and `libfuse2`) before a normal AppImage mount will start:

```sh
sudo apt install fuse libfuse2
```

If FUSE is unavailable, `APPIMAGE_EXTRACT_AND_RUN=1 ./Dumpling-*-x86_64.AppImage` still starts it.

## First launch

The app sits in the menu bar on Mac and in the system tray on Windows and Linux. The menu shows Open Dumpling, the folder, Ingest now, Undo last Ingest, Ask…, Backup remote…, Report a problem, and Quit.

Open Dumpling opens the main window, with five tabs: Today, Inbox, Pages, Ask and Settings. While it is open the app also has a Dock icon (Mac) or a taskbar entry (Windows, Linux); closing it leaves the app in the menu bar or tray only. Today shows the Dumps captured and filed today, a failed Ingest with its reason and a Retry (which runs Ingest now), the Follow-ups waiting for an answer, the Open threads, and one strip of numbers: Dumps in the last 7 days, Engine cost this month (summed from `.state/runs.tsv`, failed runs too), Pages, and the last Ingest. Inbox lists every Dump waiting for the next Ingest; Edit changes its text and Delete removes it with its image and link sidecar, each as one commit (`edit: <name>`, `delete: <name>`). Neither works while an Ingest runs. Both tabs update when a Dump arrives or an Ingest ends. Ask takes a question, as `/ask` does in Telegram. Settings changes the Engine and key, the bot, the folder, the capture shortcut, the backup remote and open at login. A change takes effect at once: a new Engine runs the next Ingest and the next question, with no restart.

The folder in Settings, chosen with Browse, can be another second brain folder, which the app then uses as it is, or an empty folder, where it makes a new one. A path with `..` in it is refused. A folder with other files in it is refused. Nothing is moved or copied, and the old folder is left as it was. A bot in Settings goes through the same steps as Connect your phone; the bot in use keeps draining until the new bot gets `/start`.

The Pages tab lists the Pages in `vault/wiki/` by kind (people, works, topics, projects, places, and your own Me page) and opens one as rendered markdown. A `[[wiki link]]` opens the Page it names; a link to a Page that does not exist is shown in red with a dashed underline, and a link to a Dump or to `log` or `open-threads` is shown as plain text. Each Page ends with the Pages that link to it. Search takes words, finds the Pages that hold all of them in their name, aliases, summary or text, and reads the files each time; the code marks where an index would take over at thousands of Pages. Open in Obsidian shows only when the system has an app registered for `obsidian://` links, and needs `vault/` opened in Obsidian as a vault. The tab only reads: nothing in it changes a Page, and a Page's HTML, images and non-web links are never drawn or loaded.

Backup remote… opens Settings, which takes a git remote URL. After each Ingest the app pushes to it, last and best-effort. A failed push rolls nothing back: the menu shows "Backup push failed", the app notifies once, and the next Ingest pushes again. Save a blank URL to stop pushing.

Report a problem opens a new GitHub issue on the bug report form, filled in with the app version, the system and the last failed Ingest from `.state/runs.tsv` (its time and reason, with the folder path replaced by `<folder>`). It carries no Dump or Page text. Nothing is sent until you submit the issue on GitHub.

First run, in the main window, asks for a folder, then the Engine, then lands on Today. The Engine is Start free (selected) or Use my own key. Start free runs a free model through opencode with no key; the Dumps go to opencode's servers in the US and EU, and the app offers only models whose terms say they keep no data and do not train on it (`freeModels` in `src/engine.ts`). Use my own key sends the Dumps to the provider picked; the app checks the key with one call to that provider and stores it in the OS keychain. The Key Engines are OpenAI, Gemini, Anthropic and OpenRouter (`keyProviders` in `src/engine.ts`), each with a default model and a cost table; setup offers a provider only once its default model has passed the v1 fixture set. Today that is OpenAI and Gemini (`google/gemini-3.5-flash-lite`, 57/58); Anthropic and OpenRouter wait for their runs. The key reaches opencode in the provider's environment variable only, never in its arguments, a log or the folder. The default folder is `Documents/Dumpling`. Create makes that folder, without a git install on the computer (git is bundled):

- `inbox/`
- `vault/raw/`
- `vault/wiki/` with `index.md`, `log.md`, `open-threads.md`, `me.md`, and `people/`, `works/`, `topics/`, `projects/`, `places/`
- `AGENTS.md`, `CONTEXT.md`, `opencode.json`, and the skills under `.agents/skills/`
- `SOURCE_COMMIT`, the commit those templates were copied from
- a git repo on branch `main` whose first commit is `create second brain`

Telegram is optional. Without a bot, Ingest now, the daily Ingest and Ask… all work, and `/ask` in Telegram and Follow-ups wait for one. Until a bot is connected, Today shows a Connect your phone card. Open BotFather, send `/newbot`, and paste the token; the app checks it with `getMe`. Then send `/start` to the new bot from your phone. That chat becomes the only one the app accepts, the bot replies "Connected", and the card goes away. The token is kept encrypted with Electron `safeStorage`, whose key is in the OS keychain (on Linux this needs a keyring such as GNOME Keyring or KWallet). It is never written to the second brain folder.

Quick capture makes a Dump on the computer. ⌃⌥Space on a Mac, Ctrl+Alt+Space on Windows and Linux, from any app, opens a small box. Type a thought or paste a link and press Enter: it is saved as a Dump in `inbox/` with `device: desktop`, as one commit (`capture: <name>`), and the box closes. Shift+Enter starts a new line, and Esc closes the box with nothing saved. An image pasted or dropped on the box is saved as a JPEG about 1200 px wide beside its Dump, with the text read from it under `## Image text` as for a Telegram photo; this needs an Engine, and text typed with the image is kept as its caption. If the image cannot be read, nothing is saved and the box stays open. While an Ingest runs the Dump waits in `inbox/` and the next drain or Ingest commits it. Quick capture makes plain Dumps only. In Settings, click the shortcut field and press other keys to change it. If the system keeps the new shortcut for another app, Settings says so and the old one keeps working; if it refuses the first one at start, Settings says quick capture is off and asks for another. The shortcut needs a desktop that lets an app register one; on Linux under Wayland that depends on the compositor's global shortcuts portal.

While the computer is awake, the app long-polls the bot. Each text message becomes a Dump in `inbox/` (`device: telegram`, with its `telegram_message_id`) and is deleted from the chat. With an OpenAI or Gemini key, a voice note is transcribed (`gpt-transcribe`, or the Gemini default model) and saved as text only; the audio is not kept. On the free Engine, or with an Anthropic or OpenRouter key, a voice note becomes a placeholder Dump that says an OpenAI or Gemini key is needed, with the audio kept beside it. A photo is saved as a JPEG about 1200 px wide beside its Dump, and the text read from it by the Engine (`gpt-5.6-luna` with an OpenAI key, or the Engine's model through opencode with the image attached) is kept under `## Image text`. A file over 20 MB, or any other file that is not a photo, becomes a placeholder Dump and is not downloaded. A voice note or photo that cannot be saved stays in the chat, and the tray names it, until a later poll. An image the app cannot decode as a JPEG (a PNG, say) becomes a placeholder Dump at once, since a retry would fail the same way. Each batch is a commit, `drain: N Dumps`. Messages from any other chat are ignored.

A message that starts with `/ask` is a question, never a Dump. The app runs the `ask` skill on it and replies in the chat, citing Page names, ending with `Filed up to <date>`. Nothing is written to `inbox/` or the wiki; the question is deleted from the chat like a Dump. The Ask tab, which Ask… in the tray opens, does the same. A question the app cannot answer gets the reply "Could not answer that." Recall answers come straight from the wiki. Persona answers come in two parts, "What you've said" then "Guess"; without `persona/STYLE.md` the voice isn't available yet, and the draft is plain and neutral.

The packaged app also registers itself to open at login (macOS and Windows login items; an XDG autostart entry on Linux, aimed at the AppImage when that is how it was started). Open at login in Settings turns it off and on.

Before filing, Ingest now fetches the link of every Dump with a `url` into a `<name>.fetched.md` sidecar beside it, so the agent reads the linked text without going online. Articles go through `defuddle`, PDFs through `pdfjs-dist`, YouTube captions through the bundled `yt-dlp` and `deno`, X posts through fxtwitter, LinkedIn posts and articles through the page's JSON-LD, Apple Podcasts through the feed's transcript, and Instagram and TikTok down to the caption. A link is never fetched twice. A paywall, a 404 or any failure writes `status: unfetched` with the reason and whatever title and description were found. A podcast episode with no published transcript stays unfetched; v1 transcribed its audio with `yap`, which is Mac only.

Ingest now files markdown Dumps dropped in `inbox/`. It runs the bundled opencode binary on the ingest skill, up to 25 Dumps at a time, then moves that chunk to `vault/raw/YYYY/MM/` and commits `ingest: <date>, N Dumps`. The cost of the run, priced from the tokens with the Engine's cost table, is appended to `.state/runs.tsv`. The key is not written into the folder, the log, or the opencode process arguments.

Ingest also runs by itself once a day: at 03:00, or at the first wake after it if the computer was asleep, right after a Telegram drain. A chunk fails on a non-zero exit, a 20 minute timeout, or no change in `vault/wiki/`. Its edits go to a git stash named `failed ingest <time>` (never a reset), its Dumps stay in `inbox/`, and a desktop notification names the stash. On the free Engine, a 429 or a gone default model moves the run to the fallback free model, once; if that fails too, the Dumps stay in `inbox/`, count no failure, and the notification offers to add a key. No other model is ever tried. A Dump that failed twice is retried alone, and one that fails twice alone moves to `inbox/failed/`. The tray icon gets a red dot after a failed Ingest and an amber dot when Telegram has not drained for 20 h. The Mac menu bar icon takes the menu bar's one colour, so there it is a solid dot for a failed Ingest and a ring for not drained. Undo last Ingest reverts the newest `ingest:` commit, which restores the wiki and puts its Dumps back in `inbox/`; an Undo that would overwrite a later edit changes nothing.

## Updates

The app does not update itself. Once a day it asks GitHub for the latest release. When a newer one exists, the tray menu shows "New version x.y.z…", which opens the release page. Download and install it as before; your folder, key and bot stay as they are.

### From Second Brain to Dumpling

The app was called Second Brain before v0.2. On its first start, Dumpling moves the settings of a Second Brain install (`config.json`, the key and the bot token) from the old settings folder, `second-brain-app`, to its own, `Dumpling`. The key and token are sealed again under the new name; on a Mac the system may ask once whether Dumpling may use the "second-brain-app Safe Storage" keychain item. Choose Allow. Your second brain folder does not move, and Dumpling keeps using it. If the keychain refuses, the old folder keeps everything, the app says which secret did not move, and the Dumpling window asks for it again: the Engine step for a key, the Connect your phone card for a bot token.

Then delete the Second Brain app. On a Mac, also remove it from System Settings → General → Login Items; Windows and Linux drop its login entry for you.

## Templates

`templates/` is copied from [adib-11/second-brain](https://github.com/adib-11/second-brain) at the commit in `templates/SOURCE_COMMIT`. The app owns those files inside each second brain. `tests/fixtures/ingest` is the v1 fixture set from that repo, with no keys or personal notes. `node scripts/ingest-fixtures.js <provider/model>` runs it on one model, after `npm run build`, and prints the pass rate; a Key Engine model takes its key from that provider's environment variable (`OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`).

## Development

The product spec lives in the private repo adib-11/second-brain, file `docs/spec/shareable.md`.

Node 22.

```sh
npm ci
npm test
npm run typecheck
npm start
```

The logo is `assets/logo.svg` and the menu bar glyph is `assets/tray.svg`. After editing either, `node scripts/make-icons.js` redraws the app icons (`assets/icon.icns`, `assets/icon.ico`, `assets/icons/`) and the tray icons (`assets/tray/`); commit what it writes. The colour and type tokens, with dark mode, are in `src/theme.css`, which every window loads.

`node scripts/fetch-opencode.js` and `node scripts/fetch-yt-dlp.js` put the bundled binaries in `vendor/`. `node scripts/fetch-link-live.js` (after `npm run build`) fetches one real link per route and prints each result; it needs the network, so it is not part of `npm test`.

`npm start` builds the app, including the main window's React renderer (`renderer/`, built by Vite into `dist/renderer/`), and opens the tray, plus the main window until first run is done. It does not register a login item; that happens in the packaged app.

### Releasing

The release workflow builds unsigned installers and attaches them to a draft GitHub Release. It runs when a `v*` tag is pushed, and it can also be started by hand (Actions → Release → Run workflow, with a tag such as `v0.2.0`). The Mac build is ad-hoc signed so macOS does not call it damaged. Bump `version` in `package.json` to match the tag, since the update check compares the two. Publishing the draft makes it the latest release, which the app links to.

### Renaming the repo

The app names `adib-11/dumpling` in the update check and in Report a problem, and Report a problem needs the bug report form on that repo's default branch. Rename `adib-11/second-brain-app` to `dumpling` (Settings → General → Repository name) right after the rename change is merged to `main`, and before tagging any release built from it. Until then, a build from `main` finds no release and its Report a problem page is a 404. GitHub redirects the old name, so installs from before the rename keep finding releases; never create a new repo called `second-brain-app`, since that ends the redirect. After the rename, run `git remote set-url origin https://github.com/adib-11/dumpling.git` in each clone.
