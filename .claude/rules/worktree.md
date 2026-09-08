---
description: "Reference: worktrees — which directory is yours to change, which branch is yours, and what a refused write means."
---

# Worktrees — where you work

This repository keeps its main checkout on `main` and never edits there. Every
change is made in a git worktree at `.worktrees/<name>`, on the branch called
`<name>`. The user starts you in one with `claude -w <name>`. That worktree is
your working directory for the whole session: Claude Code holds it, not the
conversation, so it survives compaction and resume.

> [!important]
> This file is delivered verbatim to every repo on this machine. Do not reword it
> and do not extend it — anything true only of *this* repo belongs in `CLAUDE.md`.

## IF — where am I?

`pwd` and `git branch --show-current` answer it. So does the line
"Worktree guard: …" in your context — it is sent at start and again after each
compaction. Two states:

| Your cwd | What you may do |
|:--|:--|
| `<repo>/.worktrees/<name>` | edit, run, test, commit on branch `<name>` — inside this directory only |
| the main checkout | read, search, answer. **No edits.** Say so, and ask the user to start `claude -w <name>` |

## The rules

- **Never `cd` out of your worktree, and never write the main checkout's path in
  a command.** A Bash write outside the worktree fails with `Operation not
  permitted`; an Edit/Write outside it is refused by a hook. A refusal is not a
  bug to route around — it names the copy of the file to edit instead.
- **One branch per worktree.** No `git checkout` / `git switch` to another
  branch. Git refuses a branch that is checked out elsewhere, and `main` always
  is.
- **Another session may share your worktree.** Its edits arrive as changed
  files on disk, on the same branch. Re-read a file before you edit it.
- **You do not manage worktrees.** No `EnterWorktree`, no `git worktree add` or
  `remove`. If you think you need one, say why and let the user start it.
- **Finishing** means the change is tested here (`06-testing.md`). Commit,
  push, or open a pull request only when the user asks — `05-implement.md`.
  Merging into `main` is the user's job, in the main checkout.
- **A fresh worktree has no gitignored files** — no `node_modules`, `.venv` or
  `.env`. Install what the project's setup needs, inside the worktree. Two
  worktrees that both start the dev server collide on the port from
  `01-project-config.md`; when it is busy, pick another and say which.
