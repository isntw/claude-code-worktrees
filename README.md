<div align="center">

<img src="public/apple-touch-icon.png" alt="" width="76">

# Claude Code Worktrees

</div>

Run several branches at once. Every worktree gets its own dependencies, its own ports, its own dev
server and its own logs — from one local dashboard. Each card carries the branch's **GitHub** pull
request, and **seven MCP tools** let a Claude Code session set a project up, start it and read what it
printed.

![Every worktree, every port and every service, across all projects](docs/images/overview.png)

## The problem

`git worktree add` gives you tracked files. Nothing else.

- **Nothing to run with** — no `node_modules`, no `.env`, nothing git was never told about.
- **No port of its own** — the checkout next door already has it, so the dev server dies on start.
- **No way back out** — `git worktree remove` refuses, because those untracked files are in the way.

So a second branch means installing again, copying secrets again, hunting for a free port again, and
cleaning up by hand. That is usually where people give up and go back to `git stash`.

**ccwt does that part.** A worktree becomes a running environment: the files it needs put in place,
dependencies hardlinked in milliseconds, a dev server on a port that stays its own, logs streaming
into one panel. Nothing is added to your project — no file to commit, no script to change.

## Start

> [!IMPORTANT]
> **macOS only for now.** Linux and Windows are not supported yet.

Needs git 2.20+ and Node 24+.

```bash
git clone https://github.com/isntw/claude-code-worktrees
cd claude-code-worktrees
npm install
npm run build
npm start          # opens http://localhost:4600
```

`npm i -g .` after that build puts `ccwt` on your path, to start it from anywhere.

1. **Register project** — point it at a repository root. Registering reads nothing out of it and
   writes nothing into it.
2. **Write its recipe** — what a worktree of this project needs, in your words. A session can do it
   for you.
3. **New worktree** — a name is enough; its services can start as soon as it's ready.
4. Click its port. Work.
5. **Remove** it when you're done. The branch stays.

## Set up a project

Two steps, once per repository.

**Register the root.** Registering reads nothing out of the repository and writes nothing into it —
ccwt only notes where it is.

**Write its recipe.** The recipe is what a worktree of this project needs, in your words. ccwt
detects nothing and prefills nothing:

| | |
|---|---|
| `worktreesDir` | where new worktrees go |
| `copy` | what each worktree needs its own of — `.env`, and anything else git does not carry |
| `link` | what is hardlinked instead — `node_modules`, milliseconds, no extra disk |
| `write` | files generated per worktree, from `{{project}}`, `{{slug}}`, `{{rootPath}}` and `{{worktreePath}}` |
| `postCreate` | commands run once inside a new worktree — install, generate keys, seed, build |
| `services` | what to run: a command or a container stack, each with a port range of its own |

The recipe is stored on ccwt's side, in `~/.ccwt/ccwt.db`. Nothing is written into your repository, so
there is no file to commit and no branch that can carry a stale copy of it.

![The recipe form](docs/images/recipe.png)

**Or ask a session to do it.** Both steps are MCP tools: `ccwt_project_add` registers the repository,
`ccwt_recipe_check` validates a draft, `ccwt_recipe_write` stores it. That inverts the usual order —
ccwt guesses nothing about your project, but a session can read it, and the `ccwt-recipe-create` skill
turns "set this project up for ccwt" into a request it can carry out end to end.

## Tour

Three copies of one project, each on its own ports, logs streaming into one panel.

![Three worktrees running side by side](docs/images/worktrees.png)

A service is a command or a container stack. Each worktree gets its own compose project and ports.

![A container stack running in a worktree](docs/images/container-stack.png)

## GitHub

Optional. Sign in once with a device code — the token stays in `~/.ccwt`, and signing out is one click.

A worktree and its pull request are the same work seen from two ends, so ccwt puts them on one card.

- **Every worktree card carries its branch's pull request** — open, draft, merged or closed, its
  `#number` linking straight out to GitHub.
- **Merge from the dashboard**, by merge, squash or rebase, with GitHub's own mergeability reason
  shown first and the account doing it named. A draft cannot be merged, and the button says so.
- **A merged pull request marks the worktree finished**, which is how you tell what is safe to delete.
- **It only touches the remote.** Nothing local is stopped, moved or deleted — merging does not touch
  the worktree the branch came from.

## Claude Code

Optional. A session can set a project up and run it *through* ccwt instead of around it — write the
recipe, start the services, read what they printed — without a dev server of its own fighting for the
port.

**Seven MCP tools.** Three read:

| Tool | Returns |
|---|---|
| `ccwt_status` | Every worktree, its services, the port each holds and whether that port answers. Works with the dashboard closed. |
| `ccwt_logs` | A service's recent output, so a change can be checked without starting or building anything. |
| `ccwt_recipe_read` | The recipe ccwt has stored for a repository, or that it holds none. |

Four act:

| Tool | Does |
|---|---|
| `ccwt_project_add` | Registers the repository so it can hold a recipe and get worktrees. Writes nothing into it. |
| `ccwt_recipe_check` | Validates a candidate recipe without storing it — schema errors with the path of each, plus notes on what will parse but misbehave. |
| `ccwt_recipe_write` | Stores a recipe, validated first, so the saved one never passes through a broken state. Overwriting one already stored needs `replace`. |
| `ccwt_worktree_start` | Starts the services the recipe declares. ccwt still allocates the port, repairs what's missing and owns the process. |

**Starting is the only lifecycle verb an agent gets** — stopping and restarting stay in the dashboard.
No tool writes a file into your repository.

**Four hooks:**

- `SessionStart` — the session is told what ccwt runs, and named after its worktree (never over a
  title you typed).
- `UserPromptSubmit` — told again when something moves.
- `PreToolUse:Bash` — **a command that would start a dev server ccwt already has listening is denied**,
  and the refusal names the URL to open instead.
- `SessionEnd` — the marker is cleared.

**And one skill:** `ccwt-recipe-create`, so "set this project up for ccwt" is a request a session can
carry out — write the recipe, check it, store it — instead of you filling in the form.

One button in Settings installs the plugin into Claude Code's own storage, machine-wide for every
project. Nothing is written into any repository.

![The GitHub and Claude Code panels in Settings](docs/images/settings.png)

## Good to know

- **Ports reach your app through the environment** — `PORT`, plus `CCWT_URL_<SERVICE>` so services
  can find each other. Nothing to import.
- **A worktree keeps its port.** If something else takes it, the card says so and the next start moves.
- **Removal names the path first**, keeps your branch unless you tick the box, and won't delete a
  worktree you made yourself if it has anything to lose.
- **Local only** — binds `127.0.0.1`, new token every run, nothing leaves your machine. Settings
  moves it off 4600, and it stays moved.
- **It does not compare `.env` files** between a worktree and the root checkout. A copy made when the
  worktree was created stays as it was.

## Hardcoded addresses

One thing defeats a port of your own: another service's address written into a file as a literal.
Every worktree then points at the same place. **ccwt scans for those and names the file and line** in
Setup, and keeps working either way — run one worktree of that project at a time, or let the address
fall back to `CCWT_URL_<SERVICE>`, which is the change Setup shows you.

## License

[AGPL-3.0-only](LICENSE). Copyright © 2026 Iustinian Monea.

Free to use, study, modify and share, including at work — your worktrees, code and recipes stay
yours. Redistribute ccwt or run a modified copy as a network service, and you owe your users the
source under this same license.

---

"Claude" and "Claude Code" are Anthropic trademarks.
