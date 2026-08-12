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

**Usable.** Register a repository, create a worktree, watch it get provisioned, get its own ports
and running services, read the logs, open the URL, remove it cleanly — including Docker Compose
stacks, which get isolated per worktree without editing your compose file. What is not built returns
`501 Not Implemented` naming the milestone that owes it.

| Milestone | What it adds | State |
|---|---|---|
| 1 | register → create → provision → serve → logs → remove | **done** |
| 2 | discover Claude's worktrees, respect locks, launch a session, `.worktreeinclude` | **half** — discovery and locks done |
| 3 | validated recipes, multiple services, recipe editor | **done** |
| 4 | session-status hooks, port map, git status, drift detection | **not started** |
| 5 | `WorktreeCreate` ownership | not started |
| + | Compose isolation, file browser, zero-touch setup | **done** — outside the plan |

`MILESTONES.md` has the detail, including how each claim was verified.

**The honest gaps:** the *launch a session* button and the agent badge on every card are inert until
Milestone 4's hooks land, detection understands Node and Compose but not Python or Ruby, and there
are no automated tests yet.

Two pieces of Milestone 2 came for free. Every worktree of the repository is listed whoever made
it — yours, ccwt's, and the ones Claude Code creates under `.claude/worktrees/` — each tagged by
origin, and any of them gets a port the moment you press start. And a worktree that Claude Code has
locked cannot be removed; the dashboard shows git's own lock reason instead.

## What it does that a shell alias does not

- **Isolates a Docker Compose stack per worktree** by generating an override file, so two branches
  run the same stack at once and your compose file is never touched
- **Allocates and remembers a port per service, per worktree**, in git's own per-worktree config
- **Waits for a dependency to actually answer** before starting what depends on it
- **Tells you when a port is not reachable**, instead of handing you a dead link
- **Explains what it found** — services, containers, published ports, and anything hardcoded that
  would stop worktrees running side by side

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

### Docker Compose

A compose file publishes fixed host ports, so two worktrees of one stack would collide. ccwt writes
a small override into each worktree and starts the stack with it:

```yaml
# .ccwt.compose.yml — generated, recreated on every start
services:
  webserver:
    container_name: ccwt-my-branch-webserver
    ports: !override
      - "20092:80"
```

```bash
docker compose -f docker-compose.yml -f .ccwt.compose.yml up
```

Every published port gets a free one, every container a namespaced name, and `COMPOSE_PROJECT_NAME`
separates networks and volumes. **Your compose file is never edited.** Needs Compose v2.24+ for the
`!override` tag.

By default every container is per-worktree, so a migration in one branch cannot reach another. Set
`isolate: "app-only"` on the service and list the containers to share if you would rather one
database served every worktree.

### The one case that still needs a decision

Compose is handled above. What is left is a project that writes another service's address into a
config file as a literal — a Vite proxy
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

`MILESTONES.md` records what is built, what is stubbed, and how each claim was verified.

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
code comments. `SPEC.md` is the product spec; `MILESTONES.md` is what is built against it.

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
