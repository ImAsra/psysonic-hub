# Security

## Reporting a vulnerability

Please do **not** open a public issue. Use the repository's **Security → Report a vulnerability** form (GitHub private advisories). Include what you did, what you expected and what happened. I aim to answer within a few days. Only the latest release (and `main`) is supported.

## Threat model

The hub is a small relay for **one person's own devices**. It stores no music-server address or password, no audio and no library data. What it does hold:

- the current playback state of the playing device (title, artist, position, volume...) and its current cover image, in memory only;
- the shared settings categories you switched on, in `/data/settings.json`;
- login sessions, in memory only.

Whoever has `HUB_TOKEN` (or a web login) is treated as **you**: they can see what is playing, control every connected device, and change the shared settings. They cannot reach your music server or its files through the hub. The worst realistic outcome of a leaked token is therefore someone controlling your playback and seeing track titles, and a denial of service; rotate the token if it leaks (see below).

The hub is built for a home network or a VPN, optionally behind an HTTPS reverse proxy. It is not designed to be hammered from the open internet.

## What is in place

**Authentication**
- Apps use `HUB_TOKEN`; the web page uses a username and password from the environment and gets a session cookie (`HttpOnly`, `SameSite=Strict`, and `Secure` with the `__Host-` prefix over HTTPS). Session ids are 256-bit random values; sessions are kept in memory, expire after 30 idle days and never outlive 90 days.
- Secrets are compared in constant time. The password is checked with scrypt, and user name and password are always both checked, so timing reveals nothing.
- Wrong logins, wrong device tokens and wrong API tokens all count towards one lockout per address: after the free tries the address is locked for 5 minutes, doubling up to 1 hour. Even the right credentials are refused while locked.
- Signing out (or a session expiring) closes that page's open WebSocket. Token connections are independent of sessions.
- The API has its own credentials: `API_TOKEN` (control) and `API_TOKEN_READONLY` (read only). The full-control token never works from a URL. All secrets must be at least 10 to 24 characters, must differ from each other, and a startup warning names any that look guessable. Secrets can also come from files (`HUB_TOKEN_FILE`, ...) for Docker secrets.

**Web page and browsers**
- Strict Content-Security-Policy with no inline script or style (`script-src 'self'`, `style-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`), plus `nosniff`, no referrer, a permissions policy, `Cross-Origin-Opener-Policy`, and HSTS when served over HTTPS.
- Login and logout only accept JSON from this site's own origin (no cross-site form posts). The WebSocket checks `Origin` for session logins, so another website cannot use your session.
- Logos you add to `public/` are served in a sandbox, so even a hostile SVG cannot run script.
- Only a fixed list of files is ever served; no path from a request ever reaches the filesystem.

**Input handling**
- Every message is size-limited and type-checked. Device state is reduced to known, clamped fields; command arguments must be small plain objects; settings categories are looked up without prototype tricks; cover images are checked for type and file signature and capped at 1 MB; JSON bodies must be objects of at most 8 KB. One malformed message is logged and dropped; it cannot stop the hub.
- Limits per connection (30 messages per second sustained, covers cost ten), per address (16 connections) and in total (64), and bounded memory for the tracking tables. HTTP requests must complete within 15 seconds.

**Handoff safety**
- Playback is only handed to a device on the same music server and account, and only after the playing device confirmed that it saved its queue. Otherwise the transfer is cancelled.

**Container**
- Runs as a non-root user, read-only filesystem, all capabilities dropped, `no-new-privileges`, memory and process limits, an init process and a clean shutdown on `docker stop`.

**Supply chain**
- One runtime dependency (`ws`). CI runs `npm audit` and the full test suite, pins every GitHub Action to an exact commit, uses minimal permissions, and Dependabot proposes updates (with a one-week cooldown for new releases).

## Deployment checklist

1. Generate secrets: `openssl rand -hex 24` for `HUB_TOKEN`, `API_TOKEN`, `API_TOKEN_READONLY`; use a long unique `HUB_PASSWORD`. Keep `.env` at mode `600`.
2. Do not expose port 5533 directly to the internet. Use a VPN (WireGuard, Tailscale) or an HTTPS reverse proxy.
3. Behind a proxy: publish the port as `127.0.0.1:5533:5533`, set `HUB_TRUST_PROXY=1` and `HUB_PUBLIC_URL`, make the proxy pass WebSockets and not buffer `/api/events`, and let it terminate TLS.
4. Without TLS, tokens and the password cross the network in clear text. That is acceptable on a trusted home network, not beyond it.
5. Keep the image current: `docker compose pull && docker compose up -d`.
6. Rotate on suspicion: change `HUB_TOKEN` (and the API tokens), restart the hub, update each app. Restarting also signs out every web session.

## Known limitations

- One shared device token: it cannot be revoked per device.
- The Psysonic apps keep the hub token in their local settings, like their other settings; it will move to the apps' credential storage when that is improved.
- The read-only key can travel in a URL (`?key=`), so it may show up in proxy logs or browser history. It only grants read access; rotate it if it leaks.
- Lockouts are per network address. Several people behind one shared address share a budget, and behind a proxy the address is only trustworthy if the hub cannot be reached around the proxy.
- Failed logins are logged; successful API calls are not.
- Shared settings are applied by the apps only for a fixed list of known keys with matching types, but the hub trusts whoever holds the token to set them.
