// SPEC.md §8.4 — the deny gate.
//
// `disallowedTools` is configuration, not a wall: Bash can write files through
// `python -c`, `tee`, `sh -c`, or a plain `>` redirect. "read cannot write" is
// a guarantee REX makes to the user about their own documents, so it is
// enforced at runtime, on every tool call, including calls made by subagents —
// the hook fires for those too and `agent_id` says which one made it.

import type { Profile } from "../../shared/types.ts";

const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

/**
 * Spec 12 §6.1 — the rule, and why the mechanism does not match its shape.
 *
 * **A command is refused when it can change something, and allowed when it
 * cannot.** That is a statement about commands, and the obvious mechanism for
 * it is a denylist. REX uses an allowlist anyway, because a denylist states the
 * rule without being able to keep it: to allow everything except known writers,
 * REX would have to know every program that writes. `xsltproc -o out.xml`,
 * `sqlite3 db "delete …"`, `make` and `install` all write, none is famous for
 * it, and each would ship as a hole. Under an allowlist "cannot write" is a
 * fact; under a denylist it is a hope.
 *
 * So the list is long, and it grows under a stated admission test:
 *
 * > **A binary joins only when there is a decidable test for "this invocation
 * > writes".** For `ls` the test is trivial. For `find` it is the action flags.
 * > For `git` it is the subcommand. A binary whose write ability cannot be
 * > recognised from its arguments does not join, however useful it is.
 *
 * That test is why `python`, `sh`, `node`, `xargs`, `env` and `make` are absent
 * and always will be, and it is also what found `rg --pre` (see `GUARDS`).
 *
 * Matched on the BINARY, never on a prefix of the command string. A prefix
 * match asks "does this look like git?", which is a different question from
 * "is this git, and is it reading?" — and the two came apart on the first real
 * transcript: `git -C /path/to/repo status` is the form an agent actually
 * writes, because its working directory is REX's and not the document's, and a
 * `/^git (log|status|…)/` pattern refuses every one of them.
 */
const READ_ONLY: ReadonlySet<string> = new Set([
  // Walking and naming a tree.
  "ls",
  "find",
  "stat",
  "file",
  "realpath",
  "basename",
  "dirname",
  "pwd",
  "tree",
  "du",
  "df",
  // §6.2 — the reported bug. `cd` changes the working directory of a shell
  // that exits when the call returns. There is no argument to it that puts a
  // byte on disk, and `cd X && grep …` is the form an agent writes when its own
  // working directory is REX's rather than the document's. `git -C` already
  // exists for exactly that reason; `cd` is the same problem for every other
  // binary here.
  "cd",
  // Searching.
  "rg",
  "grep",
  "egrep",
  "fgrep",
  // Reading, whole or in part.
  "cat",
  "head",
  "tail",
  "wc",
  "sed",
  "awk",
  "jq",
  "yq",
  "unzip",
  // Comparing and reshaping a stream. Every one of these writes to stdout and
  // nowhere else, except where `GUARDS` says otherwise.
  "diff",
  "comm",
  "sort",
  "uniq",
  "cut",
  "tr",
  "rev",
  "nl",
  "paste",
  "fold",
  "column",
  "expand",
  "seq",
  "base64",
  "od",
  "xxd",
  "strings",
  "shasum",
  "md5",
  "cksum",
  // Reporting on the machine. None of them takes an output path at all.
  "date",
  "uname",
  "whoami",
  "hostname",
  "id",
  // Neither writes anything without a redirect, and a redirect that writes
  // never survives `splitStages`. They earn their place by being how an agent
  // labels a run.
  "echo",
  "printf",
  "which",
  "type",
  "git",
  "gh",
  "nvim-tools",
]);

/**
 * git subcommands that only read, whatever they are given.
 *
 * `checkout`, `add`, `commit`, `merge` and the rest are absent because each
 * writes — to the index, to `.git/config`, or to the working tree.
 */
const GIT_READ_ONLY: ReadonlySet<string> = new Set([
  "log",
  "diff",
  "diff-tree",
  "show",
  "status",
  "blame",
  "ls-files",
  "ls-tree",
  "grep",
  "show-ref",
  "rev-parse",
  "rev-list",
  "cat-file",
  "describe",
  "shortlog",
  "for-each-ref",
  "reflog",
  "merge-base",
  "name-rev",
  "check-ignore",
  "count-objects",
  "help",
  "version",
]);

/**
 * Spec 12 §6.6 — subcommands that read or write depending on what follows.
 *
 * `git branch` lists; `git branch spike` creates one. `git config --get x`
 * reads; `git config x y` rewrites `.git/config`. The whole difference is in
 * the operands, so each of these carries a predicate over them rather than
 * sitting in the set above.
 *
 * The shared shape of the first four: **a positional operand means it is being
 * asked to make something**, so positionals are refused unless `-l`/`--list`
 * says they are patterns. That over-refuses `git branch --contains HEAD`, and
 * that is the accepted cost of a test that fits in one line and is obviously
 * right.
 */
/**
 * The write flags differ per subcommand, and one letter is why this is not one
 * shared regex: `git branch -a` lists ALL branches, while `git tag -a` writes
 * an ANNOTATED tag. A single set would either refuse the first or allow the
 * second, and the second creates an object in the repository.
 */
const BRANCH_WRITES =
  /^(-[dDmMcCfu]$|--(delete|move|copy|force|edit-description|set-upstream|unset-upstream|set-upstream-to))/;
const TAG_WRITES = /^(-[adsmfF]$|--(annotate|sign|delete|force|file|local-user))/;

/** True when this invocation only lists. See `GIT_GUARDED`. */
function listsOnly(writes: RegExp): (operands: string[]) => boolean {
  return (operands) => {
    if (operands.some((word) => writes.test(word))) return false;
    // `-l 'v*'` makes the positional a PATTERN. Without one, a positional is
    // the name of the thing git is being asked to create.
    const listing = operands.some((word) => word === "-l" || word === "--list");
    return listing || operands.every((word) => word.startsWith("-"));
  };
}

const GIT_GUARDED: Record<string, (operands: string[]) => boolean> = {
  branch: listsOnly(BRANCH_WRITES),
  tag: listsOnly(TAG_WRITES),
  stash: (operands) => operands[0] === "list" || operands[0] === "show",
  worktree: (operands) => operands[0] === "list",
  submodule: (operands) => operands[0] === "status",
  remote: (operands) =>
    operands.length === 0 ||
    operands[0] === "-v" ||
    operands[0] === "--verbose" ||
    operands[0] === "show",
  // `git config x y` writes `.git/config`, and `--global` writes the user's
  // own. Only the four reading forms are allowed, and they are named rather
  // than inferred.
  config: (operands) =>
    operands.some(
      (word) =>
        word === "--get" ||
        word === "--get-all" ||
        word === "--get-regexp" ||
        word === "--list" ||
        word === "-l",
    ),
};

/**
 * git's own options, before the subcommand. `-C` is the one that matters —
 * it is how an agent points git at the document's repository.
 *
 * `-c` and `--exec-path` are NOT here, and their absence is the point: `git -c
 * alias.status='!rm -rf x' status` passes a subcommand check that only reads
 * the word `status`, and `--exec-path` re-points git at another set of
 * binaries entirely. Both are refused with everything else that is not listed.
 */
const GIT_GLOBAL_WITH_VALUE: ReadonlySet<string> = new Set([
  "-C",
  "--git-dir",
  "--work-tree",
  "--namespace",
]);
const GIT_GLOBAL_FLAGS: ReadonlySet<string> = new Set([
  "--no-pager",
  "--bare",
  "--no-replace-objects",
  "--literal-pathspecs",
  "--paginate",
  "-P",
]);

/**
 * Spec 12 §6.8 — `gh`, where the unit is the COMMAND PAIR.
 *
 * Measured on 2026-08-25, thread `e2c37e06`: the reviewer asked which agents a
 * document's system supports, the agent went for the pull request that
 * introduced them, and `gh pr view 1 --json …` was refused with "REX cannot
 * tell whether 'gh' writes". It cannot tell about `gh` as a whole, and it does
 * not have to: `gh` is `git`'s problem one level down. `gh pr view` reads and
 * `gh pr merge` merges, so §6.1's admission test is met by the pair and by
 * nothing shorter.
 *
 * The pair is the whole test, which makes the DEFAULT a refusal — every
 * command that creates, edits, closes, merges, deletes, clones, checks out or
 * downloads is absent by never being listed, rather than by being recognised.
 *
 * Aliases cannot reach through this, and that is worth stating because `gh`
 * lets a user define them: `gh alias set --shell` runs its expansion through
 * `sh`. `gh` expands an alias only when the arguments do NOT resolve to a real
 * command, and every pair below is a real command — so `gh pr view` is always
 * gh's own, whatever the user's config holds.
 */
const GH_READ_ONLY: ReadonlySet<string> = new Set([
  "pr view",
  "pr list",
  "pr diff",
  "pr checks",
  "pr status",
  "issue view",
  "issue list",
  "issue status",
  "repo view",
  "repo list",
  "release view",
  "release list",
  "run view",
  "run list",
  "workflow view",
  "workflow list",
  "label list",
  "search code",
  "search commits",
  "search issues",
  "search prs",
  "search repos",
]);

/** The two `gh` commands that take no subcommand. `api` carries its own guard. */
const GH_BARE: ReadonlySet<string> = new Set(["status", "api"]);

/**
 * Neither of these writes, and both are refused for the reason `tail -f` is:
 * the run would wait. `--web` waits on a browser a headless session cannot
 * show; `--watch` waits on a CI run that has not finished.
 */
function ghWaits(words: string[]): string | null {
  for (const word of words) {
    if (word === "--web" || bundles(word, "w")) {
      return "gh --web opens a browser, which a headless run cannot show you. Without it the same is printed here";
    }
    if (word === "--watch") {
      return "gh --watch waits until the run finishes, and the session waits with it. Without it you get the state now";
    }
  }
  return null;
}

/**
 * `gh api` is the escape hatch for everything the pairs do not cover, and it is
 * a writer as readily as a reader: `-X DELETE` deletes, and a single `-f`
 * silently turns the request into a POST. Both are refused, which leaves the
 * form that is a plain GET — `gh api repos/owner/name/pulls/1`.
 *
 * A GraphQL query needs `-f query=…`, so GraphQL is refused with them. The REST
 * path answers the same questions here, and a refusal that over-refuses is the
 * accepted cost everywhere else in this file.
 */
function ghApiDenial(words: string[]): string | null {
  for (const word of words) {
    if (bundles(word, "X") || /^--method(=|$)/.test(word)) {
      return "gh api -X sends a request that can change the repository, and REX cannot tell one method from another. Without it, gh api is a GET";
    }
    if (bundles(word, "f") || bundles(word, "F") || /^--(field|raw-field|input)(=|$)/.test(word)) {
      return "gh api -f, -F and --input send a body, which makes the request a write. Ask for it in the path instead";
    }
  }
  return null;
}

/** The gh half. See `GH_READ_ONLY` for why the pair is the unit. */
function ghDenial(words: string[]): string | null {
  const waits = ghWaits(words);
  if (waits) return waits;

  // Flags are dropped rather than parsed: gh's command path is the first one or
  // two operands, and a flag's value can only follow the path, never precede it.
  const path = words.slice(1).filter((word) => !word.startsWith("-"));
  const command = path[0];
  // Bare `gh`, `gh --help` and `gh --version` print help and nothing else.
  if (!command) return null;

  if (command === "api") return ghApiDenial(words);
  if (GH_BARE.has(command)) return null;

  const pair = path[1] ? `${command} ${path[1]}` : command;
  return GH_READ_ONLY.has(pair)
    ? null
    : `gh ${pair} is not one of gh's reading commands, and several of them change the repository or GitHub itself. gh pr view, gh issue list, gh repo view, gh run view and gh api read`;
}

/**
 * `find` is the one binary on the list that can be told to stop walking and
 * start acting. Each of these makes it run a command or delete what it found,
 * so a `find` carrying one is not a search however it began.
 */
const FIND_ACTIONS = /^-(exec|execdir|ok|okdir|delete|fls|fprint|fprintf|fprint0)$/;

/** `git grep -O` hands each hit to a pager, which is an arbitrary program. */
const RUNS_A_PAGER = /^(-O|--open-files-in-pager)(=|$)/;

/** A letter inside a bundle of short flags: `-o`, and also `-nro`. */
function bundles(word: string, letter: string): boolean {
  return !word.startsWith("--") && new RegExp(`^-[a-zA-Z]*${letter}`).test(word);
}

const UNIQ_VALUE_FLAGS = new Set([
  "-f",
  "-s",
  "-w",
  "--skip-fields",
  "--skip-chars",
  "--check-chars",
]);

/** What `uniq` was actually given, with the values of its flags removed. */
function uniqOperands(words: string[]): string[] {
  const operands: string[] = [];
  for (let at = 1; at < words.length; at++) {
    const word = words[at] as string;
    if (UNIQ_VALUE_FLAGS.has(word)) {
      at += 1;
      continue;
    }
    if (word.startsWith("-") && word.length > 1) continue;
    operands.push(word);
  }
  return operands;
}

/**
 * Spec 12 §6.4 — `sed` writes through `-i`, and through a `w` command buried in
 * a script. The second cannot be recognised exactly without parsing sed, so it
 * is recognised conservatively and the over-refusal is accepted: `sed -n '/
 * warning/p'` matches `W_COMMAND` because the `w` follows a space.
 *
 * The fallback is `grep`, which is on the list, and §3.6's refusal says so.
 */
const SED_IN_PLACE = /^(-i|--in-place)/;
const W_COMMAND = /(^|[;{}\s])[wW]/;
const S_FLAG_W = /s(.)(?:[^\\]|\\.)*?\1(?:[^\\]|\\.)*?\1[a-zA-Z]*w/;

/**
 * The program text a stream tool was given, and nothing else.
 *
 * This separation is load-bearing rather than tidy. `W_COMMAND` matches a `w`
 * at the start of a word, so checking every operand would refuse
 * `sed 's/a/b/' words.txt` — the FILE would be read as a script that writes.
 * A sed or awk program is the first operand that is not a flag, plus whatever
 * follows each `-e`; everything after it is a filename and is not a program.
 */
function programsOf(
  words: string[],
  valueFlags: ReadonlySet<string>,
  scriptFlags: ReadonlySet<string>,
): string[] {
  const programs: string[] = [];
  let found = false;

  for (let at = 1; at < words.length; at++) {
    const word = words[at] as string;
    if (scriptFlags.has(word)) {
      const script = words[at + 1];
      if (script !== undefined) programs.push(script);
      at += 1;
      found = true;
      continue;
    }
    if (valueFlags.has(word)) {
      at += 1;
      continue;
    }
    if (word.startsWith("-") && word.length > 1) continue;
    if (!found) {
      programs.push(word);
      found = true;
    }
  }
  return programs;
}

const SED_SCRIPT_FLAGS = new Set(["-e", "--expression"]);
const SED_VALUE_FLAGS = new Set(["-l", "--line-length"]);
const AWK_SCRIPT_FLAGS = new Set<string>();
const AWK_VALUE_FLAGS = new Set(["-v", "--assign", "-F", "--field-separator"]);

/**
 * §3.4 — `awk`'s write ability lives inside the program text, and `>` inside
 * `awk '{print > "f"}'` **survives `splitStages`**, because that function tracks
 * quotes rather than ignoring them. `awk` on the list without this guard would
 * be a plain write hole, not a theoretical one.
 *
 * `getline` and `system` reach outside the stream in the other direction, and
 * `|` does both. Only words that are not flags are examined, so `awk -F'|'`
 * survives; `awk -F '|'` does not, and that is the same accepted cost as `sed`.
 */
const AWK_ESCAPES = /[>|]|system|close|getline|ENVIRON/;

/** Every guard for a binary whose read-only-ness depends on its arguments. */
const GUARDS: Record<string, (words: string[]) => string | null> = {
  gh: ghDenial,

  find: (words) =>
    words.some((word) => FIND_ACTIONS.test(word))
      ? "find may walk a tree in a read session but not act on what it finds"
      : null,

  "nvim-tools": (words) =>
    words.some((word) => /^--(fix|fix-all)(=|$)/.test(word))
      ? "nvim-tools may report in a read session but not fix — a fix rewrites files"
      : null,

  sort: (words) =>
    words.some((word) => bundles(word, "o") || word.startsWith("--output"))
      ? "sort -o writes the result to a file. Drop it and the result is returned to you"
      : null,

  tree: (words) =>
    words.some((word) => bundles(word, "o") || word.startsWith("--output"))
      ? "tree -o writes the listing to a file. Drop it and the listing is returned to you"
      : null,

  uniq: (words) =>
    uniqOperands(words).length > 1
      ? "uniq takes a second file as its OUTPUT and would write it. Pass one file, or pipe into it"
      : null,

  yq: (words) =>
    words.some((word) => word === "-i" || word.startsWith("--inplace"))
      ? "yq -i rewrites the file it read. Drop it and the result is returned to you"
      : null,

  unzip: (words) => {
    if (words.some((word) => bundles(word, "d"))) {
      return "unzip -d extracts into a directory. A read session may look inside an archive but not unpack it";
    }
    return words.slice(1).some((word) => /^-[a-zA-Z]*[lpvt]/.test(word))
      ? null
      : "unzip without -l, -p, -v or -t extracts the archive. Use -l to list it or -p to read one member";
  },

  // Not a write, and refused anyway: it never returns, and the session waits.
  tail: (words) =>
    words.some((word) => word === "--follow" || bundles(word, "f"))
      ? "tail -f never returns, and the run would wait for it forever"
      : null,

  rg: (words) =>
    words.some((word) => /^--(pre|pre-glob|hostname-bin)(=|$)/.test(word))
      ? "rg --pre hands every file to a program of your choosing, and REX cannot see what that program does"
      : null,

  sed: (words) => {
    if (words.some((word) => SED_IN_PLACE.test(word))) {
      return "sed -i rewrites the file. Drop -i and the same script prints instead";
    }
    if (words.some((word) => word === "-f" || word === "--file")) {
      return "sed -f reads its script from a file REX has not seen. Pass the script on the command line";
    }
    const scripts = programsOf(words, SED_VALUE_FLAGS, SED_SCRIPT_FLAGS);
    return scripts.some((word) => W_COMMAND.test(word) || S_FLAG_W.test(word))
      ? "a sed script with a w command writes a file. If it does not, use grep — the check is deliberately cautious"
      : null;
  },

  awk: (words) => {
    if (words.some((word) => word === "-f" || word === "--file")) {
      return "awk -f reads its program from a file REX has not seen. Pass the program on the command line";
    }
    const program = programsOf(words, AWK_VALUE_FLAGS, AWK_SCRIPT_FLAGS);
    return program.some((word) => AWK_ESCAPES.test(word))
      ? "an awk program using > | system getline or close reaches outside the stream. Keep it to fields and print"
      : null;
  },
};

/** Enough of a command to recognise it in a refusal, and no more. */
function clip(command: string): string {
  return command.length > 60 ? `${command.slice(0, 60)}…` : command;
}

/** The only redirect target that is not a file. */
const DISCARD = "/dev/null";

/**
 * Spec 12 §6.5 — a redirect that puts nothing on disk.
 *
 * Measured on 2026-08-25, thread `e2c37e06`: `wc -l docs/*.md 2>/dev/null; …`
 * was refused. `wc` is allowed, `;` is a separator the gate already splits on,
 * and the glob is a word like any other — the one construct that stopped the
 * command is the construct that exists to throw output away.
 *
 * Returns the index just past the redirect, or -1 when it is a real one. Two
 * families are recognised and no others:
 *
 *   `2>&1`, `1>&2`, `>&2`   — joins two streams that both go to the caller
 *   `>/dev/null`, `&>/dev/null`, `2>>/dev/null` — discards output
 *
 * `/dev/null` is matched as a COMPLETE word. `>/dev/null.txt` is a file.
 */
function readRedirect(command: string, start: number): number {
  let at = start;
  if (command[at] === "&") at += 1;
  if (command[at] !== ">") return -1;
  at += 1;
  if (command[at] === ">") at += 1;

  if (command[at] === "&") {
    at += 1;
    return command[at] === "1" || command[at] === "2" ? at + 1 : -1;
  }

  while (command[at] === " " || command[at] === "\t") at += 1;
  if (!command.startsWith(DISCARD, at)) return -1;

  const after = command[at + DISCARD.length];
  const ends = after === undefined || " \t\n;|&".includes(after);
  return ends ? at + DISCARD.length : -1;
}

/**
 * One command in a compound command, as its words with quoting resolved.
 *
 * The whole string is split into these, and EVERY stage is then checked in its
 * own right. That is the load-bearing idea in this file: the danger was never
 * the operator, it was reaching a binary that writes or a redirect that does.
 * `ls -la && echo "---" && git status` is three read-only commands and is
 * allowed; `rg foo src | tee hits.txt` is refused at `tee`, and `cat a; rm -rf
 * b` at `rm`, exactly as before.
 *
 * Returns null when the command carries something that cannot be reasoned
 * about at all. Measured: without a check on composition, a read-profile agent
 * asked to run `git status --porcelain > /tmp/out.txt` is approved by the gate.
 *
 * Quotes are tracked rather than ignored, and that matters twice over: `rg -n
 * "retry|backoff"` is an alternation and not a pipeline — the old blind regex
 * over the raw string refused it, so the gate fired on a plain search and
 * taught the reviewer nothing — and `rg "a > b" docs` is a search for a string
 * containing a `>` rather than a redirect.
 */
function splitStages(command: string): string[][] | null {
  const stages: string[][] = [];
  let words: string[] = [];
  let word = "";
  let quoted = false;
  let quote: "'" | '"' | null = null;

  const endWord = (): void => {
    if (word.length > 0 || quoted) words.push(word);
    word = "";
    quoted = false;
  };
  const endStage = (): void => {
    endWord();
    stages.push(words);
    words = [];
  };

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (quote) {
      // Inside single quotes the shell escapes nothing, not even a backslash,
      // and expands nothing either — so single-quoted text is inert and is
      // taken literally here too.
      if (quote === "'") {
        if (char === "'") quote = null;
        else word += char;
        continue;
      }

      if (char === "\\") {
        word += command[++i] ?? "";
        continue;
      }
      // DOUBLE quotes are not inert. `"$(rm -rf x)"` and "`rm -rf x`" both run
      // a command, so the two substitution forms are refused inside them
      // exactly as they are outside. Measured: without this, `cat
      // "$(whoami).txt"` reads as the single word `cat` plus a literal and is
      // approved. `$?`, `$HOME` and `${x}` expand without running anything and
      // are left alone.
      if (char === "`") return null;
      if (char === "$" && command[i + 1] === "(") return null;
      if (char === '"') quote = null;
      else word += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      quoted = true;
      continue;
    }
    if (char === "\\") {
      word += command[++i] ?? "";
      continue;
    }
    if (char === " " || char === "\t" || char === "\n") {
      endWord();
      continue;
    }

    // Redirection, command substitution and process substitution put bytes on
    // disk or run something unreviewed, and no stage check can see past them —
    // except for the two forms in `readRedirect`, which put bytes nowhere.
    if (char === ">") {
      // A file descriptor is glued to the `>`, so it is sitting in `word`
      // rather than beside it: `2>/dev/null` reaches here with `word === "2"`.
      if (word !== "" && word !== "1" && word !== "2") return null;
      const after = readRedirect(command, i);
      if (after < 0) return null;
      // Consumed, not emitted. A redirect is not an argument, and `uniq`'s
      // guard counts arguments — a `2>/dev/null` left in the list would read
      // as an output file and deny the command for the opposite reason.
      word = "";
      quoted = false;
      i = after - 1;
      continue;
    }
    if (char === "&" && command[i + 1] === ">") {
      if (word !== "") return null;
      const after = readRedirect(command, i);
      if (after < 0) return null;
      i = after - 1;
      continue;
    }
    if (char === "<" || char === "`") return null;
    if (char === "$" && command[i + 1] === "(") return null;

    if (char === ";") {
      endStage();
      continue;
    }
    if (char === "|" || char === "&") {
      // `&&` and `||` are separators like `;` and `|`. A LONE `&` is not: it
      // backgrounds the command, which outlives the session the gate is
      // reasoning about.
      if (command[i + 1] === char) i++;
      else if (char === "&") return null;
      endStage();
      continue;
    }

    word += char;
  }

  // Unbalanced quotes cannot be reasoned about, so they are not approved.
  if (quote) return null;
  endStage();
  return stages;
}

/**
 * Spec 12 §6.7 — a refusal about the command, not about REX's list.
 *
 * *"'cd' is not on the allowlist"* is a sentence about REX's book-keeping. The
 * agent cannot act on it, and the reviewer reading it in the trace learns
 * nothing about their own document. Each sentence below says what the binary
 * would DO, and where the same answer can be had without it.
 *
 * The default is the honest one, and it is what the old gate should have said
 * all along: a refusal here is REX admitting it cannot tell, not REX calling
 * the command dangerous.
 */
const INTERPRETER =
  "can write any file, so a read session does not run an interpreter. Use grep, rg or jq";
const RUNS_ANOTHER = "exists to run another command, and REX cannot see what that command would be";
const BUILDS =
  "writes files as a matter of course. Only Apply changes anything, and it shows a diff first";

const WHY_REFUSED: Record<string, string> = {
  tee: "tee writes a file. Read the output instead — it is returned to you",
  dd: "dd writes blocks to a file or a device",
  truncate: "truncate changes a file's size in place",
  rm: "rm deletes files. Only Apply changes anything, and it shows a diff first",
  rmdir: "rmdir deletes a directory",
  unlink: "unlink deletes a file",
  mv: "mv moves a file, which changes the document tree under review",
  cp: "cp creates a file",
  ln: "ln creates a link",
  mkdir: "mkdir creates a directory",
  touch: "touch creates a file, or changes one's timestamp",
  chmod: "chmod changes a file's permissions",
  chown: "chown changes a file's owner",
  python: `python ${INTERPRETER}`,
  python3: `python3 ${INTERPRETER}`,
  node: `node ${INTERPRETER}`,
  ruby: `ruby ${INTERPRETER}`,
  perl: `perl ${INTERPRETER}`,
  sh: `sh ${INTERPRETER}`,
  bash: `bash ${INTERPRETER}`,
  zsh: `zsh ${INTERPRETER}`,
  osascript: `osascript ${INTERPRETER}`,
  xargs: `xargs ${RUNS_ANOTHER}`,
  env: `env ${RUNS_ANOTHER}`,
  parallel: `parallel ${RUNS_ANOTHER}`,
  nohup: `nohup ${RUNS_ANOTHER}, and it outlives the run`,
  open: "open launches an application, which a headless run cannot show you",
  curl: "curl -o writes and -d sends. Use WebFetch, which fetches a page without either",
  wget: "wget writes what it downloads. Use WebFetch instead",
  make: `make ${BUILDS}`,
  npm: `npm ${BUILDS}`,
  npx: `npx ${RUNS_ANOTHER}`,
  pip: `pip ${BUILDS}`,
  cargo: `cargo ${BUILDS}`,
  sqlite3: "sqlite3 can run an UPDATE or a DELETE, and REX cannot tell one query from another",
  less: "less waits for a keypress, and the run would wait with it. Use head or sed -n",
  more: "more waits for a keypress. Use head or sed -n",
  vi: "vi is an editor and waits for a keypress",
  vim: "vim is an editor and waits for a keypress",
  nano: "nano is an editor and waits for a keypress",
};

function refuseBinary(binary: string): string {
  return (
    WHY_REFUSED[binary] ??
    `REX cannot tell whether '${binary}' writes, so a read session does not run it. If it only reads, say so in your answer and it can be added to the allowlist`
  );
}

/**
 * Why this one command may not run, or null when it may.
 *
 * `git` is the only binary here with an inner vocabulary, and it needs one:
 * `-C <repo>` is how an agent reaches the document's repository from REX's own
 * working directory, so the subcommand is not the first word and cannot be
 * found by looking there.
 */
function stageDenial(words: string[]): string | null {
  const binary = words[0];
  if (!binary) return "an empty command";
  if (!READ_ONLY.has(binary)) return refuseBinary(binary);

  if (binary === "git") return gitDenial(words);

  const guard = GUARDS[binary];
  return guard ? guard(words) : null;
}

/** The git half, which is the only binary here with an inner vocabulary. */
function gitDenial(words: string[]): string | null {
  let at = 1;
  while (at < words.length) {
    const option = words[at];
    if (!option?.startsWith("-")) break;
    if (GIT_GLOBAL_FLAGS.has(option)) at += 1;
    else if (GIT_GLOBAL_WITH_VALUE.has(option)) at += 2;
    else if ([...GIT_GLOBAL_WITH_VALUE].some((name) => option.startsWith(`${name}=`))) at += 1;
    else return `git ${option} is not allowed in a read session`;
  }

  const subcommand = words[at];
  if (!subcommand) return "git needs a subcommand in a read session";

  if (words.some((word) => RUNS_A_PAGER.test(word))) {
    return "git may not open files in a pager here — a pager is an arbitrary program";
  }

  if (GIT_READ_ONLY.has(subcommand)) return null;

  const guard = GIT_GUARDED[subcommand];
  if (!guard) return `git ${subcommand} can write`;
  return guard(words.slice(at + 1))
    ? null
    : `git ${subcommand} only reads when it is listing. With an operand it creates or changes something`;
}

/**
 * MCP tools are deny-by-default with an allowlist, so an MCP server added
 * later must be allowed explicitly rather than silently gaining access.
 */
const MCP_ALLOW = new Set<string>();

/**
 * Spec 11 §6.4.4 — the same rule for the **write** profile, which had none.
 *
 * That sentence above was true of `read` and false of `write`: `buildHooks`
 * returned allow for every tool, because spec 01 §8.7 step 5 — show the diff
 * and wait — was the whole protection. Loading a plugin changed what that is
 * worth. `media-plugin` declares five MCP servers, and three of them are things
 * a deck agent must not silently reach: one opens a GUI editor in a headless
 * session, one spawns a second browser, and one **sends slide content to a
 * third party over the network**. REX draws Mermaid itself, locally (§7.4.2),
 * so that last one is redundant as well as leaky.
 *
 * Empty by default. §6.4.3 adds exactly two entries when `GEMINI_API_KEY` is
 * set, and never a server — an allowlist naming two tools is a much smaller
 * thing to reason about than one naming a server.
 *
 * Every tool that is not MCP stays allowed for `write`, so nothing about Apply
 * changes.
 */
const WRITE_MCP_ALLOW = new Set<string>();

/** §6.4.3 — the two generation tools, allowed only when the key is present. */
export const GENERATION_TOOLS = [
  "mcp__media-mcp__generate_image",
  "mcp__media-mcp__generate_video",
] as const;

/**
 * §6.4.3 — REX stays self-contained, so a missing key means the feature is
 * **absent**, never half-working. Called once at start-up.
 */
export function allowGenerationTools(): void {
  for (const tool of GENERATION_TOOLS) WRITE_MCP_ALLOW.add(tool);
}

/** Whether an MCP tool may run in this profile. Exported so it can be tested. */
export function mcpAllowed(profile: Profile, toolName: string): boolean {
  return (profile === "write" ? WRITE_MCP_ALLOW : MCP_ALLOW).has(toolName);
}

export interface Denial {
  toolName: string;
  reason: string;
  /** Set when a subagent, rather than the main thread, made the call. */
  subagentId?: string;
}

/** The decision itself, separated from the SDK so it can be reasoned about. */
export function gateDecision(toolName: string, toolInput: unknown): string | null {
  if (WRITE_TOOLS.has(toolName)) {
    return `${toolName} cannot be used in a read session. Answer the comment; Apply is what changes files.`;
  }

  if (toolName === "Bash") {
    const command = String((toolInput as { command?: unknown })?.command ?? "").trim();
    const stages = splitStages(command);
    if (!stages) {
      return `A read session cannot change any file, so Bash may not redirect, background or substitute — '${clip(command)}' could write a file whatever it starts with. '2>/dev/null' and '2>&1' are allowed, because neither puts anything on disk.`;
    }

    for (const words of stages) {
      const denial = stageDenial(words);
      if (denial) {
        return `A read session cannot change any file: ${denial} ('${clip(words.join(" "))}').`;
      }
    }
    return null;
  }

  if (toolName.startsWith("mcp__") && !mcpAllowed("read", toolName)) {
    return `MCP tools are deny-by-default in a read session; ${toolName} is not on the allowlist.`;
  }

  return null;
}

/**
 * Spec 11 §6.4.4 — the write profile's decision, which is only about MCP.
 *
 * Everything else a write agent does is protected by §8.7 step 5: the change is
 * shown and nothing is kept until the reviewer accepts. An MCP server is not,
 * because starting one has already happened by the time anything is shown.
 */
export function writeGateDecision(toolName: string): string | null {
  if (toolName.startsWith("mcp__") && !mcpAllowed("write", toolName)) {
    return `MCP tools are deny-by-default here too; ${toolName} is not on the allowlist. REX draws diagrams itself and does not send document content to a third party.`;
  }
  return null;
}

// Spec 42 §8 — `buildHooks()` used to live here, and it has left.
//
// A `PreToolUse` hook is how *Claude* asks a policy, so it is SDK shape, and SDK
// shape now lives in the agent library. What stayed is every line above: the
// decisions themselves, in REX's own words, asked over the pipe before each tool
// call and answered by `bridge.ts`'s `policyFor`. `test/gate.spec.ts` is
// untouched, which is the point — the gate did not move, only its wrapper did.
//
// One rule of the old wrapper is worth keeping in view because the adapter now
// carries it: the `write` profile still returns an explicit ALLOW for every tool
// that is not MCP. Without one the SDK's default permission mode prompts for
// approval on every edit and a headless session has nobody to prompt — measured,
// the write agent's edit came back "Claude requested permissions to write to …"
// and Apply produced an empty diff.
