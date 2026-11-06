import { socialPost } from "../add";
import { Social, post } from "./social";

/** LinkedIn: the public post page carries its text in JSON-LD (SocialMediaPosting). Behind the authwall, the page is read normally. */
export class LinkedIn extends Social {
  readonly name = "linkedin-jsonld";
  override readonly fallback = true;
  request(u: URL) {
    return /^([a-z]{2,3}\.|www\.)?linkedin\.com$/.test(u.hostname) && /^\/(posts\/|feed\/update\/)/.test(u.pathname) ? u.href : undefined;
  }
  protected parse(html: string, url: string) {
    const p = socialPost(html);
    if (!p) throw new Error("no public post in the page (authwall?)");
    return post(this.name, url, p.body, p.author, p.published, []);
  }
}
