import { fetchCapped, type FetchOpts } from "../add";

/**
 * Implementor side of the bridge: how a request reaches the network and comes back as data.
 * A network (Social) doesn't know whether it talks to a JSON API, an oEmbed endpoint or a page.
 */
export interface Transport {
  get(request: string): Promise<any>;
}

/** A public JSON API, through cortex's capped fetch (timeout, size cap, public-only check from the MCP server). */
export class JsonApi implements Transport {
  constructor(private opts: FetchOpts = {}) {}
  async get(request: string): Promise<any> {
    return JSON.parse(new TextDecoder().decode((await fetchCapped(request, this.opts)).bytes));
  }
}
