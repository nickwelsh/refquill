// Shared preflight before recursive schema validation. Never invoke input getters.
export function checkJson(input, limits, fail) {
  const active = new Set();
  const stack = [{ value: input, depth: 0 }];
  let containers = 0;
  let values = 0;
  let text = 0;
  while (stack.length) {
    const { value, depth, leave } = stack.pop();
    if (leave) { active.delete(value); continue; }
    if (++values > limits.values) fail('JSON value limit exceeded');
    if (typeof value === 'string') {
      text += value.length;
      if (text > limits.text) fail('text limit exceeded');
      continue;
    }
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) continue;
    if (typeof value !== 'object') fail('expected plain JSON values');
    if (depth > limits.depth || ++containers > limits.containers) fail('JSON structure limit exceeded');
    if (active.has(value)) fail('cyclic JSON');
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) fail('expected plain JSON objects');
    active.add(value);
    stack.push({ value, leave: true });
    if (Array.isArray(value) && value.length > limits.values - values) fail('JSON value limit exceeded');
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key === 'symbol')) fail('symbol keys are not JSON');
    if (Array.isArray(value) && keys.length !== value.length + 1) fail('expected a dense JSON array');
    if (keys.length - (Array.isArray(value) ? 1 : 0) > limits.values - values) fail('JSON value limit exceeded');
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (Array.isArray(value) && key === 'length') continue;
      if (!('value' in descriptor) || !descriptor.enumerable) fail('expected plain JSON properties');
      if (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key)) fail('unexpected array property');
      text += key.length;
      if (text > limits.text) fail('text limit exceeded');
      stack.push({ value: descriptor.value, depth: depth + 1 });
    }
  }
}
