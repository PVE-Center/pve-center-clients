# Contributing to PVE Command Center Clients

Thank you for helping improve the Windows, Linux, and Android clients for **PVE Command Center**!

## Development Workflow

1. Fork this repository and create a branch from `main`.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the web dev server or native shell:
   - Web UI: `npm run dev`
   - Desktop (Tauri v2): `npm run tauri:dev`
   - Android sync: `npm run cap:sync`

## Guidelines

- Keep shared UI components in `src/` platform-agnostic so they work cleanly across Web, Windows, Linux, and Android.
- Ensure `src/lib/apiClient.ts` continues to support both:
  - Relative `/api/*` requests when hosted by the `pve-panel` backend.
  - Explicit `localStorage` server URLs (`pve_panel_server_url`) for Tauri desktop and Capacitor Android.
- Avoid introducing personal hostnames, IP addresses, API tokens, or signing keystores into commits.
- Verify the build before submitting a pull request:
  ```bash
  npm run build
  npx cap sync android
  bash -n scripts/*.sh
  ```
- When touching Rust code in `src-tauri/`, also run `cargo check` (and `cargo fmt --check`) in `src-tauri/`.

## Cross-Repository Scope

- Server API, Docker, `install.sh`, and FastAPI routes belong in [`pve-panel`](https://github.com/PVE-Center/pve-panel).
- Native SwiftUI apps (iOS/macOS/tvOS) belong in [`pve-center-apple`](https://github.com/PVE-Center/pve-center-apple).
- Documentation portal updates belong in [`pve-center-website`](https://github.com/PVE-Center/pve-center-website).
