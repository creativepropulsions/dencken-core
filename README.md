# Dencken Network 

Minimal server-side prototype for Dencken Network. This repository contains the structural skeleton only. All proprietary constitutional identity, prompts, and knowledge base data must be injected externally after deploy.

## Plesk / Shared Hosting Notes

This app is designed to work on shared hosting with dynamic port allocation.

- The server uses `process.env.PORT` first.
- It falls back to `process.env.BOARD_PORT`.
- If the environment does not provide a port, it defaults to `3000` for local development only.
- `app.js` currently starts the server directly for Step 1 testing.

---

# Dencken Network Minimal Server Node v0.1

This repository contains the core node runtime for Dencken Network, a constitutional AI enterprise node designed around a three-plane architecture:

- Infrastructure plane: hosting, Node runtime, network access, environment configuration
- Constitutional plane: encrypted policy layer, append-only signed ledger, and knowledge layer
- Operational plane: deliberation cycles, board review, and human governance actions

The implementation is intentionally split so that core modules in `src/core/` remain interface-agnostic and do not import framework-specific HTTP code.

## Network model

The constitutional layer is designed to preserve the following principles:

- Policy content is encrypted and stored in a protected configuration file
- Ledger records are append-only and signed with Ed25519 keys
- The ledger is never reset during normal operation
- Cycle outputs always pass through the signed record path
- Constitution content is not exposed outside the constitution storage module

## Current project state

This repository is currently in an active prototype phase. The node is running as a board server with:

- health check at `/ping`
- status endpoint at `/status`
- dashboard at `/dashboard`
- setup flow at `/setup`
- signed ledger recording support
- encrypted constitution loader and storage path

The app is currently serving successfully from the Plesk Node application root at `/node.dencken.net/dencken-core` and the dashboard is working.

## Security notes

Before publishing or pushing to GitHub:

- do not commit `.env` files or any runtime credentials
- do not commit private keys, encrypted config, generated ledger data, or any populated `.pem` files
- keep sample files like `.env.example` and `node_private.pem.example` as templates only
- ensure all secrets remain in the server environment and not in repository files

## Hosting / deployment notes

This app is designed to work in a shared hosting environment with dynamic Node port assignment.

- `process.env.PORT` is checked first
- `process.env.BOARD_PORT` is used as a fallback
- if neither is set, the app falls back to port `3000` for local development
- the application root should be configured to the repository folder, not the parent public directory

## Repository conventions

- `src/core/` contains the core logic without delivery-layer or HTTP coupling
- `src/board/` contains the web-facing routes and admin board handlers
- `data/` and `config/` are private runtime storage and should remain out of version control
- `ledger-public/` is a public-facing log location only and should be treated carefully

## Next milestones

The project is progressing through the staged roadmap:

1. Bare server + health check
2. Folder structure + ledger setup
3. Encryption module + setup dashboard
4. Constitution loader + agent pool
5. First deliberation cycle + PULSE
6. Scheduler + board actions

The current working state is roughly in the Step 3 / setup and board-initialization phase, with the application alive and the dashboard usable.

