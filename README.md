# Second Brain

A tray app for a second brain on your own computer. It is free and open source. There is no server and no support promise.

The product spec lives in the private repo [adib-11/second-brain](https://github.com/adib-11/second-brain), file `docs/spec/shareable.md`. This repo is the shareable app.

This first slice is the tray, the folder step of the wizard, and the release pipeline. Telegram, the OpenAI key, and Ingest are not in it yet.

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

### Windows

1. Run the installer.
2. If SmartScreen appears, choose More info, then Run anyway.

The installer is unsigned. There is no Authenticode certificate.

### Linux

```sh
chmod +x Second-Brain-*-x86_64.AppImage
./Second-Brain-*-x86_64.AppImage
```

On GNOME the tray icon uses AppIndicator. Install and enable the AppIndicator extension (Ubuntu's "Ubuntu AppIndicators" extension, or "AppIndicator and KStatusNotifierItem Support"). Plain Ubuntu may also need `libfuse2` before an AppImage will start:

```sh
sudo apt install libfuse2
```

If FUSE is unavailable, `APPIMAGE_EXTRACT_AND_RUN=1 ./Second-Brain-*-x86_64.AppImage` still starts it.

## First launch

The app sits in the menu bar on Mac and in the system tray on Windows and Linux. The menu has Quit.

The first window asks for a folder. The default is `Documents/Second Brain`. Create makes that folder, without a git install on the computer (git is bundled):

- `inbox/`
- `vault/raw/`
- `vault/wiki/` with `index.md`, `log.md`, `open-threads.md`, `me.md`, and `people/`, `works/`, `topics/`, `projects/`, `places/`
- `AGENTS.md`, `CONTEXT.md`, `opencode.json`, and the skills under `.agents/skills/`
- `SOURCE_COMMIT`, the commit those templates were copied from
- a git repo on branch `main` whose first commit is `create second brain`

The packaged app also registers itself to open at login (macOS and Windows login items; an XDG autostart entry on Linux, aimed at the AppImage when that is how it was started).

## Templates

`templates/` is copied from [adib-11/second-brain](https://github.com/adib-11/second-brain) at the commit in `templates/SOURCE_COMMIT`. The app owns those files inside each second brain. Nothing else from that repo is in this one.

## Development

Node 22.

```sh
npm ci
npm test
npm run typecheck
npm start
```

`npm start` opens the wizard and the tray. It does not register a login item; that happens in the packaged app.
