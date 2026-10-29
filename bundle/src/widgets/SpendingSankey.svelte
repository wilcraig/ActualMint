<script>
  import { sankey as d3SankeyLayout, sankeyLeft, sankeyLinkHorizontal } from 'd3-sankey';
  import { fetchApi } from '../api-client';

  const CHART_QUAL_COUNT = 9;
  const FALLBACK_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
  const INCOME_COLOR = '#0ea5e9';
  const SAVINGS_COLOR = '#22c55e';
  const SHORTFALL_COLOR = '#9ca3af';

  function colorFor(index) {
    try {
      const varName = `--palette-chartQual${(index % CHART_QUAL_COUNT) + 1}`;
      const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      if (value) return value;
    } catch {
      // getComputedStyle can be unavailable in some test/SSR contexts.
    }
    return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  }

  function currentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  let flow = $state(null); // /api/cash-flow response; null while loading
  let payeesByCategory = $state({});
  let expandedCategoryIds = $state(new Set());
  let errorMessage = $state(null);
  let containerWidth = $state(0);

  async function load() {
    try {
      const response = await fetchApi(`/api/cash-flow?month=${currentMonth()}`);
      if (!response.ok) {
        errorMessage = `Sankey unavailable (${response.status})`;
        return;
      }
      flow = await response.json();
    } catch {
      errorMessage = 'Sankey unavailable: could not reach actualmint-api.';
    }
  }

  load();

  // Clicking a category adds a merchant column for it; clicking again removes it.
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

    expandedCategoryIds = new Set(expandedCategoryIds).add(categoryId);
    const revert = () => {
      const reverted = new Set(expandedCategoryIds);
      reverted.delete(categoryId);
      expandedCategoryIds = reverted;
    };
    try {
      const response = await fetchApi(`/api/spending-breakdown?month=${currentMonth()}&level=payees&categoryId=${categoryId}`);
      if (!response.ok) return revert();
      const data = await response.json();
      payeesByCategory = { ...payeesByCategory, [categoryId]: data.slices };
    } catch {
      revert();
    }
  }

  const NODE_WIDTH = 12;
  const NODE_PADDING = 22;
  const FLOW_HEIGHT = 320; // vertical room left for the flows themselves, beyond node padding
  const LABEL_MARGIN = 240; // right-hand room for the last column's labels

  let isLoading = $derived(flow === null && !errorMessage);
  let isEmpty = $derived(flow !== null && flow.incomeCents === 0 && flow.spendingCents === 0);

  let graph = $derived.by(() => {
    if (!flow || isEmpty) return null;

    const nodes = [];
    const links = [];
    const shortfallCents = Math.max(flow.spendingCents - flow.incomeCents, 0);
    const savedCents = Math.max(flow.incomeCents - flow.spendingCents, 0);
    const totalCents = flow.incomeCents + shortfallCents;

    flow.income.forEach((source, index) => {
      nodes.push({ id: `src:${source.id}`, label: source.label, color: INCOME_COLOR, order: index });
      links.push({ source: `src:${source.id}`, target: 'income', value: source.amountCents });
    });
    if (shortfallCents > 0) {
      nodes.push({ id: 'src:shortfall', label: 'From savings', color: SHORTFALL_COLOR, order: flow.income.length });
      links.push({ source: 'src:shortfall', target: 'income', value: shortfallCents });
    }

    nodes.push({ id: 'income', label: flow.incomeCents > 0 ? 'Income' : 'Spending', color: INCOME_COLOR, order: 0 });

    if (savedCents > 0) {
      nodes.push({ id: 'savings', label: 'Saved', color: SAVINGS_COLOR, order: -1 });
      links.push({ source: 'income', target: 'savings', value: savedCents });
    }

    flow.groups.forEach((group, groupIndex) => {
      const color = colorFor(groupIndex);
      const groupNodeId = `group:${group.id}`;
      nodes.push({ id: groupNodeId, label: group.label, color, order: groupIndex });
      links.push({ source: 'income', target: groupNodeId, value: group.amountCents });

      group.categories.forEach((category, categoryIndex) => {
        const order = groupIndex * 1000 + categoryIndex;
        const catNodeId = `cat:${category.id}`;
        nodes.push({ id: catNodeId, label: category.label, color, order, categoryId: category.id });
        links.push({ source: groupNodeId, target: catNodeId, value: category.amountCents });

        const payees = expandedCategoryIds.has(category.id) ? payeesByCategory[category.id] : null;
        (payees || []).forEach((payee, payeeIndex) => {
          const merchantNodeId = `merchant:${category.id}:${payee.id}`;
          nodes.push({ id: merchantNodeId, label: payee.label, color, order: order * 1000 + payeeIndex });
          links.push({ source: catNodeId, target: merchantNodeId, value: Math.max(payee.amountCents, 1) });
        });
      });
    });

    const width = Math.max(containerWidth || 900, 600);
    // Size the chart so the densest column's padding never eats the flow
    // area -- a fixed height is what collapsed every link to a hairline.
    const maxColumn = Math.max(
      flow.income.length + (shortfallCents > 0 ? 1 : 0),
      flow.groups.length + (savedCents > 0 ? 1 : 0),
      flow.groups.reduce((n, g) => n + g.categories.length, 0),
      Object.values(payeesByCategory).reduce((n, p) => n + p.length, 0),
    );
    const height = Math.max(360, maxColumn * NODE_PADDING + FLOW_HEIGHT);

    const layout = d3SankeyLayout()
      .nodeId((d) => d.id)
      .nodeAlign(sankeyLeft)
      .nodeWidth(NODE_WIDTH)
      .nodePadding(NODE_PADDING)
      .nodeSort((a, b) => a.order - b.order)
      .extent([
        [1, 12],
        [width - LABEL_MARGIN, height - 12],
      ]);

    const result = layout({ nodes: nodes.map((d) => ({ ...d })), links: links.map((d) => ({ ...d })) });
    const maxDepth = Math.max(...result.nodes.map((n) => n.depth));
    return { ...result, width, height, maxDepth, totalCents };
  });

  const linkPath = sankeyLinkHorizontal();

  function formatDollars(cents) {
    return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  }

  function formatPercent(cents, totalCents) {
    if (!totalCents) return '';
    const pct = (cents / totalCents) * 100;
    return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
  }
</script>

<div class="actualmint-spending-sankey" bind:clientWidth={containerWidth}>
  {#if errorMessage}
    <p class="sankey-error" role="alert">{errorMessage}</p>
  {:else if isLoading}
    <p class="sankey-loading">Loading cash flow…</p>
  {:else if isEmpty}
    <p class="sankey-empty">No income or spending this month yet.</p>
  {:else if graph}
    <svg
      class="sankey-svg"
      width={graph.width}
      height={graph.height}
      viewBox="0 0 {graph.width} {graph.height}"
      role="img"
      aria-label="This month's cash flow from income to savings and spending groups and categories"
    >
      {#each graph.links as link, index (index)}
        <path
          class="sankey-link"
          d={linkPath(link)}
          fill="none"
          stroke={link.target.color}
          stroke-opacity="0.3"
          stroke-width={Math.max(link.width, 1)}
        >
          <title>{link.source.label} → {link.target.label}: {formatDollars(link.value)}</title>
        </path>
      {/each}

      {#snippet nodeBody(node)}
        {@const labelX = node.x1 - node.x0 + 6}
        {@const midY = (node.y1 - node.y0) / 2}
        {@const amount = `${formatDollars(node.value)} (${formatPercent(node.value, graph.totalCents)})`}
        <rect class="sankey-node-rect" width={node.x1 - node.x0} height={Math.max(node.y1 - node.y0, 2)} rx="2" fill={node.color} />
        <!-- Two lines need ~28px; thin nodes sit only NODE_PADDING apart, so they get one line. -->
        {#if node.depth === graph.maxDepth || node.y1 - node.y0 < 14}
          <text class="sankey-node-label" x={labelX} y={midY} dy="0.35em">
            <tspan class="sankey-node-name">{node.label}</tspan>
            <tspan class="sankey-node-amount" dx="6">{amount}</tspan>
          </text>
        {:else}
          <text class="sankey-node-label" x={labelX} y={midY} dy="-0.25em">
            <tspan class="sankey-node-name">{node.label}</tspan>
            <tspan class="sankey-node-amount" x={labelX} dy="1.2em">{amount}</tspan>
          </text>
        {/if}
      {/snippet}

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
            {@render nodeBody(node)}
          </g>
        {:else}
          <g class="sankey-node" data-node-id={node.id} transform="translate({node.x0},{node.y0})">
            {@render nodeBody(node)}
          </g>
        {/if}
      {/each}
    </svg>
  {/if}
</div>

<style>
  .actualmint-spending-sankey {
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
    overflow-x: auto;
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
    display: block;
  }

  .sankey-link:hover {
    stroke-opacity: 0.55;
  }

  .sankey-node--category {
    cursor: pointer;
  }

  .sankey-node--category:hover .sankey-node-rect,
  .sankey-node--category:focus-visible .sankey-node-rect {
    opacity: 0.75;
    outline: none;
  }

  .sankey-node-label {
    font-size: 12px;
    fill: var(--color-pageText, #111827);
    paint-order: stroke;
    stroke: var(--color-pageBackground, #fff);
    stroke-width: 3px;
    stroke-linejoin: round;
    pointer-events: none;
  }

  .sankey-node--category .sankey-node-label {
    pointer-events: auto;
  }

  .sankey-node-name {
    font-weight: 600;
  }

  .sankey-node-amount {
    fill: var(--color-pageTextSubdued, #6b7280);
  }
</style>
