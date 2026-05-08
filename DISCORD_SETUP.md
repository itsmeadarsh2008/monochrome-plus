# Discord Rich Presence Setup

## ✅ **Already Configured!**

Monochrome+ Discord Rich Presence is pre-configured with Application ID: `1478608904609857576`

## 📋 **What You Need to Do:**

1. **Upload Rich Presence Assets** in your [Discord Developer Portal](https://discord.com/developers/applications/1478608904609857576/rich-presence/assets)
2. **Required Images:**
    - `monochrome_logo` (256x256) - Main Monochrome+ logo
    - `play_icon` (small) - Play button icon
    - `pause_icon` (small) - Pause button icon

## 🔧 **Optional Environment Override:**

You can override the Application ID by setting:

```bash
export DISCORD_CLIENT_ID=your_custom_app_id
```

## 🎵 **API Usage**

The Discord rich presence will automatically start when the app launches. Use these APIs to update presence:

```javascript
// Set current track (automatic formatting)
window.electrobunAPI.setNowPlaying({
    title: 'Song Title',
    artist: 'Artist Name',
    duration: 180, // seconds
    currentTime: 0, // seconds
});

// Custom presence update
window.electrobunAPI.updateDiscordPresence({
    details: 'Listening to music',
    state: 'Monochrome+',
    largeImageKey: 'monochrome_logo',
    smallImageKey: 'play_icon',
});

// When paused:
window.electrobunAPI.updateDiscordPresence({
    details: 'Paused - Amazing Song',
    state: 'by Great Artist',
    largeImageKey: 'monochrome_logo',
    smallImageKey: 'pause_icon',
    smallImageText: 'Paused',
    // Remove timestamps when paused
});
```

## 📊 **Rich Presence Features**

- **Track Info**: Shows song title and artist
- **Playback Status**: Play/pause icons and text
- **Progress**: Start/end timestamps for progress bar
- **Branding**: Monochrome+ logo and custom icons
- **Real-time Updates**: Automatically updates as you listen
