# REX 57 — one version, one Release

**Version:** 1.0 · 2026-09-12
**Status:** **built on a branch, not yet run on GitHub.** The check, the gate
and their test exist and pass locally (§7, criteria 1–2). The first pull
request under this spec is its acceptance test. The ruleset that makes the
check *block* a merge is not created: §5 is a decision for the reviewer.
**Amends:** [`49-releases/SPEC.md`](../49-releases/SPEC.md) §2, §6 and §7 —
§4 lists every row.
**Depends on:** [`50-macos-completely/SPEC.md`](../50-macos-completely/SPEC.md)
(one installer, one runner).

## 1. What this is

Since spec 49, every push to `main` has been a Release tagged
`v<version>-<run>`, and `version` has never moved. There are five Releases on
GitHub today and every one of them is called 0.1.0 — including one whose only
change was a worktree script. The number a person sees says nothing about what
changed, and nothing makes anyone change it.

> The reviewer, 2026-09-12: *"on each PR that is going to `main` there should be
> some short small pipeline or script that will check if the version is the
> same. If it is the same, it should not allow merging the PR … When it's merged
> and the version is updated, it should trigger the pipeline that will
> automatically release the new version."*

So: **one version, one Release.** A pull request raises `version`. Merging it
publishes `v<version>`. Nothing else publishes anything.

## 2. What was decided, and why

| Decision | Choice | Why |
|:--|:--|:--|
| Who picks the number | a person, in the pull request, with `npm version patch\|minor\|major --no-git-tag-version` | The reviewer: *"for now it's okay if we change the version ourselves"*. `npm version` changes `package.json` and `package-lock.json` together, which a hand edit does not |
| Tag | `v<version>` — `v0.2.0` | One version is one Release. The old `v0.1.0-8` is, in semver, a *pre-release* of 0.1.0 — lower than 0.1.0 — so the old tags also sorted wrong |
| The gate | the tag. A run on `main` publishes only while `v<version>` does not exist on `origin` | The tag is the one fact git and GitHub agree on. A Release that failed made no tag, so the next run retries it with no one's help |
| Pull request check | `.github/workflows/version.yml`, job **`Version bump`**, which runs `node scripts/check-version.ts origin/main` | On `ubuntu-latest`, with no `npm ci`: seconds, not the five minutes a build takes |
| What the check requires | a version **higher** than `main`'s, a lock file that **agrees**, and a tag **not yet used** | Each is a way a merge could ship nothing, or ship under the wrong number |
| A push to `main` that does not raise `version` | the version job runs, and nothing builds | Nothing would be published, and a macOS build is five minutes of a runner |
| `workflow_dispatch` | always builds; publishes only on `main` with a new version | It is the manual retry of a failed Release, and the manual build of a branch |
| The check's language | TypeScript, run by Node 22's type stripping | `rules/10` makes TypeScript the default for scripts, and `test/version.spec.ts` imports its rules directly |
| The first version under it | **0.2.0** | 0.1.0 is already five Releases. Specs 51–56 shipped after the first of them. 0.2.0 sorts above every old tag, by semver and by date |

## 3. The rules

### 3.1 The pull request check

`scripts/check-version.ts <base-ref>` reads four facts and reports **every**
rule they break, not the first:

| # | Rule | The message when it breaks |
|:--|:--|:--|
| 1 | `version` is `MAJOR.MINOR.PATCH` | `package.json's version "0.2" is not MAJOR.MINOR.PATCH.` |
| 2 | `package-lock.json` has the same version | `package-lock.json says 0.1.0, package.json says 0.2.0. Set the version with npm version <x.y.z> --no-git-tag-version, which changes both.` |
| 3 | it is higher than `<base-ref>:package.json` | `package.json says 0.1.0, the same as main (0.1.0). Every merge to main is a Release, so raise the version in this pull request: npm version patch --no-git-tag-version (or minor, or major).` |
| 4 | no tag `v<version>` on `origin` | `v0.3.0 is already released. Raise the version past it.` |

Each problem is also printed as `::error title=Version not raised::…`, which
GitHub shows on the pull request beside the check, and written to the job
summary. Tags are read with `git ls-remote --tags origin`, so the answer is the
remote's and no `git fetch --tags` is needed.

The workflow checks out the merge commit with `fetch-depth: 0`. So a branch
that never touched `package.json`, cut before `main` moved to 0.3.0, is judged
at 0.3.0 against 0.3.0 — and fails, which is correct: it too would ship nothing.

### 3.2 The Release gate

`release.yml` gains a first job, **`Is this version released?`**:

| Event | Ref | `v<version>` exists | Build | Release |
|:--|:--|:--|:--|:--|
| `push` | `main` | no | yes | **`v<version>`** |
| `push` | `main` | yes | no | no |
| `workflow_dispatch` | `main` | no | yes | **`v<version>`** |
| `workflow_dispatch` | `main` | yes | yes, as an artifact | no |
| `workflow_dispatch` | any other branch | — | yes, as an artifact | no |

Measured 2026-09-12 against `origin`: `git ls-remote --exit-code --tags origin
refs/tags/v0.1.0-8` exits 0, `…/v0.2.0` exits 2, and `…/v0.1.0` exits 2. The
last one matters: a full ref name is matched whole, so an old `v0.1.0-8` can
never be mistaken for `v0.1.0`.

The Release is titled `REX <version>`. Its body is unchanged: the install guide
from `.github/release-notes.md`, then GitHub's list of merged pull requests.

### 3.3 How to release

1. On the branch, raise the version — `npm version minor --no-git-tag-version`
   for anything a person can see, `patch` for a fix only.
2. Commit `package.json` and `package-lock.json` with the change.
3. Open the pull request. `Version bump` turns green in about fifteen seconds.
4. Merge. The Release workflow builds the DMG (about five minutes) and publishes
   `v<version>`.

`1.0.0` is a decision of its own and not a step in this list.

## 4. Changes to earlier specs

| Where | Was | Now |
|:--|:--|:--|
| 49 §2, Trigger | every push to `main` publishes | a push to `main` publishes a version that has no tag yet |
| 49 §2, Pull requests | nothing runs | `Version bump` runs. Still no build |
| 49 §2, Tag | `v<version>-<run number>` | `v<version>` |
| 49 §6, What people get | "right-click → Open on macOS" | the `xattr` line — §6 below |
| 49 §7, A1 | a pull request runs nothing | a pull request runs `Version bump` and nothing else |
| 49 §7, A2 | tagged `v<version>-<run>` | tagged `v<version>` |
| 49 §7, A5 | a second merge of the same version creates a second Release | it creates nothing, and the check stops it before the merge |
| 49 §8, "A version bump on merge" | out of scope | still out of scope: a person raises the version, CI only checks it |

## 5. Making the check block a merge — the reviewer's decision

**A workflow cannot block a merge.** Only a ruleset on `main` that names
`Version bump` as a required status check can. Without one, the check is a red
mark that the merge button ignores.

The repository as measured on 2026-09-12: no branch protection and no rulesets;
auto-merge off; four of the last eight commits on `main` pushed directly rather
than merged; pull requests merged 4 seconds to 22 minutes after they were opened.

| Level | The ruleset | What changes for the reviewer |
|:--|:--|:--|
| A | none | The check is advice. An unraised merge still publishes nothing, because the gate holds either way |
| **B** — recommended | `Version bump` required; repository admins may bypass | A red pull request does not merge by button or by `gh pr merge` without an explicit bypass (`--admin`). A direct push to `main` still works for the reviewer, and publishes nothing unless it raises the version |
| C | as B, with no bypass | Every change to `main` is a pull request. The direct `[skip ci]` pushes end |

B keeps the reviewer's direct pushes and makes a *pull request* follow the rule,
which is what was asked for. Role 5 is the built-in *Admin* repository role.
The command that would create it — **not run**:

```bash
gh api -X POST repos/lukaskellerstein/rex/rulesets --input - <<'JSON'
{
  "name": "main: every merge raises the version",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }],
  "rules": [{
    "type": "required_status_checks",
    "parameters": {
      "strict_required_status_checks_policy": false,
      "required_status_checks": [{ "context": "Version bump" }]
    }
  }]
}
JSON
```

Two things follow from any level above A:

- **A merge waits for the check.** A pull request opened and merged in the same
  second is refused until `Version bump` finishes. `gh pr merge --squash --auto`
  waits by itself, but needs *Allow auto-merge* switched on in the repository's
  settings.
- **`[skip ci]` in a pull request's commits blocks it forever.** GitHub then
  never starts the check, and a required check that never starts never passes.
  `version.yml` says so at the top.

## 6. What people get — the install guide, corrected

Measured 2026-09-12 on `REX-0.1.0-arm64.dmg` from `v0.1.0-8`, mounted read-only:

| Fact | Result |
|:--|:--|
| `LSMinimumSystemVersion` | `12.0` |
| `codesign -dv` on `REX.app` | `Signature=adhoc`, `flags=0x20002(adhoc,linker-signed)`, `Sealed Resources=none` |
| `codesign --verify --deep --strict` | fails: `code has no resources but signature indicates they must be present` |
| `spctl -a -t exec` | rejected, same reason |

So the app carries only the linker's signature on its main binary, and the
bundle's signature is invalid. For a file a browser downloaded, macOS refuses
that on Apple silicon, and **right-click → Open does not get past it** — macOS
15 removed that path even for a valid unsigned app. The guide now says to clear
the quarantine flag once:

```bash
xattr -dr com.apple.quarantine /Applications/REX.app
```

What was **not** measured: the dialog itself. Launching a quarantined copy puts
a dialog on the reviewer's screen, so the words macOS uses were not clicked
through. The guide names both messages macOS is known to show.

## 7. Acceptance criteria

| # | Criterion | State |
|:--|:--|:--|
| 1 | `npm run test:version` passes — the four rules, the tag parsing, the repository's own two files, and both workflows | **passed**, 13 tests |
| 2 | On this branch, `node scripts/check-version.ts origin/main` fails at 0.1.0 with the `npm version` sentence and exits 1, and passes at 0.2.0 | **passed** |
| 3 | The first pull request under this spec shows `Version bump` green | pending — GitHub |
| 4 | Merging it publishes exactly one Release, `v0.2.0`, titled `REX 0.2.0`, carrying `REX-0.2.0-arm64.dmg` | pending — GitHub |
| 5 | The next push to `main` that does not raise the version runs only `Is this version released?` and publishes nothing | pending — GitHub |
| 6 | With level B, a pull request whose version was not raised does not merge without `--admin` | pending — §5 |

## 8. Out of scope

| What | Why not |
|:--|:--|
| Choosing the version from commit messages — semantic-release, release-please, changesets | The reviewer asked for a manual bump for now. Each is a dependency no spec names, and REX's commit messages are prose, not Conventional Commits |
| Building the DMG on the pull request | Spec 49 removed it because it doubled every build. A failed build on `main` makes no tag, so it costs a retry, not a wrong Release |
| Signing and notarisation | Still their own job, as spec 46 §13 and spec 49 §8 said |
| Ad-hoc signing the whole bundle | Probably turns "damaged" into an *Open Anyway* button with no Apple ID. Not measured, and a build change rather than a release rule |
| Deleting the old `v0.1.0-N` Releases | They are real downloads with real history, and nothing reads them |
| A `CHANGELOG.md` | `--generate-notes` already lists the merged pull requests in every Release |
