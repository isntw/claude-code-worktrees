# Telling a Claude Code session what is already running

Spec for an opt-in Claude Code integration, installed from the dashboard, that tells a session which
services ccwt runs for the repository it is working in, stops it starting a second copy of one, and
names the session after its worktree. Not built.

Amends `SPEC.md` §5, which reads as though this whole area was decided against. It was not: §3 is the
distinction, and §11 corrects §5.3, whose stdin contract does not match what Claude Code sends.

Motivating case: you create a worktree, ccwt starts its dev server, you open a Claude Code session,
and the session starts a second dev server to check its own work.

> Facts marked **(2.1.234)** were read out of the shipped Claude Code binary rather than the
> documentation, which is thinner than the behaviour. They are version-specific and worth
> re-checking when that version moves.

---

## 1. What is wrong today

A snapshot of this machine, taken while writing this document. Three `nuxt dev` processes, every one
orphaned — all three parent pids already dead:

| pid | port | where | age |
|---|---|---|---|
| 20849 | 5266 | `.claude/worktrees/link-never-copies` | 13 min — ccwt's allocated port |
| 77113 | **5600** | the root checkout, `nuxt dev` with no `--port` | 3 h 53 min |
| 66057 | 5275 | `.worktrees/ccwt-drop-session-status` — **directory no longer exists** | **2 d 7 h** |

The middle row is the reported symptom: a plain `npm run dev`, which for this project binds 5600 and
is therefore outside the 5200–5299 range ccwt allocates from, where ccwt cannot see it at all.

The bottom row is the part nobody reports. These servers outlive the session, the worktree and ccwt
itself. `supervisor.ts` holds `entries` in memory only, so a server ccwt did not spawn — or spawned
before a restart — is invisible to it while still holding a port `ports.isFree()` will refuse to hand
out. The cost is not one wasted minute of duplicate server. It is ports leaking out of the allocator,
one worktree at a time.

None of this is the session's fault. It has no way to know. `git worktree list` reports that an agent
is present (§5.5) but says nothing in the other direction, and no file inside the worktree mentions
the port.

---

## 2. Scope

### In scope

- A **plugin**, installed and removed from the dashboard, covering every project on the machine
- Tell the session what the **repository** runs — worktrees, services, ports, liveness
- Keep that picture fresh as services start, stop and move
- **Deny** a command that would duplicate a service already listening
- **Name the session** after the worktree it is working in, and rename it when that changes
- Let the session **ask** ccwt for status and logs — read-only, never lifecycle
- Record ccwt's own host and port, so the API is reachable at all
- **Tests** — the first in this repo

### Out of scope

Each of these was considered and rejected for a stated reason; §16 records them so they are not
re-proposed by accident.

- Worktree creation through ccwt (§11) — written up, but blocked behind §5.4 and off until then
- Anything that lets a session start, stop or restart a service
- A skill
- Reclaiming orphaned ports
- Reading session activity out of Claude Code's transcripts
- Reporting session state back to ccwt — that is §5.2, and it stays dropped (§3)
- Starting the session. ccwt is not an agent runner (§5.2). Unchanged

---

## 3. Why this is not the feature §5.2 dropped

§5.2 dropped session tracking, and the reason bears repeating exactly:

> It is the one feature that requires ccwt to **write into a repository it did not create**, which §6
> otherwise forbids outright.

That plan wrote hooks into **the project's `.claude/settings.json`** — a file inside a registered
repository. The rule in `CLAUDE.md` is absolute, and it stays absolute.

This feature ships a **plugin**, installed through Claude Code's own CLI (§4). It writes into no
repository, and because the plugin carries its own hook scripts it does not edit any configuration
file either. The rule needs no exception.

Machine-wide is therefore not a convenience. It is what makes this legal where its predecessor was
not, and it is also better: one install covers every project ccwt knows and every project it does
not, because a hook resolves everything at run time and prints nothing where ccwt has no answer.

### The direction that was dropped, and the one that was not

| | direction | answered by |
|---|---|---|
| §5.2, dropped | ccwt **depends on** Claude reporting state — a badge lit by a hook POSTing | the worktree lock, coarsely, for free |
| §5–§8 | ccwt → Claude: *this is already running* | nothing at all |
| §9 | Claude → ccwt: *what is running, and what did it print* | ccwt's existing API |

§9 looks like the dropped direction and is not. §5.2 made ccwt's own display depend on sessions
reporting in. §9 is a session asking ccwt for something it already publishes: ccwt depends on
nothing, and if no session ever calls, nothing about the dashboard changes. The dashboard stays the
truth; MCP hands a session the same read-only view of it.

---

## 4. Shape: a plugin, not a configuration edit

Claude Code has a complete non-interactive plugin CLI, so the dashboard button spawns a process —
which is what ccwt does for a living — instead of performing surgery on a file it does not own:

```bash
claude plugin marketplace add ~/.ccwt/plugin
claude plugin install ccwt@ccwt --scope user -y
claude plugin list --json          # id, version, scope, enabled, installPath, installedAt
claude plugin uninstall ccwt@ccwt
claude plugin enable|disable ccwt@ccwt
```

`-y` is **required when stdout is not a TTY**, which is exactly ccwt spawning it. `list --json` is
the panel's state, so nothing is inferred by parsing anyone's settings.

### Layout

Both manifests validate with `claude plugin validate`:

```
plugin/
  .claude-plugin/plugin.json     name, version, description, mcpServers
  hooks/hooks.json               SessionStart · UserPromptSubmit · PreToolUse
  hooks/ccwt.mjs                 one zero-dependency entry point, dispatched by argv
  mcp/server.mjs                 zero-dependency JSON-RPC over stdio
.claude-plugin/marketplace.json  name "ccwt"; plugins:[{ name:"ccwt", source:"./plugin" }]
```

`hooks.json` refers to the script as `node "${CLAUDE_PLUGIN_ROOT}/hooks/ccwt.mjs" <mode>`.
**`${CLAUDE_PLUGIN_ROOT}` is why there is no path to rot**: install copies the plugin into
`~/.claude/plugins/cache/ccwt/ccwt/<version>/` and the variable resolves there, so nothing points at
ccwt's checkout and moving or reinstalling ccwt breaks nothing.

### Where the marketplace lives

**`~/.ccwt/plugin/`.** ccwt writes the plugin into its own directory and registers that path,
because ccwt's install directory is only as stable as how ccwt was installed — an `npx` run has no
durable path at all. `~/.ccwt/` already holds the token and `state.json`, so this adds no new place
for ccwt to own.

**It writes those files when you press install, not at startup.** Until then ccwt does nothing: no
directory, no registered marketplace, no plugin. The same applies to updating — a newer ccwt marks
the plugin *outdated* in the panel and waits. The source path matters only while installing or
updating; once installed, the plugin runs from Claude's cache.

`package.json` ships `files: ["bin", ".output"]`, so **`plugin/` must be added** or the plugin is
missing from the published package while working perfectly from a checkout.

An install does not need a restart. Claude Code may switch the plugin on during the install and says
so in its summary; otherwise **`/reload-plugins --force`** applies it to a session already open. The
`--force` is not optional here — the reload changes which MCP tools are loaded, which invalidates the
prompt cache, and the command skips rather than do that silently. The panel says all of this.

---

## 5. What the session is told, and when

### There is no push (2.1.234)

`CwdChanged` and `FileChanged` share one dispatcher, and it harvests only `watchPaths` and
`systemMessage` from a hook's result — never `additionalContext`. So although a hook can register
watch paths and ccwt could touch a file on every status change, the resulting event can print a line
to the user's terminal and cannot tell the model anything.

**Three events carry context to the model**, and every one is Claude Code calling us:

| event | carries context | used for |
|---|---|---|
| `SessionStart` | yes | the opening picture, and the session's name |
| `UserPromptSubmit` | yes | the delta when something moved, and renaming |
| `PreToolUse` | yes | the denial, at the moment of the command |
| `CwdChanged` / `FileChanged` | **no** | nothing — cannot reach the model |

ccwt cannot initiate. The mechanism is emit-on-turn, and the design has to be honest about that
rather than wish for a socket.

### `SessionStart` describes the repository, not the directory

Describing `cwd` alone fails the ordinary case. Ports live in each **linked** worktree's git config,
so a session launched in the root checkout resolves a worktree with no ports and learns nothing — and
"work in the worktree at …" is a normal thing to be told.

So: walk `git worktree list --porcelain` for the repository containing `cwd`, read each worktree's
`ccwt.port.*`, probe each, and report the lot.

```
This repository has ccwt worktrees. ccwt owns these services and their ports:
  claude-hooks-install   dev → 5270   stopped
  link-never-copies      dev → 5266   running at http://localhost:5266
  (root)                 dev → —      no port allocated

Do not start your own dev server. Open the URL. Starting, stopping and restarting
a service is ccwt's job.
```

Outside a registered project, fall back to every ccwt service currently listening on the machine, and
say nothing at all if there are none.

### `UserPromptSubmit` carries the delta

Fires every turn with the current `cwd`. Build the same table, fingerprint it, compare against
`~/.ccwt/sessions/<session_id>.json`, and **emit only when it changed**:

```
ccwt: `dev` moved to port 5312 (was 5270) and is running at http://localhost:5312
```

`session_id` arrives in every hook's input, so the marker costs nothing. When nothing moved the hook
prints nothing and spends a few git reads and TCP probes.

`SessionEnd` deletes that marker. It does not fire on a crash, so prune the directory by mtime as a
backstop. That is the only thing `SessionEnd` is used for — see §16.

### `PreToolUse` cannot go stale

The guard reads live state at the moment of the command, so a delta missed or compacted away does not
matter: the reason the model gets always names the current port. §8.

---

## 6. Naming the session after its worktree

Three `claude` processes were running while this was written, and nothing distinguished them. The
same hooks fix it, at the cost of one extra field.

Hook output carries a top-level **`sessionTitle`**, in the same family as `watchPaths` and
`systemMessage` (2.1.234):

```js
if (m.sessionTitle) d = m.sessionTitle
…
"Hook sessionTitle applied"    → applied with source "hook"
```

And both `SessionStart` and `UserPromptSubmit` receive **`session_title`** on stdin — the current
name. So the hook always knows what the session is called before deciding to rename it.

That covers all three cases:

| when | how |
|---|---|
| session opens in a worktree | `SessionStart` returns `sessionTitle` beside `additionalContext` |
| a worktree is created mid-session | `UserPromptSubmit` sets it on the next turn |
| the same session moves to another worktree | `UserPromptSubmit` compares `cwd` and re-titles |

The apply step already no-ops when the title is unchanged, so re-emitting the same name every turn
costs nothing.

**Rules:**

- The name is project-qualified — `ccwt · claude-hooks-install` — because a machine with four
  registered projects has worktrees whose bare names collide.
- **Never clobber a name the user chose.** The hook receives `session_title`, so it can tell its own
  format from something typed by hand. Set it only when the title is empty or is one of ours.
- No rename in the root checkout, and none at all outside a ccwt worktree.

The failure mode is benign in a way §11's is not: if the field is ignored or renamed in a future
version, the session simply keeps its old name. Nothing breaks.

---

## 7. How a hook resolves the picture

Entirely offline. No server, no token, no network — prototyped and confirmed against a real worktree
while ccwt was **not running**:

```
worktree  git rev-parse --show-toplevel
root      git worktree list --porcelain          first entry is the main worktree
project   ~/.ccwt/state.json, matched on rootPath    -> service names, commands, cwd
ports     git config --worktree --get ccwt.port.<service>   per worktree
liveness  TCP connect, 127.0.0.1 and ::1
```

This works because `ports.ts:108` already persists every allocation into the worktree's own git
config. It is durable, per-worktree, and survives ccwt being closed.

Two rules from `CLAUDE.md` get re-implemented in the plugin, and both have been gotten wrong before:

- the config key is lowercased with non-alphanumerics collapsed to dashes, because **a git config key
  may not contain an underscore**
- the probe tries **both address families**, because Vite binds `localhost`, which on macOS is `::1`

That duplication is the honest cost of a hook that answers with ccwt closed.

**Liveness comes from the probe, never from "is ccwt running".** §1 is why: every process there
outlived its parent.

### When nothing matches

Not a repo, not a registered project, no recipe, no allocated port, unreadable `state.json`,
`~/.ccwt` absent — every one exits 0 and prints nothing. A hook that failed loudly outside ccwt's
world would be a machine-wide hook breaking every unrelated session, so **discovery must never
throw** applies here with more force than anywhere else in the codebase.

---

## 8. The guard

`PreToolUse` on `Bash` returns:

```json
{ "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "ccwt already runs `dev` for this worktree, listening on http://localhost:5270. Use that URL rather than starting a second one — ccwt owns this service's lifecycle." } }
```

`permissionDecisionReason` goes back to the model, so a denial teaches rather than merely blocks.

**It must not know what a dev server is.** `CLAUDE.md` forbids teaching ccwt about a particular
stack, and a hardcoded list of `npm run dev` / `pnpm dev` / `rails s` is exactly the convenience that
does the wrong thing for every project it was not written for. The match is derived from the recipe:
take `services[].command`, strip the `{{port}}` template, reduce to argv, compare shape. This
project's guard blocks `npm run dev`; `charactersheet`'s blocks `docker compose -f compose.ccwt.yml …
up`; a Django project's blocks whatever its recipe says.

### It resolves its own target

**`cwd` is the session's, not the Bash tool's** (2.1.234) — `PreToolUse` builds its input from the
same global cwd getter as every other event. So `cd ../worktrees/foo && npm run dev` would otherwise
be matched against the wrong worktree. Resolve a leading `cd <path> &&` out of the command first,
then fall back to `cwd`.

### Bounds, so it stays narrow

- Only when the target resolves to a ccwt worktree with a recipe
- Only against services that project declares
- Only when the service is **actually listening** — a stopped service is not a reason to block
- **Deny, never `updatedInput`.** Rewriting would fight the rtk hook already installed on this
  machine, which returns `updatedInput` of its own. Two hooks rewriting one string is a race worth
  never entering
- Nothing else, ever. It is not a general command filter and must not grow into one

---

## 9. What the session can ask ccwt for

`plugin.json` declares `mcpServers` directly, so the hooks and the MCP server ship in one plugin,
one install, one panel toggle.

**Two tools, both read-only:**

| tool | answers | needs ccwt running |
|---|---|---|
| `ccwt_status` | what runs for this repository, on which ports, and whether each answers | no — same discovery as §7 |
| `ccwt_logs` | a service's scrollback, so a change can be checked without building anything | yes |

`logs.get.ts:7` already returns `supervisor.scrollbackFor(worktreeId)` as plain JSON, `x-ccwt-token`
is already a valid header (`security.ts:37`), and `worktreeId` is `sha256(path).slice(0,12)`
(`git.ts:24`) — computable offline. So the server is a thin, typed front door onto endpoints ccwt
already has.

### No lifecycle, deliberately

There is no `start`, `stop` or `restart`. The guard tells the session that ccwt owns lifecycle;
handing it a restart button in the same breath would blur exactly the line being drawn, and invites a
restart loop during debugging. When a restart is genuinely needed — this project's `shared/` does not
hot-reload — the session says so and a human clicks.

Reading logs is what actually answers *did my change compile*. That was the real need behind wanting
a restart.

### The token never enters the conversation

The MCP server reads `~/.ccwt/token` itself. Nothing puts it in the model's context, and the surface
the model can reach is two tools rather than every endpoint ccwt exposes — which matters, because
`CLAUDE.md` is blunt that anything reaching that API can spawn processes.

### Built hand-rolled

MCP over stdio is JSON-RPC; two tools need roughly 150 lines and no dependencies. That matches how
`bin/ccwt.mjs` is deliberately written, starts instantly, and needs no network — where
`npx claude-code-worktrees mcp` would pay a download on first run in every session.

Cost in context is near zero: Claude Code defers MCP tool schemas, listing tools by name and loading
schemas on demand.

---

## 10. `~/.ccwt/server.json`

`bin/ccwt.mjs:13` takes `--port`, defaults to 4600, and **writes it down nowhere**. Only the token is
persisted, so nothing outside the process can find the API — including §9's MCP server.

Fix it where the token is already written, same mode 600:

```json
{ "host": "127.0.0.1", "port": 4600, "pid": 12345, "startedAt": "2026-08-17T…" }
```

`ccwt_logs` degrades to "ccwt is not running" when nothing answers on the recorded port. A stale
`server.json` must degrade to silence, never to a broken instruction.

**It is never deleted on exit, deliberately.** Cleanup would run on a clean shutdown — the case that
needs it least, since the port is released too and the probe already answers correctly — and would
miss every case that actually strands the file: `SIGKILL`, a crash, a power cut. Worse, the file is
keyed to nothing, so a late exit handler from a restarted ccwt could delete the **live** instance's
record. The file is a hint about where to look, never a claim that something is listening there, and
the probe is the only authority that can be right about the difference.

**Nor is it written per instance.** Two ccwt instances at once happens while developing ccwt itself
and not otherwise, and `CLAUDE.md` is explicit that the projects on this machine are not the test.
The consequence is worth stating so it is not mistaken for a bug: a dashboard run through
`npm run dev` never goes through `bin/ccwt.mjs`, so it writes no `server.json` and `ccwt_logs` will
say ccwt is not running. Everything else works in dev; only the logs tool needs the shipped entry
point.

---

## 11. Creating a worktree — written up, not built

**Deferred.** Installing a `WorktreeCreate` hook replaces Claude Code's creation logic wholesale,
which takes `.worktreeinclude` handling with it — and **§5.4 is still the only stub in the
codebase**. Shipping this first would silently drop a documented behaviour with nothing replacing it.
§5.4 lands first; until then the panel's row for it stays off.

Recorded now because §5.3's contract is wrong and someone will otherwise write a hook against it.

### What `WorktreeCreate` actually sends and expects (2.1.234)

| §5.3 says | actually |
|---|---|
| stdin carries `worktree_path`, `worktree_reason`, `how_triggered` | stdin carries **`name`**, plus the common fields: `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `agent_id`, `agent_type`, `effort`. The other three do not exist — `worktree_path` is the *`WorktreeRemove`* field |
| "prints the final path on stdout" | correct. The **last non-empty line** is taken; a relative path resolves against `cwd` |

**Failure is fatal and there is no fallback to git.** A non-zero exit, a success that prints no path,
or a hook configured but not run — untrusted workspace, `disableAllHooks`, matcher mismatch — makes
worktree creation *throw*. On a machine-wide plugin that means `claude --worktree` breaking in every
repository, including ones ccwt has never heard of.

### Therefore, when it is built

- **Always exit 0 and always print a path.** With ccwt unreachable, or outside a registered project,
  perform the plain `git worktree add` and print that. ccwt is the enhancement; git is the floor.
- **A subagent worktree gets the floor, never provisioning.** The event fires for
  `isolation: "worktree"` and background sessions too, and `agent_id` is present only for a subagent,
  which makes it the discriminator. Unbounded, a ten-way fan-out becomes ten provisions and ten dev
  servers, each hardlinking `node_modules` and running `postCreate` — which `CLAUDE.md` notes
  "generates keys, seeds databases and builds".

`create()` already takes `start: boolean` and, when true, provisions, allocates every port and starts
every service (`server/lib/worktrees.ts:292`). `POST /api/projects/<id>/worktrees` with
`{name, branch, start}` is the whole call — **nothing new is needed server-side**, the hook is only a
trigger. Branch naming stays Claude Code's (`worktree-<name>`); the path becomes ccwt's
`worktreesDir`, which is the point of §5.3.

`WorktreeRemove` receives `worktree_path`, is **non-blocking** — failures logged in debug only — and
maps onto the existing rule that **`postRemove` may never block a removal**.

---

## 12. The panel

`/settings` — the machine-wide page, beside GitHub, for the same reason `ForgePanel` lives there.
The nav blurb reads *"The accounts and hosts ccwt talks to on your behalf."* which no longer covers
the page: widen it in `app/nav.ts`.

State comes from `claude plugin list --json`, so it is read rather than inferred:

| state | meaning | look |
|---|---|---|
| unavailable | no `claude` on PATH | plain, no install button |
| absent | available, not installed | offer install |
| installed | present and enabled | `--ccwt-live` — the machine confirmed it is usable |
| disabled | installed, switched off in Claude Code | offer enable |
| outdated | plugin version behind this ccwt | offer update |

`--ccwt-live` is right for *installed* on the existing rule: a satisfied host requirement is already
what that hue is for. Everything else is achromatic or one of the two warm hues.

**Nothing happens until you press install.** The panel shows the exact commands it will run, in
mono, before running any of them — the same standard the removal confirmation is held to. It states
that it runs `claude plugin …` on your behalf, that a denied command is a command that will not run,
that sessions get renamed, and that everything takes effect in the **next** session.

One row per capability — context, guard, naming, tools — each with a sentence saying what it does.

---

## 13. Inventory

| file | change |
|---|---|
| `plugin/.claude-plugin/plugin.json` | new — manifest and `mcpServers` |
| `plugin/hooks/hooks.json` | new — three events |
| `plugin/hooks/ccwt.mjs` | new — discovery, three handlers, session naming, zero dependencies |
| `plugin/mcp/server.mjs` | new — JSON-RPC over stdio, two read-only tools, zero dependencies |
| `.claude-plugin/marketplace.json` | new |
| `package.json` | `files` must include `plugin` and `.claude-plugin` |
| `bin/ccwt.mjs` | write `~/.ccwt/server.json`; materialise the plugin into `~/.ccwt/plugin/` |
| `shared/types.ts` | `PluginState`, `PluginCapability`, `PluginReport` |
| `server/lib/plugin.ts` | drive the `claude plugin` CLI; no Nuxt, no H3 |
| `server/api/plugin.get.ts` · `.post.ts` · `.delete.ts` | report, install, remove |
| `app/composables/useApi.ts` | `getPlugin` / `installPlugin` / `removePlugin` |
| `app/components/PluginPanel.vue` | new |
| `app/pages/settings.vue` · `app/nav.ts` | mount it; widen the blurb |
| `test/` | first tests — `node --test`, no new dependency |
| `docs/SPEC.md` | §5.3 contract corrected; §5.6 added |
| `docs/MILESTONES.md` | entry |

Diagnostic codes, namespaced `thing.problem` and stable: `plugin.no-claude`, `plugin.disabled`,
`plugin.outdated`, `plugin.install-failed`.

Tests use `node --test`, which adds no dependency — consistent with `bin/` being deliberately
dependency-free. They cover the parts with real branching: the guard's shape match against a recipe
command, the port-key normalisation, the delta fingerprint, the session-title don't-clobber rule, and
every discovery fallback that must exit silently.

---

## 14. What must never happen

- **A write into a registered repository.** The whole feature is arranged around this (§3).
- **Installing anything on its own.** Not on startup, not when a project is registered, not after an
  update, not to repair a broken install. The plugin is installed when a person presses the button
  and never otherwise, and the same holds for updating and removing it.
- **A hook that throws outside ccwt's world.** It runs in every session on the machine, including
  repositories ccwt has never seen.
- **A hook that lets a session control a service.** Read-only, permanently (§9).
- **Clobbering a session name the user chose** (§6).
- **A slow hook.** `PreToolUse` fires on every `Bash` call and `UserPromptSubmit` on every turn.
  Cheapest checks first; no work once the target fails to resolve.
- **A guard that grows.** Duplicates of declared services, and nothing else, forever.
- **Teaching ccwt a stack.** The recipe is the only source of what a service command looks like.

---

## 15. Verifying it

```bash
npm run typecheck && npm run build && npm test
claude plugin validate .            # marketplace
claude plugin validate ./plugin     # plugin
```

Each handler, driven by hand — every one must exit 0:

```bash
echo '{"cwd":"'"$PWD"'","session_id":"t","hook_event_name":"SessionStart","source":"startup"}' \
  | node plugin/hooks/ccwt.mjs session-start

echo '{"cwd":"'"$PWD"'","tool_name":"Bash","tool_input":{"command":"npm run dev"}}' \
  | node plugin/hooks/ccwt.mjs guard
```

Confirmed against the built plugin, driven by hand in this repository:

| case | expected | result |
|---|---|---|
| `session-start` in a worktree | every worktree's services and ports | ✅ |
| `session-start` in the **root checkout** | still lists the linked worktree's ports | ✅ — the case that previously returned nothing |
| `session-start` / `prompt` | sets `sessionTitle` | ✅ `ccwt · claude-code-worktrees/claude-hooks-install` |
| `prompt`, nothing moved | complete silence | ✅ |
| `prompt`, service came up | one delta line | ✅ `dev is now running at http://localhost:5270` |
| `guard`, service listening | denies, naming the URL | ✅ |
| `guard`, `cd <path> && npm run dev` from the root | denies against the **right** worktree | ✅ |
| `guard`, `NODE_ENV=x npm run dev` | denies | ✅ |
| `guard`, `npm run build` | silence | ✅ |
| `guard`, `git commit -m "npm run dev"` | silence | ✅ quoting keeps it out |
| `guard`, service stopped | silence | ✅ |
| `guard`, outside ccwt | silence | ✅ |

The last two guard rows matter as much as the denials: a stopped service is not a reason to block,
and a repository ccwt has never seen must be untouched.

Still to prove: both MCP tools over stdio; a session renamed again on moving worktree; a hand-typed
title left alone; and an install landing beside the rtk hook in `~/.claude/settings.json` without
disturbing it.

---

## 16. Considered and left out

**A skill.** Claude Code's built-in `run` skill looks for a project skill covering how to launch the
app, so there is a slot. But §5 injects the same facts deterministically while a skill fires only
when the model decides it is relevant, and §9's tools describe themselves. Its only marginal value is
*ordering* — what to do first, what to do when a service crashed. That is a gap to discover by using
the thing, not to guess at now.

**Reclaiming orphaned ports.** `ServiceStatus.taken` (`shared/types.ts:80`) already means *stopped
service, port occupied*, and `WorktreeCard.vue:237` already renders `port 5266 taken` — a dead label
you cannot act on. Making it actionable would clear the strays in §1, which the guard never touches;
it shares no code with this feature and belongs to its own pass. Note that ccwt's own kill path is
being hardened separately: `process.kill(-pid, …)` group-kills without verifying the pid still
belongs to the process ccwt spawned, which has already killed an unrelated application.

**Killing a session's processes on `SessionEnd`.** It fires only on a clean exit, could not tell
which processes to kill, and ccwt's services are *meant* to outlive a session. `SessionEnd` is used
for exactly one thing: deleting this session's fingerprint marker (§5).

**Reading session activity from transcripts.** Claude Code writes one per session at
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, encoding `/`, `.` and `_` all as `-`. ccwt
could compute that name and take the newest mtime, giving *last active 2 minutes ago* versus *3 hours
ago* — with no hook, no write and no cooperation.

Left out for now, but two findings are worth keeping. The encoding is **lossy** — `kp_xv_portal` and
`kp-xv-portal` collide — so it may only ever be computed forwards, never inverted. And **the lock is
not the reliable signal §5.2 assumed**. `lockStateOf` (`worktrees.ts:49`) reads the pid out of the
lock reason and checks it, but of three worktrees here only one was locked: the one being actively
worked in through `EnterWorktree` had no lock at all, while a finished-but-open session keeps one
indefinitely. It under-reports real agents and over-reports finished ones. `CLAUDE.md` already
predicted half of that — *"a session parked in a finished worktree looks identical to one
mid-edit"* — and the other half is new.
