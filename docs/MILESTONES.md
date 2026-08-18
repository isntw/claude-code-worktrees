# Milestones and progress

Where `ccwt` is against `SPEC.md` §10, and what was added along the way that the spec did not
anticipate. Everything marked **done** was verified by running it, not by reading the code — the
verification is named in each case.

Last updated 2026-08-15.

| Milestone | State |
|---|---|
| 1 — the loop works | ✅ **done** |
| 2 — Claude Code aware | 🟡 **most** — discovery and locks done, session launch **dropped**, `.worktreeinclude` stubbed |
| 3 — configurable | ✅ **done**, and beyond the spec |
| 4 — polish | 🟡 **part** — port map done, session status **dropped**, the rest untouched |
| 5 — `WorktreeCreate` ownership | ⬜ **not started** (spec marks it optional) |
| — | File browser, zero-touch setup and after-start commands were added outside the plan |

---

## Milestone 1 — the loop works ✅

Register → create → provision → serve → logs → open → remove.

- `git worktree add/list/remove` over `--porcelain`, lock detection, per-worktree git config
- package manager and dev-script detection
- provisioning: copy, hardlink, install, `postCreate`
- deterministic port allocation, persisted in `git config --worktree`
- supervisor: spawn detached, capture logs, kill the process group, TCP reachability probe
- live dashboard over WebSocket

**Verified** against a scratch repo: `.env` copied (it is gitignored, so its presence proves the
copy ran), port persisted and reused across a restart, dev server serving, process group reaped on
stop and on quit with no strays, branch kept after removal.

## Milestone 2 — Claude Code aware 🟡

| Item | State |
|---|---|
| §5.1 discover and adopt Claude-created worktrees | ✅ done |
| §5.5 respect `git worktree lock` | ✅ done |
| launch a Claude Code session from the dashboard | ❌ **dropped** — see Milestone 4 |
| §5.4 read `.worktreeinclude` | ⬜ **stub** — `provision.readWorktreeInclude` |

Discovery came free: `git worktree list --porcelain` returns every worktree whoever made it, so
Claude Code's `.claude/worktrees/*` appear tagged `claude` and can be started on demand. There is no
separate adopt step and no adopt endpoint.

**Verified**: a real `git worktree lock` is refused with git's own reason, and the card disables the
control.

The lock carries more weight than it looks. Claude Code locks a worktree while an agent works, so the
lock **is** the agent signal now that §5.2 is gone — `An agent is working here` on the card comes from
`lockState === 'live'`, costs nothing and needs no configuration.

**The gap that shows**: `.worktreeinclude` (§5.4) is the only thing left owed here. The *launch a
session* button is gone — see Milestone 4.

## Milestone 3 — configurable ✅

Delivered past what the spec asked for.

- **zod schema** shared by loader, write endpoint and editor; strict objects, so `"service"` for
  `"services"` is an error naming the key rather than a silently ignored block
- **recipe editor** at `/project/:id/config` — form ⇄ JSON, line-diff before saving, `detect` button
- **multi-service detection** — parses `concurrently` / `npm-run-all`, walks pnpm and npm workspaces
- **`dependsOn`** with reachability-based ordering; cycles and unknown names refused at validation
- **`postRemove`** teardown that can never block a removal
- **copy and link** as separate lists, because a hardlink is the same inode

**Reversed from the spec**: §6 called for a committed `ccwt.config.json`. Recipes live in
`~/.ccwt/state.json` instead and ccwt has **no code path that writes into a repository**. A
committed file is still read if a project ships one. The sharing that a committed file bought is a
team feature §2 puts out of scope, and detection reconstructs the recipe anyway.

**Verified**: detection produced `claude-code-manager`'s two services from its `concurrently` script
exactly, so the hand-written config could be deleted; a dependency taking four seconds to listen
delayed its dependent by exactly that.

## Milestone 4 — polish 🟡

| Item | State |
|---|---|
| §5.2 session-status hooks | ❌ **dropped** — out of the code and out of the spec |
| port map view | ✅ done — `/overview` |
| git status per worktree | ⬜ nothing |
| `.env` diff | ⬜ nothing |
| drift detection and repair | ⬜ nothing |

**The port map** is `/overview`: every registered project read at once, totals, a filterable worktree
table, every claim on every port, per-project tiles and every diagnostic discovery produced. A row or
a port claim drills into that worktree.

**Session status was dropped, not deferred.** It had been the spec's centrepiece and it never worked —
`AgentBadge` rendered on every card and always read "no agent", because `agent` was a hardcoded `IDLE`
constant behind five stubs. Two things settled it. Installing the hooks means **writing into a
repository ccwt did not create**, which is the one thing the recipe design refuses to do anywhere
else. And **the worktree lock already answers the question**: Claude Code locks while an agent works,
so `git worktree list --porcelain` reports an agent's presence with no hook, no config and no write —
coarser (present or absent, not working-vs-waiting-vs-done), and already shipped.

Removed with it: `AgentBadge`, the agent filter tab on `/overview` and `/project/:id`, the `agents`
total, `WorktreeTable`'s Agent column, `AgentState` / `AgentStatus` / `HookEvent` / `HookPayload`, the
`agent` WebSocket message, `POST /api/hook`, and the `claude.trackSessions` recipe flag.

**Launching a session went with it** (Milestone 2, §2 capability 8). The button spawned nothing — it
returned 501 — and what it was worth turned on a question the spec never answered: D4, spawn in your
terminal app or embed a terminal in the dashboard. Neither answer buys much. Starting an agent in a
directory is one command in a terminal you already have open, and `claude --worktree` makes its own
worktree without ccwt in the loop at all. Gone: `launchSession`, `POST …/agent/launch`,
`useApi.launchAgent`, the card's button and `launch` emit, and the `claude.launchCommand` recipe
field. `server/lib/claude.ts` is gone entirely: all that survived it was `CLAUDE_WORKTREE_DIR`, and
that path now lives beside its only reader, `classify()` in `git.ts`.

**What this settles: ccwt is not an agent runner.** It provisions worktrees, allocates ports, runs
services and shows what is live. Whether an agent is in one is git's business, through the lock.
Starting one is your terminal's.

**One shim was needed.** `claude` in the recipe schema is a `strictObject`, and detection used to emit
both `trackSessions` and `launchCommand`, so every recipe already stored in `~/.ccwt/state.json`
carries them — deleting the fields alone would turn a valid stored recipe into a hard validation error
naming the key. `RETIRED_CLAUDE_KEYS` in `config-schema.ts` strips both before the strict parse, so an
old recipe loads and sheds them on its next save. Unknown keys still error, which is what the
strictness is for. `ClaudeConfig` is down to one field, `ownWorktreeCreation`, which Milestone 5 owns.

**Verified**: `typecheck` and `build` both clean, and the typecheck was confirmed to be live by
planting a type error and watching it exit non-zero.

## Milestone 5 — `WorktreeCreate` ownership ⬜

Not started. The spec marks it optional and notes the trade-off: installing the hook disables
`.worktreeinclude` processing.

---

## Added outside the plan

### After-start commands ✅

`postStart` on a service runs commands once its port answers, in the worktree, with the same
environment the service was spawned with. A failing command is retried for two minutes, because a
port answering does not mean everything behind it is ready; the first attempt streams, retries run
quiet, and the settling attempt prints its own output. `waitReachable` waits for them, so `dependsOn`
means reachable *and* prepared.

**Verified**: a service whose after-start command queried the service itself over HTTP and got 200;
a failing command reported its exit code, skipped the commands after it, and left the service
running.

### Ports reach a worktree as environment ✅

Every service is spawned with its own port and every other service's `CCWT_PORT_*` / `CCWT_URL_*`,
and ccwt writes the same values into a marker-delimited block in `.env.local`, which Vite, Next and
Nuxt all load. Where a project hardcodes an inter-service address, `inspect.ts` finds it and the **Setup** panel explains
in plain language what ccwt will do and what the optional change would be.

### Browse for a project ✅

`GET /api/fs/list` lists directories only, marks git repositories and already-registered ones, and
carries its own loopback-only gate on top of the Host check and token, because it is deliberately
outside §9's containment rule. `POST /api/projects/probe` validates a typed path as you type.

### Recipe staleness ✅

`RECIPE_REVISION` stamps a stored recipe. One saved under an older revision raises
`project.recipe-stale` telling you to press detect. It is **not** migrated — the stored recipe is
the user's, and guessing at intent is worse than saying so.

---

## Known gaps, ranked

1. **No tests.** Zero. Every bug found so far was found by running the thing. For an open-source
   project this is the gap most likely to bite.
2. **Detection is Node-shaped.** A Django, Rails or Laravel project registers, provisions and
   removes fine, but detects no service. Agreed and unbuilt: replace the filename list in
   `inspect.ts` with a search over git-tracked files, infer a container's role from its port rather
   than its image name, add an ask-once fallback, and mark detected services with their provenance.
3. **`.worktreeinclude`** (§5.4) — `provision.copy` must *merge* with it, not replace it. It is now
   the only stub left in the codebase.
4. **Milestone 4's remaining items** — per-worktree git status, `.env` diff, drift repair.

## Verifying a claim in this document

```bash
npm run typecheck && npm run build
npm start                       # or: node bin/ccwt.mjs --no-open --port 4600
grep -rn "stub('" server/lib    # everything still unimplemented, with its milestone
```
