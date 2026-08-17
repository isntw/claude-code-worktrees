# Telling a Claude Code session what is already running

Spec for an opt-in, machine-wide Claude Code hook install, driven from the dashboard. Not built.
Amends `SPEC.md` §5, which currently reads as though this whole area was decided against — it was
not, and §3 below is the part that matters.

Motivating case: you create a worktree, start its dev server from ccwt, then open a Claude Code
session in that worktree. The session knows none of it and starts a second dev server to check its
own work.

---

## 1. What is wrong today

A snapshot of this machine, taken while writing this document. Three `nuxt dev` processes, every one
of them orphaned — all three parent pids were already dead:

| pid | port | where | age |
|---|---|---|---|
| 20849 | 5266 | `.claude/worktrees/link-never-copies` | 13 min — ccwt's allocated port |
| 77113 | **5600** | the root checkout, `nuxt dev` with no `--port` | 3 h 53 min |
| 66057 | 5275 | `.worktrees/ccwt-drop-session-status` — **directory no longer exists** | **2 d 7 h** |

The middle row is the reported symptom: a plain `npm run dev`, which for this project binds 5600 and
is therefore outside the 5200–5299 range ccwt allocates from, where ccwt cannot see it at all. The
bottom row is the part nobody reports: these servers outlive the session, the worktree and ccwt
itself. `supervisor.ts` holds `entries` in memory only, so a server ccwt did not spawn — or spawned
before a restart — is invisible to it while still holding a port `ports.isFree()` will refuse to
hand out.

So the cost is not only the wasted minute of a duplicate server. It is ports leaking out of the
allocator, one worktree at a time.

Nothing about this is Claude's fault. The session has no way to know. `git worktree list` reports
that an agent is present (§5.5) but says nothing in the other direction, and no file in the worktree
mentions the port.

---

## 2. Scope

### In scope

- A **machine-wide** hook install, one click, from the dashboard — never per project
- `SessionStart`: tell the session which services this worktree has, on which ports, and which are up
- `PreToolUse` on `Bash`: **deny** a command that would duplicate a service ccwt already manages,
  with a reason naming the port and URL
- Report install state honestly — installed, stale, or pointing at a path that no longer exists
- Merge into `~/.claude/settings.json` without disturbing hooks ccwt did not write
- Record ccwt's own host and port so a session can reach the logs API

### Out of scope

- **`WorktreeCreate` / `WorktreeRemove`** (§5.3). Same panel eventually, different feature: those
  replace Claude Code's git logic, carry the `.worktreeinclude` trade-off, and need their own
  confirmation. The panel is built to hold more than one hook so they land beside these two.
- **An MCP server.** Tools for `status` / `logs` / `restart` would let a session read compile output
  and restart a service. It needs ccwt running, costs schema context in every session, and is not
  needed for the problem above. §7 gets most of the value for none of the cost.
- **Reporting session state back to ccwt.** That is §5.2, and it stays dropped — see §3.
- **Starting the session.** ccwt is not an agent runner (§5.2). Unchanged.

---

## 3. Why this is not the feature §5.2 dropped

§5.2 dropped session tracking, and the reason bears repeating exactly:

> It is the one feature that requires ccwt to **write into a repository it did not create**, which §6
> otherwise forbids outright.

That plan wrote hooks into **the project's `.claude/settings.json`** — a file inside a registered
repository. The rule in `CLAUDE.md` is absolute about this, and it should stay absolute.

This feature writes to **`~/.claude/settings.json`**: the user's own Claude Code configuration, in
their home directory, beside `~/.ccwt/` where ccwt already keeps its state and token. That is not a
repository, registered or otherwise. **No code path added by this feature writes into any repo**, and
the existing rule needs no exception.

Machine-wide is therefore not a convenience — it is the thing that makes this legal where its
predecessor was not. It also happens to be better: one install covers every project ccwt knows and
every project it does not, because the hook resolves everything from `cwd` at run time and prints
nothing when `cwd` is not a ccwt worktree.

The two features also point in opposite directions, which is easy to miss:

| | direction | answered by |
|---|---|---|
| §5.2, dropped | Claude → ccwt: *an agent is working here* | the worktree lock, for free |
| this | ccwt → Claude: *this is already running* | nothing at all |

The lock does not answer this one. Nothing does.

---

## 4. What gets installed

Two entries in `~/.claude/settings.json`, each independently installable and removable:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node /abs/path/bin/ccwt.mjs hook session-start" }] }
    ],
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node /abs/path/bin/ccwt.mjs hook guard" }] }
    ]
  }
}
```

**The path is absolute and resolved at install time**, from the running server's own location. `ccwt`
is not assumed to be on `PATH` — it frequently is not, since the common case is `npm start` from a
checkout.

That absolute path is also the one thing that can rot: move or delete the checkout and every Claude
session on the machine runs a command that is not there. The panel must therefore check that the
recorded path still exists and offer to repoint it (§8), and the installed command must be a
subcommand of `bin/ccwt.mjs` itself, which has **zero dependencies on purpose** and must not need
`.output/` to answer.

### Merging

`~/.claude/settings.json` belongs to the user, and on this machine it already carries an unrelated
`PreToolUse` / `Bash` hook (`~/.claude/hooks/rtk-rewrite.sh`). So:

- Parse, splice, write — never generate the file from scratch
- **If it does not parse, refuse and say so.** Do not clobber a file we cannot read
- Write atomically, and preserve every key and every foreign hook untouched
- Ours are identified by the command matching `ccwt.mjs hook <name>`, so a human reading the file can
  see what it is and delete it by hand

`JSON.stringify(…, null, 2)` reformats the file. That is a real cost and the panel says so before
the first write.

---

## 5. How a hook finds the worktree

Entirely offline. No server, no token, no network — prototyped and confirmed against a real worktree
while ccwt was **not** running:

```
worktree  git rev-parse --show-toplevel
root      git worktree list --porcelain          first entry is the main worktree
project   ~/.ccwt/state.json, matched on rootPath   -> service names, commands, cwd
port      git config --worktree --get ccwt.port.<service>
liveness  TCP connect, 127.0.0.1 and ::1
```

This works because `ports.ts:108` already persists every allocation into the worktree's own git
config. It is durable, per-worktree, and survives ccwt being closed.

Two rules from `CLAUDE.md` get re-implemented in `bin/` and both have been gotten wrong before:

- the config key is lowercased with non-alphanumerics collapsed to dashes, because **a git config key
  may not contain an underscore**
- the probe tries **both address families**, because Vite binds `localhost`, which on macOS is `::1`

That duplication is the honest cost of a hook that must answer without the server. §7 shrinks it.

**Liveness comes from the probe, never from "is ccwt running".** The evidence in §1 is exactly why:
every process there outlived its parent.

### When nothing matches

Not a repo, not a registered project, no recipe, no allocated port, unreadable `state.json`,
`~/.ccwt` absent — every one of these exits 0 and prints nothing. A hook that fails loudly outside
ccwt's world would be a machine-wide hook that breaks every unrelated Claude session, so
**discovery must never throw** applies here with more force than anywhere else in the codebase.

---

## 6. The guard, and how it stays command-agnostic

`PreToolUse` receives `tool_input.command` and `cwd`, and returns:

```json
{ "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "`dev` is already running for this worktree on http://localhost:5266 (pid 20849). ccwt owns this service — open the URL, or stop it from the dashboard." } }
```

`permissionDecisionReason` goes back to the model, so the denial teaches rather than just blocks.

**What it must not do is know what a dev server is.** `CLAUDE.md` forbids teaching ccwt about any
particular stack, and a hardcoded list of `npm run dev` / `pnpm dev` / `rails s` is exactly the
convenience that does the wrong thing for every project it was not written for.

So the match is derived from the recipe. `services[].command` for the project owning this worktree is
the only source: strip the `{{port}}` template, reduce to argv, and compare shape against the
proposed command. This project's guard blocks `npm run dev`; `charactersheet`'s blocks
`docker compose -f compose.ccwt.yml … up`; a Django project's blocks whatever its recipe says.
Nothing in ccwt learns a framework.

Denying is deliberate and was chosen over escalating. It is also the reason both hooks are separately
removable, and why the panel states plainly that a command will be refused.

**Deny, never `updatedInput`.** Rewriting the command would fight the rtk hook already installed on
this machine, which returns `updatedInput` of its own. Two hooks rewriting one string is a race worth
never entering.

Bounds on the guard, so it stays narrow:

- Only when `cwd` resolves to a ccwt worktree with a recipe
- Only against services that project declares
- Only when the service is **actually listening** — a stopped service is not a reason to block
- Never anything else. It is not a general command filter and must not grow into one.

---

## 7. `~/.ccwt/server.json`

`bin/ccwt.mjs:13` takes `--port` and defaults to 4600, and **writes it down nowhere**. Only the token
is persisted. So nothing outside the process can find the API.

Fix it where the token is already written, same mode 600:

```json
{ "host": "127.0.0.1", "port": 4600, "pid": 12345, "startedAt": "2026-08-17T…" }
```

Small on its own, and it buys the thing worth more than any denial: the session can read the running
server's output instead of starting its own to get some.

`logs.get.ts:7` already returns `supervisor.scrollbackFor(worktreeId)` as plain JSON, `x-ccwt-token`
is already accepted as a header (`security.ts:37`), and `worktreeId` is `sha256(path).slice(0,12)`
(`git.ts:24`) — computable offline. So `SessionStart` can hand the session a curl it can actually
run:

```bash
curl -s -H "x-ccwt-token: $(cat ~/.ccwt/token)" \
  http://127.0.0.1:4600/api/projects/<id>/worktrees/<worktreeId>/logs
```

Offered only when something answers on the recorded port — a stale `server.json` must degrade to
silence, not to a broken instruction.

It also opens the better long-term shape: the supervisor writing live service state to disk on each
status change, which would collapse §5's git-config walk and its two duplicated rules into one file
read. Worth doing later; not required here.

---

## 8. The panel

`/settings` — the machine-wide page, beside GitHub. Both are "things ccwt does to this machine on
your behalf", which is the same reason `ForgePanel` lives there.

The nav blurb currently reads *"The accounts and hosts ccwt talks to on your behalf."* That no longer
covers the page and needs widening in `app/nav.ts`.

States the panel must distinguish:

| state | what it means | look |
|---|---|---|
| unavailable | no `~/.claude` — Claude Code is not installed for this user | plain, no install button |
| absent | available, nothing installed | offer install |
| installed | present, path resolves | `--ccwt-live` — the machine confirmed it is usable |
| stale | installed at an older revision | offer update |
| broken | installed, but the recorded path is gone | `--ccwt-alarm`, offer repair |
| unreadable | `settings.json` does not parse | say so; **no button that writes** |

`--ccwt-live` is right for *installed* on the existing rule — a satisfied host requirement is
already what that hue is for, and a hook whose path resolves is the same kind of claim. Everything
else is achromatic or one of the two warm hues.

The panel shows **the exact command it will write, before it writes it**, in mono — the same standard
the removal confirmation is held to. What it states: which file is edited, that the file is
reformatted, that a denied command is a command that will not run, and that both hooks are removable
from here.

Per-hook `Toggle`, one row each, with the blurb saying what that hook does in one sentence.

---

## 9. Inventory

| file | change |
|---|---|
| `shared/types.ts` | `HookState`, `HookEntry`, `HookReport` |
| `bin/hook.mjs` | new — discovery + both handlers, zero dependencies |
| `bin/ccwt.mjs` | `hook <name>` subcommand dispatched before any server work; write `server.json` |
| `server/lib/hooks.ts` | read / install / remove against `~/.claude/settings.json`; no Nuxt, no H3 |
| `server/api/hooks.get.ts` | `HookReport` |
| `server/api/hooks.post.ts` | install named hooks, returns `HookReport` |
| `server/api/hooks.delete.ts` | remove named hooks, returns `HookReport` |
| `app/composables/useApi.ts` | `getHooks` / `installHooks` / `removeHooks` |
| `app/components/HooksPanel.vue` | new |
| `app/pages/settings.vue` | mount it |
| `app/nav.ts` | widen the settings blurb |
| `SPEC.md` | §5.6 |
| `MILESTONES.md` | entry |

Diagnostic codes, namespaced `thing.problem` and stable: `hooks.no-claude`, `hooks.unreadable`,
`hooks.broken-path`, `hooks.stale`.

`HOOK_REVISION` stamps what was installed, so a later change to the emitted context can raise *stale*
rather than silently leaving an old command in place. Bump it only when the installed **command** or
its contract changes — not when the wording of the injected context changes.

---

## 10. What must never happen

- **A write into a registered repository.** The whole feature is arranged around this (§3).
- **A hook that throws outside ccwt's world.** It runs in every Claude session on the machine,
  including sessions in repositories ccwt has never heard of.
- **A slow hook.** `PreToolUse` fires on every `Bash` call. Cheapest checks first, and no work at all
  once `cwd` fails to resolve to a ccwt worktree.
- **Clobbering `settings.json`.** Refuse on a parse failure; never rewrite from scratch; never touch
  a hook ccwt did not write.
- **A guard that grows.** It blocks duplicates of declared services and nothing else, forever.
- **Teaching ccwt a stack.** The recipe is the only source of what a service command looks like.

---

## 11. Verifying it

```bash
npm run typecheck && npm run build

echo '{"cwd":"'"$PWD"'","hook_event_name":"SessionStart","source":"startup"}' \
  | node bin/ccwt.mjs hook session-start

echo '{"cwd":"'"$PWD"'","tool_name":"Bash","tool_input":{"command":"npm run dev"}}' \
  | node bin/ccwt.mjs hook guard
```

Run the second from a worktree whose service is up, then from one where it is stopped: the first
denies, the second prints nothing and exits 0. Run both from `/tmp` and from an unregistered
repository — both must print nothing and exit 0.

Then install from the panel with the rtk hook already present in `~/.claude/settings.json`, and
confirm it is still there, unchanged, afterwards.
