// Chromium's native multi-input summation order depends on node addresses.
// Binary sums are commutative; a connection-ordered chain makes rounding repeatable.
export function stableAudioSums() {
  const proto = AudioNode.prototype, connect = proto.connect, disconnect = proto.disconnect;
  const destinations = new WeakMap(), sources = new WeakMap();
  function remove(edge) {
    disconnect.call(edge.source, edge.tap, edge.output, 0);
    disconnect.call(edge.tap);
    edge.bus.edges.delete(edge);
  }
  proto.connect = function (destination, output = 0, input = 0) {
    let inputs = destinations.get(destination);
    if (!inputs) destinations.set(destination, inputs = new Map());
    let bus = inputs.get(input);
    if (!bus) {
      const root = this.context.createGain();
      if (destination instanceof AudioNode) connect.call(root, destination, 0, input);
      else connect.call(root, destination);
      inputs.set(input, bus = { tail: root, edges: new Set() });
    }
    let edges = sources.get(this);
    if (!edges) sources.set(this, edges = new Set());
    if (![...edges].some(e => e.destination === destination && e.output === output && e.input === input)) {
      const tap = this.context.createGain(), sum = this.context.createGain();
      // Grow towards the sources so existing downstream connections never move.
      connect.call(sum, bus.tail);
      connect.call(tap, bus.tail);
      connect.call(this, tap, output, 0);
      const edge = { source: this, destination, output, input, tap, bus };
      edges.add(edge); bus.edges.add(edge); bus.tail = sum;
    }
    return destination instanceof AudioNode ? destination : undefined;
  };
  proto.disconnect = function (...args) {
    const edges = sources.get(this);
    if (!edges) return disconnect.apply(this, args);
    const [destination, output, input] = args;
    for (const edge of [...edges]) {
      const matches = !args.length || (typeof destination === 'number' ? edge.output === destination :
        edge.destination === destination && (output === undefined || edge.output === output) && (input === undefined || edge.input === input));
      if (matches) { remove(edge); edges.delete(edge); }
    }
  };
  return () => { proto.connect = connect; proto.disconnect = disconnect; };
}

export async function withStableAudioSums(render) {
  const restore = stableAudioSums();
  try { return await render(); }
  finally { restore(); }
}
