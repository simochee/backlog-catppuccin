# Backlog Catppuccin

A personal Catppuccin userstyle for Backlog, built with LESS and the official
[Catppuccin userstyles standard library](https://userstyles.catppuccin.com/contributing/reference/libraries/standard/v/v1/).
Choose any of the four flavors independently for Backlog's light and dark
appearance, plus an accent color shared by project themes.

This is an unofficial project and is not affiliated with Nulab or Catppuccin.
Phase 1 maps public CSS color tokens; visual verification is still pending.

## Install

1. Install [Stylus](https://github.com/openstyles/stylus#releases) for your browser.
2. Open the [raw userstyle](https://github.com/simochee/backlog-catppuccin/raw/main/catppuccin.user.less)
   and choose **Install style** in Stylus. During development, import the contents
   of `catppuccin.user.less` using Stylus's **Import** action.
3. In the style's settings, choose **Light Flavor**, **Dark Flavor**, and **Accent**.
4. Visit your Backlog space and switch Backlog's appearance setting to test both
   modes. The style follows the site's `.dark-mode` class on the root element.

All subdomains of `backlog.com`, `backlog.jp`, and `backlogtool.com` are included.
An internet connection is needed to resolve the standard library during compilation.

## Development

Use Node.js 24 or newer and npm. Install the pinned dependencies:

```sh
npm ci --ignore-scripts
```

Extract color-variable **names**, one per line:

```sh
npm run --silent extract
```

Check live color-variable coverage (exits nonzero on missing assignments):

```sh
npm run check:coverage
```

Compile all four flavors and check RGB triplets and independent appearance switching:

```sh
npm run check:less
```

Run extraction and coverage regression tests:

```sh
npm test
```

Regenerate the dark-mode accent-surface text selectors, or check the committed
block against live CSS (the latter runs in the non-required coverage CI job):

```sh
npm run generate:dark-text
npm run check:dark-text
```

Generated text rules retain the site's dark selector specificity and declaration
importance, so more specific states keep their colors. Generation and freshness
checks also print non-dark color selectors with equal or greater specificity
that share a BEM block. This conservative report includes ancestors, descendants
and different conditional contexts; it does not prove that selectors overlap or
cause a visible conflict and does not fail the check. Confirmed transparent
subtask chips and migration-card links are restored separately by hand.

The extractor discovers stylesheet URLs at runtime from the public error page
at `https://simochee.backlog.com/this-page-does-not-exist`, then adds the Common,
ReactApp, Kanban, Wiki, Git, Documents, React index and global-bar bundles from
the discovered version path; it never signs in. Missing discovered bundles
(HTTP 404) are skipped with a warning; other fetch failures remain errors.
Set `BACKLOG_PAGE_URL` to override the discovery page (relative stylesheet links
are resolved against that URL). Discovered stylesheets outside HTTPS
`assets.backlog.com` are skipped with a warning on stderr.
Optional extra stylesheet URLs can be supplied after `--` to extraction,
coverage, generation or freshness checking. Use the same extras for generation
and checking, including authenticated-page AI/document bundle URLs when available.
Only HTTPS URLs on `assets.backlog.com` are accepted:

```sh
npm run check:coverage -- "$EXTRA_STYLESHEET_URL"
npm run --silent extract -- "$EXTRA_STYLESHEET_URL"
npm run generate:dark-text -- "$EXTRA_STYLESHEET_URL"
npm run check:dark-text -- "$EXTRA_STYLESHEET_URL"
```

Downloads stay in memory. Neither downloaded CSS/HTML nor original variable
values are written to disk by these scripts. Extraction stdout contains names
only; source diagnostics and exclusions go to stderr. The compile check also
loads the remote standard library into memory, producing no generated files.

Color literals, named colors, color functions, RGB triplets, and references to
known color tokens are recognized. Numbers and dimensions are excluded. Composite
shadows and gradients are reported separately as `excluded-composite` and left
unchanged in Phase 1. Coverage counts all discovered color variables, then reports
the assignable count and missing assignments separately. Passing coverage does
not mean every visible color is themed: direct colors, runtime styles, and CSS
only linked on authenticated pages remain for the human's Stylus check.

The scaffold follows the [official MIT-licensed template](https://github.com/catppuccin/userstyles/blob/main/template/catppuccin.user.less).
