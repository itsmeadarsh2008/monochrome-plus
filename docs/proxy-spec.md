# Monochrome+ CORS Forward Proxy — Specification

## Overview

A lightweight CORS forward proxy that allows the Monochrome+ web client to access API/streaming instances through a user-hosted intermediary. The client sends requests to the proxy with the target URL encoded in the path. The proxy decodes it, forwards the request upstream, and streams the response back with CORS headers.

## Request Format

The client constructs URLs as:

```
GET https://<proxy_host>/<url-encoded target URL>
```

### Examples

```
# Client wants to reach: https://eu-central.monochrome.tf/api/track/12345
# It sends:
GET https://proxy.example.com/https%3A%2F%2Feu-central.monochrome.tf%2Fapi%2Ftrack%2F12345

# Health/latency test (HEAD request):
HEAD https://proxy.example.com/https%3A%2F%2Feu-central.monochrome.tf%2F
```

The proxy must URL-decode the first path segment to obtain the full target URL.

## Behavior

### Request Forwarding

1. Extract everything after the first `/` in the request path.
2. URL-decode it to get the target URL.
3. Validate the target URL against the hostname allowlist (see below).
4. Forward the request to the target URL preserving:
    - HTTP method (`GET`, `HEAD`, `POST`, etc.)
    - Request headers (except `Host`, which must be set to the target's host)
    - Request body (if any)
5. Stream the upstream response back to the client preserving:
    - Status code
    - Response headers
    - Response body (streamed, not buffered — critical for audio streaming)

### CORS Headers

Every response (including errors and preflight) **must** include:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS
Access-Control-Allow-Headers: *
Access-Control-Expose-Headers: *
```

`OPTIONS` preflight requests must return `204 No Content` with the above CORS headers immediately (no upstream forwarding).

### Hostname Allowlist

Only forward requests to these upstream hostname patterns. Reject all others with `403 Forbidden`.

```
*.monochrome.tf
*.squid.wtf
*.qqdl.site
*.kinoplus.online
*.samidy.com
listen.tidal.com
```

This prevents the proxy from being abused as an open relay.

### Error Responses

| Condition                   | Status | Body                                   |
| --------------------------- | ------ | -------------------------------------- |
| Missing/empty target URL    | `400`  | `{"error": "Missing target URL"}`      |
| Target URL fails allowlist  | `403`  | `{"error": "Target host not allowed"}` |
| Upstream connection failure | `502`  | `{"error": "Upstream unreachable"}`    |
| Upstream timeout (>15s)     | `504`  | `{"error": "Upstream timeout"}`        |

All error responses must include the CORS headers above.

### Rate Limiting

- **100 requests/minute per IP** (suggested default, make configurable)
- Return `429 Too Many Requests` when exceeded with a `Retry-After` header

## Deployment Targets

The proxy should be deployable on any of these (pick one or support multiple):

| Platform           | Runtime     | Notes                                           |
| ------------------ | ----------- | ----------------------------------------------- |
| Cloudflare Workers | JS          | Free tier: 100k req/day. Best latency via edge. |
| Deno Deploy        | TS/JS       | Free tier available. Native `fetch` streaming.  |
| Fly.io             | Node/Docker | Persistent process, good for streaming.         |
| Self-hosted VPS    | Node/Bun    | Full control. Use behind nginx/caddy for TLS.   |

## Health Endpoint

```
GET https://proxy.example.com/
```

Must return `200 OK` with:

```json
{ "status": "ok" }
```

This is NOT a proxied request — it's a direct health check on the proxy itself. Only requests with a non-empty encoded URL after `/` are forwarded.

## Non-Requirements

- No authentication/API keys on the proxy itself (it's per-user self-hosted)
- No caching (the client has its own cache layer)
- No request/response body modification or rewriting
- No WebSocket support
- No logging of request/response bodies (privacy)

## Reference: Client Integration

The client code that calls this proxy (for context only, do not modify):

```js
// Builds the proxied URL
buildProxiedUrl(proxyUrl, targetUrl) {
    return `${proxyUrl}/${encodeURIComponent(targetUrl)}`;
}

// Used in fetch:
const url = proxy
    ? buildProxiedUrl(proxy.url, instanceUrl)
    : instanceUrl;
fetch(url, { signal });

// Latency test (HEAD):
const url = `${proxyUrl}/${encodeURIComponent('https://eu-central.monochrome.tf/')}`;
fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
```
