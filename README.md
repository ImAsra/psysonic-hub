# Psysonic Hub

A small, optional, self-hosted service for [Psysonic](https://github.com/Psychotoxical/psysonic). It lets your own devices see each other, hand playback over (like Spotify Connect), control each other, share selected settings, and exposes a REST API for automations such as Home Assistant.

- **Your server, your data.** The hub only relays small messages between your devices. It never plays audio and never talks to your music server; it holds no music-server credentials.
- **Optional.** Psysonic only uses the hub if you enter its address in the settings. Without it, everything works as before.
- **One container**, one port (5533), no database.

## Quick start

You need Docker with Compose. Put `compose.yaml` and `.env` in a folder:

```sh
cp .env.example .env
# edit .env: set HUB_TOKEN, and HUB_USER + HUB_PASSWORD for the web page
docker compose up -d
```

Then open `http://<server>:5533/` and sign in. In Psysonic, go to **Settings → Integrations → Realtime hub**, switch it on, and enter the hub address (`http://<server>:5533`) and your `HUB_TOKEN`.

Check it is up: `curl http://<server>:5533/health`.

> Replace `OWNER` in `compose.yaml` with the GitHub user or organization that publishes the image. If you would rather not use a registry, the commented `build:` line builds straight from the repository.

## Configuration (`.env`)

| Variable | Required | What it does |
|---|---|---|
| `HUB_TOKEN` | yes | Used by the Psysonic apps. 16+ characters. |
| `HUB_USER`, `HUB_PASSWORD` | no | Web page login. Password 10+ characters. If unset, the page asks for `HUB_TOKEN`. |
| `API_TOKEN` | no | Full control over the REST API. 24+ characters. API control is off without it. |
| `API_TOKEN_READONLY` | no | Read-only API access (state, devices, cover art, events). |
| `HUB_PUBLIC_URL` | no | Makes `cover_url` in the API an absolute link, e.g. `https://hub.example.com`. |
| `HUB_TRUST_PROXY` | no | `1` when a reverse proxy is in front (real client address and https come from `X-Forwarded-*`). |
| `HUB_ALLOWED_ORIGINS` | no | Extra browser origins allowed to open the web socket. |
| `HUB_CORS_ORIGINS` | no | Browser origins allowed to call `/api` from another site. |
| `HUB_SERVER_CHECK` | no | `off` to allow handing playback between devices on different music servers or accounts (default: refused, because the queue travels through the music server). If two devices reach the same server by different addresses, give each the other's address as its alternate address instead. |
| `HUB_YIELD_TIMEOUT_MS` | no | How long the playing device may take to save its queue during a handoff before the transfer is cancelled. Default `10000`. |
| `HUB_MAX_CONNECTIONS`, `HUB_MAX_CONNECTIONS_PER_IP` | no | Open connections in total and per address. Default `64` and `16`. |
| `HUB_BIND` | no | Address to listen on outside Docker (default all). |
| `HUB_TOKEN_FILE`, `HUB_PASSWORD_FILE`, `API_TOKEN_FILE`, `API_TOKEN_READONLY_FILE` | no | Read that secret from a file instead (Docker secrets). |
| `PORT`, `MAX_DEVICES` | no | Default `5533` and `16`. |

Generate secrets with `openssl rand -hex 24`.

## Using it from outside your home network

Put the hub behind a reverse proxy with HTTPS (or use a VPN such as WireGuard or Tailscale). Set `HUB_TRUST_PROXY=1` and `HUB_PUBLIC_URL`. The proxy must pass **WebSocket upgrades** and must **not buffer** the event stream (`/api/events`).

Caddy:

```
hub.example.com {
    reverse_proxy 127.0.0.1:5533
}
```

nginx (the relevant parts):

```
location / {
    proxy_pass http://127.0.0.1:5533;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

## Security

The hub is meant for a home network or a VPN, and it is built to be hard to abuse: separate credentials for apps, web page and API, a lockout on guessing, strict browser protections, size- and rate-limited input, and a locked-down container. Details, the threat model, a deployment checklist and known limitations are in [SECURITY.md](SECURITY.md). Please report vulnerabilities privately (see there).

The short version: use generated secrets, do not expose the port directly to the internet, put a VPN or an HTTPS reverse proxy in front for anything beyond your LAN, and keep the image updated.

## What is synced

Settings sync works in categories you switch on from the web page: playback (crossfade, AutoDJ, gapless...), volume normalization, lyrics, appearance, equalizer and keybindings. Server addresses and credentials are never shared.

## REST API and live events

For Home Assistant, Stream Deck, scripts and the like: see [docs/API.md](docs/API.md). The wire protocol the apps speak is in [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Roadmap

Planned or under consideration, roughly in this order:

- **Webhooks:** the hub calls a URL you configure when the track, play state or active device changes (Home Assistant, n8n, scripts).
- **Config export and backup:** Psysonic exporting its settings as JSON, and the hub keeping scheduled, off-site copies per device with a "restore from hub" option on a fresh install. Depends on the settings refactoring planned in Psysonic.
- **Library analysis sharing:** devices on the same music server sharing the results of heavy analysis instead of each redoing it.
- **Ideas:** MQTT / Home Assistant discovery, a small activity history, per-device tokens.

The hub is an independent project: Psysonic itself only gets the minimal, documented changes needed for compatibility, listed in [docs/PSYSONIC-INTEGRATION.md](docs/PSYSONIC-INTEGRATION.md).

## Development

```sh
npm ci --ignore-scripts
HUB_TOKEN=a-long-test-token-123 HUB_USER=me HUB_PASSWORD=a-long-password node server.js
npm test
```

`tools/remote.js` is a tiny command-line remote and `tools/fakeplayer.js` a fake second player, handy for trying things without another device.

## License

Not chosen yet. Psysonic itself is GPL-3.0-or-later; matching it keeps the two projects compatible.
