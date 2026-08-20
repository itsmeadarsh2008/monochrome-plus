/**
 * Vite plugin: embeds the Discord Rich Presence bridge into the dev server.
 *
 * The browser talks to the bridge at /api/discord/* (same origin, no CORS,
 * no origin whitelist needed) and the bridge forwards to Discord Desktop's
 * local IPC socket. See server/discord-bridge.js for the protocol.
 */
import { createDiscordBridge } from './server/discord-bridge.js';

export default function discordBridgePlugin() {
    let bridge = null;

    return {
        name: 'vite-plugin-discord-bridge',
        configureServer(server) {
            bridge = createDiscordBridge();
            server.middlewares.use((req, res, next) => bridge.handler(req, res, next));
            server.httpServer?.on('close', () => bridge.teardown());
        },
        configurePreviewServer(server) {
            bridge = createDiscordBridge();
            server.middlewares.use((req, res, next) => bridge.handler(req, res, next));
            server.httpServer?.on('close', () => bridge.teardown());
        },
        closeBundle() {
            bridge?.teardown();
            bridge = null;
        },
    };
}
