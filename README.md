# ccwt — git worktrees that actually run

Register a repository once. From then on, a new worktree arrives with its files, its dependencies,
its own ports, its services started and its logs streaming — from one click in a local dashboard.

A local web app on `127.0.0.1`. No database, no Electron, no native modules, and no container runtime
required — though it will happily run a container stack if that is what your project is.

> "Claude" and "Claude Code" are Anthropic trademarks. Fine for a personal repo; expect to rename if
> this is ever published publicly.

## The problem

`git worktree add` checks out **tracked files only**. Everything that makes a checkout runnable is
missing, and the second worktree collides with the first.

| You wanted | What you get |
|---|---|
| A working copy | No `node_modules`, no `.env` |
| To run it | The port is taken by the checkout next door |
| Two branches at once | Two dev servers fighting over `:3000` |
| To throw it away | `git worktree remove` refuses — untracked files |

So every parallel branch means installing again, copying secrets again, hunting for a free port,
remembering which port was which, and cleaning up by hand.

**That is the part ccwt does.** One click per worktree, one dashboard for all of them.

## Quick start

```bash
npm install
npm run build
npm start            # opens http://127.0.0.1:4600 with a one-time token
```

`--no-open` skips the browser. `--port <n>` moves it off 4600.

Then, in the dashboard:

1. **Add a repository** — browse to it or type the path. ccwt reads the project and fills in a recipe.
2. **New worktree** — a name, a branch, optionally *start its services once provisioned*.
3. Watch it get set up, click its port, work.
4. **Merge** its pull request, then **remove** it. The branch survives unless you say otherwise.

**Nothing is added to your project.** No file to commit, no script to change.

## Features

### Worktrees

- **Create** with a name and a branch — the name is slugified, the branch defaults to it, and services can start on their own
- They live in `.claude/worktrees/<project>/<name>` by default, alongside Claude Code's own
- **Every worktree is listed**, whoever made it, tagged `ccwt`, `claude` or `manual`
- **Git status per worktree** — ahead/behind, staged, unstaged, untracked, conflicted, or *unpushed* when there is no upstream. ccwt never fetches, and says so
- **A merged pull request marks the worktree `finished`**, so you can see what is safe to delete
- **Locks are shown, not obeyed** — the card gives git's own lock reason, and *An agent is working here* when Claude Code holds it. Removal releases the lock first
- **Removal is careful about whose files they are** (below)
- **Missing files are put back** on the next start; create-time commands are never re-run in a worktree ccwt did not create

### Ports

- **One port per service, per worktree** — derived from the path, then remembered in worktree-scoped git config
- **Checked on both `127.0.0.1` and `[::1]`** before it is handed out, because `localhost` is two address families
- **Extra named ports** beside the main one — a database, an HMR socket, a debugger — each allocated and remembered the same way
- **Pin a port** by giving its range equal ends; the card then warns instead of starting into a collision
- **`5209 taken · moves on start`** — something else answers, so the next start takes the next free port in range and keeps it
- **`not on port 5209`** — ccwt assigned it, nothing is listening, so the command is probably ignoring it
- **Port map** at `/overview` — every claim on every port, across every registered project
- **Who holds this port** — ccwt's own service, or a foreign pid and its command line; free it from the dashboard

### Services

- **Start or stop one, or all.** States: stopped, starting, running, crashed
- **Reachability is probed**, so you get a warning rather than a dead link
- **`dependsOn` waits for the dependency to answer**, not merely to spawn; cycles are refused at validation, naming the loop
- **After-start commands** — migrations, seeds, a warm-up request — retried for two minutes
- **Its own stop and remove commands**, for anything that does not die with its process
- **Logs stream live**, with follow and clear
- **Stopping kills the process group**, so no grandchild keeps the port; everything is reaped when ccwt quits

### Setup, in one recipe

- **Detection** reads the lockfile for the package manager, takes the first of `dev`, `start` or
  `serve` as the service, or one service per workspace package (`workspaces`, `pnpm-workspace.yaml`).
  It appends `--port` only when the script runs a single process
- It prefills `node_modules` under **link**, and the `.env*` files that exist and are gitignored under **copy**
- **Editor** at `/project/:id/config` — form ⇄ JSON, both validated, with a line diff before saving
- **Detect opens a picker**, not an overwrite: a row per thing found, merge only, nothing removed
- **Four ways to put a file in a worktree** — `copy` from the root checkout, `link` (a hardlink, the
  same inode, 0 MB), `write` from content in the recipe, and `postCreate` to build it
- **Hooks** — `postCreate` (install, keys, seeds), per-service `postStart`, and `postRemove`, which can never block a removal
- **A service is a command or a container stack** — pick stack and the editor fills in the compose
  commands and a per-worktree project name. ccwt itself only ever runs commands
- **Stored in `~/.ccwt/state.json`.** ccwt has no code path that writes into your repository. A
  committed `ccwt.config.json` is read if you ship one
- **Setup panel** — plain language on what was found, what each worktree will run, and anything that would stop two running at once
- **Forgetting your edits asks first**, then falls back to detection

### Pull requests

- **Sign in to GitHub** by device code; the token lives in `~/.ccwt`, and `sign out` is one click
- **Each worktree shows its branch's pull request** — open, draft, merged, closed
- **Merge from the dashboard** — merge, squash or rebase, with GitHub's mergeability reason shown
  first and the account doing it named
- It changes the remote only. Nothing local is stopped or deleted

### Claude Code

- **Ships a plugin**, installed, updated and removed with a button in **Settings**
- **Sessions are told what ccwt runs** — every worktree, its services, its ports, which are answering — and told again when something moves
- **A session cannot start a dev server ccwt already has listening**; the duplicate command is denied
- **Two read-only MCP tools.** `ccwt_status` answers even with the dashboard closed; `ccwt_logs`
  returns a service's recent output. Neither can start, stop or restart anything
- **Names the session after its worktree**, and never over a title you typed
- Installs into Claude Code's own storage — no repository is touched

### Safety

- Binds `127.0.0.1` only, and refuses any other `--host`
- Validates the `Host` header on every request — this, not the loopback bind, is what stops DNS rebinding
- A **new random token every run**, carried in the launch URL, exchanged for an HttpOnly `SameSite=Strict`
  cookie and stripped from the URL. Tools present the same token as a header
- Validates `Origin` on WebSocket upgrades, because WebSockets ignore CORS
- The directory browser returns directories only, and refuses outright unless bound to loopback
- **Requirements** panel checks git ≥ 2.20 and Node ≥ 20, and says what each is for

A restart issues a new token, so a tab left open from a previous run shows `Unauthorized` until you
open the new launch URL.

## How a worktree learns which port it got

Through the environment its services are started with. There is no file to read and nothing to
import.

```bash
PORT=5209                                # this service's own port
CCWT_PORT_WEB=5209                       # every service in the recipe,
CCWT_URL_WEB=http://localhost:5209       # so one can reach another
CCWT_PORT_SERVER=4767
CCWT_URL_SERVER=http://localhost:4767
DB_PORT=5433                             # any extra port you named, under that name
```

`FORCE_COLOR=0` and `BROWSER=none` come along too, so logs stay readable and nothing opens a second tab.

The same values are available as placeholders anywhere the recipe takes a string — a command, an
environment value, an after-start step:

| Placeholder | Becomes |
|---|---|
| `{{port}}` `{{url}}` | this service's port and URL |
| `{{port.server}}` `{{url.server}}` | another service's, by name |
| `{{project}}` `{{slug}}` `{{branch}}` | what this worktree is |
| `{{rootPath}}` `{{worktreePath}}` | where it is |

**A file written at provision time cannot carry a port.** `provision.write` renders `{{project}}`,
`{{slug}}`, `{{rootPath}}` and `{{worktreePath}}` only, because it runs before any port is allocated.
Ports reach a process, not a file.

## Running something once a service is up

**Run once this service answers** takes any commands you like, run in the worktree with the same
environment the service got:

```
npm run db:migrate
```

They run on every start, so keep them idempotent. A failure is retried for two minutes — a port
answering does not mean everything behind it is ready. If it never succeeds, it is reported with its
exit code, the commands after it are skipped, and the service keeps running so you can read its logs.

## What removal will and will not delete

- **The repository root is never removable.**
- **A worktree ccwt or Claude Code made** is removed with `--force`, because ccwt is what put the
  untracked files there. The confirmation names the exact path first.
- **A worktree you made yourself** is removed only when it has nothing to lose. Uncommitted changes or
  ignored files stop it, named in the message — ccwt did not create them, so it will not delete them.
- **The branch is kept** unless you tick the box, and the box says what that does.
- A lock is released first, ports are released, and per-service remove commands and `postRemove` run
  with their results discarded, so teardown can never trap a worktree.

## The one case that needs a decision from you

A project that writes another service's address into a file as a literal — a Vite proxy pointing at
`http://127.0.0.1:4599`, say. A value baked into a file cannot differ between two copies of it, so
every worktree points at the same place. Nothing outside the file can change that.

ccwt names the file and the line and keeps working: **run one worktree of that project at a time.** To
run several, the panel shows the one-line change that makes the address configurable — your call, not
a requirement:

```diff
- '/api': 'http://127.0.0.1:4599',
+ '/api': process.env.CCWT_URL_SERVER ?? 'http://127.0.0.1:4599',
```

Most projects never hit this. Of eight repositories tested, one did.

## Not built yet

- **Detection is Node-shaped.** A Django, Rails or Laravel project registers, provisions and removes
  fine, but no service is found — you write the command yourself, and the Setup panel says so
- **`.worktreeinclude`** is the one stub left in the codebase; it returns `501` naming its milestone
- **No `.env` diff and no drift repair** between a worktree and the root checkout
- **Thin tests.** `npm test` covers the parts that branch — port keys, the command guard, worktree
  parsing, session naming. Most of `server/lib` is still verified by running it

`docs/MILESTONES.md` records what is built, what is stubbed, and how each claim was verified.

## Why dependencies are copied or hardlinked, never symlinked

Benchmarked against a real Vite + Vue repo (38 MB `node_modules`, 703 files):

| Strategy | Time | New disk | Safe? |
|---|---|---|---|
| `cp -al` hardlink (npm/yarn) | **22 ms** | **0 MB** | yes |
| pnpm install per worktree | 679 ms | 0.18 MB | yes |
| npm install per worktree | 1053 ms | 40 MB | yes |
| symlink `node_modules` | — | 0 MB | **no — corrupts the root project** |

The symlink result is the surprising one: a `pnpm install` inside the worktree pruned packages out of
the *shared root* `node_modules` and broke the root checkout's build, while the root's own
`package.json` and lockfile stayed unchanged — so nothing in git would explain it.

Because `link` hardlinks the same inode, editing a linked file edits the root checkout. That is why
copy and link are two separate lists rather than one setting with a toggle.

## Where your data lives

No database. Two places, both plain text you can read.

**`~/.ccwt/`**, created at mode 700:

| File | Holds |
|---|---|
| `state.json` | the repositories you registered, and any recipe you edited — nothing else |
| `token` | this run's token, mode 600 |
| `forge.json` | your GitHub credential |
| `server.json` | the host and port this run is on, so the plugin can find the API |
| `plugin/` | a copy of the plugin, and only once you press install |

**`git config --worktree`, in the repository** — one key per allocated port, plus a stamp marking the
worktree as ccwt's. This is the only thing ccwt ever writes into a repository, and it needs
`extensions.worktreeConfig`, which ccwt sets when it creates a worktree.

Everything else is re-derived on every read: which worktrees exist, what is running, what is
answering, what git thinks of each one. Logs are the last 1000 lines per service, held in memory — a
restart loses them. Delete `state.json` and you lose your project list and your recipe edits; no
worktree is touched.

## How it is put together

One Nuxt project, `ssr: false`. Vue SFCs, Nitro server routes, one shared type vocabulary.

```
app/          frontend; every backend call goes through composables/useApi.ts
server/lib/   pure logic, no Nuxt or H3 — git, provisioning, ports, supervisor, forge, plugin
server/api/   thin HTTP wrappers around lib/
server/routes/_ws.ts   WebSocket: logs and status
shared/       the types both sides use, and the recipe schema
plugin/       the Claude Code plugin: hooks and read-only MCP tools
bin/ccwt.mjs  CLI entry: boot the server, open a browser
```

```bash
npm run dev          # 127.0.0.1:5600, auth disabled
npm run typecheck
npm test
```

Read `CLAUDE.md` before changing anything — it holds the rules that are not visible from the code,
because the repo uses no code comments. `docs/SPEC.md` is the product spec.

## License

AGPL-3.0-only. Copyright © 2026 Iustinian Monea. Full text in [LICENSE](LICENSE).

Use it, study it, modify it, share it — freely, including at work and on projects you are paid for.
Running `ccwt` places no obligation on you or on anything it provisions: your worktrees, your code and
your recipes are yours, and nothing here reaches into them.

The one condition is reciprocity, and it binds only redistribution. Ship `ccwt` to someone else —
modified or not, sold or given away — or run a modified copy as a service other people reach over a
network, and you owe them the complete corresponding source under this same license. A fork stays
open; it cannot be closed.
