import type { HubState } from '../store/useHubStore.ts';

/**
 * The player whose library the remote shows: the active one, else the first. None while the page is not
 * connected: lookups in flight are lost with the connection, so the library reloads once it is back.
 */
export function libraryPlayerOf(s: Pick<HubState, 'status' | 'devices'>): string {
  if (s.status !== 'connected') return '';
  return (s.devices.find((d) => d.active) ?? s.devices[0])?.id ?? '';
}
