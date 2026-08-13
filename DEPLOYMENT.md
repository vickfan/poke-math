# Deploying to Cloudflare Pages

This project serves static assets from the repo root and uses Pages Functions
(`functions/`) for the API. Game state (caught / fainted / evolution) lives in a
Workers KV namespace named `GAME_STATE`, seeded from `seed/game-state.json`.

## 1. Prerequisites

- Node.js 18+ and `npm`
- A Cloudflare account
- Wrangler installed: `npm install` (already a dev dependency)

## 2. Create the KV namespace

```bash
npx wrangler kv namespace create GAME_STATE
```

Copy the returned `id` into `wrangler.toml` (replace `REPLACE_WITH_NAMESPACE_ID`):

```toml
[[kv_namespaces]]
binding = "GAME_STATE"
id = "REPLACE_WITH_NAMESPACE_ID"
```

> The environment variables `QUESTIONS_CSV_URL` and `ALLOWED_QUESTION_TYPE` are
> declared in `wrangler.toml` under `[vars]`. You can override them in the Pages
> dashboard (Settings → Environment variables) without redeploying.

## 3. Seed the KV namespace

```bash
npx wrangler kv bulk put --binding GAME_STATE seed/game-state.json
```

This uploads keys `caught`, `fainted`, and `evolution` (your current progress).
Re-run it any time you edit `seed/game-state.json` to reset progress.

## 4. Deploy

### Option A — Wrangler (CLI)

```bash
npx wrangler pages deploy .
```

### Option B — Git integration (dashboard)

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → connect your Git repo
2. Build command: leave empty; Build output directory: `/` (repo root)
3. In **Settings → Functions → KV namespace bindings**, add `GAME_STATE`
4. In **Settings → Environment variables**, add `QUESTIONS_CSV_URL` and `ALLOWED_QUESTION_TYPE`
5. Deploy; pushes to the branch auto-deploy

## 5. Verify

On the deployed URL, check:

- `GET /` — game loads
- `GET /api/sheet-questions?refresh=1` — returns MCQ rows from the Google Sheet
- `GET /data/caught.json` — returns the 66 seeded ids (proves the KV binding works)
- Catch a Pokémon and hard-refresh — progress must persist

## Local development

```bash
# seed local KV (values from seed/game-state.json)
npx wrangler kv bulk put --local --binding GAME_STATE seed/game-state.json

# run the site with local KV
npx wrangler pages dev . --port 8788
```

> Do NOT pass `--kv GAME_STATE` to `wrangler pages dev`; it creates a separate
> local store and the seed won't be visible. Local dev state lives in `.wrangler/`
> (gitignored).

## Notes

- `data/` is not tracked — `seed/game-state.json` is the seed source of truth.
- After deploy, game progress is stored in KV, not in the repo. Edits to the
  game only persist through the app, not via git.