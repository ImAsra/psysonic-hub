# Changes to Psysonic

The hub is independent of Psysonic. Psysonic only needs a small, optional client to talk to it. Nothing runs unless the user switches the hub on in **Settings → Integrations → Realtime hub** and enters an address and token; with the field blank Psysonic behaves exactly as before.

This lists everything the integration touches in the Psysonic repository (28 files, about 1700 added lines, of which about 1450 are in the new `src/features/hub/` folder).

## New files (13)

| File | Purpose |
|---|---|
| `src/features/hub/hubClient.ts` | WebSocket client: connection, state reporting, remote commands, handoff, queue sync signal, cover upload |
| `src/features/hub/hubStore.ts` | Persisted settings (address, token, device name) and runtime state |
| `src/features/hub/hubSettingsSync.ts` | Opt-in settings categories synced through the hub |
| `src/features/hub/hubServerKeys.ts` | Hashes of "music server + account" so handoffs only go to a compatible device |
| `src/features/hub/compat.ts` | Pure helper: can playback move between two devices |
| `src/features/hub/useHubRemote.ts`, `usePlayerView.ts` | "Another device is playing" view helpers for display |
| `src/features/hub/useHubConnection.ts` | Hook that starts the client |
| `src/features/hub/HubSettings.tsx` | The settings section |
| `src/features/hub/HubDevicePicker.tsx` | "Play on..." button and list |
| `src/features/hub/index.ts` | Barrel |
| `src/features/miniPlayer/components/MiniDevicePicker.tsx` | The same picker inside the mini player window |
| `src/styles/components/hub.css` | Theme-proof styling of the device list |

## Existing files changed (15)

| File | Change |
|---|---|
| `src/app/AppShell.tsx` | +2: starts the hub hook |
| `src/features/settings/components/IntegrationsTab.tsx` | +3: renders the settings section |
| `src/features/playback/components/PlayerBar.tsx` | ~15: shows the active device's track/state/volume/repeat/shuffle; adds the picker |
| `src/features/playback/hooks/useVolumeToggle.ts` | 3: volume display follows the active device |
| `src/features/fullscreenPlayer/components/FullscreenPlayerStatic.tsx`, `...Immersive.tsx`, `...Prism.tsx`, `FsPlayBtn.tsx`, `FsLyricsRail.tsx`, `FsLyricsApple.tsx` | 3 to 8 each: show the active device's state; picker in the controls |
| `src/features/miniPlayer/utils/miniPlayerBridge.ts`, `miniPlayerHelpers.ts`, `hooks/useMiniSync.ts`, `components/MiniToolbar.tsx` | The mini window gets the active device's state, position and device list through the existing sync payload |
| `src/styles/components/index.css` | +1: imports `hub.css` |

## How it hooks into the existing player

- **Display:** the screens above use small "view" hooks, so they show the other device's values only while another device is the active player.
- **Controls:** while another device plays, the store actions for play/pause/next/previous/seek/volume/shuffle/repeat/click-to-play/undo are routed to it through the hub instead of the local player (installed in `hubClient.ts`, removed again when the hub is switched off). Nothing else in the store is replaced.
- **Queue:** it keeps using the existing Subsonic play queue. The hub only says "the queue changed" and a handoff reuses the existing save and restore code.
- **Credentials:** the integration never reads or sends a server password. It sends one-way hashes of the server address and user name.

## Known deviations from the repository's conventions

- `npm run dep:check` reports 14 imports inside `src/features/hub/` that reach into `playback` and `settings` internals instead of their barrels. Resolving this needs the maintainers' decision (export those items, or place the client inside the playback feature).
- Strings in the new UI are English only; translations are still to do.
- The settings-sync categories read the existing stores directly; they should move onto the planned settings refactoring.
