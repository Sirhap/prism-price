# Security & Privacy Policy

## Architectural Privacy Boundaries

- **Read-Only Public Catalogs**: PRISM Parity (棱镜比价) aggregates publicly accessible storefront catalogs for reference price comparison only and does not collect user payment information.
- **Contact & PII Sanitization**: All public APIs, server-rendered catalog pages (`/catalog/*`), XML sitemaps, and `/llms*.txt` endpoints filter out private social handles such as Telegram links (`hideTelegramContacts`) before rendering or caching.
- **Zero Client Secrets**:
  - Local development secrets must live only in `.dev.vars` (git-ignored).
  - Production secrets on self-hosted instances live in root-only `/etc/ldxp-cf-demo.env` injected via systemd.
  - Never commit `.dev.vars`, D1 `.sqlite` database files, or bearer tokens (`INGEST_SECRET`, `ADMIN_SECRET`, etc.).

## Reporting a Security Issue

If you discover a secret exposure, injection risk, SSRF issue in storefront adapters, or privacy leak, please open a private security advisory on GitHub (`Sirhap/prism-price/security/advisories`) or contact the repository maintainer directly instead of disclosing exploit details in public issues.
