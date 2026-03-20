function inferSingleState(page, explicitStateId) {
  if (explicitStateId) return explicitStateId;
  if (page?.states?.length === 1) return page.states[0].id;
  return null;
}

function nodeLabel(page, stateId, fallback) {
  const state = stateId && page?.states?.find((entry) => entry.id === stateId);
  return state?.label || page?.label || fallback;
}

function edgeSection(sourceNode, targetNode) {
  const startPoint = {
    x: sourceNode.x + sourceNode.width,
    y: sourceNode.y + sourceNode.height / 2
  };
  const endPoint = {
    x: targetNode.x,
    y: targetNode.y + targetNode.height / 2
  };

  if (Math.abs(startPoint.y - endPoint.y) < 1) {
    return { startPoint, endPoint };
  }

  const midX = startPoint.x + Math.max(40, (endPoint.x - startPoint.x) / 2);
  return {
    startPoint,
    bendPoints: [
      { x: midX, y: startPoint.y },
      { x: midX, y: endPoint.y }
    ],
    endPoint
  };
}

function verticalSection(sourceNode, targetNode) {
  return {
    startPoint: {
      x: sourceNode.x + sourceNode.width / 2,
      y: sourceNode.y + sourceNode.height
    },
    endPoint: {
      x: targetNode.x + targetNode.width / 2,
      y: targetNode.y
    }
  };
}

function createVisualNode({
  id,
  pageId,
  stateId,
  label,
  visitIndex,
  manifestIndex,
  x,
  y,
  width,
  height
}) {
  return {
    id,
    pageId,
    stateId,
    visitIndex,
    manifestIndex,
    x,
    y,
    width,
    height,
    labels: [{ text: label }]
  };
}

function buildVisitNodes(pageId, explicitStateId, pageMap, stateCursor, seenPages, remainingVisits) {
  const page = pageMap.get(pageId);
  const states = page?.states || [];
  const visualNodes = [];

  if (explicitStateId) {
    visualNodes.push({
      pageId,
      stateId: explicitStateId,
      label: nodeLabel(page, explicitStateId, pageId),
      hasScreenshot: true
    });
    return visualNodes;
  }

  if (states.length === 0) {
    const firstVisit = !seenPages.has(pageId);
    seenPages.add(pageId);
    visualNodes.push({
      pageId,
      stateId: null,
      label: nodeLabel(page, null, pageId),
      hasScreenshot: firstVisit
    });
    return visualNodes;
  }

  if (states.length === 1) {
    const stateId = inferSingleState(page, null);
    const firstVisit = !seenPages.has(`${pageId}--${stateId}`);
    seenPages.add(`${pageId}--${stateId}`);
    visualNodes.push({
      pageId,
      stateId,
      label: nodeLabel(page, stateId, pageId),
      hasScreenshot: firstVisit
    });
    return visualNodes;
  }

  const cursor = stateCursor.get(pageId) || 0;
  const remainingStates = states.slice(cursor);
  if (remainingStates.length > 0) {
    const futureVisits = Math.max(0, (remainingVisits || 1) - 1);
    const consumeCount = Math.max(1, remainingStates.length - futureVisits);
    const visitStates = remainingStates.slice(0, consumeCount);
    stateCursor.set(pageId, cursor + visitStates.length);
    for (const state of visitStates) {
      visualNodes.push({
        pageId,
        stateId: state.id,
        label: nodeLabel(page, state.id, pageId),
        hasScreenshot: true
      });
    }
    return visualNodes;
  }

  visualNodes.push({
    pageId,
    stateId: null,
    label: nodeLabel(page, null, pageId),
    hasScreenshot: false
  });
  return visualNodes;
}

/**
 * Build a sequential journey layout with local vertical sub-journeys
 * for pages that emit multiple captured states in a single visit.
 */
export async function computeLayout(config) {
  const steps = config.steps || [];

  if (steps.length === 0) {
    throw new Error('No steps defined in config');
  }

  const pageMap = new Map(config.pages.map((page) => [page.id, page]));
  const stateCursor = new Map();
  const seenPages = new Set();
  const children = [];
  const edges = [];
  const visitGroups = [];
  const remainingVisitsByPage = new Map();

  const width = 200;
  const height = 120;
  const columnGap = 120;
  const rowGap = 80;
  const topY = 40;
  let manifestIndex = 0;
  let visitIndex = 0;
  let nodeIndex = 0;

  const visitSequence = [steps[0].from, ...steps.map((step) => step.to)];
  for (const pageId of visitSequence) {
    remainingVisitsByPage.set(pageId, (remainingVisitsByPage.get(pageId) || 0) + 1);
  }

  function materializeVisit(pageId, explicitStateId) {
    const visitsLeft = remainingVisitsByPage.get(pageId) || 0;
    const descriptors = buildVisitNodes(
      pageId,
      explicitStateId,
      pageMap,
      stateCursor,
      seenPages,
      visitsLeft
    );
    remainingVisitsByPage.set(pageId, visitsLeft - 1);
    const group = {
      pageId,
      visitIndex: visitIndex++,
      descriptors,
      nodes: []
    };
    visitGroups.push(group);
    return group;
  }

  const firstVisit = materializeVisit(steps[0].from, steps[0].fromState);
  let previousGroup = firstVisit;

  for (const step of steps) {
    const targetGroup = materializeVisit(step.to, step.toState);
    previousGroup.edgeLabel = step.label || '';
    previousGroup.nextGroup = targetGroup;
    previousGroup = targetGroup;
  }

  let xCursor = 40;
  for (let i = 0; i < visitGroups.length; i++) {
    const group = visitGroups[i];
    const nextGroup = visitGroups[i + 1];
    const returnGroup = visitGroups[i + 2];
    const isDetour =
      nextGroup &&
      returnGroup &&
      group.pageId === returnGroup.pageId &&
      group.pageId !== nextGroup.pageId;

    group.x = xCursor;
    group.baseY = topY;

    if (isDetour) {
      nextGroup.x = xCursor;
      nextGroup.baseY = topY + height + rowGap;
      returnGroup.x = xCursor + width + columnGap;
      returnGroup.baseY = topY;
      xCursor += 2 * (width + columnGap);
      i += 2;
      continue;
    }

    if (typeof group.x !== 'number') {
      group.x = xCursor;
      group.baseY = topY;
    }
    xCursor += width + columnGap;
  }

  visitGroups.forEach((group) => {
    const x = group.x;
    const baseY = group.baseY;

    group.descriptors.forEach((descriptor, stateIndex) => {
      const y = baseY + stateIndex * (height + rowGap);
      const node = createVisualNode({
        id: `n${nodeIndex++}-${descriptor.pageId}${descriptor.stateId ? `--${descriptor.stateId}` : ''}`,
        pageId: descriptor.pageId,
        stateId: descriptor.stateId,
        label: descriptor.label,
        visitIndex: group.visitIndex,
        manifestIndex: descriptor.hasScreenshot ? manifestIndex++ : null,
        x,
        y,
        width,
        height
      });
      children.push(node);
      group.nodes.push(node);
    });
  });

  visitGroups.forEach((group, index) => {
    for (let i = 0; i < group.nodes.length - 1; i++) {
      const sourceNode = group.nodes[i];
      const targetNode = group.nodes[i + 1];
      edges.push({
        id: `e-local-${index}-${i}`,
        sources: [sourceNode.id],
        targets: [targetNode.id],
        sections: [verticalSection(sourceNode, targetNode)],
        labels: []
      });
    }

    if (!group.nextGroup) return;

    const sourceNode = group.nodes[group.nodes.length - 1];
    const targetNode = group.nextGroup.nodes[0];
    edges.push({
      id: `e-main-${index}`,
      sources: [sourceNode.id],
      targets: [targetNode.id],
      sections: [edgeSection(sourceNode, targetNode)],
      labels: group.edgeLabel ? [{ text: group.edgeLabel }] : []
    });
  });

  return {
    id: 'root',
    children,
    edges
  };
}
