# CLAUDE.md

`ccwt` manages git worktrees as **running environments** — provisioned files, installed
dependencies, a dev server on its own port, live logs — and knows about the Claude Code sessions
running inside them. `SPEC.md` is the product spec; this file is how the code got the way it is.

## Commands

```bash
npm run dev          # nuxt dev on 127.0.0.1:5600
npm run build        # nuxt build -> .output/
npm run typecheck    # vue-tsc across app/, server/ and shared/
npm start            # bin/ccwt.mjs — the shipped entry point
node bin/ccwt.mjs --no-open --port 4600
```

`npx nuxt` does not work in this shell — a command hook rewrites it. Use `./node_modules/.bin/nuxt`.

**Delete `.nuxt/` and `.output/` before trusting a build that changed `nuxt.config.ts`.** The SPA
shell is generated into the renderer chunk at build time and a stale one served the old `<html>`
tag for two rebuilds while the config on disk already said otherwise.

## Architecture

One Nuxt project, `ssr: false`. Two rules keep the seams clean and both are load-bearing:

1. **`server/lib/` never imports Nuxt or H3.** Pure functions over `node:` builtins, testable
   without booting the app. They import types by relative path (`../../shared/types`), never via the
   `#shared` alias, because that alias is a Nuxt construct.
2. **The frontend only reaches the backend through `app/composables/useApi.ts`.** One file to change
   if this is ever wrapped in Electron. Nothing else may call `fetch` or open a `WebSocket`.

`shared/types.ts` is the one type vocabulary both sides use. App code imports it as
`#shared/types`; server code by relative path.

### What is real, and what still announces itself

Milestone 1 is built: `exec`, `git`, `detect`, `ports`, `provision`, `supervisor`, `projects`,
`worktrees`, `store`. What remains stubbed throws `NotImplemented` from `stub.ts` —
`claude.launchSession` and the hook machinery (Milestones 2 and 4), and
`provision.readWorktreeInclude` (Milestone 2).

`guard()` (`server/utils/guard.ts`) turns that one error class into a **501 with the milestone in
the message**, and any other `Error` into a 400 carrying its message. So an unbuilt feature reads as
"not built yet, Milestone 2" in the error bar, and a real failure — a locked worktree, an exhausted
port range, a path that already exists — reads as the sentence the lib threw. Grep `stub('` to see
what each milestone still owes.

**`server/api/` imports `server/lib/` through the `~~/server/lib/…` alias, never relatively.** The
routes nest six directories deep (`projects/[id]/worktrees/[worktreeId]/services/[service]/`) and
hand-counted `../../../../../..` was wrong in three files out of four on the first attempt.

### Two things fall out of Milestone 1 that the spec files under Milestone 2

Worth knowing before building §5.1, because most of it is already done:

- **Discovery is free.** `git worktree list --porcelain` returns every worktree whoever made it, so
  Claude Code's `.claude/worktrees/*` already appear on the dashboard, tagged by `classify()`.
  There is no separate adopt step and no adopt endpoint — a discovered worktree gets a port the
  moment you press start, because `startService` allocates on demand. What §5.1 still owes is
  provisioning an adopted worktree that has no `node_modules`; the card marks those `unprovisioned`.
- **Locks are respected.** `remove()` refuses a locked worktree and surfaces git's own lock reason,
  and `WorktreeCard` disables the control. Verified against a real `git worktree lock`.

### Removal is `--force`, and that is why it asks first

ccwt puts `node_modules` and copied `.env` files into a worktree, so `git worktree remove` always
refuses with "contains modified or untracked files". Removal therefore passes `--force`, which
deletes untracked work. Two things keep that honest and both must stay: the dashboard confirms with
the exact path and states that the branch survives, and `remove()` refuses any worktree outside the
project's configured `worktreesDir` unless it was classified `claude`.

### Ports live in git's own per-worktree config

`git config --worktree ccwt.port.<service>`, which requires `extensions.worktreeConfig` to be `true`
on the repo. `create()` sets it, idempotently. **This is the one place ccwt writes to a repository it
did not create** — deliberate, per `SPEC.md` §8; the alternative was a sidecar database keyed by
path that drifts the moment anything moves. Git's caveat applies: with the extension on, `core.bare`
and `core.worktree` in the common config bind only to the main worktree. Neither is set on a normal
checkout.

Allocation is `hashToRange(path + service)` then a linear probe forward through the range, so a
worktree keeps its port across restarts and two worktrees rarely collide before probing.

### The supervisor spawns detached so it can kill a tree

`npm run dev` is a process that spawns the process you actually care about. Killing the child leaves
the grandchild holding the port. Services spawn with `detached: true` and stop via
`process.kill(-pid)` — the negative pid signals the whole process group — escalating to `SIGKILL`
four seconds after `SIGTERM`. Verified: stopping leaves no stray `node`, and neither does quitting
ccwt (`stopAll` on the Nitro `close` hook plus `SIGINT`/`SIGTERM`, which is decision **D1**).

State goes `starting` → `running` after 750ms still alive, rather than on first output: a server
that prints nothing would otherwise never leave `starting`, and one that prints a banner then dies
would flash `running`.

`supervisor.note()` writes a synthetic log line under the service name `provision` — that is how
worktree creation streams progress to the dashboard before the card it belongs to exists.

`store.ts` holds only `{id, rootPath, addedAt}` per project. Everything else on `Project` — name,
package manager, default branch, config, diagnostics — is **re-derived on every read** by
`projects.hydrate()`, so editing `ccwt.config.json` or switching branches shows up without
re-registering and nothing in `~/.ccwt/state.json` can go stale.

### Security is not optional, and the loopback bind is not the control

The backend runs `git` and spawns processes, so a web page that can reach it has remote code
execution. Vite shipped CVE-2025-24010 for exactly this shape of bug.

`server/middleware/security.ts` runs before every route:

- **Host header validation is what stops DNS rebinding**, not the loopback bind. A browser resolving
  `evil.example.com` to `127.0.0.1` still sends its own name in `Host`. Only `127.0.0.1`,
  `localhost` and `[::1]` pass; anything else is 403 before any handler runs.
- **The token is per run.** `bin/ccwt.mjs` generates 32 random bytes, writes them to `~/.ccwt/token`
  at mode 600 for hook callbacks, and puts them in the launch URL. The middleware exchanges
  `?t=<token>` for an HttpOnly `SameSite=Strict` cookie and **redirects to strip it from the URL**,
  so the token does not survive in history or in a copied link.
- **An empty token disables auth, and that is only ever true in `npm run dev`.** `bin/ccwt.mjs`
  always sets one. Do not add a code path that boots the built server without it.
- **WebSocket upgrades validate `Origin` separately** (`server/routes/_ws.ts`) because WebSockets
  ignore CORS entirely — the cookie would be sent and the connection would open.

A restart issues a new token, so an already-open tab starts failing with `Unauthorized` until the
new launch URL is opened. That is the design, not a bug; the error bar says so plainly.

### `bin/ccwt.mjs` probes the port before it claims anything

It used to print "listening on…" and then die on an unhandled `EADDRINUSE` from deep inside Nitro,
which reads as "started fine, then crashed for no reason". It now binds a throwaway `net` server
first and exits with a sentence naming the next free port. It has **zero dependencies** on purpose:
it lives outside `.output/`, which bundles its own, so anything it imports would have to become a
real runtime dependency of the published package.

It refuses any `--host` that is not loopback. See above for why.

## Web layer

Terminal-native, dark-first, a hand-rolled Tailwind 4 shell. **This is a deliberate port of
`claude-code-manager`'s console**, down to the token names, and it carries that project's rule:
there is no component library, so nothing else's look leaks into the identity. `Nuxt UI` is listed
in `SPEC.md` §3 and was rejected for that reason — its radii, shadows and control shapes read as a
different product, and re-skinning it is permanent work.

### Colour means three things and nothing else

- **Warm is broken.** `--ccwt-alarm` and `--ccwt-caution` are the only warm hues. If something is
  orange, it is wrong. Do not spend warm on anything else.
- **`--ccwt-live` is alive.** One desaturated green, used for a running service and a working agent.
  This is the one hue this project has that `claude-code-manager` does not, and it is a considered
  addition rather than drift: that app spent its cool channel on a five-step precedence ramp, this
  app has no precedence to encode, and "what is running right now" is the single question the
  dashboard exists to answer at a glance. **Do not extend it.** A second cool hue means the palette
  needs rethinking, not another token.
- **Interaction uses neither.** Selection inverts (`bg → ink`, `text → canvas`), the way a terminal
  cursor block does.

`success` is achromatic on purpose — full-strength `text-ink`, never green. An agent that finished
is not a running one, and giving both the live hue would collapse the distinction the card exists to
draw.

Type roles are load-bearing: **mono is what the machine said** (names, branches, paths, ports,
counts), **sans is what we think about it** (descriptions, states, error messages).
`.t-eyebrow` / `.t-data` / `.t-numeral` / `.t-badge` in `app/assets/style.css` are the only type
primitives.

### The `.t-*` split

`.t-badge`, `.t-control`, `.t-tabs` and `.t-button` in `style.css` hold the shell — geometry, type,
hairline, disabled treatment, focus ring. The components own only their own state. Two details
inherited from the source project that were each written twice before they were written once:

- **A tab's and a button's label is a separate blockified element.** Centring text in a fixed-height
  box centres the font's *content* box, and `ui-monospace` is lopsided, so labels ride high or low
  by ~1px. `text-box: trim-both cap alphabetic` fixes it, but **only on a blockified element** —
  applied to the button itself the label is an anonymous flex item and the trim silently does
  nothing.
- **A control's indicator is inline, not a flex item.** A flex container takes its baseline from its
  first item; an indicator with no text in it puts that baseline at its bottom edge and drops the
  label ~3px against the numbers beside it.

`Checkbox` and `Toggle` draw themselves because a native checkbox draws itself from the OS —
rounded, blue, and the only rounded thing on the page. Both keep a real `<input type="checkbox">`,
`sr-only` rather than `appearance: none`, so label association, the space bar and `role="switch"`
still come free.

### The theme class is set before paint, and is not head-managed

`nuxt.config.ts` puts a tiny inline script in `<head>` that reads `localStorage['ccwt.theme']` and
toggles `.dark` on `<html>`, defaulting to dark.

**This replaced `htmlAttrs: { class: 'dark' }`, which was an actual bug.** With the class in
`app.head`, unhead re-applied `dark` after the plugin had removed it — so a stored `light`
preference rendered a dark page with a sidebar that read "light". Do not put the theme class back
into `htmlAttrs` under any spelling; unhead will win the race. `useTheme` toggles `classList`
directly and that is now the only writer.

### Routing and pages

`app/nav.ts` is the single nav manifest — path, title, blurb, icon, and whether it sits in the page
list or pinned to the bottom. Adding a page means touching that file and `app/pages/`. It exists
instead of `definePageMeta` because the sidebar needs a *component* per route, and Nuxt extracts
page meta statically at build time.

`ConsoleHeader` takes `title` and `blurb` as props rather than reading the route, so a drill-in page
can title itself after the thing it is showing (`project/[id].vue` uses the project's name).

`/preview` renders every primitive in every state. It is a real route in the shipped nav, not a
scratch file, because this shell is hand-rolled: the source project documents its own primitives
drifting — `h-7` beside `h-6`, `disabled` at 40% in one place and 50% in another — and one page
where they sit side by side is what makes that visible. Its sample data is defined in the page and
must never leak into the real ones; the dashboards render only what the API returned.

## Conventions

- **Do not write code comments.** No prose, no JSDoc, no section banners. The reasoning lives in
  *this file*, which gets read before the code is touched rather than after. What a tool reads is
  not a comment in that sense and stays: `@ts-expect-error`, a shebang, a directive a compiler needs.
- **`noUncheckedIndexedAccess` is on.** Index access yields `T | undefined`; use `!` only after an
  explicit length or existence check.
- **`useLayout` is a Nuxt built-in.** The shell composable is `useShell` because of it. Check names
  against Nuxt's auto-imports before adding a composable — the collision warning is easy to scroll
  past during install.
- **Discovery must never throw** once `server/lib/` is real. A repository that fails to parse must
  still produce a value carrying a `Diagnostic`; the broken thing is what the dashboard exists to
  show.
- **`Diagnostic.code` is machine-readable** and namespaced `thing.problem` (`worktree.drift`,
  `project.no-config`). Keep them stable; the UI will group on them.

## Rules the Claude Code integration imposes

These are not implemented yet (Milestone 2 onward) but they constrain what may be written:

- **Never remove a locked worktree.** Claude Code runs `git worktree lock` while an agent is
  working. Check before any removal and say "an agent is working here" rather than failing opaquely.
  `WorktreeCard` already disables its remove button on `locked`.
- **Never symlink into `.claude/`,** and never symlink `node_modules`. Claude Code refuses to create
  a worktree when `.claude`, `.claude/worktrees` or the worktree directory is a symlink. Separately,
  a symlinked `node_modules` lets a `pnpm install` inside a worktree **prune packages out of the
  shared root** and break the root checkout, with nothing in git to explain it. Copy or hardlink.
- **A worktree may vanish underneath us.** Claude Code sweeps stale subagent worktrees on its own
  schedule. Releasing a port and reaping a process must tolerate the directory already being gone.
- **`.worktreeinclude` is a config source, not a competitor.** A file is copied only if it matches a
  pattern *and* is gitignored, so tracked files are never duplicated. `provision.copy` merges with
  it rather than replacing it.
