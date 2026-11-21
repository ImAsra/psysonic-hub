import type { ALBUM_SORTS, LIBRARY_TABS } from './constants.ts';

export type * from '../../shared/protocol.ts';

export type AuthMode = 'password' | 'token';
export type ConnectionStatus =
  | 'notConnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'lockedOut'
  | 'tooManyConnections'
  | 'signedOut'
  | 'wrongToken';
export type LibraryTab = (typeof LIBRARY_TABS)[number];
export type RemoteAlbumSort = (typeof ALBUM_SORTS)[number];
export type Page = 'remote' | 'settings';
export interface TokenInfo {
  token: string;
  /** 'env' = set by HUB_TOKEN on the server (cannot be regenerated from the page). */
  source: 'env' | 'generated';
}
