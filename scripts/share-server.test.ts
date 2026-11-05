import { expect, test } from "bun:test";
import { toInbox } from "./share-server";

test("share: a link alone is a .url, text keeps its link inside a .md, nothing is null", () => {
  expect(toInbox({ url: "https://a.b/c", title: "Page" })).toEqual(["url", "https://a.b/c\n"]);
  expect(toInbox({ text: " https://a.b/c " })).toEqual(["url", "https://a.b/c\n"]);
  expect(toInbox({ text: "Un post sur les LLM locaux\nsuite https://lnkd.in/x" })).toEqual(
    ["md", "# Un post sur les LLM locaux\n\nUn post sur les LLM locaux\nsuite\n\nSource : <https://lnkd.in/x>\n"]);
  expect(toInbox({ title: "Idée", text: "rappel : tester GLM" })).toEqual(["md", "# Idée\n\nrappel : tester GLM\n"]);
  expect(toInbox({ text: "  " })).toBeNull();
});
