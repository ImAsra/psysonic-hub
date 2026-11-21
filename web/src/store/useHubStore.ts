import { create } from 'zustand';

import type {
  AuthMode,
  ConnectionStatus,
  Device,
  Page,
  QueueWindow,
  RelayedState,
  SyncCategory,
  SyncConfig,
} from '../types.ts';

export interface HubState {
  /** How the page signs in; null until the hub said. */
  mode: AuthMode | null;
  status: ConnectionStatus;
  /** The login card is shown (with an optional message) instead of the player. */
  login: { visible: boolean; message: string };
  /** Players only (web remotes are not listed). */
  devices: Device[];
  state: RelayedState | null;
  /** When `state` arrived (positions are extrapolated from it). */
  stateAt: number;
  queues: Record<string, QueueWindow>;
  catalog: SyncCategory[];
  syncConfig: SyncConfig;
  /** The hub welcomed this page at least once since signing in (the player cards show from then on). */
  welcomed: boolean;
  /** Which page of the remote is shown. */
  page: Page;
}

export const initialHubState: HubState = {
  mode: null,
  status: 'notConnected',
  login: { visible: false, message: '' },
  devices: [],
  state: null,
  stateAt: 0,
  queues: {},
  catalog: [],
  syncConfig: {},
  welcomed: false,
  page: 'remote',
};

/** What the hub told this page. Written by the connection, read by the components. */
export const useHubStore = create<HubState>()(() => ({ ...initialHubState }));

/** The device that is playing, if any. */
export const selectActiveDevice = (s: HubState): Device | undefined => s.devices.find((d) => d.active);
