# Wire protocol (version 1)

What the Psysonic apps speak: JSON messages over a WebSocket at `/ws`.

## Handshake

The first message must be `hello` within 5 seconds:

`{ "t": "hello", "v": 1, "token": "...", "deviceId": "desk-1a2b", "name": "Psysonic Desktop", "kind": "desktop" }`

- `kind` is `desktop`, `phone` or `web`. A `web` device is a remote: it can control players but is not one itself.
- The web page authenticates with its login session cookie instead of a token and is always treated as `web`.
- `deviceId`: 4 to 64 characters of letters, digits, `_` and `-`.
- `server` (optional): up to 4 opaque hashes that identify the music server + account this device uses (the app hashes `normalized server address + username`, once for the main and once for the alternate address). The hub never sees the address, only compares hashes. Devices without it count as compatible.

The hub answers with `welcome`: `{ t, v, you, devices, state, settings, syncConfig, syncCatalog, serverCheck }`. Each entry of `devices` is `{ id, name, kind, active, server }`.

## Device messages (players)

| Message | Meaning |
|---|---|
| `state` `{ state: { trackId, title, artist, album, albumId, artistId, coverArt, durationSec, positionSec, playing, volume, shuffle, repeat } }` | Playback state. Sent on changes plus a slow heartbeat. Idle devices do not overwrite the active device's state. |
| `cover` `{ trackId, mime, data }` | The current cover (`image/jpeg|png|webp`, base64, up to 1 MB). Only accepted from the device that reported that track. |
| `yielded` `{ to, ok, reason? }` | Answer to `yield`. `ok: true` = "I paused and my queue is saved". `ok: false` = the save failed (`reason`, e.g. `queue_save_failed`, `queue_sync_disabled`); the transfer is cancelled. Omitting `ok` counts as true (older apps). |
| `takeover-failed` `{ reason }` | The device was handed playback but could not load the queue. |
| `server` `{ server }` | The user switched music server or account on this device. |
| `queue-changed` | The shared queue changed (already saved to the music server). Relayed to the others. |
| `settings` `{ category, value, init? }` | A settings category changed. `init: true` only fills an empty slot. |
| `ping` | Answered with `pong`. |

## Messages any device can send

| Message | Meaning |
|---|---|
| `command` `{ to, action, args }` | Control another device. Actions: `play`, `pause`, `toggle`, `next`, `prev`, `seek` (`{positionSec}`), `volume` (`{volume}`), `shuffle` (`{value}`), `repeat` (`{value}`). |
| `transfer` `{ to, fresh? }` | Move playback to a device. Refused with `transfer-failed` / `server_mismatch` when the two devices use different music servers or accounts. Otherwise the current player is asked to `yield` first, and the target only starts after it confirms `ok: true`. `fresh: true` starts the loaded queue from the beginning (here the requester's own queue is the one being moved). |
| `sync-config` `{ category, enabled }` | Switch a settings category on or off for all devices. |

## Messages from the hub

`devices`, `state`, `command` (`from` is a device id or `api`/`hub`), `yield` `{ to }`, `takeover` `{ from, state, ageMs, fresh, server }`, `queue-changed` (only sent to devices on the same music server + account), `settings` `{ category, value }`, `sync-config` `{ config }`, `transfer-failed` `{ to, reason }`, `pong`.

`transfer-failed` reasons: `server_mismatch`, `device_cannot_play`, `timeout` (the playing device did not confirm within `HUB_YIELD_TIMEOUT_MS`), `queue_save_failed`, `queue_sync_disabled`, `queue_unavailable`. When a handoff is cancelled after the playing device already paused, the hub tells it to play again.

## Handoff

1. Check compatibility (same music server + account).
2. Ask the playing device to `yield`: it pauses and saves its queue and position to the music server.
3. Only when it answers `ok: true`, send `takeover` to the target, which loads that queue and resumes.

A failed save or a missing answer cancels the transfer instead of letting the target load an outdated queue. If the playing device disconnects mid-handoff there is nothing left to wait for and the takeover proceeds.

## Close codes

4001 hello timeout, 4002 bad JSON, 4003 hello first, 4004 unsupported protocol, 4005 unauthorized (also: the web login this socket belongs to was signed out or expired), 4006 bad deviceId, 4007 too many devices, 4008 replaced by a newer connection of the same device, 4010 too many connections, 4011 this address is locked out after repeated failures, 4012 message rate exceeded (the hub allows about 30 messages per second per connection; a cover image counts as ten).
