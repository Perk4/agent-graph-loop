# agent-graph-loop

Four functions that build the graph from Andrew Ng and Harrison Chase's [AI Agents in LangGraph](https://www.youtube.com/watch?v=58n-n-3oRic).

A single prompt is one shot. An agent is a function you can call again. A loop needs a halt. A graph is those functions plus the arrows between them. This package is that sequence without LangGraph, without an LLM, and without a product.

The four functions are `defineNode`, `connect`, `runGraph`, and `assertFanOutAndHalt`.

`defineNode(id, runFn)` freezes a stub agent step. In the course the first agent is a Python class that calls a model. Here the step is the function. Thought, tool, and writer share this shape.

`connect(from, to, edge?)` returns a graph. `to` may be one node or a list. A list is fan-out, the same pattern as the course's parallel tool calls for weather in SF and weather in LA. Pass `{ graph }` to add an edge to an existing graph. `edge.when` is the halt guard. The course names that guard `should_continue`, `exists_action`, or `max_turns`. Here it is one predicate on the node's output. A back-edge with no `when` is a cycle without a halt guard.

`runGraph(graph, input)` starts at the first `connect` source, which is the course's entry point. It walks ready waves in connect order and returns `{ output, trace }`. `trace` lists node ids in visit order. The graph stops when no outgoing edge fires. Following an unguarded edge that closes a cycle of unguarded edges throws. A `when` that never returns false throws after 256 visits.

`assertFanOutAndHalt(n)` builds one source that fans to `n` stubs, asserts every stub appears in the trace, then asserts a ping-pong cycle without `when` throws.

Nodes do not call models. You own `runFn`.

```ts
import {
  assertFanOutAndHalt,
  connect,
  defineNode,
  runGraph,
} from "./src/graph.ts";

const prompt = defineNode("prompt", (q: string) => q);
const sf = defineNode("sf", (q: string) => `${q}:sf`);
const la = defineNode("la", (q: string) => `${q}:la`);
const { output, trace } = runGraph(connect(prompt, [sf, la]), "weather");

const llm = defineNode("llm", (n: number) => n + 1);
const act = defineNode("act", (n: number) => n);
const looped = connect(act, llm, {
  graph: connect(llm, act),
  when: (n) => n < 3,
});
runGraph(looped, 0);

assertFanOutAndHalt(3);
```

Fan-out `trace` is `["prompt", "sf", "la"]`. Fan-out `output` is `["weather:sf", "weather:la"]`.

## What this is not

No LangGraph. No checkpointer. No interrupt before a tool. No essay-writer UI. No model SDK.

## Run

```
npm test
```
