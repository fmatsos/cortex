import { expect, test } from "bun:test";
import { toInbox } from "./share-server";

test("share: a link alone is a .url (note on its line), text keeps its link inside a .md with a .md.note, nothing is null", () => {
  expect(toInbox({ url: "https://a.b/c", title: "Page" })).toEqual([["url", "https://a.b/c\n"]]);
  expect(toInbox({ text: " https://a.b/c ", note: "à lire\nplus tard" })).toEqual([["url", "https://a.b/c à lire plus tard\n"]]);
  expect(toInbox({ text: "Un post sur les LLM locaux\nsuite https://lnkd.in/x", note: "veille" })).toEqual([
    ["md", "# Un post sur les LLM locaux\n\nUn post sur les LLM locaux\nsuite\n\nSource : <https://lnkd.in/x>\n"],
    ["md.note", "veille\n"],
  ]);
  expect(toInbox({ title: "Idée", text: "rappel : tester GLM" })).toEqual([["md", "# Idée\n\nrappel : tester GLM\n"]]);
  expect(toInbox({ text: "  ", note: "x" })).toBeNull();
});

test("share: a text with an explicit url (page captured by the extension) keeps it in a .md.origin, and its own quotes of the url", () => {
  expect(toInbox({ title: "Article", url: "https://a.b/c", text: "Corps. Voir https://a.b/c plus haut.\n\nFin.", note: "veille" })).toEqual([
    ["md", "# Article\n\nCorps. Voir https://a.b/c plus haut.\n\nFin.\n\nSource : <https://a.b/c>\n"],
    ["md.origin", "https://a.b/c\n"],
    ["md.note", "veille\n"],
  ]);
  // the url repeated at the end of the text (an Android share) is not part of the content, and a url alone stays a .url
  expect(toInbox({ url: "https://a.b/c", text: "Mon post\nhttps://a.b/c" })).toEqual([
    ["md", "# Mon post\n\nMon post\n\nSource : <https://a.b/c>\n"], ["md.origin", "https://a.b/c\n"],
  ]);
  expect(toInbox({ url: "https://a.b/c", text: "https://a.b/c" })).toEqual([["url", "https://a.b/c\n"]]);
});

test("share: the extension origin gets CORS headers (preflight and POST), another origin none", async () => {
  const { route } = await import("./share-server");
  const ext = "chrome-extension://" + "a".repeat(32);
  const pre = await route(new Request("http://x/share/api", { method: "OPTIONS", headers: { origin: ext, "access-control-request-method": "POST" } }));
  expect(pre.status).toBe(204);
  expect(pre.headers.get("access-control-allow-origin")).toBe(ext);
  expect(pre.headers.get("access-control-allow-headers")).toBe("content-type");
  const post = await route(new Request("http://x/share/api", { method: "POST", headers: { origin: ext }, body: "{}" })); // nothing to send: 400, no Gitea call
  expect(post.status).toBe(400);
  expect(post.headers.get("access-control-allow-origin")).toBe(ext);
  const other = await route(new Request("http://x/share/api", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
  expect(other.headers.get("access-control-allow-origin")).toBeNull();
});
