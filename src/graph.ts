import assert from "node:assert/strict";

export type Node<I = unknown, O = unknown> = Readonly<{
  id: string;
  run: (input: I) => O;
}>;

export type EdgeSpec<T = unknown> = Readonly<{
  when?: (value: T) => boolean;
  graph?: Graph;
}>;

type StoredNode = Readonly<{
  id: string;
  run: (input: unknown) => unknown;
}>;

type StoredEdge = Readonly<{
  from: string;
  to: string;
  when?: (value: unknown) => boolean;
}>;

export type Graph = Readonly<{
  entry: string;
  nodes: Readonly<Record<string, StoredNode>>;
  edges: readonly StoredEdge[];
}>;

export type RunResult = Readonly<{
  output: unknown;
  trace: readonly string[];
}>;

const LOOP_CEILING = 256;

export function defineNode<I, O>(id: string, runFn: (input: I) => O): Node<I, O> {
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("id must be a non-empty string");
  }
  if (typeof runFn !== "function") {
    throw new Error("runFn must be a function");
  }
  return Object.freeze({ id, run: runFn });
}

export function connect<I, T>(
  from: Node<I, T>,
  to: Node<T, unknown> | readonly Node<T, unknown>[],
  edge?: EdgeSpec<T>,
): Graph {
  const source = asNode(from, "from");
  const targets = asTargets(to);
  const base = edge?.graph;
  if (base !== undefined && !isGraph(base)) {
    throw new Error("edge.graph must be a graph");
  }
  return addEdges(base ?? blankGraph(source.id), source, targets, edge);
}

export function runGraph(graph: Graph, input: unknown): RunResult {
  if (!isGraph(graph)) {
    throw new Error("graph is required");
  }
  const start = graph.nodes[graph.entry];
  if (start === undefined) {
    throw new Error("entry is required");
  }
  for (const edge of graph.edges) {
    if (graph.nodes[edge.from] === undefined || graph.nodes[edge.to] === undefined) {
      throw new Error("unknown node");
    }
  }

  const visits = new Map<string, number>();
  let wave: Readonly<{ id: string; value: unknown }>[] = [
    { id: start.id, value: input },
  ];
  const trace: string[] = [];
  let lastOutputs: unknown[] = [];

  while (wave.length > 0) {
    const next: { id: string; value: unknown }[] = [];
    lastOutputs = [];
    for (const item of wave) {
      const node = graph.nodes[item.id];
      if (node === undefined) {
        throw new Error("unknown node");
      }
      const output = node.run(item.value);
      trace.push(node.id);
      lastOutputs.push(output);
      visits.set(node.id, (visits.get(node.id) ?? 0) + 1);
      if (trace.length > LOOP_CEILING) {
        throw new Error("halt guard never halted");
      }
      for (const edge of graph.edges) {
        if (edge.from !== node.id) {
          continue;
        }
        if (edge.when !== undefined && !edge.when(output)) {
          continue;
        }
        const seen = (visits.get(edge.to) ?? 0) > 0;
        if (seen && edge.when === undefined && unguardedCycle(graph, edge)) {
          throw new Error("cycle without halt guard");
        }
        next.push({ id: edge.to, value: output });
      }
    }
    wave = next;
  }

  const output = lastOutputs.length === 1 ? lastOutputs[0] : lastOutputs;
  return Object.freeze({ output, trace: Object.freeze(trace) });
}

export function assertFanOutAndHalt(n = 3): RunResult {
  if (!Number.isInteger(n) || n < 2) {
    throw new Error("n must be an integer >= 2");
  }
  const prompt = defineNode("prompt", (q: string) => q);
  const agents: Node<string, string>[] = [];
  for (let i = 0; i < n; i += 1) {
    const index = i;
    agents.push(defineNode(`agent-${index}`, (q: string) => `${q}:${index}`));
  }
  const fanned = runGraph(connect(prompt, agents), "weather");
  const expectedTrace = ["prompt", ...agents.map((agent) => agent.id)];
  const expectedOutput = agents.map((_, i) => `weather:${i}`);
  assert.deepEqual(fanned.trace, expectedTrace);
  assert.deepEqual(fanned.output, expectedOutput);

  const a = defineNode("loop-a", (x: number) => x);
  const b = defineNode("loop-b", (x: number) => x);
  assert.throws(
    () => runGraph(connect(b, a, { graph: connect(a, b) }), 0),
    { message: "cycle without halt guard" },
  );

  return fanned;
}

function unguardedCycle(graph: Graph, closing: StoredEdge): boolean {
  const seen = new Set<string>([closing.to]);
  const queue = [closing.to];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined) {
      break;
    }
    for (const edge of graph.edges) {
      if (edge.from !== id || edge.when !== undefined) {
        continue;
      }
      if (edge.to === closing.from) {
        return true;
      }
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return false;
}

function blankGraph(entry: string): Graph {
  return freezeGraph({ entry, nodes: {}, edges: [] });
}

function addEdges(
  graph: Graph,
  from: StoredNode,
  targets: readonly StoredNode[],
  opts: EdgeSpec<unknown> | undefined,
): Graph {
  const nodes: Record<string, StoredNode> = { ...graph.nodes };
  putNode(nodes, from);
  const edges = [...graph.edges];
  const when = opts?.when;
  for (const target of targets) {
    putNode(nodes, target);
    const duplicate = edges.some(
      (edge) => edge.from === from.id && edge.to === target.id,
    );
    if (duplicate) {
      throw new Error(`duplicate edge ${from.id} -> ${target.id}`);
    }
    const edge: StoredEdge =
      when === undefined
        ? { from: from.id, to: target.id }
        : { from: from.id, to: target.id, when: bindWhen(when) };
    edges.push(Object.freeze(edge));
  }
  return freezeGraph({ entry: graph.entry, nodes, edges });
}

function putNode(nodes: Record<string, StoredNode>, node: StoredNode): void {
  const existing = nodes[node.id];
  if (existing !== undefined && existing.run !== node.run) {
    throw new Error(`duplicate node id: ${node.id}`);
  }
  nodes[node.id] = node;
}

function bindWhen<T>(when: (value: T) => boolean): (value: unknown) => boolean {
  return (value) => when(value as T);
}

function freezeGraph(graph: Graph): Graph {
  Object.freeze(graph.nodes);
  Object.freeze(graph.edges);
  return Object.freeze(graph);
}

function isGraph(x: object): x is Graph {
  return "entry" in x && "nodes" in x && "edges" in x;
}

function isNode(x: unknown): x is StoredNode {
  return (
    typeof x === "object" &&
    x !== null &&
    "id" in x &&
    "run" in x &&
    typeof (x as StoredNode).run === "function" &&
    typeof (x as StoredNode).id === "string"
  );
}

function asNode(x: unknown, label: string): StoredNode {
  if (!isNode(x)) {
    throw new Error(`${label} must be a node`);
  }
  return x;
}

function asTargets(x: unknown): readonly StoredNode[] {
  if (isNode(x)) {
    return [x];
  }
  if (Array.isArray(x) && x.length > 0 && x.every(isNode)) {
    return x;
  }
  throw new Error("to must be a node or a non-empty array of nodes");
}
