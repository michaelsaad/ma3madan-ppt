<p align="center">
  <img src="docs/icon.png" width="96" alt="">
</p>

<h1 align="center">Ma3madan PPT</h1>

<p align="center">
  <b>A presenter view for PowerPoint, made for the people running the slides.</b><br>
  Your slides full screen on the projector. On your laptop: the live slide, the next one, your notes, every section, and a phone remote.
</p>

<p align="center">
  <a href="https://github.com/michaelsaad/ma3madan-ppt/releases/latest"><b>⬇ Download for Windows</b></a>
</p>

![The presenter view](docs/screenshot.png)

## Why this app?

Running slides for a meeting, a church service or a class usually means juggling:

- 📂 Several presentations (the songs, the sermon, the announcements), each opened, closed and searched for in a folder while everyone waits.
- 🔎 Hunting for slide 47 in a long deck, because the reading moved or the choir changed the order of the songs.
- 🧭 Long presentations split into sections in PowerPoint, with no quick way to jump to one while presenting.
- 📱 Having to stand by the laptop the whole time.

**Ma3madan PPT keeps PowerPoint for what it does best and gives you the rest.** PowerPoint itself shows the slides on the projector, so animations, transitions, videos, fonts and links all work exactly as the author made them. Everything around it is on your laptop: your presentations, their sections, a grid of every slide, and the presenter view. Your phone is a remote that can do all of it too.

*Ma3madan* (المعمدان) means "the Baptist". The app was originally made for **St. John the Baptist Church in Qalyub, Al-Qalyubia, Egypt**. It's free for anyone to use, for anything. It has a sister app for videos: [Ma3madan Play](https://github.com/michaelsaad/ma3madan-play).

## Features

- **Presenter view.** The slide on the projector, live (animations and videos included), the next slide or the next animation step, your notes in a size you can read, a timer and the clock. Type a slide number and press `Enter` to jump there.
- **Click on the slide.** Click the live slide on your laptop, or tap it on your phone, and it's like clicking on the projector: links, "go to slide" buttons and action buttons all work.
- **Sections.** PowerPoint's sections show as chips under the live slide, with that section's slides beside them. One click jumps to a section.
- **All slides** (`G`): a big grid of every slide, grouped by section. Open and close sections, make the slides bigger or smaller, and click any slide to go there.
- **Before the show:** the same grid with each section's slides, a **Start here** on every section, and **From this slide**.
- **Black and white screens** (`B`, `W`) for the moments the projector should show nothing.
- **Your presentations, in one place.**
  - **Recent:** every presentation you opened, with a picture of its first slide.
  - **Lists:** make one for each meeting ("Sunday service"), add presentations from their **⋯** menu or by dragging them onto the list, open them all at once.
  - **Search** across all of them.
  - Several presentations open at the same time, as tabs at the top: switch with a click or `Ctrl + Tab`.
  - It remembers the slide you stopped at in each one.
- **Phone remote.** Turn it on and scan the QR code once: the [Ma3madan Remote](https://ma3madan-remote.pages.dev) app opens on the phone (add it to the home screen) and connects by itself from then on, directly over the Wi-Fi. Or pick this computer from **Computers on this Wi-Fi** in the app and approve it here. On the phone: the live slide (tap it to click on it), next and back, black, white, end, your notes, the timer, every section with its slides, and your presentations, recents and lists to open or start.
- **Edit while you present.** Presentations open read-only in the background, so the file stays untouched and you can still open it in PowerPoint to fix a typo (**⋯** → **Edit in PowerPoint**).
- **Choose the screen** for the show (**This screen / Screen 2 ▾**), or let the app pick the projector by itself.
- **English and Arabic** interface (Arabic is right-to-left), **light and dark** themes that follow Windows, and every shortcut one `?` away.
- **Opens presentations from Explorer** (`.pptx`, `.ppt`, `.ppsx`, `.pps`, `.pptm`, `.ppsm`).

![All slides by section](docs/slides.png)

## Install

You need **Microsoft PowerPoint** (2013 or later, including Microsoft 365) on the same computer: Ma3madan PPT uses it to show the slides.

1. Download **`Ma3madan-PPT-Setup-x.y.z.exe`** from the [latest release](https://github.com/michaelsaad/ma3madan-ppt/releases/latest).
2. Run it. Because the app is new and not code-signed yet, Edge or Windows may warn you first. See [Windows says the file is unsafe](#windows-says-the-file-is-unsafe) below.
3. Pick where to install it. No admin rights are needed.

Prefer not to install? Download **`Ma3madan-PPT-Portable-x.y.z.exe`** and run it from anywhere.

Requirements: Windows 10 or 11 (64-bit) and PowerPoint.

### Windows says the file is unsafe

Edge and Windows SmartScreen warn about any new program that isn't code-signed and hasn't been downloaded by many people yet. The warning is about reputation, not about anything found in the file. All the source code is in this repository, and every release is built from it.

- **Edge** ("isn't commonly downloaded"): open Downloads (`Ctrl + J`), hover over the file, click **⋯** → **Keep** → **Show more** → **Keep anyway**.
- **Windows SmartScreen** ("Windows protected your PC"): click **More info** → **Run anyway**.

### Updates

When a new version is out, an **Update** button appears in the top bar. Nothing changes until you click it (and never during a show). The app downloads the new installer, checks it against the SHA-256 that GitHub publishes for the file, installs it and restarts. The portable version's button opens the download page instead.

## Using it with a projector

1. Connect the projector and press **`Win + P`**, then choose **Extend**.
2. Open your presentation in Ma3madan PPT (or pick it from Recent or a list).
3. Press **From the beginning** (`F5`), or select a slide and press **From this slide** (`Shift + F5`). The show goes full screen on the projector and the presenter view opens on your laptop.
4. To use another screen, pick it under **Screen ▾** before starting.

With only one screen, the show fills that screen like in PowerPoint; use the keyboard or the phone remote to move through it.

## Keyboard shortcuts

| Keys | |
|---|---|
| `F5` / `Shift + F5` | Start from the beginning / from the selected slide |
| `→` `Space` `PgDn` | Next animation or slide |
| `←` `PgUp` | Previous |
| a number, then `Enter` | Go to that slide |
| `Home` / `End` | First / last slide |
| `G` | All slides |
| `B` / `W` | Black / white screen |
| `Esc` | End the show |
| `Ctrl + O` | Open a presentation |
| `Ctrl + Tab` | Next open presentation |
| `Ctrl + B` | Side panel |
| `?` | All shortcuts |

## Build from source

```bash
npm install
npm start
```

- `npm test` runs the app against `test/test.pptx` with the real PowerPoint: sections, thumbnails, a full-screen show, next and back, animation steps, the slide grid, clicking a link and a button on a slide, the black screen, and the phone remote's commands. It takes over the screen for about a minute.
- `npm run test:bridge` checks only the PowerPoint connection.
- `npm run test:remote` opens the app with the phone remote on and prints the pairing link.
- `npm run shots` remakes the screenshots above from `docs/demo.pptx` (made by `docs/make-demo.js`).

### How it works

- `src/ppt/host.js` runs under Windows Script Host and talks to PowerPoint through COM (late-bound, so it works with any installed Office, 32- or 64-bit): opening presentations read-only without a window, sections, notes, slide pictures, and the slide show itself.
- `src/ppt/win.ps1` does what COM can't: it finds the show window, puts it on the chosen screen, and clicks inside it.
- A click on a slide first goes to PowerPoint, which finds the shape there and runs its action (a link, "go to slide", next, end…). Anything else becomes a real click on the projector.
- The live slide in the presenter view is a capture of the show window.
- The phone remote is the [Ma3madan Remote](https://github.com/michaelsaad/ma3madan-remote) app over an encrypted WebRTC connection (`src/link.js`, `src/link-host.js`, shared with Ma3madan Play).

### Releasing

Bump `version` in `package.json`, commit, and push a matching tag (`git tag v1.2.0 && git push origin v1.2.0`). The Release workflow builds the installer and the portable `.exe` and attaches them to a draft release.

## Privacy

The app doesn't collect, store or send any personal data or usage statistics. Your presentations never leave your computer. It connects to the internet only to check GitHub for app updates and, when you turn the phone remote on, to find your phone: the Ma3madan Remote app meets the computer through a signaling server that sees only encrypted messages and deletes them after ten minutes, then talks to it directly over the Wi-Fi. The slide pictures, notes and titles the phone shows travel only over that direct, encrypted connection.

## Third-party software

- [Electron](https://www.electronjs.org/) (MIT), bundled
- [QR Code Generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase (MIT), bundled for the phone remote's QR code
- Microsoft PowerPoint, which you install yourself, under its own license. Ma3madan PPT is an independent app, not made by or affiliated with Microsoft.

The demo presentation uses Psalm 23 and Matthew 3 from the King James Version (public domain).

## License

Free to use for any person or organization, for any purpose: use it, copy it, change it and share it ([MIT License](LICENSE)).

The app is provided as is, without warranty of any kind, and may contain bugs. Please try it before relying on it at an important event. If you find a problem, [open an issue](https://github.com/michaelsaad/ma3madan-ppt/issues).

---

<p align="center">Developed by Michael Saad · © 2026</p>
