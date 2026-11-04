import { join } from "node:path";
import { interactiveWith, type Backend, type Config } from "./backend";

// --- opencode v2 : API REST de `opencode serve` (le SDK publié, 1.19.5, ne parle pas la v2) -----

export default function opencode(cfg: Config): Backend {
  const model = cfg.model ?? "opencode/big-pickle";
  const [providerID, ...id] = model.split("/");
  return {
    interactive: interactiveWith((p) => ["opencode", "--model", cfg.effort ? `${model}#${cfg.effort}` : model, "--prompt", p]),
    async run(root, prompt, mode) {
      const server = await startOpencode();
      try {
        const api = async (method: string, path: string, body?: unknown) => {
          const r = await fetch(server.url + path, {
            method, headers: { ...server.headers, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
          });
          if (!r.ok) throw new Error(`opencode ${method} ${path} → ${r.status} ${await r.text()}`);
          return r.status === 204 ? undefined : r.json();
        };
        const rule = (action: string, resource: string, effect: "allow" | "deny") => ({ action, resource, effect });
        // la dernière règle qui correspond l'emporte ; jamais "ask" : personne ne répondrait
        const permissions = [
          rule("edit", "*", "deny"),
          ...(mode === "write" ? [rule("edit", "wiki/*", "allow"), rule("edit", `${join(root, "wiki")}/*`, "allow")] : []),
          rule("shell", "*", "deny"),
          rule("shell", "cortex search*", "allow"),
          rule("shell", "cortex log --*", "allow"), // lecture du journal ; « cortex log add » n'y correspond pas
          ...(mode === "write" ? [rule("shell", "cortex index*", "allow"), rule("shell", "cortex lint*", "allow"), rule("shell", "cortex new *", "allow"), rule("shell", "cortex log add *", "allow")] : []),
          rule("external_directory", "*", "deny"),
          rule("webfetch", "*", "deny"), rule("websearch", "*", "deny"), rule("subagent", "*", "deny"), rule("question", "*", "deny"),
        ];
        const { data: session } = await api("POST", "/api/session", {
          location: { directory: root }, permissions, model: { providerID, id: id.join("/"), ...(cfg.effort && { variant: cfg.effort }) }, // effort = variante du modèle opencode
        });
        await api("POST", `/api/session/${session.id}/prompt`, { text: prompt });
        await api("POST", `/api/experimental/session/${session.id}/wait`);
        const { data: messages } = await api("GET", `/api/session/${session.id}/message?order=desc&limit=50`);
        const idle = messages.find((m: any) => m.type === "idle");
        if (idle?.outcome === "failed") throw new Error(`agent opencode en échec : ${idle.error?.message ?? "inconnu"}`);
        const last = messages.find((m: any) => m.type === "assistant");
        return (last?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
      } finally {
        server.close();
      }
    },
  };
}

/** `opencode serve` sur un port libre (4096 entrerait en collision), mot de passe propre à la session (Basic opencode:<mdp>). */
async function startOpencode() {
  const sock = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = sock.port;
  sock.stop(true);
  const password = crypto.randomUUID();
  const proc = Bun.spawn(["opencode", "serve", "--hostname=127.0.0.1", `--port=${port}`], {
    env: { ...process.env, OPENCODE_SERVER_PASSWORD: password }, stdout: "pipe", stderr: "pipe",
  });
  const close = () => proc.kill();
  const reader = proc.stdout.getReader();
  let out = "";
  const deadline = Date.now() + 30_000;
  while (!/listening on (\S+)/.test(out)) {
    const chunk = await Promise.race([reader.read(), Bun.sleep(Math.max(0, deadline - Date.now())).then(() => null)]);
    if (!chunk || chunk.done) { close(); throw new Error(`opencode serve n'a pas démarré : ${out || await new Response(proc.stderr).text()}`); }
    out += new TextDecoder().decode(chunk.value);
  }
  reader.releaseLock();
  return { url: out.match(/listening on (\S+)/)![1], close, headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` } };
}

