export const manufacturedGraphLimits = Object.freeze({ executions: 32, depth: 32 });
const reject = code => { throw Object.assign(new Error(code), { status: 409, code }); };

export const manufacturedTraversal = () => ({ active: new Set(), visited: new Set(), completed: new Map() });

export async function visitManufacturedNode(walk, id, read) {
  if (walk.active.has(id)) reject('MANUFACTURED_GRAPH_CYCLE');
  if (walk.completed.has(id)) return walk.completed.get(id);
  walk.visited.add(id);
  if (walk.visited.size > manufacturedGraphLimits.executions || walk.active.size >= manufacturedGraphLimits.depth) reject('MANUFACTURED_GRAPH_LIMIT');
  walk.active.add(id);
  try {
    const result = await read();
    walk.completed.set(id, result);
    return result;
  } finally { walk.active.delete(id); }
}

export function consumedManufacturedAncestry(receipts, directReceiptIds) {
  return [...new Set([...directReceiptIds, ...receipts.flatMap(receipt => receipt.consumedAncestryReceiptIds || receipt.consumedReceiptIds)])].sort();
}
