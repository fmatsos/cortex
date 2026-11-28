import { expect, test } from "bun:test";
import { describeImage, imageType } from "./describe-image";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test("imageType: PNG, JPEG, WebP and GIF by their first bytes, nothing else", () => {
  const b = (s: string) => new TextEncoder().encode(s);
  expect(imageType(PNG)).toEqual({ mime: "image/png", ext: "png" });
  expect(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ mime: "image/jpeg", ext: "jpg" });
  expect(imageType(b("RIFF\0\0\0\0WEBPVP8 "))).toEqual({ mime: "image/webp", ext: "webp" });
  expect(imageType(b("GIF89a"))).toEqual({ mime: "image/gif", ext: "gif" });
  expect(imageType(b("%PDF-1.4"))).toBeUndefined();
  expect(imageType(new Uint8Array())).toBeUndefined();
});

test("describeImage (openai client): one chat completion with the image as a data URL part, key and server as the client has them, in the wiki's language", async () => {
  const seen: { auth: string | null; url: string; body: any }[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) {
    seen.push({ auth: req.headers.get("authorization"), url: new URL(req.url).pathname, body: await req.json() });
    return Response.json({ choices: [{ message: { role: "assistant", content: "# Titre\n\nUne image." } }] });
  } });
  const saved = process.env.OPENAI_API_KEY;
  try {
    const base = `http://127.0.0.1:${server.port}/v1`;
    const out = await describeImage(PNG, "image/png", { client: "openai", model: "qwen3-vl", base_url: base, language: "French" });
    expect(out).toBe("# Titre\n\nUne image.");
    expect(seen[0]!.url).toBe("/v1/chat/completions");
    expect(seen[0]!.auth).toBeNull(); // a base_url of cortex.json never gets $OPENAI_API_KEY
    const { model, messages } = seen[0]!.body;
    expect(model).toBe("qwen3-vl");
    expect(messages).toHaveLength(1);
    const [text, image] = messages[0].content;
    expect(text.type).toBe("text");
    expect(text.text).toContain("in French");
    expect(text.text).not.toContain("{{");
    expect(image).toEqual({ type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}` } });
    expect(seen[0]!.body.tools).toBeUndefined(); // no tool: one turn
    // the server's answer is an error: it is the failure, with the status
    const bad = Bun.serve({ port: 0, fetch: () => new Response("model has no vision", { status: 400 }) });
    try { await expect(describeImage(PNG, "image/png", { client: "openai", model: "m", base_url: `http://127.0.0.1:${bad.port}/v1` })).rejects.toThrow("answered 400: model has no vision"); }
    finally { bad.stop(true); }
    // an empty description is a failure, not an empty source
    const empty = Bun.serve({ port: 0, fetch: () => Response.json({ choices: [{ message: { role: "assistant", content: "" } }] }) });
    try { await expect(describeImage(PNG, "image/png", { client: "openai", model: "m", base_url: `http://127.0.0.1:${empty.port}/v1` })).rejects.toThrow("described nothing"); }
    finally { empty.stop(true); }
  } finally { server.stop(true); if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved; }
});
