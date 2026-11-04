import { expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { add, MAX_BODY_BYTES, privateIp } from "./add";

const newRoot = async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  return root;
};
const page = `<html><head><title>Page de test</title></head><body><article><h1>Page de test</h1>${"<p>Un paragraphe de remplissage assez long pour que l'extraction dépasse le seuil de cinquante mots exigé par cortex add, sans réseau.</p>".repeat(4)}</article></body></html>`;

test("privateIp : plages locales, privées, CGNAT et formes IPv6 embarquant de l'IPv4", () => {
  for (const ip of ["127.0.0.1", "0.0.0.0", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.255",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::a00:1"]) expect(privateIp(ip)).toBe(true);
  for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(privateIp(ip)).toBe(false);
});

test("add côté MCP (publicOnly) : refuse loopback, privé et hôte local, avant tout fetch", async () => {
  const root = await newRoot();
  const hits: string[] = [];
  const srv = Bun.serve({ port: 0, fetch: (req) => (hits.push(req.url), new Response(page, { headers: { "content-type": "text/html" } })) });
  try {
    for (const url of [`http://127.0.0.1:${srv.port}/`, "http://10.0.0.1/", "http://[::1]:1/", "http://[::ffff:7f00:1]/", "http://localhost:1/", "http://169.254.169.254/latest/"])
      await expect(add(root, url, { note: "x", publicOnly: true })).rejects.toThrow(/refusée/);
    expect(hits).toEqual([]);
    expect(existsSync(join(root, "raw"))).toBe(false);
  } finally { srv.stop(true); }
});

test("add côté CLI : une URL locale reste acceptée", async () => {
  const root = await newRoot();
  const srv = Bun.serve({ port: 0, fetch: () => new Response(page, { headers: { "content-type": "text/html" } }) });
  try {
    const r = await add(root, `http://127.0.0.1:${srv.port}/`, { note: "x" });
    expect(r.duplicate).toBe(false);
    expect(r.ex?.title).toBe("Page de test");
  } finally { srv.stop(true); }
});

test("add : une réponse au-delà du plafond est abandonnée en cours de lecture, sans rien écrire", async () => {
  const root = await newRoot();
  const mib = 1024 * 1024;
  let sent = 0;
  const chunk = new Uint8Array(64 * 1024).fill(97);
  // chunked, no content-length: only the streaming check can catch it
  const srv = Bun.serve({
    port: 0,
    fetch: () => new Response(new ReadableStream({
      pull(c) { if (sent >= 64 * mib) return c.close(); sent += chunk.length; c.enqueue(chunk); },
    }), { headers: { "content-type": "text/html" } }),
  });
  try {
    await expect(add(root, `http://127.0.0.1:${srv.port}/`, { note: "x", maxBytes: mib })).rejects.toThrow("trop volumineuse (> 1 Mo)");
    expect(sent).toBeLessThan(16 * mib); // aborted early, not drained
    expect(existsSync(join(root, "raw"))).toBe(false);
  } finally { srv.stop(true); }
});

test("add : content-length au-dessus du plafond refusé avant lecture ; le plafond par défaut est 20 Mo", async () => {
  expect(MAX_BODY_BYTES).toBe(20 * 1024 * 1024);
  const root = await newRoot();
  const srv = Bun.serve({ port: 0, fetch: () => new Response("x".repeat(2000), { headers: { "content-type": "application/pdf" } }) });
  try {
    await expect(add(root, `http://127.0.0.1:${srv.port}/`, { note: "x", maxBytes: 1000 })).rejects.toThrow("trop volumineuse");
  } finally { srv.stop(true); }
});

test("cortex mcp : l'outil add refuse une URL loopback", async () => {
  const root = await newRoot();
  const proc = Bun.spawn(["bun", join(import.meta.dir, "cortex.ts"), "mcp"], {
    env: { ...process.env, CORTEX_ROOT: root }, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  const reader = proc.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  const send = (m: object) => { proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n"); proc.stdin.flush(); };
  const recv = async (id: number) => {
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl >= 0) { const msg = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1); if (msg.id === id) return msg; continue; }
      const { value, done } = await reader.read();
      if (done) throw new Error("serveur arrêté");
      buf += value;
    }
  };
  try {
    send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    await recv(1);
    send({ method: "notifications/initialized" });
    send({ id: 2, method: "tools/call", params: { name: "add", arguments: { input: "http://127.0.0.1:9/", note: "ssrf" } } });
    const res = (await recv(2)).result;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("refusée");
  } finally { proc.stdin.end(); proc.kill(); }
});
