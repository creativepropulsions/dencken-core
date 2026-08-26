# Project Instructions

- Do not add, suggest, configure, or use external services, hosted databases, SaaS platforms, cloud storage, telemetry, or third-party backends unless the user explicitly requests and approves that specific service first.
- Treat this project as local/self-hosted by default. Prefer Node.js built-ins, local files, SQLite when available, and the existing JSONL fallback.
- Before adding a dependency or integration, check whether an existing local implementation already provides the required capability.
- Never introduce hosted databases, cloud storage, or equivalent integrations implicitly or as a fallback.
- Keep secrets in environment variables and do not add provider-specific credentials, URLs, migrations, or configuration to the repository.
- If an external option appears useful, report it as an optional alternative and wait for explicit approval before making any change.
