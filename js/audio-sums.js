export const AUDIO_CONNECT = Symbol('audioConnect');
export const AUDIO_ROUTE = Symbol('audioRoute');
const installed = new WeakMap();

// Fix the order of native multi-input sums before the offline audio thread runs.
export function deterministicAudioSums(ctx, { incremental = false } = {}) {
  if (typeof BaseAudioContext === 'undefined') return () => {};
  if (installed.has(ctx)) return installed.get(ctx);
  const connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect;
  const gain = ctx.createGain.bind(ctx), destinations = new WeakMap(), sources = new WeakMap(), dirty = new Set();
  function wire(destination, output = 0, input = 0) {
    let edges = sources.get(this);
    if (edges && [...edges].some(e => e.destination === destination && e.output === output && e.input === input)) return destination instanceof AudioNode ? destination : undefined;
    const result = connect.apply(this, arguments);
    let inputs = destinations.get(destination);
    if (!inputs) destinations.set(destination, inputs = new Map());
    let bus = inputs.get(input);
    if (!bus) inputs.set(input, bus = { destination, input, edges: new Set(), nodes: [] });
    if (!edges) sources.set(this, edges = new Set());
    const edge = { source: this, destination, output, input, target: destination, targetInput: input, bus };
    if (incremental) {
      if (!bus.tail) {
        bus.tail = gain();
        if (destination instanceof AudioNode) connect.call(bus.tail, destination, 0, input);
        else connect.call(bus.tail, destination);
      }
      if (destination instanceof AudioNode) disconnect.call(this, destination, output, input);
      else disconnect.call(this, destination, output);
      const tap = gain(), sum = gain();
      connect.call(sum, bus.tail); connect.call(tap, bus.tail); connect.call(this, tap, output, 0);
      bus.tail = sum;
      edge.target = tap; edge.targetInput = 0; edge.tap = tap;
    }
    edges.add(edge); bus.edges.add(edge); dirty.add(bus);
    return result;
  }
  function unwire(...args) {
    const edges = sources.get(this), [destination, output, input] = args;
    const matches = edges && [...edges].filter(e => !args.length || (typeof destination === 'number' ? e.output === destination :
      e.destination === destination && (output === undefined || e.output === output) && (input === undefined || e.input === input)));
    if (!matches?.length) return disconnect.apply(this, args);
    for (const edge of matches) {
      if (edge.target instanceof AudioNode) disconnect.call(this, edge.target, edge.output, edge.targetInput);
      else disconnect.call(this, edge.target, edge.output);
      if (edge.tap) disconnect.call(edge.tap);
      edges.delete(edge); edge.bus.edges.delete(edge); dirty.add(edge.bus);
    }
  }
  const attach = (child, destination, input = 0) => {
    const source = child.source || child.node, output = child.output || 0;
    if (destination instanceof AudioNode) connect.call(source, destination, output, input);
    else connect.call(source, destination, output);
    if (child.source) { child.target = destination; child.targetInput = input; }
  };
  const flush = () => {
    if (incremental) { dirty.clear(); return; }
    for (const bus of dirty) {
      const fanIn = bus.destination instanceof AudioParam || bus.destination.channelCountMode !== 'max' ? 1 : 2;
      if (bus.edges.size <= fanIn && !bus.nodes.length) continue;
      for (const edge of bus.edges) {
        if (edge.target instanceof AudioNode) disconnect.call(edge.source, edge.target, edge.output, edge.targetInput);
        else disconnect.call(edge.source, edge.target, edge.output);
      }
      for (const node of bus.nodes) disconnect.call(node);
      bus.nodes = [];
      let level = [...bus.edges];
      while (level.length > fanIn) {
        const next = [];
        for (let i = 0; i < level.length; i += 2) {
          if (i + 1 === level.length) { next.push(level[i]); continue; }
          const node = gain(); bus.nodes.push(node);
          attach(level[i], node); attach(level[i + 1], node);
          next.push({ node });
        }
        level = next;
      }
      for (const child of level) attach(child, bus.destination, bus.input);
    }
    dirty.clear();
  };
  ctx[AUDIO_CONNECT] = wire;
  for (const name of Object.getOwnPropertyNames(BaseAudioContext.prototype).filter(n => n.startsWith('create'))) {
    const create = ctx[name].bind(ctx);
    ctx[name] = (...args) => {
      const node = create(...args);
      if (node instanceof AudioNode) {
        node.connect = function (...args) { return (ctx[AUDIO_ROUTE] || wire).apply(this, args); };
        node.disconnect = unwire;
      }
      return node;
    };
  }
  installed.set(ctx, flush);
  return flush;
}
