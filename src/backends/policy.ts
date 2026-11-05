import { join } from "node:path";
import type { Mode } from "./backend";

// --- What the agent may run: ONE table, rendered in each backend's dialect----------------------

/** Read-only option of a command; `value` is a regex source for the option's argument. */
type Flag = { flag: string; value?: string };

/**
 * `args`: how a command takes its arguments (the cortex CLI validates them itself):
 *   any = zero or more, none = takes none, required = at least one.
 * `flags`: the command is allowed only with these options (no subcommand, no free argument).
 */
export type Rule =
  | { cmd: string; args: "any" | "none" | "required" }
  | { cmd: string; flags: Flag[] };

const READ: Rule[] = [
  { cmd: "search", args: "any" },
  // journal reading; `cortex log add` is a separate rule, write mode only
  { cmd: "log", flags: [{ flag: "--json" }, { flag: "--limit", value: "\\d+" }, { flag: "--kind", value: "\\w+" }] },
];

/** `cortex` subcommands an agent may run, per mode. */
export const POLICY: Record<Mode, Rule[]> = {
  read: READ,
  write: [
    ...READ,
    { cmd: "index", args: "none" },
    { cmd: "lint", args: "any" },
    { cmd: "new", args: "required" },
    { cmd: "log add", args: "required" },
  ],
};

const isFlags = (r: Rule): r is Extract<Rule, { flags: Flag[] }> => "flags" in r;

/**
 * Regex a Claude guard applies to an already unquoted Bash command. Arguments are not constrained
 * for `args` rules (`cmd( |$)`); a `flags` rule accepts only its options, up to the end of the command.
 */
export function toRegex(mode: Mode): RegExp {
  const rules = POLICY[mode];
  const free = rules.filter((r) => !isFlags(r)).map((r) => r.cmd);
  const alts = [
    `^cortex (${free.join("|")})( |$)`,
    ...rules.filter(isFlags).map((r) => `^cortex ${r.cmd}(${r.flags.map((f) => ` ${f.flag}${f.value ? ` ${f.value}` : ""}`).join("|")})*$`),
  ];
  return new RegExp(alts.join("|"));
}

/** Words of the refusal message: the subcommands the mode allows. */
export const toLabel = (mode: Mode): string => `cortex ${[...new Set(POLICY[mode].map((r) => r.cmd))].join("|")}`;

export type OpencodeRule = { action: string; resource: string; effect: "allow" | "deny" };

/**
 * Permission rules of an opencode session: only the cortex tool pack (MCP server « cortex », tools `cortex_*`), which
 * guards each call itself; opencode's own tools are denied. Never "ask", nobody would answer.
 */
export function toOpencodeRules(): OpencodeRule[] {
  const rule = (action: string, resource: string, effect: "allow" | "deny"): OpencodeRule => ({ action, resource, effect });
  return [
    ...["read", "edit", "glob", "grep", "shell", "external_directory", "webfetch", "websearch", "subagent", "question", "skill", "execute"].map((a) => rule(a, "*", "deny")),
    rule("cortex_*", "*", "allow"),
  ];
}
