# Second Brain

A tray app for a second brain on your own computer. It is free and open source. There is no server and no support promise.

The product spec lives in the private repo [adib-11/second-brain](https://github.com/adib-11/second-brain), file `docs/spec/shareable.md`. This repo is the shareable app.

So far it has the tray, the folder, OpenAI key and bot steps of the wizard, Telegram text capture, Ingest now with link fetching, and the release pipeline. Voice and photos are not in it yet.

## Download

Draft installers are attached to a draft GitHub Release. The release workflow runs when a `v*` tag is pushed, and it can also be started by hand (Actions → Release → Run workflow, with a tag such as `v0.1.0`). The files are unsigned. The Mac build is ad-hoc signed so macOS does not call it damaged.

| System | File | After download |
| --- | --- | --- |
| Mac (Apple silicon) | `Second-Brain-<version>-arm64.dmg` (or the `.zip`) | Privacy & Security → Open Anyway |
| Windows | `Second-Brain-<version>-x64.exe` | SmartScreen → More info → Run anyway |
| Linux | `Second-Brain-<version>-x86_64.AppImage` | `chmod +x`, then run it |

### Mac

1. Open the dmg and drag Second Brain to Applications. (Or unzip the zip and move the app to Applications.)
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
chmod +x Second-Brain-*-x86_64.AppImage
./Second-Brain-*-x86_64.AppImage
```

On GNOME the tray icon uses AppIndicator. The AppImage ships `libappindicator`. Install and enable the AppIndicator extension (Ubuntu's "Ubuntu AppIndicators" extension, or "AppIndicator and KStatusNotifierItem Support"). Plain Ubuntu also needs FUSE (`fusermount` from the `fuse` package, and `libfuse2`) before a normal AppImage mount will start:

```sh
sudo apt install fuse libfuse2
```

If FUSE is unavailable, `APPIMAGE_EXTRACT_AND_RUN=1 ./Second-Brain-*-x86_64.AppImage` still starts it.

## First launch

The app sits in the menu bar on Mac and in the system tray on Windows and Linux. The menu shows the folder, Ingest now, Connect Telegram… until a bot is connected, and Quit.

The first window asks for a folder, then an OpenAI API key. The wizard checks the key with one call and stores it in the OS keychain. The default folder is `Documents/Second Brain`. Create makes that folder, without a git install on the computer (git is bundled):

- `inbox/`
- `vault/raw/`
- `vault/wiki/` with `index.md`, `log.md`, `open-threads.md`, `me.md`, and `people/`, `works/`, `topics/`, `projects/`, `places/`
- `AGENTS.md`, `CONTEXT.md`, `opencode.json`, and the skills under `.agents/skills/`
- `SOURCE_COMMIT`, the commit those templates were copied from
- a git repo on branch `main` whose first commit is `create second brain`

Next the window asks for a Telegram bot. Open BotFather, send `/newbot`, and paste the token; the app checks it with `getMe`. Then send `/start` to the new bot from your phone. That chat becomes the only one the app accepts, and the bot replies "Connected". The token is kept encrypted with Electron `safeStorage`, whose key is in the OS keychain (on Linux this needs a keyring such as GNOME Keyring or KWallet). It is never written to the second brain folder.

While the computer is awake, the app long-polls the bot. Each text message becomes a Dump in `inbox/` (`device: telegram`, with its `telegram_message_id`) and is deleted from the chat. Each batch is a commit, `drain: N Dumps`. Messages from any other chat are ignored. Voice notes, photos and files stay in the chat for now.

The packaged app also registers itself to open at login (macOS and Windows login items; an XDG autostart entry on Linux, aimed at the AppImage when that is how it was started).

Before filing, Ingest now fetches the link of every Dump with a `url` into a `<name>.fetched.md` sidecar beside it, so the agent reads the linked text without going online. Articles go through `defuddle`, PDFs through `pdfjs-dist`, YouTube captions through the bundled `yt-dlp` and `deno`, X posts through fxtwitter, LinkedIn posts and articles through the page's JSON-LD, Apple Podcasts through the feed's transcript, and Instagram and TikTok down to the caption. A link is never fetched twice. A paywall, a 404 or any failure writes `status: unfetched` with the reason and whatever title and description were found. A podcast episode with no published transcript stays unfetched; v1 transcribed its audio with `yap`, which is Mac only.

Ingest now files markdown Dumps dropped in `inbox/`. It runs the bundled opencode binary on the ingest skill, up to 25 Dumps at a time, then moves that chunk to `vault/raw/YYYY/MM/` and commits `ingest: <date>, N Dumps`. The cost of the run is appended to `.state/runs.tsv`. The key is not written into the folder, the log, or the opencode process arguments.

## Templates

`templates/` is copied from [adib-11/second-brain](https://github.com/adib-11/second-brain) at the commit in `templates/SOURCE_COMMIT`. The app owns those files inside each second brain. `tests/fixtures/ingest` is the v1 fixture set from that repo, with no keys or personal notes.

## Development

Node 22.

```sh
npm ci
npm test
npm run typecheck
npm start
```

`node scripts/fetch-opencode.js` and `node scripts/fetch-yt-dlp.js` put the bundled binaries in `vendor/`. `node scripts/fetch-link-live.js` (after `npm run build`) fetches one real link per route and prints each result; it needs the network, so it is not part of `npm test`.

`npm start` opens the wizard and the tray. It does not register a login item; that happens in the packaged app.
