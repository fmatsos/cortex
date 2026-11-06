import type { Extract } from "../add";
import { LIMITS } from "../limits";
import type { Transport } from "./transport";

/**
 * Abstraction side of the bridge: a social network. It knows which request names a post and how to read
 * the answer; fetching is delegated to its Transport. One subclass per network, registered in social/index.ts.
 */
export abstract class Social {
  constructor(protected transport: Transport) {}
  /** Recorded in the source's `extractor`. */
  abstract readonly name: string;
  /** The URL shape is ambiguous (another site can match it): on failure, read the page normally. */
  readonly fallback: boolean = false;
  /** Request for this post, or undefined when the URL is not one of this network's posts. */
  abstract request(u: URL): string | undefined;
  /** Answer → source; `url` is the post's original URL, kept in the source. */
  protected abstract parse(data: any, url: string): Extract;

  async read(url: string, request: string): Promise<Extract> {
    return this.parse(await this.transport.get(request), url);
  }
}

/** A post as a source: its text, then the quoted post and the media links. */
export function post(name: string, url: string, text: string, author: string | undefined, published: string | undefined, media: string[], quote?: string): Extract {
  const body = [text.trim(), quote && quote.trim().split("\n").map((l) => `> ${l}`).join("\n"), ...media.map((m) => `![](${m})`)].filter(Boolean).join("\n\n");
  if (!body) throw new Error(`empty post on ${url}: nothing written.`);
  return { title: body.split("\n")[0].slice(0, LIMITS.textTitleChars), content: body, kind: "article", url, author, published, extractor: name };
}

export const who = (name?: string, handle?: string) => (name && handle ? `${name} (@${handle})` : name || handle) || undefined;
export const iso = (d?: string) => (d && !isNaN(Date.parse(d)) ? new Date(d).toISOString() : undefined);
