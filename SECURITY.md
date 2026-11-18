# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| `main` / `1.0.x` | Yes |

## Client Security Architecture

- **Capabilities & URL Scopes (Tauri v2)**: `src-tauri/capabilities/default.json` restricts native commands to `core:default`, `shell:allow-open`, and `http:default` (`http://*` / `https://*`) so users can connect to self-hosted LAN and Tailscale servers without exposing arbitrary shell execution.
- **Android Network Security**: `android/app/src/main/AndroidManifest.xml` enables `android:usesCleartextTraffic="true"` explicitly so private RFC1918 Proxmox LAN servers can be accessed over HTTP when Tailscale HTTPS is not used. Prefer Tailscale Serve (`https://...ts.net`) whenever connecting over untrusted networks.
- **Credentials & Tokens**: Bearer API tokens and session tokens are stored client-side in WebView `localStorage` and transmitted in `Authorization: Bearer` headers (or `?token=` on WebSocket/SSE upgrades). Never commit `.keystore`, `.jks`, `.env`, or server tokens to Git.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead:
1. Use GitHub **Private Vulnerability Reporting** on `PVE-Center/pve-center-clients` (Security tab -> Report a vulnerability), or
2. Contact the maintainers privately via the repository profile.

Include affected platform (Windows, Linux, Android), client version, reproduction steps, and potential impact. We aim to acknowledge reports within 72 hours.
