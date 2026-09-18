import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertFanOutAndHalt,
  connect,
  defineNode,
  runGraph,
} from "./graph.ts";
import * as graph from "./graph.ts";

test("public function names are the four primitives", () => {
  const names = Object.entries(graph)
    .filter(([, value]) => typeof value === "function")
    .map(([name]) => name)
    .sort();
  assert.deepEqual(names, [
    "assertFanOutAndHalt",
    "connect",
    "defineNode",
    "runGraph",
  ]);
});

test("a node is a one-shot function", () => {
  const prompt = defineNode("prompt", (q: string) => `answer:${q}`);
  const end = defineNode("end", (s: string) => s);
  const { output, trace } = runGraph(connect(prompt, end), "hi");
  assert.deepEqual(trace, ["prompt", "end"]);
  assert.equal(output, "answer:hi");
});

test("thought, action, and tool are the same Node shape", () => {
  const thought = defineNode("thought", (q: string) => `think:${q}`);
  const action = defineNode("action", (q: string) => `act:${q}`);
  const tool = defineNode("tool", (q: string) => `tool:${q}`);
  const linked = connect(action, tool, { graph: connect(thought, action) });
  const { output, trace } = runGraph(linked, "weather");
  assert.deepEqual(trace, ["thought", "action", "tool"]);
  assert.equal(output, "tool:act:think:weather");
});

test("a loop edge with when stops after the guard fails", () => {
  const llm = defineNode("llm", (n: number) => n + 1);
  const act = defineNode("act", (n: number) => n);
  const looped = connect(act, llm, {
    graph: connect(llm, act),
    when: (n) => n < 3,
  });
  const { output, trace } = runGraph(looped, 0);
  assert.deepEqual(trace, ["llm", "act", "llm", "act", "llm", "act"]);
  assert.equal(output, 3);
});

test("a cycle without halt guard throws", () => {
  const a = defineNode("a", (n: number) => n);
  const b = defineNode("b", (n: number) => n);
  const cycled = connect(b, a, { graph: connect(a, b) });
  assert.throws(() => runGraph(cycled, 0), { message: "cycle without halt guard" });
});

test("an unguarded self-loop throws", () => {
  const spin = defineNode("spin", (n: number) => n + 1);
  assert.throws(() => runGraph(connect(spin, spin), 0), {
    message: "cycle without halt guard",
  });
});

test("fan-out runs N stubs then halts", () => {
  const prompt = defineNode("prompt", (q: string) => q);
  const sf = defineNode("sf", (q: string) => `${q}:sf`);
  const la = defineNode("la", (q: string) => `${q}:la`);
  const { output, trace } = runGraph(connect(prompt, [sf, la]), "weather");
  assert.deepEqual(trace, ["prompt", "sf", "la"]);
  assert.deepEqual(output, ["weather:sf", "weather:la"]);
});

test("assertFanOutAndHalt fans 1 to N then terminates", () => {
  const { output, trace } = assertFanOutAndHalt(3);
  assert.deepEqual(trace, ["prompt", "agent-0", "agent-1", "agent-2"]);
  assert.deepEqual(output, ["weather:0", "weather:1", "weather:2"]);
});

test("assertFanOutAndHalt rejects n below 2", () => {
  assert.throws(() => assertFanOutAndHalt(1), {
    message: "n must be an integer >= 2",
  });
});

test("a when that never fails hits the internal ceiling", () => {
  const spin = defineNode("spin", (n: number) => n + 1);
  const looped = connect(spin, spin, { when: () => true });
  assert.throws(() => runGraph(looped, 0), { message: "halt guard never halted" });
});

test("defineNode rejects an empty id", () => {
  assert.throws(() => defineNode("", (x: string) => x), {
    message: "id must be a non-empty string",
  });
});

test("connect rejects a duplicate edge", () => {
  const from = defineNode("from", (x: string) => x);
  const to = defineNode("to", (x: string) => x);
  const once = connect(from, to);
  assert.throws(
    () => connect(from, to, { graph: once }),
    { message: "duplicate edge from -> to" },
  );
});
