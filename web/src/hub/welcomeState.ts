import type { HubState } from '../store/useHubStore.ts';
import type { WelcomeMessage } from '../types.ts';

/** What the page knows after the hub's welcome (remotes are not listed as players). */
export function welcomeState(m: WelcomeMessage, now = Date.now()): Partial<HubState> {
  return {
    status: 'connected',
    welcomed: true,
    login: { visible: false, message: null },
    catalog: m.syncCatalog ?? [],
    syncConfig: m.syncConfig ?? {},
    devices: m.devices.filter((d) => d.kind !== 'web'),
    queues: m.queues ?? {},
    ...(m.state ? { state: m.state, stateAt: now } : {}),
  };
}
