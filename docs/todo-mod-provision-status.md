# TODO: provision status in the ccwt mod table

Raised 2026-10-14 from a session in `charactersheet`.

## What is missing

The mod's worktree table (`mod/hooks/register.tsx`) shows WORKTREE, STATE, PORT and ACTION. It
says nothing about provisioning, although the server knows it: `ccwt_create_worktree` returns
`provisioned: true|false`, and the mod already offers a repair action that re-runs provisioning
(`act($, worktreeId, 'repair', 'provision')`). A worktree whose provisioning failed, is still
running, or was done with an older recipe looks exactly like a healthy one until a service fails.

## Proposal

Add a PROVISION column (or a marker in the STATE cell when the table is narrow) with one word per
worktree:

| Value | Meaning |
| --- | --- |
| `ok` | provisioned with the current recipe |
| `running` | `postCreate` or linking still in progress |
| `failed` | a provision step failed (the action column offers repair) |
| `stale` | provisioned with an older recipe than the stored one |
| `none` | never provisioned (created outside ccwt, e.g. `git worktree add`) |

- Source: the server's worktree record (the same data `ccwt_get_status` reads); add the provision
  result and the recipe revision it ran with if they are not stored yet.
- `failed` and `stale` make the row draw attention like a crashed service, and the ACTION column
  offers repair.
- `ccwt_get_status` and the SessionStart context should carry the same value, so a Claude session
  sees it too.

## Status

Done in the mod, from data it already had (`provisioned`, `repairing`): a PROVISION column with
`ok`, `repairing` and `missing` (`missing` covers `none` too: the recipe's files are not there,
whoever made the worktree). A `missing` row already raised the `unprovisioned` alert with repair.

Left:

- `failed` needs the server to record the outcome of `postCreate` on the worktree; today only
  the create result carries it, and only at the time.
- `stale` contradicts "There is no recipe revision" in `CLAUDE.md`. It needs a decision on how a
  recipe change is told apart (a version inside the recipe, or a hash of it) before any code.
- `ccwt_get_status` and the SessionStart context do not carry the value yet.
- No narrow-table fallback: the column takes its width from the name column, which is cut in the
  middle instead of folding the value into STATE.

## Why it matters

Today the only way to learn a worktree's provisioning went wrong, or ran with an older recipe, is a
service failing later or reading the create result at the time. A provision column shows it up
front, for every worktree, next to the action that repairs it.
