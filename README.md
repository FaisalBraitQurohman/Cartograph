This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Database

Postgres on Supabase. Authorization is row-level security, not application code.

- `supabase/migrations/` — the schema, tracked in version control. Every domain
  table carries the Clerk organization id, references `organizations(id)`, and
  has one policy reading the organization off the session token. An event
  trigger turns row-level security on for every table created in `public`, so a
  table cannot exist without it.
- `supabase/seed.sql` — analyses for two organizations plus an empty third, so
  the dashboard's list and its empty state are both reachable. Five rows cover
  every state the table shows: queued, parsing, a failure with its reason, and
  two completions.
- `types/database.ts` — generated from the live schema and committed, so the
  build does not need a database.

## Parser

Phase 03 adds a standalone parser. It reads a directory on disk, never fetches
or clones it, and writes a typed JSON contract containing files, folders, edges,
fan-in/fan-out and import coverage. It uses `ts-morph` for the TypeScript AST;
framework knowledge enters only through the fallback adapter.
The command uses Node's built-in TypeScript stripping (Node 22.6 or newer).

```bash
pnpm parse:repo . --out parser-output.json
```

The command reports found, parsed and skipped files, every skip reason, folder
count, edge count, coverage states and re-export resolution. If `--out` is
provided, it reads the JSON back and validates the contract before returning.

Apply changes with the Supabase MCP (`apply_migration`) or the CLI, then
regenerate the types:

```bash
supabase gen types --linked --schema public > types/database.ts
```

### Required configuration

Beyond `.env.local`, two things are set in dashboards rather than in code:

- **Supabase → Authentication → Third-Party Auth**: Clerk must be registered as
  an identity provider, or Supabase treats the Clerk token as anonymous and
  every policy returns nothing.
- **Clerk → Sessions → Customize session token**: add
  `{"org_name": "{{org.name}}"}`. The workspace page reads `org_name` and
  throws without it. The organization id (`o.id`) is already in the default
  token and is what the policies read.
