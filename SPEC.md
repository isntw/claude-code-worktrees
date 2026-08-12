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
| 7 | **Show Claude Code session status per worktree** — running, waiting for input, finished |
| 8 | **Launch a Claude Code session in a worktree** from the dashboard |
| 9 | A dashboard listing every worktree, its status, port, URL and agent state |
| 10 | Work with any project — the recipe is data, not hardcoded |

### Out of scope

- Not a git client — no staging, committing, merging, conflict resolution
- Not a task board — no prompts, no diff review, no PR creation *(that's Conductor / vibe-kanban territory; explicitly not this product)*
- No CI, no deployment, no team features
- Single machine, single user, localhost only

### Later

- Reverse proxy so each worktree gets `feature-x.myapp.localhost` instead of a port
- Per-worktree databases · Docker Compose support · Electron wrapper

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
│   │   ├── AgentBadge.vue
│   │   └── CreateWorktreeModal.vue
│   └── composables/useApi.ts    # all backend calls go through here
└── server/                  # ── BACKEND (Nitro / Node) ──
    ├── lib/                     # pure logic, no framework imports
    │   ├── git.ts               worktree add/list/remove, locks
    │   ├── detect.ts            package manager + dev script
    │   ├── provision.ts         copy / hardlink / install
    │   ├── ports.ts             allocate + persist
    │   ├── supervisor.ts        spawn / logs / kill
    │   ├── claude.ts            hooks, session tracking, .worktreeinclude
    │   └── store.ts             ~/.ccwt/state.json
    ├── api/                     # thin HTTP wrappers around lib/
    ├── api/hook.post.ts         # endpoint Claude Code hooks call back into
    ├── middleware/security.ts   # Host validation, token exchange
    └── routes/_ws.ts            # WebSocket: logs + status
```

Two rules keep it clean:

1. **`server/lib/` never imports Nuxt or H3** — pure functions, testable without booting the app.
2. **The frontend only talks to the backend through `useApi.ts`** — one file to change if you ever wrap it in Electron.

---

## 5. Claude Code integration

Claude Code creates its own worktrees. If we ignore that, you end up with two parallel sets of worktrees that don't know about each other. Three integration points fix it.

### 5.1 Discover and adopt — *default, always on*

Claude Code creates worktrees at `.claude/worktrees/<name>/` on a branch `worktree-<name>`, and subagents with `isolation: worktree` get their own too. All of them show up in `git worktree list --porcelain`.

**The dashboard lists every worktree of the repo, whoever made it**, tagged by origin (`manual` / `ccwt` / `claude`). An adopted worktree can be given a port and a dev server with one click, without ccwt having created it. This is cheap, safe and requires no configuration.

### 5.2 Session status — *opt-in, one click to install*

ccwt writes hooks into the project's `.claude/settings.json` that POST to its own localhost API:

| Hook | Matcher | Meaning on the card |
|---|---|---|
| `SessionStart` | `startup`, `resume` | agent **running** |
| `Notification` | `agent_needs_input` | agent **waiting for you** |
| `Notification` | `agent_completed` | agent **done** |
| `SubagentStart` / `SubagentStop` | `*` | subagent count |
| `SessionEnd` | `*` | agent **idle** |

Each hook receives `session_id` and `cwd` on stdin; ccwt maps `cwd` → worktree and updates the card live over the WebSocket. The hook script reads the auth token from `~/.ccwt/token` so it can reach the API.

This is the feature that makes the dashboard worth leaving open: at a glance, which worktrees have an agent working, which are blocked on you, which are done.

### 5.3 Own worktree creation — *opt-in, advanced*

A `WorktreeCreate` hook replaces Claude Code's git logic entirely, so `claude --worktree` routes through ccwt: our path convention, our provisioning, our port allocation. The hook receives `worktree_path`, `worktree_reason` and `how_triggered` on stdin, and **prints the final path on stdout**; exit 0 means success. A paired `WorktreeRemove` hook tears down ports and processes (its exit code is ignored — removal proceeds regardless, so cleanup must be best-effort and never block).

**Important caveat:** installing a `WorktreeCreate` hook **disables `.worktreeinclude` processing**. ccwt must then do that copying itself — which it does anyway, so this is a merge of two mechanisms rather than a loss. Off by default; the UI must state this trade-off when enabling it.

### 5.4 `.worktreeinclude` compatibility — *always*

`.worktreeinclude` uses `.gitignore` syntax, and a file is copied only if it **matches a pattern *and* is gitignored** — so tracked files are never duplicated. Claude Code and worktrunk both read it.

**ccwt reads it as a config source.** A repo already set up for Claude Code works with zero ccwt configuration, and `provision.copy` in `ccwt.config.json` merges with it rather than replacing it.

### 5.5 Safety rules this imposes

- **Never remove a locked worktree.** Claude Code runs `git worktree lock` while an agent is working. Check the lock before any removal, and surface "an agent is working here" in the UI.
- **Never symlink into `.claude/`.** Claude Code refuses to create a worktree when `.claude`, `.claude/worktrees`, or the worktree directory itself is a symlink. This reinforces the no-symlink rule in §7.
- **Windows:** removing a worktree containing a directory symlink or NTFS junction deletes only the link. Another reason to copy or hardlink, never link.
- Claude Code's own sweep (`cleanupPeriodDays`) removes stale subagent worktrees. ccwt must tolerate a worktree disappearing underneath it and clean up its port and process without erroring.

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
    "trackSessions": true,             // install SessionStart/Notification hooks
    "ownWorktreeCreation": false,      // install WorktreeCreate hook
    "launchCommand": "claude"
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
- Random per-run token in the launch URL, exchanged for an HttpOnly cookie; same token in `~/.ccwt/token` for hook callbacks
- Validate `Origin` on WebSocket upgrades — WebSockets ignore CORS
- Always `shell: false` with argv arrays; all paths checked to be inside a registered project

---

## 10. Build order

**Milestone 1 — the loop works**
Register project → create worktree → provision → start dev server → logs → open URL → remove. One service, minimal config.

**Milestone 2 — Claude Code aware**
Discover and adopt Claude-created worktrees (§5.1). Read `.worktreeinclude` (§5.4). Respect worktree locks (§5.5). Launch a session from the dashboard.

**Milestone 3 — configurable**
Full `ccwt.config.json` with validation, auto-detection, multiple services, recipe editor.

**Milestone 4 — polish**
Session status hooks (§5.2), port map view, git status per worktree, `.env` diff, drift detection and repair.

**Milestone 5 — optional**
`WorktreeCreate` ownership (§5.3).

---

## 11. Decisions still open

| # | Question | Leaning |
|---|---|---|
| D1 | Do dev servers keep running after you close ccwt? | No — simpler; revisit if annoying |
| D2 | Where do ccwt-created worktrees live? | `../.worktrees/<name>`, but adopt `.claude/worktrees/*` as first-class |
| D3 | Auto-start services when a worktree is created? | Off by default, checkbox in the create dialog |
| D4 | How does "launch Claude Code" open? | Spawn in the user's terminal app vs an embedded terminal in the dashboard |

---

**Sources:** [Claude Code worktrees](https://code.claude.com/docs/en/worktrees) · [Claude Code hooks](https://code.claude.com/docs/en/hooks) · [pnpm on git worktrees](https://pnpm.io/git-worktrees) · [git worktree](https://git-scm.com/docs/git-worktree) · [Nitro WebSocket](https://nitro.build/docs/websocket) · [Vite CVE-2025-24010](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6)
