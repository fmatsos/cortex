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
  /** `cortex upgrade`: download of a ~90 MB binary. */
  upgradeTimeoutMs: 300_000,
  /** How long `opencode serve` has to announce that it listens. */
  opencodeStartMs: 30_000,
  /** A source still `pending` after this many days is reported by lint. */
  pendingDays: 7,
  /** Title taken from the first line of a PDF, cut to this many characters. */
  pdfTitleChars: 120,
  /** Title taken from the first line of a plain text, cut to this many characters. */
  textTitleChars: 80,
  /** Related pages kept per page on the site. */
  relatedPages: 8,
  /** Journal entries shown by `cortex log` without `--limit`. */
  logEntries: 20,
  /** Tokens of the search snippet (FTS5 `snippet`). */
  snippetTokens: 12,
} as const;
