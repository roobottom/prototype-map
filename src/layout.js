import ELK from 'elkjs';

const elk = new ELK();

/**
 * Build an ELK graph from config journeys and compute layout.
 *
 * Returns { nodes: [{id, x, y, width, height, label, pageId, stateId}], edges: [{id, source, target, label, sections}] }
 */
export async function computeLayout(config, journeyId) {
  const journeys = journeyId
    ? config.journeys.filter(j => j.id === journeyId)
    : config.journeys;

  if (journeys.length === 0) {
    throw new Error(journeyId ? `Journey "${journeyId}" not found` : 'No journeys defined in config');
  }

  // Collect unique nodes and edges across selected journeys
  const nodeMap = new Map();
  const edges = [];

  const pageMap = new Map(config.pages.map(p => [p.id, p]));

  for (const journey of journeys) {
    for (const step of journey.steps) {
      // Add source node
      const sourceKey = step.fromState ? `${step.from}--${step.fromState}` : step.from;
      if (!nodeMap.has(sourceKey)) {
        const page = pageMap.get(step.from);
        const state = step.fromState && page?.states?.find(s => s.id === step.fromState);
        nodeMap.set(sourceKey, {
          id: sourceKey,
          pageId: step.from,
          stateId: step.fromState || null,
          label: state?.label || page?.label || step.from
        });
      }

      // Add target node
      const targetKey = step.toState ? `${step.to}--${step.toState}` : step.to;
      if (!nodeMap.has(targetKey)) {
        const page = pageMap.get(step.to);
        const state = step.toState && page?.states?.find(s => s.id === step.toState);
        nodeMap.set(targetKey, {
          id: targetKey,
          pageId: step.to,
          stateId: step.toState || null,
          label: state?.label || page?.label || step.to
        });
      }

      // Add edge
      edges.push({
        id: `${sourceKey}->${targetKey}`,
        sources: [sourceKey],
        targets: [targetKey],
        label: step.label || ''
      });
    }
  }

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '60',
      'elk.layered.spacing.nodeNodeBetweenLayers': '120',
      'elk.spacing.edgeLabel': '20',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX'
    },
    children: Array.from(nodeMap.values()).map(node => ({
      id: node.id,
      width: 200,
      height: 120,
      labels: [{ text: node.label }],
      // Store custom data
      pageId: node.pageId,
      stateId: node.stateId
    })),
    edges: edges.map(e => ({
      id: e.id,
      sources: e.sources,
      targets: e.targets,
      labels: e.label ? [{ text: e.label }] : []
    }))
  };

  const layoutResult = await elk.layout(graph);
  return layoutResult;
}
