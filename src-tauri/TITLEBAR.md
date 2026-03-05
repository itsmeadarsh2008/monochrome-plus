# Monochrome+ Custom Titlebar

A beautiful, cross-platform custom titlebar for Monochrome+.

## Features

- 🎨 **Beautiful Design**: Gradient background with glassmorphism effects
- 🖥️ **Cross-Platform**: Adapts to Windows, macOS, and Linux
- 🌙 **Dark/Light Theme Support**: Respects system theme preferences
- ♿ **Accessible**: Proper ARIA labels and keyboard support
- 🎭 **Animations**: Smooth hover effects and transitions
- 📱 **Responsive**: Works on all screen sizes

## Integration

### 1. Import the CSS

Add the titlebar CSS to your HTML `<head>`:

```html
<link rel="stylesheet" href="../src-tauri/titlebar.css">
```

Or import it in your JavaScript:

```javascript
import '../src-tauri/titlebar.css';
```

### 2. Import and Initialize

In your main JavaScript file:

```javascript
import { initTitlebar } from '../src-tauri/titlebar.js';

// Initialize the titlebar
initTitlebar();
```

### 3. Adjust Your Content

The titlebar is 40px tall. Add the `content-with-titlebar` class to your main content container:

```html
<main class="content-with-titlebar">
    <!-- Your app content -->
</main>
```

This automatically adds the necessary margin to prevent content from being hidden under the titlebar.

## How It Works

### Window Controls

The titlebar provides three window control buttons:

- **Minimize** (`─`): Minimizes the window to the taskbar
- **Maximize/Restore** (`□`/`◱`): Toggles between maximized and windowed states
- **Close** (`×`): Closes the application

### Drag Functionality

- Click and drag on the app name/logo area to move the window
- Double-click on the drag area to maximize/restore the window

### Platform Detection

The titlebar automatically detects the platform and adjusts its appearance:

- **Windows/Linux**: Buttons on the right, gradient background
- **macOS**: Traffic light buttons on the left (red, yellow, green circles)

## Customization

### Changing Colors

Edit the CSS variables in `titlebar.css`:

```css
.titlebar {
    background: linear-gradient(135deg, #your-color-1 0%, #your-color-2 100%);
}
```

### Changing the Logo

Replace the SVG in the `insertTitlebar()` function in `titlebar.js`:

```javascript
<svg class="titlebar-logo" viewBox="0 0 24 24">
    <!-- Your custom SVG path -->
</svg>
```

### Changing the App Name

Edit the app name in the `insertTitlebar()` function:

```javascript
<span class="titlebar-app-name">Your App Name</span>
```

## Configuration in tauri.conf.json

The titlebar requires these settings in `tauri.conf.json`:

```json
{
    "app": {
        "windows": [{
            "decorations": false,
            "transparent": false
        }]
    },
    "capabilities": {
        "permissions": [
            "core:window:allow-minimize",
            "core:window:allow-maximize",
            "core:window:allow-unmaximize",
            "core:window:allow-close",
            "core:window:allow-start-dragging",
            "core:window:allow-toggle-maximize"
        ]
    }
}
```

## Browser Support

The titlebar is designed for Tauri applications. It uses:

- `app-region: drag` for window dragging
- Tauri API for window controls
- CSS backdrop-filter for glassmorphism effects

## Accessibility

- All buttons have proper `aria-label` attributes
- Buttons have clear focus indicators
- Supports `prefers-reduced-motion` for users who prefer reduced animations
- Supports `prefers-contrast: high` for high contrast mode

## Troubleshooting

### Titlebar Not Appearing

1. Check that `decorations: false` is set in `tauri.conf.json`
2. Verify the CSS and JS files are properly imported
3. Check the browser console for errors

### Window Controls Not Working

1. Verify all window permissions are granted in capabilities
2. Check that `@tauri-apps/api` is installed
3. Ensure `initTitlebar()` is called after the DOM is ready

### Drag Not Working

1. Make sure `core:window:allow-start-dragging` permission is granted
2. Check that the `data-tauri-drag-region` attribute is on the drag element

## License

Part of Monochrome+ - Copyright (c) 2026 Monochrome+ Team
