# Hosting the Insights page: DOM and routing notes

Findings from a live spike (2026-10-29) against a local demo stack:
`insights-proxy` -> ABT sidecar `ghcr.io/aelxxs/abt-sidecar:0.1.100` ->
`ghcr.io/actualbudget/actual:26.10.0`, demo budget ("Try the demo"),
Chromium 1400x900. Class names with a hash suffix (`css-*` from emotion,
`svelte-*` from ABT's Svelte build) change between releases: never select on
them. Clone them from a live sibling instead.

## Routing: `/actual-insights` does not survive a refresh

- The server side is fine: `GET /actual-insights` (and `/actual-insights/`)
  through the proxy returns the same app shell as `/budget`, with the
  Insights bundle injected.
- The client side is not: Actual's router has a catch-all that redirects any
  unknown path to `/budget` (`history.replaceState`, hash dropped). A direct
  load or refresh of `/actual-insights#summaries` lands on `/budget`.
- Redirects drop the hash too: `/` -> `/budget`, `/reports` ->
  `/reports/<dashboard-id>`, and our own once-per-tab `/budget` -> `/reports`
  redirect (`redirect.js`, which uses `location.href`).
- A hash on a concrete route survives a refresh untouched:
  `/budget#actual-insights`, `/schedules#…`, `/payees#…`, `/accounts#…`,
  `/settings#actual-insights/channels`, `/reports/<id>#actual-insights` were
  all still in the address bar after load.

**Decision (the plan's fallback):** hash-only route. The page is open when
`location.hash` is `#actual-insights` or `#actual-insights/<tab>`, on
whatever path the user is on; opening it pushes the hash onto the current
path. Actual keeps rendering the current route underneath (react-router
never sees the change), so no route of Actual's is involved. `redirect.js`
must not redirect when the hash is an Insights hash, or a first load of a
bookmarked `/budget#actual-insights` in a new tab would lose it.

Leaving the page needs no work: every Actual nav item navigates through
react-router, which pushes a new path without our hash.

## Main content region (what the page covers)

Same for both sidebars:

```
<div class="css-…">                      main column, right of the sidebar
  <div class="css-…">                    title bar, ~49px tall
    … <button data-testid="help-menu-button"> …
  </div>
  <div class="css-…">                    notifications (0px tall)
  <div class="css-…">                    (0px tall)
  <div class="css-…">                    page content (fills the rest)
</div>
```

Find it from the only stable hook, `[data-testid="help-menu-button"]`: climb
while the parent is under 100px tall; that element is the title bar. The
content region is the title bar's tallest following sibling. Cover it, leave
the sidebar and the title bar visible.

## Sidebars

Only one sidebar is visible at a time. With ABT's "Live sidebar" on, Actual's
own sidebar is still in the DOM but laid out at 0x0; with it off, there is no
`.sidebar` element at all.

### Actual's own sidebar

Container: `[data-testid="sidebar-primary-buttons"]`. Each item is a wrapper
`div` around a react-router `a[href]`:

```html
<div data-testid="sidebar-primary-buttons" class="css-15mvrs5">
  <div class="css-15mvrs5"><a class="css-1trtw0g" href="/budget" data-discover="true"><div class="css-1myt2vd"><svg width="15" height="15" viewBox="0 0 20 20" style="color: inherit;">…</svg><div class="css-1isemmb">Budget</div><div class="css-1y7d8dh"></div></div></a></div>
  <div class="css-15mvrs5"><a class="css-1trtw0g" href="/reports" data-discover="true"><div class="css-1myt2vd"><svg width="15" height="15" viewBox="0 0 20 20" style="color: inherit;">…</svg><div class="css-1isemmb">Reports</div><div class="css-1y7d8dh"></div></div></a></div>
  <div class="css-15mvrs5"><a class="css-1trtw0g" href="/schedules" data-discover="true">…Schedules…</a></div>
  <div class="css-276q18"><button …>…More…</button></div>
  <div class="css-15mvrs5"><a class="css-e5dykp" href="/payees">…</a></div>
  …
</div>
```

Selected state: the active link gets a different emotion class plus
`class="… active"` and `aria-current="page"` (e.g.
`<a aria-current="page" class="css-7iovzr active" href="/budget">`). Computed:
accent color text and a 4px accent `border-left`; inactive links have no
border. Insert our item after the Schedules wrapper (before "More").

### ABT live sidebar, Standard layout

```html
<div class="sidebar transitions-ready" role="presentation">
  …
  <nav class="nav svelte-1lvh2r">
    <button type="button" class="nav-link svelte-1lvh2r"><span class="nav-icon svelte-1lvh2r"><svg …/></span> <span class="nav-label svelte-1lvh2r">Budget</span></button>
    <button type="button" class="nav-link svelte-1lvh2r"><span class="nav-icon svelte-1lvh2r"><svg …/></span> <span class="nav-label svelte-1lvh2r">Reports</span></button>
    <button type="button" class="nav-link svelte-1lvh2r"><span class="nav-icon svelte-1lvh2r"><svg …/></span> <span class="nav-label svelte-1lvh2r">Schedules</span></button>
    <!----> <!---->
    <button type="button" class="nav-link svelte-1lvh2r active" aria-expanded="false">…Settings…</button>
  </nav>
  …
</div>
```

Selected state: `.active` class (accent-tinted background). Items are
`button`s that navigate through Actual; there is no `href`.

### ABT live sidebar, Split layout (icon bar)

```html
<div class="sidebar split transitions-ready" role="presentation">
  <div class="activity-bar">
    <button class="rail-avatar svelte-11repqg" aria-label="Change budget icon">TB</button>
    <button class="rail-icon svelte-11repqg" aria-label="Search">…</button>
    <div class="rail-nav svelte-11repqg">
      <button type="button" class="rail-icon svelte-11repqg active" aria-label="Budget"><svg class="lucide lucide-layout-grid lucide-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" …>…</svg></button>
      <button type="button" class="rail-icon svelte-11repqg" aria-label="Reports">…</button>
      <button type="button" class="rail-icon svelte-11repqg" aria-label="Schedules">…</button>
    </div>
    <div class="rail-divider svelte-11repqg"></div>
    <div class="rail-nav svelte-11repqg"><!-- Payees, Tags, Rules, Bank Sync, Settings --></div>
    <div class="rail-spacer svelte-11repqg"></div>
    <div class="rail-foot svelte-11repqg">…</div>
  </div>
  <div class="split-panel">…budget name, search, accounts…</div>
</div>
```

Icon-only, labelled by `aria-label`. Selected state: `.active`. Insert after
the Schedules button in the first `.rail-nav`.

## Name clash to know about

ABT already has a button labelled "Insights" on the Budget page
(`#abt-template-plan-trigger`, `aria-label="Open insights"`, top right of the
budget table), which opens its template-planning drawer. Our sidebar entry is
also "Insights"; they are different features.

## Other gotchas seen

- Actual rate-limits static files: a dozen full page loads in a few minutes
  return `429 Too many requests` for `/data/migrations/*.sql` and the app
  fails to load. Prefer in-app navigation when testing.
- Turning ABT's live sidebar on/off and switching Standard/Split applies
  immediately, without a reload.
