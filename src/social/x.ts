import { Social, post, who, iso } from "./social";

/** X / Twitter through fxtwitter, a third-party service (x.com has no login-free API): it can disappear. */
export class X extends Social {
  readonly name = "fxtwitter-api";
  readonly network = "x";
  request(u: URL) {
    const id = /^(www\.|mobile\.)?(x|twitter)\.com$/.test(u.hostname) && u.pathname.match(/^\/[^/]+\/status\/(\d+)/)?.[1];
    return id ? `https://api.fxtwitter.com/status/${id}` : undefined;
  }
  protected parse({ tweet: t }: any, url: string) {
    return post(this.name, url, t.text ?? "", who(t.author?.name, t.author?.screen_name), iso(t.created_at),
      (t.media?.all ?? []).map((m: any) => m.url), t.quote && `${t.quote.author?.name ?? ""}: ${t.quote.text}`,
      (t.raw_text?.facets ?? []).filter((f: any) => f.type === "url").map((f: any) => f.replacement ?? f.original)); // t.co links, unfolded by fxtwitter
  }
}
