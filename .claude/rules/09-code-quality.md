---
description: "Reference: Code quality standards — SOLID, KISS, DRY, error handling, anti-patterns"
---

# Reference: Code Quality

Write code that is **simple, maintainable, and production-ready**. Prioritize
clarity over cleverness.

## Principles

1. **Simplicity First** (KISS)
2. **Consistency** in tech stack
3. **Maintainability** over cleverness
4. **DRY** — eliminate duplication
5. **YAGNI** — don't add speculative features
6. **SOLID** — Single Responsibility, Open/Closed, Liskov Substitution,
   Interface Segregation, Dependency Inversion

## Code Organization

- Keep functions small (< 20 lines ideally, < 100 lines max)
- One level of abstraction per function
- Use meaningful, pronounceable names
- Self-documenting code; comments explain "why", not "what"
- Prefer composition over inheritance

## Error Handling

- Fail fast and explicitly
- Use typed errors/exceptions with clear messages
- Never silently ignore errors
- Validate inputs at system boundaries

## Anti-Patterns to Avoid

- No commented-out code "just in case"
- No TODO comments
- No copy-paste instead of abstracting
- No premature optimization
- No over-engineering simple solutions
- No ignoring compiler/linter warnings

## Formatting and linting

This machine runs "no config, no tool": a formatter or linter acts on this repo
only if the repo carries that tool's own config file. If `:w` changes nothing and
the gutter stays empty, the marker file is missing — not the editor broken.

This repo carries `biome.jsonc` (the JS/TS family — formatter *and* live linter),
`tsconfig.json` (tsc), `.editorconfig` (shfmt) and `.markdownlint-cli2.yaml`
(markdown). `nvim-tools` gates each tool on its file — `tsc` on `tsconfig.json`
exactly as it gates `basedpyright` on `pyrightconfig.json` and `ruff` on
`ruff.toml`, and since spec 42 `agent-gateway/` carries both of those, so a
Python finding is a finding like any other.

One file is deliberately outside biome: `src/shared/agent-protocol.ts` is
generated from `agent-gateway/src/agent_gateway/protocol.py` and compared byte
for byte by `test/protocol.spec.ts`, so a formatter rewrapping it would break
that test for a reason nobody could act on. The generator keeps it inside
`lineWidth` itself. `agent-gateway/schema.json` and `catalogue.json` are
excluded for the same reason.

The file must stay `biome.jsonc`, not `biome.json`: biome silently ignores a
`.json` config containing comments and falls back to its full defaults, which
reintroduces every rule the template turned off.

The contract, and the skill that applies it, are in mac-setup:
`projects/tooling.md` and `/lint-format-lsp`.
