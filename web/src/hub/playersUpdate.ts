import type { Device, QueueWindow } from '../types.ts';

/** The new player list, and the queues of players that are still there. */
export function playersUpdate(
  devices: Device[],
  queues: Record<string, QueueWindow>,
): { devices: Device[]; queues: Record<string, QueueWindow> } {
  const players = devices.filter((d) => d.kind !== 'web');
  const kept = Object.fromEntries(Object.entries(queues).filter(([id]) => players.some((d) => d.id === id)));
  return { devices: players, queues: kept };
}
