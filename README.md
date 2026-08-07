<p align="center">
  <a href="https://monochrome-plus.appwrite.network">
    <img src="https://github.com/itsmeadarsh2008/monochrome-plus/blob/main/public/assets/512.png?raw=true" alt="Monochrome+ Logo" width="150px">
  </a>
</p>

<h1 align="center">Monochrome+</h1>

<p align="center">
  <strong>An open-source, privacy-respecting, ad-free Hi-Fi client. Bring your own source.</strong>
</p>

<p align="center">
  <a href="https://monochrome-plus.appwrite.network">Website</a> •
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#self-hosting">Self-Hosting</a> •
  <a href="docs/CONTRIBUTE.md">Contributing</a>
</p>

<p align="center">
  <a href="https://github.com/itsmeadarsh2008/monochrome-plus/stargazers">
    <img src="https://img.shields.io/github/stars/itsmeadarsh2008/monochrome-plus?style=for-the-badge&color=ffffff&labelColor=000000" alt="GitHub stars">
  </a>
  <a href="https://github.com/itsmeadarsh2008/monochrome-plus/forks">
    <img src="https://img.shields.io/github/forks/itsmeadarsh2008/monochrome-plus?style=for-the-badge&color=ffffff&labelColor=000000" alt="GitHub forks">
  </a>
  <a href="https://github.com/itsmeadarsh2008/monochrome-plus/issues">
    <img src="https://img.shields.io/github/issues/itsmeadarsh2008/monochrome-plus?style=for-the-badge&color=ffffff&labelColor=000000" alt="GitHub issues">
  </a>
</p>

---

## What is Monochrome+?

**Monochrome+** is an open-source, privacy-respecting, ad-free Hi-Fi client forked from
[Monochrome](https://github.com/monochrome-music/monochrome). It is **bring-your-own-source**:
the app ships with no music provider built in and no hard-coded API. Instead, it is a fully
**Eclipse-compatible** music app — any addon that speaks the
[Eclipse addon protocol](https://eclipsemusic.app/docs) works as your stream source.

Deploy (or pick) an addon — a self-hostable server or Cloudflare Worker that provides search,
streaming and catalog endpoints for services such as TIDAL and Qobuz. Paste one addon URL in
**Settings → Eclipse Addon** and the app does the rest. Your music source is your choice:
switch addons any time, no account lock-in, no vendor tie-in.

It provides a clean, minimalist interface for streaming high-quality music without the
clutter of traditional platforms.

---

## Features

### Audio Quality

- Hi-Res/lossless audio streaming with real stream quality shown in the player
  (bit depth, sample rate, container format from the addon)
- Adaptive streaming (DASH/HLS) plus progressive streaming for regular files
- Rate-limit-aware request queue with automatic 429 retry and priority lane for playback
- Support for local music files
- Intelligent API caching for improved performance

### Interface

- Modern, minimalist interface with glassmorphism
- Customizable themes and fonts (Google Fonts via the CoolLabs proxy, URLs, or uploads)
- Accurate and unique audio visualizer
- Karaoke lyrics with haptic sync
- Offline-capable Progressive Web App (PWA)
- Media Session API integration for system controls
- Keyboard shortcuts for power users

### Library & Organization

- Recently Played tracking for easy history access
- Comprehensive Personal Library for favorites
- Queue management with shuffle, repeat, and gapless playback modes
- Playlist import from other platforms
- Public playlists for social sharing
- Smart recommendations for new songs, albums & artists
- Unreleased music tracking

### Lyrics & Metadata

- Lyrics support with karaoke mode
- Genius integration for lyrics

### Integrations

- Account system for cross-device syncing (Powered by Appwrite)
- Last.fm, ListenBrainz, Maloja and LibreFM support for scrobbling
- Eclipse-compatible addon backend — bring your own stream source

### Download

- High-quality downloads (including DASH manifest resolution)
- Bulk album/playlist downloads with custom filename templates

---

## Quick Start

### Live Instance

Use the official instance:

👉 **https://monochrome-plus.appwrite.network**

### Installing an Addon

Monochrome+ needs an Eclipse addon for search and streaming:

1. Deploy an addon (see [eclipsemusic.app](https://eclipsemusic.app/docs)) — e.g. a TIDAL or Qobuz addon
2. Open **Settings → Eclipse Addon**
3. Paste the addon's URL and click **Install**
4. Test the connection, then search and play

---

## Usage

### Basic Usage

1. Visit the website or your local instance
2. Search for artists, albums, or tracks
3. Click play to start streaming
4. Use media controls to manage playback, queue, and volume

### Keyboard Shortcuts

| Shortcut | Action         |
| -------- | -------------- |
| `Space`  | Play/Pause     |
| `→`      | Next track     |
| `←`      | Previous track |
| `↑`      | Volume up      |
| `↓`      | Volume down    |
| `M`      | Mute/Unmute    |
| `L`      | Toggle lyrics  |
| `F`      | Fullscreen     |
| `/`      | Focus search   |

### Account Features

To sync your library, history, and playlists across devices:

1. Open the Profile section
2. Sign in with Discord or email
3. Your data syncs automatically

---

## Self-Hosting

> NOTE: Accounts won't work on self-hosted instances.

### Option 1: Docker (Recommended)

```bash
git clone https://github.com/itsmeadarsh2008/monochrome-plus.git
cd monochrome-plus
docker compose up -d
```

See [docs/DOCKER.md](docs/DOCKER.md) for the full Docker guide.
