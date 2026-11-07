import { fail, paint, warn } from "./style";

/**
 * What domain code says instead of printing. `ok` renders as `✓ text` and `info` as the text itself, both on stdout
 * (info text may already be styled with `paint`); `warn` and `fail` go to stderr (`mark` replaces the default `!`).
 */
export type Message = { level: "ok" | "info" | "warn" | "fail"; text: string; mark?: string };
/** Live sink for progress that must show while a long operation runs (an agent session, a network fetch). */
export type Report = (m: Message) => void;
/** Outcome of a command: `ok` drives the exit code (false → 1), `messages` is everything that was said, in order. */
export type Result = { ok: boolean; messages: Message[] };

/** The single renderer: the current colored lines, one per message. */
export const print: Report = ({ level, text, mark }) => {
  if (level === "fail") fail(text);
  else if (level === "warn") warn(text, mark);
  else console.log(level === "ok" ? `${paint.ok("✓")} ${text}` : text);
};

/** Collects messages for the returned Result and forwards each one to `report` as it happens (no-op by default). */
export function collector(report: Report = () => {}) {
  const messages: Message[] = [];
  const say = (level: Message["level"], text: string, mark?: string) => {
    const m: Message = mark ? { level, text, mark } : { level, text };
    messages.push(m);
    report(m);
  };
  return { messages, say, done: (ok: boolean): Result => ({ ok, messages }) };
}
