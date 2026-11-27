/** Tunable thresholds of the CLI, with their calibration. A magic number belongs here, not inline. */
export const LIMITS = {
  /** Readability replaces defuddle only if it extracts clearly more words than defuddle. */
  // ponytail: threshold 1.3 calibrated on the 21 sources of step 0; to revisit if false positives appear
  readabilityRatio: 1.3,
  /** Below this many words an HTML extraction is treated as an empty body (anti-bot page). */
  minArticleWords: 50,
  /** Below this many words a PDF is treated as scanned (no text layer). */
  minPdfWords: 20,
  /** Timeout of a page or PDF fetch. */
  fetchTimeoutMs: 30_000,
  /** Pages a social post links to that `add` also captures (one level: their own links are not followed). cortex.json parser.social[.<network>].external_link.limit overrides it. */
  maxLinkedSources: 5,
  /** `cortex upgrade`: download of a ~90 MB binary. */
  upgradeTimeoutMs: 300_000,
  /** How long `opencode serve` has to announce that it listens. */
  opencodeStartMs: 30_000,
  /** openai client: one chat completion (local models are slow). */
  llmRequestMs: 600_000,
  /** openai client: model turns before the agent loop gives up. */
  agentTurns: 100,
  /** openai client: turns where the model gets the lint errors of its pages back before cortex gives up on fixing them. */
  lintFixPasses: 2,
  /** Tags of a page an agent creates (cortex.json max_tags overrides it): beyond, cortex keeps the tags already in use first. */
  maxTags: 4,
  /** openai client: characters of one part of a tool result (small local contexts); the next part comes with `offset`. */
  toolOutputChars: 20_000,
  /** openai client: tokens of one model answer. A whole page fits; a model stuck repeating a line fails fast instead of filling the context. */
  llmMaxTokens: 16_384,
  /** openai client: context window of the server (llama.cpp n_ctx); above 80% of it the old tool results are elided before the request. */
  llmContextTokens: 65_536,
  /** openai client: answers cut by `llmMaxTokens` the model may redo in smaller parts before cortex gives up. */
  cutRetries: 3,
  /** A source still `pending` after this many days is reported by lint. */
  pendingDays: 7,
  /** The maintenance summary of the site: a page modified since its review and not reviewed again for this many days counts as stale. */
  maintenanceStaleDays: 180,
  /** Title taken from the first line of a PDF, cut to this many characters. */
  pdfTitleChars: 120,
  /** Title taken from the first line of a plain text, cut to this many characters. */
  textTitleChars: 80,
  /** Related pages kept per page on the site. */
  relatedPages: 8,
  /** cortex links: a title or alias shorter than this is never matched (« IA », « Go » only as aliases of 3+). */
  linkMinName: 3,
  /** cortex links: mentioned on more than this share of the pages = a common word, never suggested… */
  linkMaxSpread: 0.3,
  /** …and on large wikis, more than this many pages (30 % of 5000 pages would be 1500). */
  linkMaxSpreadPages: 50,
  /** cortex links: mentions needed before keyphraseness is judged; below, the context filter decides alone. */
  linkMinEvidence: 3,
  /** cortex links: least share of the mentioning pages that link to the page (Wikipedia's wikify uses ~0.06; the wiki is smaller and denser). */
  linkMinKeyphraseness: 0.2,
  /** cortex links: least similarity of the two pages when they share no tag and no source. Calibrated on the wiki of step 1. */
  linkMinSimilarity: 0.1,
  /** cortex links: suggestions kept per page, best first. */
  linkMaxPerPage: 5,
  /** New page: same-type pages compared with it by meaning (embeddings) before it is created. */
  dupCandidates: 5,
  /** New page: the judge picks a candidate with at least this probability → creation refused. */
  dupJudge: 0.7,
  /** New page, no judge: a candidate at least this close (cosine) → creation refused. Only the fallback of naming.ts when no model profile applies (embeddings off); the calibrated values are the ones of embed.ts PROFILES (here Qwen3-Embedding's). */
  dupCosine: 0.9,
  /** New page: candidates at least this close (cosine) are listed as a warning when the page is created. Same fallback role as `dupCosine`: the calibrated values are in embed.ts PROFILES. */
  dupWarn: 0.75,
  /** Ingest: pages close in meaning to the source offered to the judge (those it says the source updates go in the compile prompt). */
  routeCandidates: 10,
  /** Ingest: characters of the raw source the judge reads (it reads them once per candidate page). */
  routeChars: 1500,
  /** Ingest: the judge answers « yes » to « does the source bring something to this page? » at or above this (a hint to the agent: cheaper to be wrong than for a new-page check). */
  // default for d3-mini (best F1 0.68 at 0.53 on 1290 routing questions of a real wiki); Jev 1.13: 0.83 at 0.64, set judge.route_yes
  routeYes: 0.5,
  /** Journal entries shown by `cortex log` without `--limit`. */
  logEntries: 20,
  /** Tokens of the search snippet (FTS5 `snippet`). */
  snippetTokens: 12,
  /** Characters of the extract of a result that no word matched (found by its meaning): the start of its best section. */
  snippetChars: 160,
  /** Site question: wiki pages the search offers the judge, each judged alone against the question. */
  askCandidates: 16,
  /** Site question: a page the judge rates at or above this is retained (given in full to the agent, listed under the answer). */
  // first calibration on Jev, on another corpus (2026-11-22): the documents a right answer cites score 0.73 to 0.97, the breaks fall between 0.57 and 0.27; not calibrated on a wiki yet
  askRetained: 0.5,
  /** Site question: at or above this, below askRetained, a page is related (named to the agent, listed apart). */
  askRelated: 0.3,
  /** Site question: characters of the judged page the judge reads (title and description come first). */
  askJudgeChars: 2500,
  /** Site question: characters of retained pages given in full; the retained pages beyond it are only named. */
  askReadingChars: 40_000,
  /** Site question: characters kept of each earlier answer in the history sent with the question. */
  askHistoryChars: 4000,
  /** Site question: characters kept of each earlier question given to the judge. */
  askEarlierChars: 300,
  /** Site question: turns that may read (Read, Grep, Glob); then only the display tool is offered and the model must answer from what it has read (the pages are already given in full). */
  askToolRounds: 4,
  /** Site question: calls of the display tool (render_blocks) before no tool at all is offered and the model must write the answer (a model that lays out for ever never answers; observed: 98 calls in a row). */
  askLayoutCalls: 3,
  /** Judge: simultaneous calls of one batch (a search, a site question): a hosted model rate-limits, a local server queues. */
  judgeConcurrency: 6,
  /** Judge: scores kept in `.cortex/judge.db`, forgotten after this many days… */
  judgeCacheDays: 30,
  /** …and the oldest ones beyond this many rows. */
  judgeCacheRows: 20_000,
  /** Site search: results of `GET /api/search` without `limit`, and the most it ever returns. */
  searchLimit: 20,
  searchMaxLimit: 50,
  /** Site search: hits taken from the hybrid search before the operators filter them (a filter keeps a few of them). */
  searchPool: 300,
  /** Site search: longest query, in characters. */
  searchQueryChars: 500,
  /** Site search with the judge: the best hybrid hits (after the operators) judged against the query. */
  searchCandidates: 20,
  /** Site search with the judge: a page rated at or above this is retained; from `searchRelated` to it, related (same calibration as the site question: not calibrated on a wiki yet). */
  searchRetained: 0.5,
  searchRelated: 0.3,
  /** Site search with the judge: characters of the judged page the judge reads (title and description come first). */
  searchJudgeChars: 2500,
} as const;
