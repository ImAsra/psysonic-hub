// Wire protocol shared by the hub server and the web remote (see docs/PROTOCOL.md).
// Only types: Node runs this file with type stripping, and the web app bundles it.

export const PROTOCOL = 1;

export type DeviceKind = 'desktop' | 'phone' | 'web';
export type RepeatMode = 'off' | 'all' | 'one';

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  active: boolean;
  server: string[];
}

/** What a player reports about its playback (the hub keeps only these fields). */
export interface PlayerState {
  trackId?: string;
  title?: string;
  artist?: string;
  album?: string;
  albumId?: string;
  artistId?: string;
  coverArt?: string;
  durationSec?: number;
  positionSec?: number;
  volume?: number;
  playing?: boolean;
  shuffle?: boolean;
  repeat?: RepeatMode;
}

/** The state as relayed by the hub: who reported it and when. */
export interface RelayedState extends PlayerState {
  from: string;
  ts: number;
}

export interface QueueTrack {
  id: string;
  title?: string;
  artist?: string;
  album?: string;
  albumId?: string;
  artistId?: string;
  coverArt?: string;
  durationSec?: number;
}

/** A window of a player's queue: `tracks` start at absolute position `offset`; `index` is the current track. */
export interface QueueWindow {
  index: number;
  offset: number;
  total: number;
  tracks: QueueTrack[];
}

export type AlbumSort =
  'newest' | 'recent' | 'frequent' | 'random' | 'alphabeticalByName' | 'alphabeticalByArtist' | 'starred';

export type BrowseRequest =
  | { kind: 'albums'; sort: AlbumSort; offset: number }
  | { kind: 'artists'; offset: number }
  | { kind: 'playlists' }
  | { kind: 'search'; query: string }
  | { kind: 'album' | 'artist' | 'playlist'; id: string };

export type BrowseKind = BrowseRequest['kind'];

/** An album, artist, song or playlist in a browse answer. */
export interface LibraryItem {
  id: string;
  name?: string;
  title?: string;
  artist?: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  coverArt?: string;
  year?: number;
  durationSec?: number;
  songCount?: number;
  albumCount?: number;
  track?: number;
  disc?: number;
}

export interface BrowseResult {
  item?: LibraryItem;
  albums?: LibraryItem[];
  artists?: LibraryItem[];
  songs?: LibraryItem[];
  playlists?: LibraryItem[];
  more?: boolean;
}

export type PlayItemKind = 'album' | 'playlist' | 'song';
export type PlayItemMode = 'play' | 'next' | 'add';

export interface SyncCategory {
  id: string;
  label: string;
  desc: string;
  def: boolean;
}

export type SyncConfig = Record<string, boolean>;
export type SharedSettings = Record<string, Record<string, unknown>>;

// ---- messages from the hub ----
export interface WelcomeMessage {
  t: 'welcome';
  v: number;
  you: string;
  devices: Device[];
  state: RelayedState | null;
  settings: SharedSettings;
  syncConfig: SyncConfig;
  syncCatalog: SyncCategory[];
  serverCheck: boolean;
  queues: Record<string, QueueWindow>;
}

export type HubMessage =
  | WelcomeMessage
  | { t: 'devices'; devices: Device[] }
  | { t: 'state'; state: RelayedState }
  | { t: 'queue'; from: string; queue: QueueWindow }
  | { t: 'sync-config'; config: SyncConfig }
  | { t: 'settings'; category: string; value: Record<string, unknown> }
  | { t: 'command'; from: string; action: string; args: Record<string, unknown> | null }
  | { t: 'transfer-failed'; to: string; reason: string }
  | { t: 'browse-result'; rid: string; from?: string; result?: BrowseResult; error?: string }
  | { t: 'pong' };
