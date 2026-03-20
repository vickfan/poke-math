# AGENTS.md

## Cursor Cloud specific instructions

This is a **Pokémon Math Battle** game — a single vanilla JS/HTML/CSS application served by a Node.js HTTP server (no framework, no build step).

### Running the app

- `npm start` (or `node server.js`) starts the server on port **3000**
- The frontend is plain HTML/CSS/JS with no transpilation or bundling
- Game state is persisted to `data/*.json` files (created automatically on first write)

### Key notes

- There are **no automated tests** — `npm test` is a placeholder that exits with code 1
- There is **no linter configured** (no ESLint, Prettier, etc.)
- The only npm dependency is `pm2` (process manager, not required for dev)
- Pokémon sprites load from `raw.githubusercontent.com`; emoji fallbacks are used if images fail
- No environment variables or `.env` files are needed
- No database — flat JSON files in `data/` directory (gitignored)
