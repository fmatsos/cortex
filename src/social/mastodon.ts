import TurndownService from "turndown";
import { Social, post, who, iso } from "./social";

/** Mastodon through the instance's own public API; any site can have /@user/123 URLs, hence the fallback. */
export class Mastodon extends Social {
  readonly name = "mastodon-api";
  readonly network = "mastodon";
  override readonly fallback = true;
  request(u: URL) {
    const id = u.pathname.match(/^\/@[^/]+\/(\d+)\/?$/)?.[1];
    return id ? `${u.origin}/api/v1/statuses/${id}` : undefined;
  }
  protected parse(s: any, url: string) {
    if (!s?.account) throw new Error("not a Mastodon status");
    const text = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" }).turndown(s.content ?? "");
    // links: the text's, minus mentions and hashtags (the API lists them), and the link card
    const skip = new Set([...(s.mentions ?? []), ...(s.tags ?? [])].map((m: any) => m.url));
    const links = [...String(s.content ?? "").matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")).filter((l) => !skip.has(l) && !/\/tags\//.test(l));
    if (s.card?.url) links.push(s.card.url);
    return post(this.name, url, text, who(s.account.display_name, s.account.acct), iso(s.created_at), (s.media_attachments ?? []).map((a: any) => a.url), undefined, links);
  }
}
