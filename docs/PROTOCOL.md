# Wire protocol (version 1)

What the Psysonic apps speak: JSON messages over a WebSocket at `/ws`.

## Handshake

The first message must be `hello` within 5 seconds:

`{ "t": "hello", "v": 1, "token": "...", "deviceId": "desk-1a2b", "name": "Psysonic Desktop", "kind": "desktop" }`

- `kind` is `desktop`, `phone` or `web`. A `web` device is a remote: it can control players but is not one itself.
- The web page authenticates with its login session cookie instead of a token and is always treated as `web`.
- `deviceId`: 4 to 64 characters of letters, digits, `_` and `-`.

The hub answers with `welcome`: `{ t, v, you, devices, state, settings, syncConfig, syncCatalog }`.

## Device messages (players)

| Message | Meaning |
|---|---|
| `state` `{ state: { trackId, title, artist, album, albumId, artistId, coverArt, durationSec, positionSec, playing, volume, shuffle, repeat } }` | Playback state. Sent on changes plus a slow heartbeat. Idle devices do not overwrite the active device's state. |
| `cover` `{ trackId, mime, data }` | The current cover (`image/jpeg|png|webp`, base64, up to 1 MB). Only accepted from the device that reported that track. |
| `yielded` `{ to }` | "I paused and saved my queue position" (answer to `yield`). |
| `queue-changed` | The shared queue changed (already saved to the music server). Relayed to the others. |
| `settings` `{ category, value, init? }` | A settings category changed. `init: true` only fills an empty slot. |
| `ping` | Answered with `pong`. |

## Messages any device can send

| Message | Meaning |
|---|---|
| `command` `{ to, action, args }` | Control another device. Actions: `play`, `pause`, `toggle`, `next`, `prev`, `seek` (`{positionSec}`), `volume` (`{volume}`), `shuffle` (`{value}`), `repeat` (`{value}`). |
| `transfer` `{ to, fresh? }` | Move playback to a device. The current player is asked to `yield` first. `fresh: true` starts the loaded queue from the beginning. |
| `sync-config` `{ category, enabled }` | Switch a settings category on or off for all devices. |

## Messages from the hub

`devices`, `state`, `command` (`from` is a device id or `api`/`hub`), `yield` `{ to }`, `takeover` `{ from, state, ageMs, fresh }`, `queue-changed`, `settings` `{ category, value }`, `sync-config` `{ config }`, `pong`.

## Close codes

4001 hello timeout, 4002 bad JSON, 4003 hello first, 4004 unsupported protocol, 4005 unauthorized, 4006 bad deviceId, 4007 too many devices, 4008 replaced by a newer connection of the same device.
