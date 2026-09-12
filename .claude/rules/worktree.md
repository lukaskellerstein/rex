---
description: "Reference: worktrees — which directory is yours to change, which branch is yours, and what a refused write means."
---

# Worktrees — where you work

This repository keeps its main checkout on `main` and never edits there. Every
change is made in a git worktree at `.worktrees/<name>`, on the branch called
`<name>`. The user starts you in one with `claude -w <name>`. That worktree is
your working directory for the whole session: Claude Code holds it, not the
conversation, so it survives compaction and resume.

The one exception is `claude --no-worktree`. The user starts that session in the
main checkout on purpose, and then the main checkout *is* your working directory
and you may edit it. The guard line at the start of the session says which of
the two you are in. Never assume it — read the line.

> [!important]
> This file is delivered verbatim to every repo on this machine. Do not reword it
> and do not extend it — anything true only of *this* repo belongs in `CLAUDE.md`.

## IF — where am I?

The line "Worktree guard: …" in your context answers it. It is sent at start and
again after each compaction, and it names the state. `pwd` and
`git branch --show-current` confirm it. Three states:

| The guard line says | What you may do |
|:--|:--|
| worktree `<repo>/.worktrees/<name>` | edit, run, test, commit on branch `<name>` — inside this directory only |
| MAIN checkout | read, search, answer. **No edits.** Say so, and ask the user to start `claude -w <name>` |
| no-worktree session in the MAIN checkout | edit, run, test, commit on `main` — but **never** in `.worktrees/*`, which belongs to other sessions |

## The rules

- **Never `cd` out of the checkout the guard line named, and never write another
  checkout's path in a command.** A Bash write outside it fails with `Operation
  not permitted`; an Edit/Write outside it is refused by a hook. A refusal is
  not a bug to route around — it names the copy of the file to edit instead.
- **One branch per checkout.** No `git checkout` / `git switch` to another
  branch, in a worktree or in a no-worktree session. Git refuses a branch that
  is checked out elsewhere, and `main` always is.
- **Another session may share your worktree.** Its edits arrive as changed
  files on disk, on the same branch. Re-read a file before you edit it.
- **You do not manage worktrees.** No `EnterWorktree`, no `git worktree add` or
  `remove`. If you think you need one, say why and let the user start it.
- **You never switch the session into or out of no-worktree mode.** It is set
  once, by how the user launched `claude`. If you are in the read-only main
  checkout and the work needs edits, say so and name both routes —
  `claude -w <name>` for a branch, `claude --no-worktree` to work on `main`.
  The choice is the user's.
- **Finishing** means the change is tested here (`06-testing.md`). Commit,
  push, or open a pull request only when the user asks — `05-implement.md`.
  Merging a branch into `main` is the user's job, in every state — a
  no-worktree session sits in the main checkout, and that is still not a
  licence to merge.
- **A fresh worktree has no gitignored files** — no `node_modules`, `.venv` or
  `.env`. Install what the project's setup needs, inside the worktree. Two
  worktrees that both start the dev server collide on the port from
  `01-project-config.md`; when it is busy, pick another and say which.
