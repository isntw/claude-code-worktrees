# Tracking what the plugin did

Spec for a record of the ccwt plugin's own activity — every hook that fired, every tool that was
called, what it decided and what it changed. **Not built.** The plugin itself is built and shipping;
this is the missing half — what it *does* is settled, and nothing anywhere says what it *has done*.

Motivating case: a session rewrites the recipe, or the guard refuses a command, and the dashboard —
the thing whose whole job is showing you the state of your worktrees — has no idea it happened.

---

## 1. What counts as activity

Four sources, and they are not equally visible.

| Source | Where | Runs when |
|---|---|---|
| Hooks | `plugin/hooks/hooks.json` | `SessionStart`, every `UserPromptSubmit`, `PreToolUse` on Bash, `SessionEnd` |
| MCP tools | `plugin/mcp/server.mjs` | Seven tools: status, logs, project add, recipe read/check/write, worktree start |
| Skill | `plugin/skills/ccwt-recipe-create/` | Loaded by Claude Code, never through ccwt |
| Install, enable, remove | `server/lib/plugin.ts` | Already reported by `GET /api/plugin` |

The skill is unobservable and stays that way — it is a document Claude Code reads. It is visible only
in the tool calls it leads to, which is enough.

## 2. What is recorded today

Almost nothing, and less than it looks.

- `SessionStart` and each `UserPromptSubmit` write a marker through
  `server/api/plugin/session/[id].put.ts` into the `sessions` table (`server/lib/schema.ts:27`).
  It is **one row per session, last write wins**, and `SessionEnd` deletes it. A marker, not a log —
  it exists so `prompt` can diff against the last snapshot, and it is doing that job correctly.
- Tool calls hit ordinary API routes carrying only `x-ccwt-token`. **Indistinguishable from the
  dashboard's own traffic.**
- The guard (`plugin/hooks/ccwt.mjs:87-107`) reaches the server only for `readState()`. The denial
  itself — which service clashed, what command was refused — never leaves the hook process.
- `GET /api/plugin` reports the static inventory: which hooks and tools *exist*
  (`app/components/PluginPanel.vue`). Never that one fired.

And a floor worth stating: `describe()` returns `null` for an unregistered repository or one with no
recipe, so those sessions produce no activity to record at all. That is correct — the plugin genuinely
does nothing there.

## 3. What the standards cover, and what they do not

Researched rather than assumed; see §9 for sources.

**Claude Code exports OpenTelemetry** — `CLAUDE_CODE_ENABLE_TELEMETRY=1` plus
`OTEL_LOGS_EXPORTER=otlp`. It emits `claude_code.tool_result`, `claude_code.tool_decision`,
`claude_code.user_prompt`, `claude_code.mcp_server_connection`, `claude_code.plugin_installed` and
`claude_code.plugin_loaded`, with `plugin.name`, `marketplace.name`, `mcp_server.name`,
`mcp_tool.name`, `session.id` and `prompt.id` on them. This is the standard for machine-wide
monitoring and **ccwt must not reimplement it.**

It cannot do this job, for four reasons:

1. It is emitted by Claude Code to the **user's** OTLP endpoint. A plugin cannot enable it for itself
   and cannot receive it.
2. Third-party plugin names collapse to `"third-party"` unless the user also sets
   `OTEL_LOG_TOOL_DETAILS=1`. ccwt would appear unnamed.
3. The `claude_code.hook` span is beta — `ENABLE_BETA_TRACING_DETAILED=1`, and in interactive
   sessions org allowlisting. Not something to depend on.
4. It reports *that* a `PreToolUse` hook ran and the tool was denied. It cannot report ccwt's reason.

**MCP has a logging standard and ccwt does not implement it.** A server declares a `logging`
capability, the client sets a level with `logging/setLevel`, and the server pushes
`notifications/message` at RFC 5424 severities. `plugin/mcp/server.mjs` declares protocol
`2025-06-18` and no such capability, so its seven tools narrate nothing to any client. Worth fixing on
its own merits — but it reports to Claude Code, not to ccwt.

**Hooks have no standard at all.** Stdout on exit 0 goes to Claude Code's debug log;
`SessionStart` and `UserPromptSubmit` stdout becomes context instead. Nothing is recorded by default.
The prevailing convention is a hook appending structured JSONL, which is what §4 does.

Conclusion: no standard covers *a plugin reporting its own activity back to its own server*. That
part is ours to design. The two that do exist we should conform to rather than route around.

## 4. The work

### 4.1 Name the caller

`ask`, `tell` and `call` in `plugin/lib/discover.mjs:78-127` are the only way any hook or any tool
reaches the server. One header added there — `x-ccwt-source: hook/SessionStart`,
`tool/ccwt_write_recipe` — instruments the entire plugin in one edit, and cannot drift out of step
with a tool list it does not read.

Send `session_id` and `prompt_id` alongside it where they are known. **The header is a label, never
an authority**: the token and `Host` checks in `server/middleware/security.ts` stay the only thing
that admits a request, and a forged source header must buy nothing but a wrong row.

### 4.2 An events table

`apply()` (`server/lib/schema.ts:83`) runs the whole `CREATE TABLE IF NOT EXISTS` block on every
open, so a table costs no migration machinery. Columns: `at`, `source`, `name`, `session_id`,
`prompt_id`, `project_id`, `worktree_id`, `outcome`, `detail`.

Append-only, and therefore **capped** — `logstore.ts` already rotates at 2 MB and clamps a line at
8 KB, and this needs its own answer before it ships, not after it has grown for a month.

### 4.3 Show it

A `{ type: 'event' }` arm on `SocketMessage` (`shared/types.ts:432`) and `broadcast`
(`server/routes/_ws.ts:7`), and a feed on `/settings` beside `PluginPanel`. The panel says what the
plugin can do; the feed says what it did.

### 4.4 The guard reports its own denial

The only event that must be pushed rather than observed. Requirements, in order:

- **It may never delay or block the denial.** The guard decides from local git config and port probes
  precisely so it still works with the dashboard closed; a report that can stall it is a regression,
  not a feature. Fire and forget, after `emit`.
- Record the service that clashed and the worktree. See §5 on whether the refused command text is
  recorded with it.

### 4.5 Declare MCP `logging`

Independent of everything above, and standards-conformant: `logging` in the server's capabilities,
`logging/setLevel` honoured, `notifications/message` for what each tool did.

### 4.6 Document the OTel path

A short section pointing at `CLAUDE_CODE_ENABLE_TELEMETRY` and `OTEL_LOG_TOOL_DETAILS=1` for anyone
who wants ccwt's activity in their own monitoring, and saying plainly that ccwt does not emit it.

## 5. Decisions still open

- **Events lost while the server is down.** `reachServer()` returns `null` and the event is gone. A
  spool file under `~/.ccwt/` for the server to drain on boot would close it. Whether a plugin
  activity feed is allowed to have holes is a product decision, and shipping one silently is the
  wrong answer either way.
- **Whether the refused command text is stored.** It is the most useful field in a denial and the
  only one that is arbitrary user input written to disk. `logstore` clamps rather than refuses; this
  may want to record the matched service and not the command.
- **Retention.** Rotate like the log store, cap by row count, or drop on some age.
- **Whether the `sessions` marker and the events feed stay separate.** They should: the marker is
  state the plugin reads back, the feed is history nobody reads back. Deleting the marker at
  `SessionEnd` must not delete the history.

## 6. Out of scope

- Reimplementing or ingesting OpenTelemetry.
- Recording anything about the skill beyond the tool calls it produces.
- Any tracking of a repository ccwt has no recipe for.
- Making the guard's decision depend on the server being reachable, in any form.

## 7. Order to build it

§4.1 and §4.2 together are the whole substrate and are worth one worktree. §4.3 is the first thing
that makes it visible. §4.4 is small but has the sharpest constraint. §4.5 is separable and could go
first. §4.6 is a paragraph. The spool in §5 is deliberately last, because the shape of the feed
should be known before deciding what a gap in it costs.

## 8. What this touches

| File | Why |
|---|---|
| `plugin/lib/discover.mjs` | The header, and the report call for the guard |
| `plugin/hooks/ccwt.mjs` | Report the denial after emitting it |
| `plugin/mcp/server.mjs` | Capabilities, `logging/setLevel`, notifications |
| `server/lib/schema.ts` | The table |
| `server/lib/` | A new module owning append and read, importing no Nuxt |
| `server/api/plugin/` | The record endpoint and the read endpoint |
| `shared/types.ts` | The event type and the socket arm |
| `app/composables/useApi.ts` | The only place the feed may be fetched from |
| `app/pages/settings.vue`, `app/components/` | The feed |

## 9. Sources

- Monitoring — <https://code.claude.com/docs/en/monitoring-usage>
- Hooks — <https://code.claude.com/docs/en/hooks>
- MCP logging — <https://modelcontextprotocol.io/specification/2025-03-26/server/utilities/logging>
- Agent SDK observability — <https://code.claude.com/docs/en/agent-sdk/observability>

Read 2026-08-21. The beta gates in §3 are version-specific and worth re-checking.
