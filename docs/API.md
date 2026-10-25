# REST API

For automations. It translates requests into the same commands the apps use, and reports what the playing device last told the hub. It never contacts your music server.

## Authentication

Send `Authorization: Bearer <token>`.

| Token | Allows |
|---|---|
| `API_TOKEN` | everything, including control (`POST`) |
| `API_TOKEN_READONLY` | `GET` endpoints only |
| `HUB_TOKEN` | `GET` endpoints only |

`GET` endpoints also accept `?key=<API_TOKEN_READONLY>` for clients that cannot send headers. The full-control token is never accepted in a URL. Requests are limited to 600 per minute per client address.

Errors are JSON: `{"error": "<code>"}` with the usual status (400, 401, 403, 404, 409, 413, 429).

## Read

### `GET /api/state`

```json
{
  "server_time": "2026-10-23T18:04:11.482Z",
  "active_device": { "id": "desk-1a2b", "name": "Psysonic Desktop", "kind": "desktop" },
  "playing": true,
  "track": {
    "id": "7f3c...",
    "title": "Love of Mine",
    "artist": "Benson Boone",
    "album": "Fireworks & Rollerblades",
    "album_id": "a1",
    "artist_id": "b2",
    "duration_sec": 203,
    "cover_url": "https://hub.example.com/api/cover?track=7f3c...&v=3f9a"
  },
  "position_sec": 46.2,
  "volume": 0.74,
  "shuffle": false,
  "repeat": "off",
  "devices": [
    { "id": "desk-1a2b", "name": "Psysonic Desktop", "kind": "desktop", "active": true },
    { "id": "lap-9z8y", "name": "Psysonic laptop", "kind": "desktop", "active": false }
  ]
}
```

`position_sec` is already advanced to the moment of the request while playing. `cover_url` is `null` when no cover is available. Without `HUB_PUBLIC_URL` the URL is relative (`/api/cover?...`).

### `GET /api/devices`

`{ "devices": [ ... ] }` — the players (web remotes are not listed).

### `GET /api/cover[?track=<id>]`

The current track's cover image (`image/jpeg`, `image/png` or `image/webp`) with an `ETag`, or `404` when there is none. With `track` it only answers if that is the current track. The playing device uploads it, so it can arrive a moment after the track starts.

### `GET /api/events`

A live stream (Server-Sent Events). The first event is the current state, then another after every change:

```
event: state
data: { ...same JSON as /api/state... }
```

Position is not streamed continuously: extrapolate from `position_sec` and `server_time` while `playing` is true. A comment line (`: ping`) is sent every 20 seconds.

## Control (needs `API_TOKEN`)

All bodies are JSON. By default a command goes to the active device; add `"device": "<id or name>"` to target another player. A name may be partial and any case: `"laptop"` finds "Psysonic laptop". If a partial name fits several players the answer is `409 ambiguous_device` with a `matches` list; if it fits none, `404 unknown_device`. If nothing is active the answer is `409 no_active_device`.

| Request | Body |
|---|---|
| `POST /api/play`, `/pause`, `/toggle`, `/next`, `/prev` | none |
| `POST /api/seek` | `{"positionSec": 90}` or `{"delta": -10}` |
| `POST /api/volume` | `{"volume": 0.5}` (0 to 1) or `{"delta": 0.05}` |
| `POST /api/shuffle` | `{"value": true}`, `false` or `"toggle"` |
| `POST /api/repeat` | `{"value": "off"}`, `"all"`, `"one"` or `"cycle"` |
| `POST /api/transfer` | `{"device": "Laptop"}` — move playback there. Answers `409 server_mismatch` if that device uses a different music server or account. The handoff itself is asynchronous (the playing device saves its queue first), so check `/api/state` afterwards |
| `POST /api/command` | `{"action": "...", "args": {...}, "device": "..."}` (any of the above by name) |

Relative values (`delta`, `"toggle"`, `"cycle"`) start from what **the targeted device** last reported, not from the active device. If that device has not reported the needed value yet, the answer is `409 device_state_unknown` (an absolute value always works).

Success: `{"ok": true, "target": {"id": "...", "name": "..."}}`.

## Examples

```sh
HUB=http://hub.local:5533
curl -s -H "Authorization: Bearer $API_TOKEN" $HUB/api/state
curl -s -X POST -H "Authorization: Bearer $API_TOKEN" $HUB/api/next
curl -s -X POST -H "Authorization: Bearer $API_TOKEN" -d '{"delta":-10}' $HUB/api/seek
curl -s -X POST -H "Authorization: Bearer $API_TOKEN" -d '{"device":"Laptop"}' $HUB/api/transfer
curl -N -H "Authorization: Bearer $API_TOKEN_READONLY" $HUB/api/events
```

## Building a media player tile (for example in Home Assistant)

Everything a "mini player" needs is available:

- **Now playing, cover, position, volume, shuffle, repeat:** `GET /api/state`, or `GET /api/events` for push updates (poll `/api/state` every few seconds if streaming is inconvenient).
- **Cover art:** `track.cover_url` (set `HUB_PUBLIC_URL`). It needs credentials: send the read-only token as a header, or append `?key=<API_TOKEN_READONLY>` where headers are impossible.
- **Buttons and sliders:** `play`/`pause`/`toggle`, `next`, `prev`, `seek`, `volume`, `shuffle`, `repeat`.
- **Source picker:** `devices` in the state, and `POST /api/transfer`.
