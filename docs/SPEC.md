# claude-code-worktree

**Spec v0.3** · 2026-08-12

---

## 1. What it is

A local web app that manages git worktrees as **running environments** — provisioned files, installed dependencies, a dev server on its own port, live logs — and knows about the Claude Code sessions running inside them.

Register a root project once, describe how a worktree should be set up for that stack, and from then on creating a feature worktree is one click.

**Package:** `claude-code-worktree` · **CLI:** `ccwt` (alias `claude-code-worktree`)

> Note: "Claude" and "Claude Code" are Anthropic trademarks. Fine for an internal or personal repo; if you ever publish this publicly, expect to rename.

> **As built:** the package and repository are `claude-code-worktrees` (plural), matching the directory and the GitHub repo. The CLI is `ccwt`, with `claude-code-worktrees` as the alias.

---

## 2. Scope

### In scope

| # | Capability |
|---|---|
| 1 | Register a root project; auto-detect its package manager and dev script |
| 2 | Configure a **recipe** per project: files to copy, how deps are provisioned, post-create commands |
| 3 | Create a worktree from a branch, provision it, remove it cleanly |
| 4 | Assign a stable, non-colliding port per worktree |
| 5 | Start / stop / restart a dev server per worktree, with streamed logs |
| 6 | **Discover and adopt worktrees Claude Code created**, so they get ports and dev servers too |
| 7 | ~~Show Claude Code session status per worktree~~ — **dropped**, see §5.2 |
| 8 | ~~Launch a Claude Code session in a worktree from the dashboard~~ — **dropped**, see §5.2 |
| 9 | A dashboard listing every worktree, its status, port and URL |
| 10 | Work with any project — the recipe is data, not hardcoded |

### Out of scope

- Not a git client — no staging, committing, merging, conflict resolution
- Not a task board — no prompts, no diff review, no PR creation *(that's Conductor / vibe-kanban territory; explicitly not this product)*
- No CI, no deployment, no team features
- Single machine, single user, localhost only

### Later

- Reverse proxy so each worktree gets `feature-x.myapp.localhost` instead of a port
- Per-worktree databases · Docker Compose support · Electron wrapper

> **As built:** none of this is supported and ccwt knows nothing about containers. A container
> command is just a command: you can put one in a service and ccwt will run it, allocate its port and
> kill its process group, exactly as with any other. It will not read, generate or reason about a
> compose file.

---

## 3. Tech stack

**One Nuxt project. That's the whole stack.**

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Nuxt 4.5** | Includes Vue 3.5 and the Nitro server |
| Frontend | **Vue 3 SFCs** in `app/` | `ssr: false` — it's a local dashboard |
| Backend | **Nitro server routes** in `server/` | Plain Node. Where `git` and `spawn` run. |
| Live updates | **Nitro WebSocket** | Built in; needs `nitro.experimental.websocket: true` |
| Language | **TypeScript** | |
| UI kit | ~~Nuxt UI 4~~ → **hand-rolled Tailwind 4 shell** | See the note below |
| Git & processes | **`node:child_process`** | No wrapper lib — `git worktree list --porcelain` is already machine-readable |
| Storage | **JSON files + git config** | No database |
| Distribution | **npm** → `npx ccwt` | `nuxt build` → 2.0 MB `.output/`, run with `node .output/server/index.mjs` |

No database, no Docker requirement, no Rust toolchain, no native modules.

> **Decided against Nuxt UI.** The console look is a port of `claude-code-manager`, whose own notes
> record removing PrimeVue entirely so that "nothing else's look leaks into the identity". Nuxt UI's
> radii, shadows and control shapes read as a different product, and re-skinning it is permanent
> work. The shell is hand-rolled on Tailwind 4; see `CLAUDE.md`.

**Why not a plain Vue SPA:** the browser sandbox can't run `git` or spawn processes. Something must run in Node.
**Why not Electron:** same code either way; skipping it avoids code signing, Apple notarization, SmartScreen and per-OS CI. Electron can wrap this exact build later without touching the frontend or server.

---

## 4. Project layout

```
claude-code-worktrees/
├── nuxt.config.ts
├── bin/ccwt.mjs             # CLI entry: boot server, open browser
├── shared/types.ts          # the type vocabulary both sides use
├── app/                     # ── FRONTEND (Vue) ──
│   ├── nav.ts                   the nav manifest
│   ├── pages/
│   │   ├── index.vue            project list
│   │   ├── project/[id].vue     worktree dashboard
│   │   └── preview.vue          every primitive in every state
│   ├── components/
│   │   ├── WorktreeCard.vue
│   │   ├── LogViewer.vue
│   │   └── CreateWorktreeModal.vue
│   └── composables/useApi.ts    # all backend calls go through here
└── server/                  # ── BACKEND (Nitro / Node) ──
    ├── lib/                     # pure logic, no framework imports
    │   ├── git.ts               worktree add/list/remove, locks
    │   ├── detect.ts            package manager + dev script
    │   ├── provision.ts         copy / hardlink / install
    │   ├── ports.ts             allocate + persist
    │   ├── supervisor.ts        spawn / logs / kill
    │   └── store.ts             ~/.ccwt/state.json
    ├── api/                     # thin HTTP wrappers around lib/
    ├── middleware/security.ts   # Host validation, token exchange
    └── routes/_ws.ts            # WebSocket: logs + status
```

Two rules keep it clean:

1. **`server/lib/` never imports Nuxt or H3** — pure functions, testable without booting the app.
2. **The frontend only talks to the backend through `useApi.ts`** — one file to change if you ever wrap it in Electron.

---

## 5. Claude Code integration

Claude Code creates its own worktrees. If we ignore that, you end up with two parallel sets of worktrees that don't know about each other. Two integration points fix it.

### 5.1 Discover and adopt — *default, always on*

Claude Code creates worktrees at `.claude/worktrees/<name>/` on a branch `worktree-<name>`, and subagents with `isolation: worktree` get their own too. All of them show up in `git worktree list --porcelain`.

**The dashboard lists every worktree of the repo, whoever made it**, tagged by origin (`manual` / `ccwt` / `claude`). An adopted worktree can be given a port and a dev server with one click, without ccwt having created it. This is cheap, safe and requires no configuration.

### 5.2 Session status and session launch — ~~*opt-in, one click to install*~~ **both dropped**

The plan was to write `SessionStart` / `Notification` / `SubagentStart` / `SubagentStop` / `SessionEnd`
hooks into the project's `.claude/settings.json`, each POSTing `session_id` and `cwd` to ccwt's
localhost API, so a card could read *working* / *waiting for you* / *done* and update live over the
WebSocket.

> **As built:** dropped, and the badge, the four states, the hook endpoint, the payload types and the
> `claude.trackSessions` recipe flag are all gone with it. Two things decided this. It is the one
> feature that requires ccwt to **write into a repository it did not create**, which §6 otherwise
> forbids outright. And **§5.5 already answers the question it was built to answer** — Claude Code
> runs `git worktree lock` while an agent works, so `git worktree list --porcelain` reports the
> presence of an agent for free, with no hook, no config and no writes. Coarser: present or absent,
> not working-vs-waiting-vs-done. Cheap enough to be always on.

**Launching a session (§2 capability 8) went too.** A button on the card would have spawned
`claude` in the worktree, and it never did anything but return 501. What it was worth turned on a
question §11 never answered — D4, spawn in your terminal app or embed a terminal in the dashboard —
and neither answer buys much: starting an agent in a directory is one command in a terminal you
already have open, and `claude --worktree` makes its own worktree without ccwt in the loop at all.
A control shipped ahead of the decision about what it does is worse than no control.

**ccwt is therefore not an agent runner.** It provisions worktrees, allocates ports, runs services
and shows what is live. Whether an agent is in one is git's business, through the lock. Starting one
is your terminal's.

### 5.3 Own worktree creation — *opt-in, advanced*

A `WorktreeCreate` hook replaces Claude Code's git logic entirely, so `claude --worktree` routes through ccwt: our path convention, our provisioning, our port allocation. A paired `WorktreeRemove` hook tears down ports and processes (its exit code is ignored — removal proceeds regardless, so cleanup must be best-effort and never block).

> **Corrected against Claude Code 2.1.234.** This section described a stdin payload that does not
> exist. `WorktreeCreate` receives **`name`** plus the common fields (`session_id`,
> `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `agent_id`, `agent_type`, `effort`) —
> not `worktree_path`, `worktree_reason` or `how_triggered`. `worktree_path` is the *`WorktreeRemove`*
> field. It does print the final path on stdout, where the **last non-empty line** is taken and a
> relative path resolves against `cwd`.
>
> Two things this section did not say and needed to. **Failure is fatal with no fallback to git**: a
> non-zero exit, a success printing no path, or a hook configured but not run makes worktree creation
> throw — so on a machine-wide install the hook must always exit 0 and always print a path, doing the
> plain `git worktree add` itself when ccwt is unreachable. And it **fires for subagent worktrees**
> (`isolation: "worktree"`) and background sessions, where `agent_id` is the discriminator: without
> that bound, a ten-way fan-out becomes ten provisions and ten dev servers.

**Important caveat:** installing a `WorktreeCreate` hook **disables `.worktreeinclude` processing**. ccwt must then do that copying itself — which it does anyway, so this is a merge of two mechanisms rather than a loss. Off by default; the UI must state this trade-off when enabling it.

**As built:** not built, and gated on §5.4, which is still a stub. Installing this hook takes
`.worktreeinclude` handling away with nothing replacing it, so §5.4 lands first. `docs/claude-hooks.md`
§11 carries the design.

### 5.4 `.worktreeinclude` compatibility — *always*

`.worktreeinclude` uses `.gitignore` syntax, and a file is copied only if it **matches a pattern *and* is gitignored** — so tracked files are never duplicated. Claude Code and worktrunk both read it.

**ccwt reads it as a config source.** A repo already set up for Claude Code works with zero ccwt configuration, and `provision.copy` in `ccwt.config.json` merges with it rather than replacing it.

### 5.5 Safety rules this imposes

- **Never remove a locked worktree.** Claude Code runs `git worktree lock` while an agent is working. Check the lock before any removal, and surface "an agent is working here" in the UI.
- **Never symlink into `.claude/`.** Claude Code refuses to create a worktree when `.claude`, `.claude/worktrees`, or the worktree directory itself is a symlink. This reinforces the no-symlink rule in §7.
- **Windows:** removing a worktree containing a directory symlink or NTFS junction deletes only the link. Another reason to copy or hardlink, never link.
- Claude Code's own sweep (`cleanupPeriodDays`) removes stale subagent worktrees. ccwt must tolerate a worktree disappearing underneath it and clean up its port and process without erroring.

### 5.6 Tell the session what is already running — *opt-in, one click to install*

A session working in a worktree does not know ccwt started its dev server, so it starts a second one
— on the wrong port, outliving the session, holding a port the allocator will not hand out again.
Nothing in §5.1–§5.5 answers that: the lock reports an agent to *us*, and says nothing back.

**ccwt ships a Claude Code plugin**, installed from `/settings` by pressing a button. It carries
three hooks and a read-only MCP server:

- `SessionStart` describes **the repository** — every worktree, its services, the port each holds,
  and whether that port answers. Not the current directory: ports live in each linked worktree's git
  config, so a session launched in the root checkout would otherwise learn nothing.
- `UserPromptSubmit` emits the difference when a service starts, stops or moves, against a
  per-session fingerprint that `SessionEnd` deletes.
- `PreToolUse` **denies** a command that would duplicate a service already listening, with a reason
  naming the URL to open. What counts as that command is derived from the recipe, never from a list
  of frameworks.
- Both hooks also **name the session after its worktree**, and rename it when that changes. A title
  typed by hand is never overwritten.
- `ccwt_status` and `ccwt_logs` let a session ask what is running and read what it printed. There is
  deliberately no start, stop or restart: the guard says ccwt owns lifecycle, and handing back a
  restart button would blur the same line.

**This is the direction §5.2 does not cover, and it does not reopen it.** §5.2 made ccwt's display
depend on sessions reporting in; this tells sessions what ccwt already knows, and a session asking
for status changes nothing about the dashboard.

**It writes into no repository.** The plugin installs through `claude plugin`, into Claude Code's own
storage — which is what makes it legal where §5.2 was not. ccwt copies the plugin into `~/.ccwt/plugin`
**when the button is pressed and never before**: no directory, no marketplace, no install until a
person asks, and a newer ccwt marks an installed plugin outdated and waits.

`docs/claude-hooks.md` is the full spec.

---

## 6. Configuration

> **As built:** the recipe lives in ccwt's own storage (`~/.ccwt/state.json`), **not** in the
> project. ccwt has no code path that writes a file into a repository. A committed
> `ccwt.config.json` is still *read* if a project chooses to ship one, but ccwt never creates it.
> The original decision below assumed a committed file; it was reversed once "never modify the
> user's project" became a hard constraint, since the sharing it bought is a team feature §2 puts
> out of scope, and detection reconstructs the recipe anyway.

The shape, wherever it is stored:

```jsonc
{
  "worktreesDir": "../.worktrees",
  "packageManager": "auto",

  "provision": {
    "dependencies": "auto",            // auto | install | hardlink | copy | none
    "copy": [".env", ".env.local"],    // merged with .worktreeinclude
    "postCreate": []
  },

  "services": [
    {
      "name": "web",
      "cwd": ".",
      "command": "pnpm dev --port {{port}}",
      "portRange": [5200, 5299]
    }
  ],

  "claude": {
    "ownWorktreeCreation": false       // install WorktreeCreate hook
  }
}
```

Variables in commands and generated env: `{{port}}`, `{{port.<service>}}`, `{{url.<service>}}`, `{{slug}}`, `{{branch}}`, `{{rootPath}}`, `{{worktreePath}}`.

Missing file → ccwt detects sensible values and offers to write it.

---

## 7. How dependencies get into a worktree

`git worktree add` checks out **tracked files only**, so `node_modules` and `.env` are absent. This is the whole reason the tool exists.

Benchmarked against a real Vite+Vue repo (38 MB `node_modules`, 703 files):

| Strategy | Time | New disk | Safe? |
|---|---|---|---|
| pnpm install per worktree | 679 ms | **0.18 MB** | ✅ |
| `cp -al` hardlink (npm/yarn) | **22 ms** | **0 MB** | ✅ |
| npm install per worktree | 1053 ms | 40 MB | ✅ |
| **symlink `node_modules`** | — | 0 MB | ❌ **corrupts the root project** |

The symlink result is the surprising one: a `pnpm install` inside the worktree pruned packages out of the *shared root* `node_modules` and broke the root checkout's build — while the root's own `package.json` and lockfile stayed unchanged, so nothing in git would explain it.

**`"dependencies": "auto"` resolves to:**

- **pnpm / bun** → just install. The global store already hardlinks: ~0.2 MB, under a second.
- **npm / yarn** → `cp -al` hardlink from root, then install to reconcile.
- **never symlink `node_modules`** — no time or disk saved, real corruption risk, and Claude Code refuses symlinked worktree paths anyway.

Build caches (`node_modules/.vite`, `.nuxt`, `.output`, `.turbo`, `dist`) are always per-worktree. Sharing them makes Vite re-optimize dependencies on every switch.

---

## 8. Ports

- Deterministic: hash worktree + service name into the configured range, then probe for a free port.
- Persisted with `git config --worktree ccwt.port.web` — git's own per-worktree config. Survives restarts, invisible to other worktrees, no sidecar database.
- Released on teardown. Manual pinning supported.

---

## 9. Security

The backend runs `git` and spawns processes, so a malicious web page reaching it would be remote code execution. Vite shipped CVE-2025-24010 for exactly this.

- Bind `127.0.0.1` only
- Validate the `Host` header on every request — this, not the loopback bind, is what stops DNS rebinding
- Random per-run token in the launch URL, exchanged for an HttpOnly cookie; the same token is kept at `~/.ccwt/token`, mode 600
- Validate `Origin` on WebSocket upgrades — WebSockets ignore CORS
- Always `shell: false` with argv arrays; all paths checked to be inside a registered project

---

## 10. Build order

**Milestone 1 — the loop works**
Register project → create worktree → provision → start dev server → logs → open URL → remove. One service, minimal config.

**Milestone 2 — Claude Code aware**
Discover and adopt Claude-created worktrees (§5.1). Read `.worktreeinclude` (§5.4). Respect worktree locks (§5.5).

**Milestone 3 — configurable**
Full `ccwt.config.json` with validation, auto-detection, multiple services, recipe editor.

**Milestone 4 — polish**
Port map view, git status per worktree, `.env` diff, drift detection and repair.

**Milestone 5 — optional**
`WorktreeCreate` ownership (§5.3).

---

## 11. Decisions still open

| # | Question | Leaning |
|---|---|---|
| D1 | Do dev servers keep running after you close ccwt? | No — simpler; revisit if annoying |
| D2 | Where do ccwt-created worktrees live? | `../.worktrees/<name>`, but adopt `.claude/worktrees/*` as first-class |
| D3 | Auto-start services when a worktree is created? | Off by default, checkbox in the create dialog |
| ~~D4~~ | ~~How does "launch Claude Code" open?~~ | **Moot** — launching was dropped, see §5.2 |

---

**Sources:** [Claude Code worktrees](https://code.claude.com/docs/en/worktrees) · [Claude Code hooks](https://code.claude.com/docs/en/hooks) · [pnpm on git worktrees](https://pnpm.io/git-worktrees) · [git worktree](https://git-scm.com/docs/git-worktree) · [Nitro WebSocket](https://nitro.build/docs/websocket) · [Vite CVE-2025-24010](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6)
