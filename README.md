<p align="center">
  <a href="https://monochrome-plus.appwrite.network">
    <img src="https://github.com/itsmeadarsh2008/monochrome-plus/blob/main/public/assets/512.png?raw=true" alt="Monochrome+ Logo" width="150px">
  </a>
</p>

<h1 align="center">Monochrome+</h1>

<p align="center">
  <strong>An open-source, privacy-respecting, ad-free music app.</strong>
</p>

<p align="center">
  <a href="https://monochrome-plus.appwrite.network">Website</a> •
  <a href="https://ko-fi.com/monochromemusic">Donate</a> •
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

**Monochrome+** is an open-source, privacy-respecting, ad-free [TIDAL](https://tidal.com) web UI, built on top of [Hi-Fi](https://github.com/binimum/hifi-api). It provides a beautiful, minimalist interface for streaming high-quality music without the clutter of traditional streaming platforms.

<p align="center">
  <a href="https://monochrome-plus.appwrite.network/#album/90502209">
    <img width="2559" height="1439" alt="Monochrome UI" src="" width="800">
  </a>
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
- Dynamic Discord Embeds
- Multiple API instance support with failover

### Power User Features

- Keyboard shortcuts for power users

---

## Quick Start

### Live Instance

Our recommended way to use Monochrome+ is through the official instance:

**[monochrome-plus.appwrite.network](https://monochrome-plus.appwrite.network)**

For alternative instances, check [docs/INSTANCES.md](docs/INSTANCES.md).

---

## Self-Hosting

NOTE: Accounts won’t work on self-hosted instances.

### Option 1: Docker (Recommended)

```bash
git clone https://github.com/itsmeadarsh2008/monochrome-plus.git
cd monochrome-plus
docker compose up -d
```

Visit `http://localhost:3000`

For PocketBase, development mode, and advanced setups, see [docs/DOCKER.md](docs/DOCKER.md).

### Option 2: Manual Installation

#### Prerequisites

- [Node.js](https://nodejs.org/) (Version 20+ or 22+ recommended)
- [Bun](https://bun.sh/) or [npm](https://www.npmjs.com/)

#### Local Development

1. **Clone the repository:**

    ```bash
    git clone https://github.com/itsmeadarsh2008/monochrome-plus.git
    cd monochrome-plus
    ```

2. **Install dependencies:**

    ```bash
    bun install
    # or
    npm install
    ```

3. **Start the development server:**

    ```bash
    bun run dev
    # or
    npm run dev
    ```

4. **Open your browser:**
   Navigate to `http://localhost:5173/`.

#### Building for Production

```bash
bun run build
# or
npm run build
```

---

## Usage

### Basic Usage

1. Visit the [Website](https://monochrome-plus.appwrite.network) or your local development server
2. Search for your favorite artists, albums, or tracks
3. Click play to start streaming
4. Use the media controls to manage playback, queue, and volume

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

1. Click the Profile section
2. Sign in with Discord or email
3. Your data automatically syncs across devices

---

## Contributing

We welcome contributions from the community. Please see [docs/CONTRIBUTE.md](docs/CONTRIBUTE.md).

---

<p align="center">
  <a href="https://fmhy.net/audio#streaming-sites">
    <img src="https://raw.githubusercontent.com/itsmeadarsh2008/monochrome-plus/refs/heads/main/public/assets/asseenonfmhy880x310.png" alt="As seen on FMHY" height="50">
  </a>
</p>

<p align="center">
  Made with ❤️ by the Monochrome+ team
</p>
