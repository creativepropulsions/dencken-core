# Dencken Network Minimal Server Node v0.1

Minimal server-side prototype for Dencken Network. This repository contains the structural skeleton only. All proprietary constitutional identity, prompts, and knowledge base data must be injected externally after deploy.

## Plesk / Shared Hosting Notes

This app is designed to work on shared hosting with dynamic port allocation.

- The server uses `process.env.PORT` first.
- It falls back to `process.env.BOARD_PORT`.
- If the environment does not provide a port, it defaults to `3000` for local development only.
- `app.js` currently starts the server directly for Step 1 testing.
