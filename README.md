# claude-code-worktrees

A local web app that manages git worktrees as **running environments** — provisioned files,
installed dependencies, a dev server on its own port, live logs — and knows about the Claude Code
sessions running inside them.

Register a root project once, describe how a worktree should be set up for that stack, and from then
on creating a feature worktree is one click.

**CLI:** `ccwt`

> "Claude" and "Claude Code" are Anthropic trademarks. Fine for a personal repo; expect to rename if
> this is ever published publicly.

## Status

**Milestone 1 works.** Register a repository, create a worktree, watch it get provisioned, get a
port and a running dev server, read its logs, open its URL, remove it cleanly. What is not built
returns `501 Not Implemented` naming the milestone that owes it.

| Milestone | What it adds | State |
|---|---|---|
| 1 | register → create → provision → serve → logs → remove | **done** |
| 2 | `.worktreeinclude`, provisioning an adopted worktree, launch a session | partly — see below |
| 3 | full `ccwt.config.json`, validation, multiple services, recipe editor | reads the file; no validation |
| 4 | session-status hooks, port map, git status, drift detection | stubs |
| 5 | `WorktreeCreate` ownership | not started |

Two pieces of Milestone 2 came for free. Every worktree of the repository is listed whoever made
it — yours, ccwt's, and the ones Claude Code creates under `.claude/worktrees/` — each tagged by
origin, and any of them gets a port the moment you press start. And a worktree that Claude Code has
locked cannot be removed; the dashboard shows git's own lock reason instead.

## Running it

```bash
npm install
npm run build
npm start            # or: node bin/ccwt.mjs
```

It prints a URL carrying a one-time token and opens your browser. Pass `--no-open` to skip that,
`--port <n>` to move it off 4600.

For development:

```bash
npm run dev          # 127.0.0.1:5600, auth disabled
npm run typecheck
```

## Setting up a project

**There is nothing to set up.** Register a repository and ccwt reads it: the package manager, the
dev script, how many services it runs. Every worktree then gets its own port per service.

You never have to edit your project to use ccwt. If a project needs something ccwt cannot work out,
the **Setup** panel on its dashboard says so in plain language, and says what — if anything — you
could change to get more out of it. It is guidance, never a prerequisite.

### How a worktree learns which port it got

Two ways, both automatic:

1. Each service is spawned with `PORT` and its own port already in the environment.
2. ccwt writes a marked block into `.env.local` inside the worktree — a file Vite, Next and Nuxt
   load on their own:

```bash
# >>> ccwt (generated — edits between these markers are replaced)
CCWT_PORT_WEB=5209
CCWT_URL_WEB=http://localhost:5209
CCWT_PORT_SERVER=4767
CCWT_URL_SERVER=http://localhost:4767
# <<< ccwt
```

Anything you already have in that file is kept; only the marked block is rewritten.

### The one case that needs a decision

If a project writes another service's address into a config file as a literal — a Vite proxy
pointing at `http://127.0.0.1:4599`, say — then every worktree points at the same place, because a
value baked into a file cannot differ between two copies of it. Nothing can change that from the
outside.

ccwt finds those lines, names the file and line number, and keeps working: **run one worktree of
that project at a time.** If you would rather run several at once, the panel shows the one-line
change that makes the address configurable — your call, not a requirement:

```diff
- '/api': 'http://127.0.0.1:4599',
+ '/api': process.env.CCWT_URL_SERVER ?? 'http://127.0.0.1:4599',
```

Most projects never hit this. Of the eight repositories this was tested against, one did.

## How it is put together

One Nuxt project, `ssr: false`. Vue SFCs in `app/`, Nitro server routes in `server/`, one shared
type vocabulary in `shared/`. No database — JSON files and git's own per-worktree config. No
Electron, no Docker requirement, no native modules.

```
app/          frontend; every backend call goes through composables/useApi.ts
server/lib/   pure logic, no Nuxt or H3 imports — git, provisioning, ports, supervisor, hooks
server/api/   thin HTTP wrappers around lib/
server/routes/_ws.ts   WebSocket: logs and status
shared/       the types both sides use
bin/ccwt.mjs  CLI entry: boot the server, open a browser
```

Read `CLAUDE.md` before changing anything — it holds the reasoning, because the repo does not use
code comments. `SPEC.md` is the product spec.

## Security

It runs `git` and spawns processes, so a web page that could reach it would have remote code
execution.

- Binds `127.0.0.1` only, and refuses any other `--host`
- Validates the `Host` header on every request — this, not the loopback bind, is what stops DNS
  rebinding
- Random per-run token in the launch URL, exchanged for an HttpOnly cookie and stripped from the URL;
  the same token lands in `~/.ccwt/token` (mode 600) for hook callbacks
- Validates `Origin` on WebSocket upgrades, because WebSockets ignore CORS

A restart issues a new token, so a tab left open from a previous run will show `Unauthorized` until
you open the new launch URL.

## Why dependencies are copied or hardlinked, never symlinked

`git worktree add` checks out tracked files only, so `node_modules` and `.env` are absent. That is
the whole reason this tool exists. Benchmarked against a real Vite + Vue repo (38 MB `node_modules`,
703 files):

| Strategy | Time | New disk | Safe? |
|---|---|---|---|
| pnpm install per worktree | 679 ms | **0.18 MB** | yes |
| `cp -al` hardlink (npm/yarn) | **22 ms** | **0 MB** | yes |
| npm install per worktree | 1053 ms | 40 MB | yes |
| symlink `node_modules` | — | 0 MB | **no — corrupts the root project** |

The symlink result is the surprising one: a `pnpm install` inside the worktree pruned packages out
of the *shared root* `node_modules` and broke the root checkout's build, while the root's own
`package.json` and lockfile stayed unchanged — so nothing in git would explain it.
