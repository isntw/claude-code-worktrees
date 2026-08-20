# Multiple GitHub accounts

Spec for holding more than one GitHub sign-in at a time and binding each project to one of them.
Not built. `SPEC.md` predates the forge feature entirely, so this document is its spec rather than
an amendment to a numbered section.

Motivating case: one machine, a personal account and a work account, both on github.com.

```
xvpn/kp_xv_portal                                    work
isntw/claude-code-worktrees, isntw/claude-code-manager   personal
```

---

## 1. What is wrong today

ccwt holds exactly one credential. `writeSaved()` clobbers `~/.ccwt/forge.json`, so signing in as a
second account silently evicts the first — the panel button even says **"use a different account"**
(`app/components/ForgePanel.vue:145`), which is an honest description of the model.

The consequence is not just inconvenience. A project whose repository the held account cannot see
falls into `unreachable()` with a 403/404, and the card shows local git only. With work and personal
repositories registered side by side, at most one group can ever show pull requests.

---

## 2. Scope

### In scope

- Hold N credentials, each independently signed in and signed out
- Resolve which account a project uses, automatically where possible, explicitly where not
- Show which identity is being used, especially at the moment of a merge
- Distinguish *revoked* from *unreachable* (§8) — with one account this was cosmetic, with several it
  is not

### Out of scope

- **A second forge.** `charactersheet` has a Bitbucket remote, which `REMOTE` (`server/lib/forge.ts:67`)
  does not match, so `repoOf()` returns `null` and that project shows no pull requests **and no
  diagnostic explaining why**. Worth a diagnostic in this pass (§8); a Bitbucket implementation is a
  separate feature with a different API and merge model.
- **GitHub Enterprise Server.** Both accounts are on github.com, confirmed from the registered
  remotes, so an account is a token and not a token plus a host. `API` stays a module constant in
  both files. See D3 for why this is recorded rather than designed away.
- Per-account OAuth client ids.

### Later

- `read:org` and org-membership resolution, if probing proves too chatty (§5)
- Per-account rate-limit reporting

---

## 3. What GitHub already permits

Nothing on GitHub's side is single-account, which is why this is a local change only.

- **One OAuth app takes any number of authorizations.** Each account that completes device flow gets
  its own token.
- **`start()` does not identify anyone** (`server/lib/forgeauth.ts:154`). It asks for a code; the login
  is only learned from `identify()` after `poll()` succeeds. Adding an account is therefore anonymous
  until it lands, which constrains the UI (§6).
- **An OAuth-app user token (`gho_`) does not expire on a timer.** It lives until revoked, or a year
  unused. There is no refresh token, so `poll()` discarding everything but `access_token` is correct
  and stays correct.
- **`GET /repos/{owner}/{name}` returns a `permissions` object** (`admin`/`push`/`pull`) for the
  authenticated user. This is the signal that makes automatic resolution work (§5).

---

## 4. Storage

### `~/.ccwt/forge.json` becomes a list

```jsonc
{
  "version": 2,
  "accounts": [
    { "id": "…", "token": "gho_…", "login": "isntw", "scopes": ["repo"], "savedAt": "…" }
  ]
}
```

`readSaved()` already returns `null` on anything it does not recognise, so accepting the v1 shape — a
bare `{token, login, scopes, savedAt}` object read as a single account — is a few lines inside it.
Mode stays `0600` inside the `0700` state directory.

`id` is generated, not derived from the login, so a sign-out and sign-in of the same account does not
silently re-adopt stale project bindings.

### The binding lives on the project record

Add `forgeAccountId?: string` to `ProjectRecord` (`server/lib/store.ts:6`). `updateRecord()` already
takes a `Partial`, so persistence costs nothing.

**It must not go into the repository's git config.** Port allocation is the only place ccwt writes to
a repository it did not create, and that rule is load-bearing. The binding is a ccwt decision *about*
a repository — the same category as the stored recipe, and it belongs in the same file.

It is stored, not derived, so `projects.hydrate()` passes it through rather than recomputing it. See
§5 for why that distinction matters.

### The memo

`memo`/`memoAt` (`server/lib/forgeauth.ts:36`) becomes a `Map` keyed by account id, same 30s TTL.
`forget()` keeps clearing everything wholesale; there is nothing to gain from being precise.

---

## 5. Resolution

### The ladder, cheapest first

| | Signal | Cost |
|---|---|---|
| 1 | `owner === account.login` | Free — the login is already in `forge.json`, no API call |
| 2 | `GET /repos/{owner}/{name}` per candidate, highest `permissions.push` wins | One call, only for accounts step 1 did not settle |
| 3 | Two accounts both report `push` | Cannot be resolved. Ask (§6) |

For the motivating case this asks nothing: both `isntw/*` projects settle at step 1 with no network
call at all, and `xvpn/kp_xv_portal` settles at step 2 on the first probe.

Bare visibility is not enough on its own — on a public repository every account succeeds. It is
`permissions.push` that separates the account you work with from the bystander.

**Org membership is deliberately not used.** `GET /user/orgs` would answer in one call per account
instead of one per repository, but it requires `read:org` on top of the `repo` currently requested at
`server/lib/forgeauth.ts:8`, which forces every existing user to re-authorise. The probe reaches the
same answer for free.

### Precedence mirrors `readRecipe`

Stored binding → detection → persist what detection found. `readRecipe` already establishes this
shape (stored recipe → detection) and there is no reason for a second one.

**Detection proposes; the store decides.** A purely derived binding would re-resolve on every read,
so the day an account's access changes — you leave the org, a repository goes private — *which
identity merges your pull request* changes with no record of why. Detect automatically, write the
answer down, show it, allow an override and a re-detect.

### Where it hooks in

`read()`, `mergeability()` and `merge()` each call `credential()` with no argument
(`server/lib/forge.ts:180`, `:305`, `:346`). That is the whole seam. `callApi(path, token, init)`
already takes the token as a parameter rather than reaching for a global, so widening `credential()`
to accept an account or a repo leaves everything downstream untouched.

The pull request cache is already keyed by `projectId` (`server/lib/forge.ts:45`), so per-project
accounts do not disturb it and the etag machinery stays valid.

### A trap this exposes

`repoOf()` resolves the *branch's* remote before falling back to `origin`
(`server/lib/forge.ts:70-77`). On a fork workflow — branch pushed to a personal fork, pull request
opened against the org repository — it resolves `isntw/thing` rather than `acme/thing`, so detection
confidently binds the personal account and the result *looks* correct. Pre-existing, but fork-based
work is exactly where personal and work collide. Fix it in this pass: prefer the remote the branch's
upstream tracks, and fall back to the push remote only when there is no upstream.

---

## 6. Web layer

### The panel becomes a list

```
┌ GitHub ───────────────────────────────────────────────────────┐
│                                                               │
│  isntw                                     can merge          │
│  claude-code-worktrees, claude-code-manager      [ sign out ] │
│  ───────────────────────────────────────────────────────────  │
│  imonea-xvpn                               can merge          │
│  kp_xv_portal                                    [ sign out ] │
│                                                               │
│  [ add another account ]                                      │
└───────────────────────────────────────────────────────────────┘
```

- Login in **mono**, capability in **sans** — so `can merge` / `read only`, never the raw `scopes`
  array, which is machine-speak at the wrong altitude
- Bound projects in mono beneath the login
- Sign-out moves from panel-level to row-level
- The empty state keeps today's pitch paragraph verbatim, including the `~/.ccwt` reassurance
- `signedIn` (`app/components/ForgePanel.vue:15`) stops being a boolean over one object

**The device-code block stays a single block below the list, not a pending row** — `start()` does not
know who is signing in (§3).

### Attribution per project

One line on the project page, not a badge on every card; repeating one fact per worktree is noise.

```
pull requests read as   isntw ▾
```

The picker is `Suggest.vue`, already a keyboard-navigable combobox over `string[]`. No new primitive.

The merge modal shows it too, because that is where attribution becomes permanent:

```
merging as   imonea-xvpn
[ squash and merge ]
```

`MergeModal.vue:31` currently reads `canMerge` off *the* session and must instead read the account
bound to that project.

### The ambiguous case is a diagnostic, not a modal

`app/pages/project/[id]/index.vue:76` already spreads `forge.issues` into the page, so step 3 of the
ladder needs no new machinery:

```
⚠  Two accounts can write to xvpn/kp_xv_portal.
   ccwt is using imonea-xvpn.   [ isntw ▾ ]  [ use this ]
```

### Two details that will be got wrong once

- **`Button` must be `md` beside the picker.** `.t-input` is `1.75rem`; `md` is `h-7` and matches,
  `sm` is `h-6` and sits 4px short. The panel uses `sm` throughout today because it has no input
  beside a button.
- **Do not extend `--ccwt-live` to a connected account.** A working credential resembles "a satisfied
  host requirement", but the palette permits one desaturated green and that judgement is not this
  feature's to make. Rows stay achromatic; `--ccwt-caution` for a read-only account, matching the
  existing "can read pull requests but not merge them" copy.

Both new shapes need a `/preview` entry.

---

## 7. Server surface

| Route | Change |
|---|---|
| `GET /forge/session` | Returns a list. `ForgeSession` gains an `id`; a `ForgeAccounts` wrapper carries the `configured` flag once rather than per account |
| `DELETE /forge/session` | Takes an account id. Currently carries no identifier at all |
| `POST /forge/login` | Unchanged |
| `POST /forge/poll` | Unchanged, including `forge.forgetAll()` on success |
| `PUT /projects/{id}/forge-account` | New. Sets or clears `forgeAccountId`, then `forge.forget(projectId)` |

**Signing out must clear every binding pointing at that account**, or projects hold dangling ids.
Clearing drops those projects back to detection on the next read.

---

## 8. Diagnostics

`Diagnostic.code` is machine-readable and stable, namespaced `thing.problem`.

| Code | Severity | When |
|---|---|---|
| `forge.account-ambiguous` | `warning` | Two accounts report `push` and none is stored |
| `forge.account-lost` | `warning` | The stored binding names an account that no longer exists |
| `forge.not-github` | `info` | The remote is not GitHub — today this is silence |

**`forge.signed-out` and `forge.unreachable` must stop being interchangeable.** `session()`
(`server/lib/forgeauth.ts:122`) returns `login: null` whenever `identify()` fails for *any* reason —
the 10s timeout, being offline, a 403 rate limit, a GitHub 5xx — and the panel reads that as "not
connected". So a transient failure presents as a revoked token and invites a pointless re-authorisation.
`remaining()` (`server/lib/forge.ts:141`) already has the correct copy for a real 401; `session()`
simply never reaches it.

This was tolerable with one account. With a list, one row silently reading as disconnected while the
others are fine is actively misleading, so `session()` must report `revoked` and `unreachable`
separately. Observed in practice: a token still on disk and correct, answering `401 Bad credentials`,
indistinguishable in the UI from GitHub being briefly unreachable.

---

## 9. Failure modes that must not happen

1. **A merge under the wrong identity.** The merge commit's attribution is not recoverable by
   re-binding afterwards. This is the reason attribution is visible in the merge modal rather than
   merely stored.
2. **A silent re-bind.** An account losing access must raise `forge.account-lost` and offer a
   re-detect, never quietly move to whichever other account happens to answer.
3. **A dangling binding.** Sign-out clears bindings (§7).
4. **Guessing at an ambiguity.** Step 3 asks. It does not pick the first match.

---

## 10. Build order

1. `forge.json` v2 with v1 migration; `credential()` and the memo take an account id. No behaviour
   change yet — one account in a list of one.
2. `session()` splits `revoked` from `unreachable` (§8). Independently useful.
3. `ProjectRecord.forgeAccountId`, the `PUT` route, and resolution steps 1–2. Detection persists.
4. Panel becomes a list; per-row sign-out; `add another account`.
5. Project attribution line and merge modal identity. Step 3 of the ladder as a diagnostic.
6. `repoOf()` fork fix (§5) and `forge.not-github` (§8).

Steps 1 and 2 are server-only and shippable on their own. The panel is the larger half of the work.

---

## 11. Decisions still open

| # | Question | Leaning |
|---|---|---|
| A1 | Does an unbound project probe every account, or only on first view? | Lazily on first read, persist the answer, never re-probe unless asked |
| A2 | May one project be read by one account and merged by another? | No — one binding. Two would double every explanation for a case that has not come up |
| A3 | Does the picker offer accounts that cannot see the repository? | Yes, but marked. Hiding them makes "why is my account missing" unanswerable |
| A4 | Does `xvpn` restrict OAuth apps or enforce SAML SSO? | Unknown. If so the default client id needs approval, or `CCWT_GITHUB_CLIENT_ID` and a self-registered app. The existing 403 copy already reads correctly |
| D3 | Carry `host` on the account record now, for GHES later? | No. Both accounts are on github.com; a second *forge* (Bitbucket) is the likelier next axis and needs far more than a host field |

---

## Verifying a claim in this document

```bash
grep -n "credential()" server/lib/forge.ts        # the three call sites that are the whole seam
grep -n "x-oauth-scopes\|SCOPE\|API =" server/lib/forgeauth.ts
python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.ccwt/forge.json'))).keys())"
```
