import type { FetchOpts } from "../add";
import type { Social } from "./social";
import { HtmlPage, JsonApi } from "./transport";
import { X } from "./x";
import { Bluesky } from "./bluesky";
import { Mastodon } from "./mastodon";
import { LinkedIn } from "./linkedin";

/** The networks, each bound to its transport; tried in order, the ambiguous ones (fallback) last. */
export function socials(opts: FetchOpts = {}): Social[] {
  const api = new JsonApi(opts);
  return [new X(api), new Bluesky(api), new LinkedIn(new HtmlPage(opts)), new Mastodon(api)];
}

/** The network for this URL and its request, or undefined (the page is read normally). */
export function socialFor(url: string, opts: FetchOpts = {}): { social: Social; request: string } | undefined {
  const u = new URL(url);
  for (const social of socials(opts)) {
    const request = social.request(u);
    if (request) return { social, request };
  }
}
