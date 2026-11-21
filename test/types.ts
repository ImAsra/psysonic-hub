// Extra fields the integration tests keep on sockets and server processes.
import type { ChildProcess } from 'node:child_process';
import type { WebSocket } from 'ws';

/* eslint-disable @typescript-eslint/no-explicit-any -- messages are checked field by field in the tests */
export type TestSocket = WebSocket & { inbox: any[]; closeCode?: number; closed: Promise<number> };
export type TestProc = ChildProcess & { exited: number | null; err: string };
/** A JSON response body, read as untyped data. */
export const body = async (r: Response): Promise<any> => r.json();
