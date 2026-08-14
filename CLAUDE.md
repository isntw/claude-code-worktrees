# CLAUDE.md

`ccwt` manages git worktrees as **running environments** — provisioned files, installed dependencies,
a dev server on its own port, live logs. `SPEC.md` is the product spec. This file is the set of rules
that are not visible from the code; `MILESTONES.md` records what is built and the traps found on the
way.

## Commands

```bash
npm run dev          # nuxt dev on 127.0.0.1:5600, auth disabled
npm run build        # nuxt build -> .output/
npm run typecheck    # vue-tsc across app/, server/ and shared/
npm start            # bin/ccwt.mjs — the shipped entry point
```

- `npx nuxt` does not work in this shell; a command hook rewrites it. Use `./node_modules/.bin/nuxt`.
- **Delete `.nuxt/` and `.output/` before trusting a build that changed `nuxt.config.ts`.** The SPA
  shell is generated into the renderer chunk at build time and goes stale.
- Changing `shared/` requires restarting `npm run dev`; it does not hot-reload.

## Architecture

One Nuxt project, `ssr: false`. Two seams, both load-bearing:

1. **`server/lib/` never imports Nuxt or H3.** Pure functions over `node:` builtins. They import types
   by relative path (`../../shared/types`), never via `#shared`, which is a Nuxt construct.
2. **The frontend reaches the backend only through `app/composables/useApi.ts`.** Nothing else may
   call `fetch` or open a `WebSocket`.

`shared/types.ts` is the one type vocabulary. App code imports it as `#shared/types`, server code by
relative path. **`server/api/` imports `server/lib/` through the `~~/server/lib/…` alias, never
relatively** — the routes nest six deep and hand-counted `../` was wrong three times out of four.

Unbuilt features throw `NotImplemented` from `stub.ts`; `guard()` turns that into a **501 naming the
milestone** and any other `Error` into a 400 carrying its message. Grep `stub('` for what is owed.

## Rules that break something if violated

### Ports

- Allocation is `hashToRange(path + service)` then a linear probe, persisted in
  `git config --worktree ccwt.port.<service>`, which needs `extensions.worktreeConfig` — `create()`
  sets it. This is **the only place ccwt writes to a repository it did not create.**
- **A git config key may not contain an underscore.** Service names may, so keys are lowercased with
  non-alphanumerics collapsed to dashes.
- **A persisted port must still satisfy the range it is asked for.** `readAllocated` takes the range
  and returns `null` outside it, so narrowing a range in the recipe actually moves the port.
- `servicesFor` consults the supervisor's live entry only when the service is **not** stopped; a
  stopped entry's port is stale the moment the range changes.
- **A range whose ends are equal is a pinned port**, and everything that reports on ports must
  account for it.

### Loopback is two address families

**Vite binds `localhost`, which on macOS is `[::1]` — nothing on `127.0.0.1`.**

- `ports.isFree()` requires the port free on **both** families, or it hands out a taken port.
- `supervisor.canConnect()` tries both and takes either.
- Generated URLs use **`localhost`**, never `127.0.0.1`, or an IPv6-only server is a dead link.

ccwt's *own* server still binds `127.0.0.1` explicitly. The rule is: bind narrowly, probe broadly.

### The supervisor

- Services spawn `detached: true` and stop via `process.kill(-pid)` — the negative pid signals the
  process group. Killing the child alone leaves the grandchild holding the port. `SIGKILL` follows
  `SIGTERM` after four seconds.
- State goes `starting` → `running` after 750ms still alive, not on first output.
- `supervisor.note()` writes under the service name `provision`, which is how worktree creation
  streams before its card exists.
- `stopAll` runs on the Nitro `close` hook and on `SIGINT`/`SIGTERM` (decision **D1**).

### Ordering and after-start commands

- `dependsOn` starts each dependency **and waits for its port to answer** before the dependent —
  spawn order alone is worthless. A dependency that never comes up logs and proceeds rather than
  blocking forever.
- Cycles and unknown names are rejected in `findCycle` at **validation**, so a bad graph is a 422
  naming the loop, not a hang.
- `postStart` runs when the service's port answers, in the worktree, with **the same environment the
  service was spawned with**. A failing command is **retried for two minutes** — a port answering
  does not mean everything behind it is ready. First attempt streams, retries run quiet, the settling
  attempt prints its own output. A final failure skips the remaining commands and leaves the service
  running.
- **`waitReachable` waits for `settling` too**, so `dependsOn` means reachable *and* prepared. Its
  probe deadline applies only before the port answers.
- **`postRemove` may never block a removal** (`SPEC.md` §5.3). Every command's result is discarded.
- `argv()` strips top-level quotes as a shell would, so hook commands must be plain argv, not shell
  one-liners.

### Provisioning

- **Never symlink `node_modules` or anything into `.claude/`.** A `pnpm install` inside a worktree
  prunes packages out of a symlinked shared root and breaks the root checkout, with nothing in git to
  explain it. Copy or hardlink.
- `provision.copy` copies; `provision.link` **hardlinks — the same inode**, so editing a linked file
  edits the root checkout. Two lists, never one list with a mode toggle.
- Per-entry outcomes go into a `ProvisionReport`; nothing throws. `copyFile` throws on a directory,
  and one directory entry used to abort the whole chain silently.
- **`ALWAYS_PER_WORKTREE` is enforced.** Linking one of those paths is refused, and any nested inside
  something linked is removed afterwards.
- **A symlink standing where real content belongs is replaced, not skipped.** It holds no data, and
  it is invisible inside anything that follows the link rather than the target.
- `startService` calls `needsProvisioning` first and provisions only when something is missing, so a
  warm start does no work. There is no provision button.
- With `dependencies: "hardlink"` the install runs after the link and npm will prune undeclared
  packages out of the linked tree. Use `"copy"` to link without reconciling.

### Removal is `--force`

ccwt puts `node_modules` and copied `.env` files into a worktree, so `git worktree remove` always
refuses. Two things keep `--force` honest and both must stay: the dashboard confirms with the exact
path and states the branch survives, and `remove()` refuses any worktree outside the project's
`worktreesDir` unless it was classified `claude`.

**Never remove a locked worktree** — Claude Code locks while an agent works. Say "an agent is working
here", not an opaque failure.

**A worktree may vanish underneath us.** Claude Code sweeps stale subagent worktrees on its own
schedule; releasing a port and reaping a process must tolerate the directory being gone.

### The recipe is ccwt's, not the project's

`writeConfig` stores it on the project record in `~/.ccwt/state.json`. **There is no code path that
writes a file into a registered repository, and there must not be one.**

`readConfig` order: the stored recipe → a committed `ccwt.config.json`, **read only** → detection.
`resetConfig` drops the stored recipe, which is the only way back from a bad edit.

`store.ts` holds `{id, rootPath, addedAt}` plus the recipe once edited. Everything else on `Project`
is **re-derived on every read** by `projects.hydrate()`.

`RECIPE_REVISION` is bumped when detection learns to produce a new field, raising
`project.recipe-stale`. A stale recipe is **never** migrated or overwritten. Do not bump it for a
field detection cannot produce.

### Security

The backend runs `git` and spawns processes, so a page that reaches it has RCE.
`server/middleware/security.ts` runs before every route:

- **Host header validation is what stops DNS rebinding**, not the loopback bind. Only `127.0.0.1`,
  `localhost` and `[::1]` pass.
- **The token is per run.** `bin/ccwt.mjs` writes 32 random bytes to `~/.ccwt/token` at mode 600 and
  puts them in the launch URL; the middleware exchanges `?t=` for an HttpOnly `SameSite=Strict`
  cookie and **redirects to strip it from the URL**.
- **An empty token disables auth, and that is only ever true in `npm run dev`.** Do not add a path
  that boots the built server without one.
- **WebSocket upgrades validate `Origin` separately** — WebSockets ignore CORS.
- **`GET /api/fs/list` carries `assertBrowsable()`** on top of that: it is deliberately outside §9's
  containment rule, so it refuses outright when bound to anything but loopback, returns
  **directories only**, and caps at 500 entries with a visible notice.

`bin/ccwt.mjs` probes the port with a throwaway `net` server before claiming it, has **zero
dependencies** on purpose (it lives outside `.output/`), and refuses any non-loopback `--host`.

## Web layer

Terminal-native, dark-first, hand-rolled Tailwind 4. **There is no component library and must not
be** — `Nuxt UI` is in `SPEC.md` §3 and was rejected because its radii and control shapes read as a
different product.

- **Warm is broken.** `--ccwt-alarm` and `--ccwt-caution` are the only warm hues.
- **`--ccwt-live` is alive** — one desaturated green, for a running service or a working agent. **Do
  not extend it.** A second cool hue means the palette needs rethinking.
- **Interaction uses neither.** Selection inverts (`bg → ink`, `text → canvas`).
- **`success` is achromatic**, never green — a finished agent is not a running one.
- **Mono is what the machine said** (names, branches, paths, ports); **sans is what we think about
  it** (descriptions, states, errors). `.t-eyebrow` / `.t-data` / `.t-numeral` / `.t-badge` are the
  only type primitives.

`.t-badge`, `.t-control`, `.t-tabs`, `.t-button` hold geometry, type, hairline, disabled and focus;
components own only their own state. Two details that were each written twice:

- **A tab's or button's label must be a separate blockified element.** `text-box: trim-both cap
  alphabetic` silently does nothing on an anonymous flex item, and `ui-monospace` rides ~1px off.
- **A control's indicator is inline, not a flex item**, or the container takes its baseline from the
  indicator's bottom edge and drops the label ~3px.

`Checkbox` and `Toggle` draw themselves — a native checkbox is the only rounded thing on the page —
but keep a real `sr-only` `<input type="checkbox">` rather than `appearance: none`, so label
association, the space bar and `role="switch"` still come free.

**A button beside an input must be the same height.** `.t-input` is `1.75rem`; `Button`'s **`md`** is
`h-7` and matches, `sm` is `h-6` and sits 4px short. Check `/preview` before changing either.

**The theme class is set before paint by an inline script in `nuxt.config.ts` and is not
head-managed.** Do not put it back into `htmlAttrs` under any spelling — unhead re-applies it after
the plugin runs and a stored `light` preference renders dark. `useTheme` is the only writer.

`app/nav.ts` is the single nav manifest; adding a page means touching it and `app/pages/`. It exists
instead of `definePageMeta` because the sidebar needs a *component* per route. `ConsoleHeader` takes
`title` and `blurb` as props so a drill-in page can title itself. `/preview` is a shipped route that
renders every primitive in every state; its sample data must never leak into real pages.

## Conventions

- **Do not write code comments.** No prose, no JSDoc, no banners. Reasoning lives here. What a tool
  reads stays: `@ts-expect-error`, a shebang, a compiler directive.
- **`noUncheckedIndexedAccess` is on.** Use `!` only after an explicit length or existence check.
- **`useLayout` is a Nuxt built-in** — the shell composable is `useShell`. Check Nuxt's auto-imports
  before adding a composable.
- **Discovery must never throw.** A repository that fails to parse must still produce a value
  carrying a `Diagnostic`; the broken thing is what the dashboard exists to show.
- **`Diagnostic.code` is machine-readable**, namespaced `thing.problem` (`worktree.drift`,
  `project.no-config`). Keep them stable.
- **`.worktreeinclude` is a config source, not a competitor** (`SPEC.md` §5.4, still stubbed). A file
  is copied only if it matches a pattern *and* is gitignored. `provision.copy` merges with it.
- **ccwt is command-agnostic.** It allocates a port, renders a template, spawns a process, probes the
  port, kills the process group. It does not know what any command does, and nothing may teach it
  about a particular stack, framework or runtime.
