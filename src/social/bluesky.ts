import { Social, post, who, iso } from "./social";

/** Bluesky through its official public AppView API. */
export class Bluesky extends Social {
  readonly name = "bsky-api";
  request(u: URL) {
    const m = u.hostname === "bsky.app" && u.pathname.match(/^\/profile\/([^/]+)\/post\/([^/]+)/);
    return m ? `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?depth=0&uri=${encodeURIComponent(`at://${m[1]}/app.bsky.feed.post/${m[2]}`)}` : undefined;
  }
  protected parse({ thread: { post: p } }: any, url: string) {
    return post(this.name, url, p.record?.text ?? "", who(p.author?.displayName, p.author?.handle), iso(p.record?.createdAt),
      (p.embed?.images ?? p.embed?.media?.images ?? []).map((i: any) => i.fullsize), p.embed?.record?.value?.text ?? p.embed?.record?.record?.value?.text);
  }
}
