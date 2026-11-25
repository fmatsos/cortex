# Design tokens

`tokens.json` is the single source of the Cortex colors and radius. Nothing else holds a palette by hand.

- `shared`: values that do not depend on the theme (`--radius: 0px`, square design).
- `light`, `dark`: the same set of tokens in both themes, as sRGB hex.
- `aliases`: tokens defined as `{--other-token}` (the `--trust-*` states), emitted once and resolved in each theme.
- `print`: overrides of `light` applied in print (black on white).

After an edit, run `bun run design`. `bun scripts/build-design.ts --check` fails if an output is stale and writes nothing; `src/design-tokens.test.ts` runs it.

Generated outputs (never edit them):

| File | Consumer |
|---|---|
| `site/src/lib/design/tokens.css` | Site, imported by `site/src/app.css` (`:root`, system dark, forced dark, print) |
| `extension/generated/cortex.css` | Plain extension pages (`:root`, system dark only) |
| `extension/generated/theme.js` | Classic script defining `CORTEX_THEME_CSS` with `:host` selectors, for Shadow DOM |
| `scripts/generated/cortex-css.ts` | `CORTEX_CSS` string for the share pages |

The last three are not wired to their consumers yet, and the distribution payload (`scripts/build.sh`) does not list them yet.

`src/theme.test.ts` measures the WCAG contrast of every text and graphical pair from the generated CSS.
