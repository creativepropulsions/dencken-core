# Dencken Network 

Minimal server-side prototype for Dencken Network. This repository contains the structural skeleton only. All proprietary constitutional identity, prompts, and knowledge base data must be injected externally after deploy.

## Plesk / Shared Hosting Notes

Current prototype app is designed to work on shared hosting with dynamic port allocation.

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
- Constitution philosophy and content is copyrighted, the philosphical manifest is public available at `github.com/dencken-network/dencken-constitution`

## Current project state

This repository is currently in an active prototype phase. The node is running as a board server from the Plesk Node application root at `/node.dencken.net/dencken-core` and the dashboard is working.

## Next milestones

The project is progressing through the staged roadmap:

1. Bare server + health check
2. Folder structure + ledger setup
3. Encryption module + setup dashboard
4. Constitution loader + agent pool
5. First deliberation cycle + PULSE
6. Scheduler + board actions

The current working state is roughly in the Step 5 / setup and board-initialization phase, with the application alive and the dashboard usable.

Copyright © 2025–2026 CP Müller / Oddsized / Dencken Network — All rights reserved