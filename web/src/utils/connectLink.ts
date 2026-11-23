/**
 * What the connect QR code holds: the hub address and the device token, for a Psysonic app to read
 * (see docs/PROTOCOL.md, "Connecting by QR code"). A custom scheme, so a phone's camera app opens
 * nothing with it and the token does not end up in a browser history.
 */
export function connectLink(hubUrl: string, token: string): string {
  const q = new URLSearchParams({ v: '1', url: hubUrl, token });
  return `psysonic-hub://connect?${q.toString()}`;
}
