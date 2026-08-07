<p align="center">
  <a href="https://monochrome-plus.appwrite.network">
    <img src="https://github.com/itsmeadarsh2008/monochrome-plus/blob/master/public/assets/512.png?raw=true" alt="Monochrome+ Logo" width="140px">
  </a>
</p>

<h1 align="center">Monochrome+</h1>

<p align="center">
  <strong>An open-source, privacy-respecting, ad-free Hi-Fi music client.</strong><br>
  <em>Bring your own source — powered by any Eclipse-compatible addon.</em>
</p>

<p align="center">
  <a href="https://monochrome-plus.appwrite.network">
    <img src="https://img.shields.io/badge/monochrome%2B-000000?style=for-the-badge&logo=rocket&logoColor=ffffff&label=Live" alt="Live instance">
  </a>
  <a href="https://github.com/itsmeadarsh2008/monochrome-plus/stargazers">
    <img src="https://img.shields.io/github/stars/itsmeadarsh2008/monochrome-plus?style=for-the-badge&logo=github&logoColor=ffffff&color=000000&labelColor=000000" alt="GitHub stars">
  </a>
  <a href="https://github.com/itsmeadarsh2008/monochrome-plus/forks">
    <img src="https://img.shields.io/github/forks/itsmeadarsh2008/monochrome-plus?style=for-the-badge&logo=github&logoColor=ffffff&color=000000&labelColor=000000" alt="GitHub forks">
  </a>
  <a href="https://github.com/itsmeadarsh2008/monochrome-plus/issues">
    <img src="https://img.shields.io/github/issues/itsmeadarsh2008/monochrome-plus?style=for-the-badge&logo=github&logoColor=ffffff&color=000000&labelColor=000000" alt="GitHub issues">
  </a>
  <a href="https://github.com/itsmeadarsh2008/monochrome-plus/blob/master/license">
    <img src="https://img.shields.io/github/license/itsmeadarsh2008/monochrome-plus?style=for-the-badge&logo=opensourceinitiative&logoColor=ffffff&color=000000&labelColor=000000" alt="License">
  </a>
  <a href="https://github.com/itsmeadarsh2008/monochrome-plus/commits/master">
    <img src="https://img.shields.io/github/last-commit/itsmeadarsh2008/monochrome-plus?style=for-the-badge&logo=git&logoColor=ffffff&color=000000&labelColor=000000" alt="Last commit">
  </a>
  <a href="https://discord.gg/ncKKpJpZbk">
    <img src="https://img.shields.io/badge/join-000000?style=for-the-badge&logo=discord&logoColor=ffffff&label=Discord" alt="Discord">
  </a>
</p>

<p align="center">
  <a href="#what-is-monochrome">About</a> •
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#usage">Usage</a> •
  <a href="#self-hosting">Self-Hosting</a> •
  <a href="docs/CONTRIBUTE.md">Contributing</a> •
  <a href="https://discord.gg/ncKKpJpZbk">Discord</a>
</p>

---

## What is Monochrome+?

**Monochrome+** is a fork of [Monochrome](https://github.com/monochrome-music/monochrome) reimagined
as a **bring-your-own-source** music client. It ships with **no music provider built in and no
hard-coded API**. Instead, it is a fully **Eclipse-compatible** app — any addon that speaks the
[Eclipse addon protocol](https://eclipsemusic.app/docs) becomes your stream source.

You deploy (or pick) an addon — a self-hostable server or Cloudflare Worker that provides search,
streaming, and catalog endpoints for services such as **TIDAL** and **Qobuz**. Paste one addon URL
in **Settings → Eclipse Addon** and the app does the rest. Switch addons any time — no account
lock-in, no vendor tie-in.

## Why bring your own source?

> Monochrome+ never decides what you listen to — **you do**.

- **Your data, your rules.** No built-in tracking, no ads, no third-party analytics.
- **Any Eclipse addon works.** TIDAL, Qobuz, self-hosted servers, or your own Cloudflare Worker.
- **Switch freely.** Swap providers in seconds; playlists and library stay intact.

> **Privacy is opt-in.** The app itself never tracks you. The only thing that exposes anything
> about you is the optional account system used for cross-device sync — and that's entirely your
> choice. If you do create an account, your username/profile becomes **searchable by other users**,
> so only sign up if you're comfortable with that.

All wrapped in a clean, minimalist interface for streaming high-quality music without the clutter
of traditional platforms.

---

## Features

### Audio Quality

- Hi-Res / lossless streaming with **real stream quality** shown in the player
  (bit depth, sample rate, container format reported by the addon)
- Adaptive streaming (**DASH/HLS**) plus progressive streaming for regular files
- Rate-limit-aware request queue with automatic **429 retry** and a priority lane for playback
- Local music file support
- Intelligent API caching for faster, smoother playback

### Interface

- Modern, minimalist glassmorphism UI
- Customizable themes and fonts (Google Fonts via the CoolLabs proxy, URLs, or uploads)
- Accurate, unique audio visualizer
- Karaoke lyrics with haptic sync
- Offline-capable **Progressive Web App (PWA)**
- Media Session API integration for system controls
- Keyboard shortcuts for power users

### Library & Organization

- Recently Played history tracking
- Comprehensive personal library for favorites
- Queue management with shuffle, repeat, and gapless playback
- Playlist import from other platforms
- Public playlists for social sharing
- Smart recommendations for new songs, albums & artists
- Unreleased music tracking

### Lyrics & Metadata

- Full lyrics support with karaoke mode
- Genius integration for lyrics

### Integrations

- Account system for cross-device syncing (powered by Appwrite)
- Last.fm, ListenBrainz, Maloja, and LibreFM scrobbling
- **Eclipse-compatible addon backend** — bring your own stream source

### Download

- High-quality downloads (including DASH manifest resolution)
- Bulk album / playlist downloads with custom filename templates

---

## Quick Start

### 1. Use the live instance

```bash
# Just open it in your browser
https://monochrome-plus.appwrite.network
```

### 2. Install an addon

Monochrome+ needs an Eclipse addon for search and streaming:

1. Deploy (or pick) an addon — see the [Eclipse addon docs](https://eclipsemusic.app/docs),
   e.g. a TIDAL or Qobuz addon
2. Open **Settings → Eclipse Addon**
3. Paste the addon's URL and click **Install**
4. Test the connection, then search and play

---

## Usage

### Basic usage

1. Open the app (live instance or your local build)
2. Search for artists, albums, or tracks
3. Hit play to start streaming
4. Use the player to manage playback, queue, and volume

### Keyboard shortcuts

| Shortcut | Action         |
| -------- | -------------- |
| `Space`  | Play / Pause   |
| `→`      | Next track     |
| `←`      | Previous track |
| `↑`      | Volume up      |
| `↓`      | Volume down    |
| `M`      | Mute / Unmute  |
| `L`      | Toggle lyrics  |
| `F`      | Fullscreen     |
| `/`      | Focus search   |

### Accounts

To sync your library, history, and playlists across devices:

1. Open the Profile section
2. Sign in with Discord or email
3. Your data syncs automatically

---

## Self-Hosting

> **Note:** Accounts won't work on self-hosted instances.

### Docker (recommended)

```bash
git clone https://github.com/itsmeadarsh2008/monochrome-plus.git
cd monochrome-plus
docker compose up -d
```

See [docs/DOCKER.md](docs/DOCKER.md) for the full Docker guide.

---

## Contributing

Contributions are welcome! Read [docs/CONTRIBUTE.md](docs/CONTRIBUTE.md) to get started.

<p align="center">
  <sub>Made with passion for music. No ads. No tracking. Just your source.</sub>
</p>
