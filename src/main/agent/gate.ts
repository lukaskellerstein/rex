// SPEC.md §8.4 — the deny gate.
//
// `disallowedTools` is configuration, not a wall: Bash can write files through
// `python -c`, `tee`, `sh -c`, or a plain `>` redirect. "read cannot write" is
// a guarantee REX makes to the user about their own documents, so it is
// enforced at runtime, on every tool call, including calls made by subagents —
// the hook fires for those too and `agent_id` says which one made it.

import type {
  HookCallbackMatcher,
  HookJSONOutput,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import type { Profile } from "../../shared/types.ts";

const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

/**
 * The read-only inspection an answer actually needs.
 *
 * Kept deliberately mundane: searching a tree, listing it, and reading part of
 * a file is what "check this claim against the repository" reduces to, and an
 * agent that cannot do it answers from the prose alone and says so — which is
 * a worse failure than the one the allowlist is guarding against, because it
 * is invisible.
 *
 * Matched on the BINARY, never on a prefix of the command string. A prefix
 * match asks "does this look like git?", which is a different question from
 * "is this git, and is it reading?" — and the two came apart on the first real
 * transcript: `git -C /path/to/repo status` is the form an agent actually
 * writes, because its working directory is REX's and not the document's, and a
 * `/^git (log|status|…)/` pattern refuses every one of them.
 *
 * Absent on purpose: `sort` (`-o FILE` writes), `uniq` (a second positional is
 * an output file), `tree` (`-o FILE`), `tee`, `xargs`, and every interpreter.
 */
const READ_ONLY: ReadonlySet<string> = new Set([
  "ls",
  "find",
  "stat",
  "file",
  "realpath",
  "basename",
  "dirname",
  "pwd",
  "rg",
  "grep",
  "egrep",
  "fgrep",
  "cat",
  "head",
  "tail",
  "wc",
  // Neither writes anything without a redirect, and redirects never survive
  // `splitStages`. They earn their place by being how an agent labels a run.
  "echo",
  "printf",
  "which",
  "type",
  "git",
  "nvim-tools",
]);

/**
 * git subcommands that only read.
 *
 * `config`, `branch`, `tag`, `remote`, `checkout`, `add` and the rest are
 * absent because each writes — to the index, to `.git/config`, or to the
 * working tree.
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
]);

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
 * `find` is the one binary on the list that can be told to stop walking and
 * start acting. Each of these makes it run a command or delete what it found,
 * so a `find` carrying one is not a search however it began.
 */
const FIND_ACTIONS = /^-(exec|execdir|ok|okdir|delete|fls|fprint|fprintf|fprint0)$/;

/**
 * `git grep -O` hands each hit to a pager — an arbitrary program — and
 * `nvim-tools --fix` rewrites files in place. Both binaries are otherwise
 * read-only, so the guard is on the flag rather than on the name.
 */
const RUNS_A_PAGER = /^(-O|--open-files-in-pager)(=|$)/;
const NVIM_TOOLS_WRITES = /^--(fix|fix-all)(=|$)/;

/** Enough of a command to recognise it in a refusal, and no more. */
function clip(command: string): string {
  return command.length > 60 ? `${command.slice(0, 60)}…` : command;
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
    // disk or run something unreviewed, and no stage check can see past them.
    if (char === ">" || char === "<" || char === "`") return null;
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
  if (!READ_ONLY.has(binary)) return `'${binary}' is not on the allowlist`;

  if (binary === "find" && words.some((word) => FIND_ACTIONS.test(word))) {
    return "find may walk a tree in a read session but not act on what it finds";
  }
  if (binary === "nvim-tools" && words.some((word) => NVIM_TOOLS_WRITES.test(word))) {
    return "nvim-tools may report in a read session but not fix — a fix rewrites files";
  }

  if (binary === "git") {
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
    if (!GIT_READ_ONLY.has(subcommand)) return `git ${subcommand} can write`;
    if (words.some((word) => RUNS_A_PAGER.test(word))) {
      return "git may not open files in a pager here — a pager is an arbitrary program";
    }
  }

  return null;
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

const ALLOW: HookJSONOutput = {
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
};

function deny(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
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
      return `Bash in a read session may not redirect, background or substitute — '${clip(command)}' could write a file whatever it starts with.`;
    }

    for (const words of stages) {
      const denial = stageDenial(words);
      if (denial) {
        return `Bash is limited to read-only inspection in a read session: ${denial} ('${clip(words.join(" "))}').`;
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

/**
 * Both profiles install a PreToolUse hook; only what it decides differs.
 *
 * The `write` profile still returns allow for every tool that is not MCP, and
 * that is not decoration: without an explicit allow the SDK's default
 * permission mode prompts for approval on every Edit, and a headless session
 * has nobody to prompt — measured, the write agent's edit came back "Claude
 * requested permissions to write to …" and Apply produced an empty diff. What
 * protects the user for those tools is §8.7 step 5: the change is shown and
 * nothing is kept until they accept.
 *
 * Spec 11 §6.4.4 is why MCP is now the exception in both profiles. Step 5
 * cannot protect against an MCP server, because by the time anything is shown
 * the server has already started and whatever it was sent has already left.
 */
export function buildHooks(
  profile: Profile,
  onDenial: (denial: Denial) => void,
): Partial<Record<"PreToolUse", HookCallbackMatcher[]>> {
  const decide =
    profile === "write"
      ? (name: string): string | null => writeGateDecision(name)
      : (name: string, input: unknown): string | null => gateDecision(name, input);

  return {
    PreToolUse: [
      {
        matcher: ".*",
        hooks: [
          async (input): Promise<HookJSONOutput> => {
            const event = input as PreToolUseHookInput;
            const reason = decide(event.tool_name, event.tool_input);
            if (!reason) return ALLOW;
            onDenial({
              toolName: event.tool_name,
              reason,
              ...(event.agent_id ? { subagentId: event.agent_id } : {}),
            });
            return deny(reason);
          },
        ],
      },
    ],
  };
}
