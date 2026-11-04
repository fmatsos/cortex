import { styleText } from "node:util";

/**
 * Terminal styling on top of `node:util` styleText (no dependency). styleText drops the escape codes when the target
 * stream is not a TTY or when NO_COLOR is set, so piped output and `--json` stay plain.
 */
type Format = Parameters<typeof styleText>[0];
const on = (stream: NodeJS.WriteStream) => (format: Format) => (s: string) => styleText(format, s, { stream });
const out = on(process.stdout), err = on(process.stderr);

/** Styles for text printed on stdout. */
export const paint = { ok: out("green"), warn: out("yellow"), error: out("red"), accent: out("cyan"), dim: out("dim"), bold: out("bold") };

/** Error line on stderr: red ✗, then the message. */
export const fail = (msg: string) => console.error(`${err("red")("✗")} ${msg}`);
/** Warning line on stderr: yellow marker (! by default), then the message. */
export const warn = (msg: string, mark = "!") => console.error(`${err("yellow")(mark)} ${msg}`);
