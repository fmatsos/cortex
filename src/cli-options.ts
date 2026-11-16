/** Options of the cortex command line (parseArgs), shared by the CLI and `remote-exec`, which parses a forwarded argv the same way. */
export const OPTIONS = {
  note: { type: "string" }, via: { type: "string" }, "dry-run": { type: "boolean" }, in: { type: "string" },
  json: { type: "boolean" }, limit: { type: "string" }, pending: { type: "boolean" }, batch: { type: "boolean" },
  file: { type: "boolean" }, kind: { type: "string" }, source: { type: "string", multiple: true }, page: { type: "string", multiple: true }, out: { type: "string" }, interactive: { type: "boolean" }, help: { type: "boolean", short: "h" }, type: { type: "string" }, check: { type: "boolean" }, write: { type: "boolean" }, version: { type: "boolean", short: "v" }, force: { type: "boolean" }, agent: { type: "string" }, model: { type: "string" }, effort: { type: "string" }, port: { type: "string" }, sync: { type: "boolean" }, wiki: { type: "string" }, identity: { type: "string" },
} as const;
