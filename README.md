


<p align="center">
  <a href="https://monochrome-plus.appwrite.network">
    <img src="https://github.com/itsmeadarsh2008/monochrome-plus/blob/main/public/assets/512.png?raw=true" alt="Monochrome+ Logo" width="150px">
  </a>
</p>

<h1 align="center">Monochrome+</h1>

<p align="center">
  <strong>An open-source, privacy-respecting, ad-free Hi-Fi client.</strong>
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

**Monochrome+** is an open-source, privacy-respecting, ad-free Hi-Fi client built on top of [Hi-Fi](https://github.com/binimum/hifi-api).

It provides a clean, minimalist interface for streaming high-quality music without the clutter of traditional platforms.


## Images Preview

<p align="center">
  <img src="https://i.postimg.cc/nzrxgL0C/image.png" alt="Preview 1" width="80%"/>
</p>
<p align="center">
  <img src="https://i.postimg.cc/L6tszn7B/image.png" alt="Preview 2" width="80%"/>
</p>

---

## Features

### Audio Quality

- High-quality Hi-Res/lossless audio streaming
- Support for local music files
- Intelligent API caching for improved performance

### Interface

- Modern, minimalist interface with glassmorphism
- Customizable themes
- Accurate and unique audio visualizer
- Offline-capable Progressive Web App (PWA)
- Media Session API integration for system controls

### Library & Organization

- Recently Played tracking for easy history access
- Comprehensive Personal Library for favorites
- Queue management with shuffle and repeat modes
- Playlist import from other platforms
- Public playlists for social sharing
- Smart recommendations for new songs, albums & artists

### Lyrics & Metadata

- Lyrics support with karaoke mode
- Genius integration for lyrics

### Integrations

- Account system for cross-device syncing (Powered by Appwrite)
- Last.fm and ListenBrainz integration for scrobbling
- Unreleased music from [ArtistGrid](https://artistgrid.cx)
- Dynamic Discord embeds
- Multiple API instance support with failover

### Power User Features

- Keyboard shortcuts for power users

---

## Quick Start

### Live Instance

Use the official instance:

👉 **https://monochrome-plus.appwrite.network**

For alternative instances, see [docs/INSTANCES.md](docs/INSTANCES.md).

---

## Usage

### Basic Usage

1. Visit the website or your local instance  
2. Search for artists, albums, or tracks  
3. Click play to start streaming  
4. Use media controls to manage playback, queue, and volume  

### Keyboard Shortcuts

| Shortcut | Action         |
|----------|---------------|
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

> NOTE: Accounts won’t work on self-hosted instances.

### Option 1: Docker (Recommended)

```bash
git clone https://github.com/itsmeadarsh2008/monochrome-plus.git
cd monochrome-plus
docker compose up -d