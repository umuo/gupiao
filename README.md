# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Independent Accounts

Paper Alpha includes its own email-and-password account system and does not
depend on ChatGPT, OpenAI workspace headers, or an external identity provider.
Passwords are stored as salted PBKDF2-SHA256 hashes. Login sessions use random
tokens in `HttpOnly`, `SameSite=Lax` cookies; only token hashes are stored in D1.

The `DB` binding is required for users, sessions, personal strategies, and AI
endpoint preferences. Apply the generated migrations in `drizzle/` when
deploying outside Sites.

On a new database, the first registered account is assigned the `superadmin`
role. When upgrading an existing database, migration `0001` promotes the
earliest account if no superadmin exists. No default password is stored in the
source; the site owner sets the superadmin password during registration.

## OpenAI-Compatible Strategy Generation

Users can configure an HTTPS API Base URL and model name for services that
implement `POST /chat/completions`. The API key is never written to the database
or source code; it stays in the current page session and is sent only to the
server-side proxy for the generation request.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
