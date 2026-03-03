---
applyTo: "**/*.go"
paths:
  - "**/*.go"
---

# Code Conventions

## General

- Follow **Effective Go** and standard library patterns
- Keep functions small and focused; prefer clear control flow over cleverness
- Keep exported APIs stable; add new helpers rather than changing call sites widely
- Use context-aware operations where IO or long work happens
- Avoid global state; prefer constructor-based dependency injection

## Formatting & Imports

- Run `make fmt` before every commit
- Import grouping: stdlib → blank line → third-party
- No dot imports; avoid aliasing unless resolving a conflict

## Naming

- `camelCase` for locals, `PascalCase` for exported identifiers
- No stuttering: `memory.Service` not `memory.MemoryService`
- Interfaces at package boundaries; concrete types in structs
- Pointer receivers for methods that mutate state or avoid large copies
- Capture `time.Now()` once when needed

## Error Handling

- Return early on error; avoid deep nesting
- Wrap with context: `fmt.Errorf("doing X: %w", err)`
- Error strings: lowercase, no trailing punctuation
- Typed errors only when callers need to branch on them

## Output

- CLI commands report errors at the command layer, not inside libraries
- Library packages return errors, never print
- Stderr for errors, stdout for data

## Concurrency

- Use `sync.RWMutex` / `sync.Mutex` consistently for shared state
- Keep critical sections minimal; lock ordering must be obvious

## Testing

- Tests colocated with source (`*_test.go`)
- Prefer table-driven tests for multi-case scenarios
- Use `t.Helper()` in helper functions
- Name tests with behavior intent: `TestCreate_ValidInput`, `TestSearch_EmptyQuery`
- Test error cases as thoroughly as success cases

## CLI Patterns

- Commands live in `internal/cli/`; registered in `root.go`
- Viper config in `internal/config/`; hierarchy: flags > env > file > defaults
- Wire new flags to config where appropriate
- Consistent flag naming: `--level`, `--session`, `--tags`, `--output`
