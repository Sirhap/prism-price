# Contributing to PRISM Parity (棱镜比价)

Thank you for helping improve **PRISM Parity**!

## Development Workflow

1. Use **Node.js 22+** and install dependencies with `npm ci`.
2. Initialize local D1 migrations: `npm run db:migrate:local`.
3. Start the local dev server: `npm run dev`.

## Updating Brand Classification Rules

- Edit [`src/config/brand-rules.json`](src/config/brand-rules.json) rather than hardcoding branches inside ETL cleaners.
- Follow all constraints documented in [`BRAND-RULES.md`](BRAND-RULES.md) (unique IDs, valid regex without stateful `g`/`y` flags, and minimal regression fixtures for ambiguous titles).

## Required Checks Before Opening a Pull Request

Run all checks locally and ensure zero failures:

```bash
npm run typecheck
npm test
npm run test:sync
```

For UI or bilingual (`zh` / `en`) text changes, update [`public/i18n.js`](public/i18n.js) and [`src/i18n/locale.ts`](src/i18n/locale.ts) consistently and verify mobile responsiveness (`375px` viewport).

## Boundaries

- Do not commit `.dev.vars`, `.wrangler/`, `*.sqlite` databases, or production credentials.
- Do not add scrapers targeting authenticated or private endpoints; storefront adapters must only inspect publicly accessible pages with SSRF protection (`assertSafePublicUrl`).
