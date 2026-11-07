import { cli, interactiveWith, type Backend, type Config } from "./backend";
import { toOpencodeRules } from "./policy";
import { packServer } from "./tools";
import { LIMITS } from "../limits";

// --- opencode v2: REST API of `opencode serve` (the published SDK, 1.19.5, does not speak v2); the cortex tool pack
// over MCP (inline config), opencode's own reading, writing and shell tools denied.

export default function opencode(cfg: Config): Backend {
  const model = cfg.model ?? "opencode/big-pickle";
  const [providerID, ...id] = model.split("/");
  return {
    interactive: interactiveWith((p) => ["opencode", "--model", cfg.effort ? `${model}#${cfg.effort}` : model, "--prompt", p]),
    async run(root, prompt, mode) {
      const pack = packServer(root, mode);
      const server = await startOpencode({ mcp: { servers: { cortex: { type: "local", command: [pack.command, ...pack.args], environment: pack.env } } } });
      try {
        const api = async (method: string, path: string, body?: unknown) => {
          const r = await fetch(server.url + path, {
            method, headers: { ...server.headers, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
          });
          if (!r.ok) throw new Error(`opencode ${method} ${path} → ${r.status} ${await r.text()}`);
          return r.status === 204 ? undefined : r.json();
        };
        const permissions = toOpencodeRules();
        const { data: session } = await api("POST", "/api/session", {
          location: { directory: root }, permissions, model: { providerID, id: id.join("/"), ...(cfg.effort && { variant: cfg.effort }) }, // effort = opencode model variant
        });
        await api("POST", `/api/session/${session.id}/prompt`, { text: prompt });
        await api("POST", `/api/experimental/session/${session.id}/wait`);
        const { data: messages } = await api("GET", `/api/session/${session.id}/message?order=desc&limit=50`);
        const idle = messages.find((m: any) => m.type === "idle");
        if (idle?.outcome === "failed") throw new Error(`opencode agent failed: ${idle.error?.message ?? "unknown"}`);
        const last = messages.find((m: any) => m.type === "assistant");
        return (last?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
      } finally {
        server.close();
      }
    },
  };
}

/** Grace period between SIGTERM and SIGKILL when stopping the server (mutable for tests). */
export const killGrace = { ms: 3_000 };

/** Reads a pipe to the end in the background, keeping the last `keep` characters (a pipe nobody reads fills up and blocks the writer). */
function drain(stream: ReadableStream<Uint8Array>, keep = 4_000) {
  const box = { tail: "" };
  const dec = new TextDecoder();
  (async () => { for await (const c of stream) box.tail = (box.tail + dec.decode(c, { stream: true })).slice(-keep); })().catch(() => {});
  return box;
}

/** `opencode serve` on a free port (4096 would collide), session-specific password (Basic opencode:<pwd>). */
export async function startOpencode(config?: object) {
  // ponytail: the port is probed then released before the spawn (small race window); `opencode serve --port=0` is
  // unverified without the binary (no --help available here), so it is not used.
  const sock = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = sock.port;
  sock.stop(true);
  const password = crypto.randomUUID();
  const proc = Bun.spawn([cli("opencode"), "serve", "--hostname=127.0.0.1", `--port=${port}`], {
    env: { ...process.env, OPENCODE_SERVER_PASSWORD: password, ...(config && { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) }) }, stdout: "pipe", stderr: "pipe",
  });
  // SIGTERM, then SIGKILL if the server is still there after the grace period
  const close = () => {
    proc.kill("SIGTERM");
    const t = setTimeout(() => proc.kill("SIGKILL"), killGrace.ms);
    void proc.exited.then(() => clearTimeout(t));
  };
  const err = drain(proc.stderr); // never left undrained: a chatty server would block on a full pipe
  const reader = proc.stdout.getReader();
  let out = "";
  const deadline = Date.now() + LIMITS.opencodeStartMs;
  while (!/listening on (\S+)/.test(out)) {
    const chunk = await Promise.race([reader.read(), Bun.sleep(Math.max(0, deadline - Date.now())).then(() => null)]);
    if (!chunk || chunk.done) { close(); throw new Error(`opencode serve did not start: ${out || err.tail}`); }
    out += new TextDecoder().decode(chunk.value);
  }
  // keep reading after startup: the server logs for the whole session and would block once the pipe buffer is full
  (async () => { while (!(await reader.read()).done); })().catch(() => {});
  return { url: out.match(/listening on (\S+)/)![1], close, exited: proc.exited, headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` } };
}
