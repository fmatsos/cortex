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
  /** New page, no judge: a candidate at least this close (cosine) → creation refused. Not calibrated yet. */
  dupCosine: 0.85,
  /** New page: candidates at least this close (cosine) are listed as a warning when the page is created. Not calibrated yet. */
  dupWarn: 0.6,
  /** Ingest: pages close in meaning to the source offered to the judge (those it says the source updates go in the compile prompt). */
  routeCandidates: 10,
  /** Ingest: characters of the raw source the judge reads (it reads them once per candidate page). */
  routeChars: 1500,
  /** Ingest: the judge answers « yes » to « does the source bring something to this page? » at or above this (a hint to the agent: cheaper to be wrong than for a new-page check). */
  routeYes: 0.5,
  /** Pipeline routing: candidate pages (core, one-link neighbours, shared tags) kept before the judge sorts them. */
  pipelineCandidatesPool: 30,
  /** Journal entries shown by `cortex log` without `--limit`. */
  logEntries: 20,
  /** Tokens of the search snippet (FTS5 `snippet`). */
  snippetTokens: 12,
  /** Queue: an entry still open after this many days is reported by lint (info). */
  queueStaleDays: 30,
  /** Pipeline: a source above this many tokens (estimated at 4 characters per token) is cut into chunks of about this size, one extraction each. */
  pipelineChunkTokens: 6000,
  /** Pipeline: tokens of the previous chunk repeated (last paragraph, at most) at the head of the next one, so that no reasoning is cut. */
  pipelineChunkOverlap: 300,
  /** Pipeline: characters of a fact's quote (the proof that the source says it); cortex does not copy it to the page. */
  pipelineQuoteChars: 200,
} as const;
