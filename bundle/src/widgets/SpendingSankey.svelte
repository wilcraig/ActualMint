<script>
  import { sankey as d3SankeyLayout, sankeyLinkHorizontal } from 'd3-sankey';
  import { fetchApi } from '../api-client';

  // Same categorical chart palette + fallback every other widget uses
  // (AccountBalancesChart.svelte's convention) -- category and merchant
  // nodes under a group share that group's color, same as the donut/
  // treemap convention this plan's sibling task also uses.
  const CHART_QUAL_COUNT = 9;
  const FALLBACK_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

  function colorFor(index) {
    try {
      const varName = `--palette-chartQual${(index % CHART_QUAL_COUNT) + 1}`;
      const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      if (value) return value;
    } catch {
      // getComputedStyle can be unavailable in some test/SSR contexts --
      // fall through to the static fallback below.
    }
    return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  }

  // Zero-config, current-month only, same posture as burn-rate/month-end-net.
  function currentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  let groups = $state(null); // null while loading; [] when the month has no spending
  let categoriesByGroup = $state(null); // { [groupId]: slices[] }
  let payeesByCategory = $state({}); // { [categoryId]: slices[] } -- only present for expanded categories
  let expandedCategoryIds = $state(new Set());
  let errorMessage = $state(null);

  // Request-sequence guard, same pattern as CategoryBreakdownModal.svelte /
  // AccountBalancesChart.svelte: load() can in principle re-fire (e.g. a
  // future month picker), and a slower in-flight request shouldn't clobber
  // a newer one's result.
  let loadSeq = 0;

  async function load() {
    const seq = ++loadSeq;
    errorMessage = null;
    groups = null;
    categoriesByGroup = null;
    payeesByCategory = {};
    expandedCategoryIds = new Set();

    try {
      const month = currentMonth();
      const groupsResponse = await fetchApi(`/api/spending-breakdown?month=${month}&level=groups`);
      if (seq !== loadSeq) return;

      if (!groupsResponse.ok) {
        errorMessage = `Sankey unavailable (${groupsResponse.status})`;
        return;
      }

      const groupsData = await groupsResponse.json();
      if (seq !== loadSeq) return;

      if (groupsData.slices.length === 0) {
        groups = [];
        return;
      }

      // Categories for every group are fetched in parallel, not one at a
      // time -- there's no ordering dependency between them.
      const categoryEntries = await Promise.all(
        groupsData.slices.map(async (group) => {
          const response = await fetchApi(`/api/spending-breakdown?month=${month}&level=categories&groupId=${group.id}`);
          if (!response.ok) {
            throw new Error(`categories fetch failed (${response.status})`);
          }
          const data = await response.json();
          return [group.id, data.slices];
        }),
      );
      if (seq !== loadSeq) return;

      categoriesByGroup = Object.fromEntries(categoryEntries);
      groups = groupsData.slices;
    } catch {
      if (seq !== loadSeq) return;
      errorMessage = 'Sankey unavailable: could not reach actualmint-api.';
    }
  }

  load();

  // Clicking an unexpanded category fetches its payees and merges a 4th
  // merchant column into the graph; clicking an already-expanded one
  // removes that category's merchant nodes/links instead of re-fetching
  // (no duplication on a second click).
  async function toggleCategory(categoryId) {
    if (expandedCategoryIds.has(categoryId)) {
      const next = new Set(expandedCategoryIds);
      next.delete(categoryId);
      expandedCategoryIds = next;

      const nextPayees = { ...payeesByCategory };
      delete nextPayees[categoryId];
      payeesByCategory = nextPayees;
      return;
    }

    const next = new Set(expandedCategoryIds);
    next.add(categoryId);
    expandedCategoryIds = next;

    try {
      const month = currentMonth();
      const response = await fetchApi(`/api/spending-breakdown?month=${month}&level=payees&categoryId=${categoryId}`);
      if (!response.ok) {
        const reverted = new Set(expandedCategoryIds);
        reverted.delete(categoryId);
        expandedCategoryIds = reverted;
        return;
      }
      const data = await response.json();
      payeesByCategory = { ...payeesByCategory, [categoryId]: data.slices };
    } catch {
      const reverted = new Set(expandedCategoryIds);
      reverted.delete(categoryId);
      expandedCategoryIds = reverted;
    }
  }

  const WIDTH = 720;
  const HEIGHT = 420;
  const NODE_WIDTH = 16;
  const NODE_PADDING = 10;

  let isEmpty = $derived(groups !== null && groups.length === 0);
  let isLoading = $derived(groups === null && !errorMessage);

  // Builds the {nodes, links} graph and runs it through d3-sankey's layout
  // -- real connecting flow curves via sankeyLinkHorizontal(), not the
  // mockup's disconnected boxes. Node values are floored at 1 cent so a
  // zero-amount slice (shouldn't happen -- the API excludes those -- but
  // guards the degenerate case anyway) never collapses a link's width to 0
  // and breaks the layout.
  let graph = $derived.by(() => {
    if (!groups || groups.length === 0 || !categoriesByGroup) return null;

    const nodes = [{ id: 'income', label: 'Income', colorIndex: -1 }];
    const links = [];

    groups.forEach((group, groupIndex) => {
      const groupNodeId = `group:${group.id}`;
      nodes.push({ id: groupNodeId, label: group.label, colorIndex: groupIndex });
      links.push({ source: 'income', target: groupNodeId, value: Math.max(group.amountCents, 1) });

      const categories = categoriesByGroup[group.id] || [];
      categories.forEach((category) => {
        const catNodeId = `cat:${category.id}`;
        nodes.push({ id: catNodeId, label: category.label, colorIndex: groupIndex, categoryId: category.id });
        links.push({ source: groupNodeId, target: catNodeId, value: Math.max(category.amountCents, 1) });

        const payees = expandedCategoryIds.has(category.id) ? payeesByCategory[category.id] : null;
        if (payees) {
          payees.forEach((payee) => {
            const merchantNodeId = `merchant:${category.id}:${payee.id}`;
            nodes.push({ id: merchantNodeId, label: payee.label, colorIndex: groupIndex, merchant: true });
            links.push({ source: catNodeId, target: merchantNodeId, value: Math.max(payee.amountCents, 1) });
          });
        }
      });
    });

    const layout = d3SankeyLayout()
      .nodeId((d) => d.id)
      .nodeWidth(NODE_WIDTH)
      .nodePadding(NODE_PADDING)
      .extent([
        [1, 1],
        [WIDTH - 1, HEIGHT - 1],
      ]);

    // d3-sankey mutates its input, so pass fresh copies on every rebuild
    // rather than the arrays above directly.
    return layout({
      nodes: nodes.map((d) => ({ ...d })),
      links: links.map((d) => ({ ...d })),
    });
  });

  const linkPath = sankeyLinkHorizontal();

  function formatCents(cents) {
    return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  }
</script>

<div class="actualmint-spending-sankey">
  {#if errorMessage}
    <p class="sankey-error" role="alert">{errorMessage}</p>
  {:else if isLoading}
    <p class="sankey-loading">Loading spending flow…</p>
  {:else if isEmpty}
    <p class="sankey-empty">No spending to show.</p>
  {:else if graph}
    <svg
      class="sankey-svg"
      viewBox="0 0 {WIDTH} {HEIGHT}"
      role="img"
      aria-label="Monthly spending flow from income to group to category"
    >
      {#each graph.links as link, index (index)}
        <path
          class="sankey-link"
          d={linkPath(link)}
          fill="none"
          stroke={colorFor(Math.max(link.source.colorIndex, 0))}
          stroke-opacity="0.25"
          stroke-width={Math.max(link.width, 1)}
        />
      {/each}

      {#each graph.nodes as node (node.id)}
        {#if node.categoryId}
          <g
            class="sankey-node sankey-node--category"
            data-node-id={node.id}
            transform="translate({node.x0},{node.y0})"
            role="button"
            tabindex="0"
            aria-label={`${node.label}: click to ${expandedCategoryIds.has(node.categoryId) ? 'collapse' : 'expand'} merchants`}
            onclick={() => toggleCategory(node.categoryId)}
            onkeydown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleCategory(node.categoryId);
              }
            }}
          >
            <rect
              class="sankey-node-rect"
              width={Math.max(node.x1 - node.x0, 1)}
              height={Math.max(node.y1 - node.y0, 1)}
              fill={node.colorIndex >= 0 ? colorFor(node.colorIndex) : '#6b7280'}
            />
            <text class="sankey-node-label" x={node.x1 - node.x0 + 6} y={(node.y1 - node.y0) / 2} dy="0.35em">
              {node.label}
            </text>
          </g>
        {:else}
          <g class="sankey-node" data-node-id={node.id} transform="translate({node.x0},{node.y0})">
            <rect
              class="sankey-node-rect"
              width={Math.max(node.x1 - node.x0, 1)}
              height={Math.max(node.y1 - node.y0, 1)}
              fill={node.colorIndex >= 0 ? colorFor(node.colorIndex) : '#6b7280'}
            />
            <text class="sankey-node-label" x={node.x1 - node.x0 + 6} y={(node.y1 - node.y0) / 2} dy="0.35em">
              {node.label}
            </text>
          </g>
        {/if}
      {/each}
    </svg>
  {/if}
</div>

<style>
  .actualmint-spending-sankey {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
    /* Establishes this widget's own box (not the viewport) as the sizing
       context, since it's mounted into a host element of unpredictable
       width inside an Actual report page. */
    container-type: inline-size;
  }

  .sankey-error {
    color: #b91c1c;
    font-weight: 600;
  }

  .sankey-loading,
  .sankey-empty {
    color: #555;
  }

  .sankey-svg {
    width: 100%;
    height: auto;
  }

  .sankey-node-rect {
    stroke: #fff;
    stroke-width: 1;
  }

  .sankey-node--category {
    cursor: pointer;
  }

  .sankey-node--category:hover .sankey-node-rect,
  .sankey-node--category:focus-visible .sankey-node-rect {
    opacity: 0.8;
    outline: none;
  }

  .sankey-node-label {
    font-size: 10px;
    fill: #111827;
    dominant-baseline: middle;
  }
</style>
