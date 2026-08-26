---
name: ccwt-worktree-remove
description: Remove a ccwt worktree — what removal destroys, what survives it, and what to put to the person before confirming. Use when asked to remove, delete or clean up a worktree, when a worktree made for a test is finished with, or when a branch has landed and its worktree is still on disk.
---

# Removing a worktree

`ccwt_remove_worktree` deletes a directory, and most of what it deletes is not in git: a hardlinked
`node_modules`, the `.env` files ccwt copied, whatever `postCreate` generated. Nothing brings that
back. It is the only ccwt tool whose mistake cannot be undone by calling it again.

It stops the services itself, so there is nothing to stop first.

## Two calls, never one

1. **Without `confirm`** — nothing is removed. The answer names the path, who made the worktree,
   what is up, whether a session is holding it, how many files carry changes committed nowhere, and
   what becomes of the branch.
2. **Put that to the person, with the path in it.** Not "shall I clean up?" — the path, and what
   goes with it.
3. **`confirm: true`** — it goes.

The first call is the only confirmation there is; skipping it removes the worktree on your own
authority. `worktree` has no default for the same reason: name the one you mean, and take the name
from `ccwt_get_status` rather than assembling a path.

## What goes and what stays

| | |
|---|---|
| The directory and every untracked file in it | **Gone.** `node_modules`, copied `.env` files, build output, anything `postCreate` made. |
| Changes committed nowhere | **Gone** with the directory. Keeping the branch does not bring them back. |
| The branch | **Kept**, unless you pass `branch: true`. What was committed survives on it. |
| Anything on a remote | Untouched. `branch: true` is local, and git keeps even a local branch whose commits are merged nowhere. |
| The ports it held | Released, and free for the next worktree that asks. |
| The scrollback | Forgotten. Read what you need with `ccwt_get_logs` before, not after. |

## Whose worktree it is

- **`origin: "ccwt"` or `"claude"`** — ccwt created it, and removal deletes what ccwt put there.
- **`origin: "manual"`** — ccwt only found it. It will not empty a worktree it did not make:
  removal goes ahead only if nothing would be lost, and is refused, naming the files, if anything
  would. That refusal is the right answer — report it and stop. Committing or clearing someone
  else's work to get past it is not yours to do.

## A lock is not permission, and not a refusal either

Claude Code locks a worktree while an agent works in it, with a reason naming the session and its
pid. ccwt releases the lock and removes the worktree anyway — a session parked in a finished
worktree looks identical to one mid-edit, and the lock cannot tell you which.

So when the answer says a process that is **still running** holds it, that is another session's
working directory. Quote the reason to the person and let them decide. Never confirm past a live
lock on your own judgement.

## What is working in there

The first call also names every program whose working directory is inside the worktree, as
`working`. Removing the directory takes the ground out from under each of them: a session that `cd`
ed in loses the directory it is working in, and what happens next is not ccwt's to control.

ccwt leaves them alone. It stops its own services and reaps a stray still holding one of the
worktree's ports, and those are already left out of `working` — what is left is collateral. Quote it
with the path. A session in that list has to leave the directory itself; nothing outside a process
can move it, and `ExitWorktree` does not apply to a worktree ccwt created.

## Being asked to leave one

"Exit this worktree", or work that is finished and a directory that should go with it, is three
steps in this order:

1. **Push what is worth keeping.** Once it is on the remote, the directory holds nothing that is
   only there.
2. **Leave the directory** — `cd` to the repository root. Nothing outside a process can move it out
   of a directory, so this is the one step only the session standing there can take.
3. **Then remove it.**

Step 2 is not optional and nothing checks it for you. The tool refuses a worktree the session was
*launched* in, which it knows from where its own process started — it cannot see a `cd` made since.
A session that started at the root and moved in gets no refusal, so removing from in there deletes
the directory out from under itself, and every tool call after it.

`ExitWorktree` is not this. It exits a worktree Claude Code created for a session of its own, and
ccwt creates worktrees with `git worktree add` — so there is no session to exit and the call does
nothing at all. It says so, and a no-op is not the work being done.

## Never the one you are in

The tool refuses the worktree this session started in, and refuses the repository root. That
refusal is final for a session launched inside a worktree: where its process started never changes,
so no amount of moving about makes the tool accept it. Say so and leave it to the person. A session
that only moved in has the three steps above instead.

## Stale entries

A worktree whose directory is already gone comes back `prunable`. Removing it drops the entry git
still keeps and changes nothing on disk: nothing to lose, nothing to weigh.

## Afterwards

Say what went and what was kept, plus anything the answer reported — a stray process that was still
holding a port when the directory went, or a branch git refused to delete. Then `ccwt_get_status`:
the worktree should be absent and its port free.
