import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkJson } from '../packages/schema/json.js';

const limits = { depth: 4, containers: 8, values: 16, text: 32 };
const fail = message => { throw new Error(message); };

test('JSON preflight counts repeated values and containers without rejecting harmless sharing', () => {
  const shared = { value: 'x' };
  assert.doesNotThrow(() => checkJson([shared, shared], limits, fail));
  assert.throws(() => checkJson([shared, shared], { ...limits, containers: 2 }, fail), /structure limit/);
  assert.throws(() => checkJson([shared, shared], { ...limits, values: 4 }, fail), /value limit/);
  assert.throws(() => checkJson([shared, shared], { ...limits, text: 11 }, fail), /text limit/);
});

test('JSON preflight preserves the structural boundary and rejects hidden or non-JSON properties', () => {
  let value = {};
  for (let i = 0; i < limits.depth; i++) value = { value };
  assert.doesNotThrow(() => checkJson(value, { ...limits, text: 100 }, fail));
  assert.throws(() => checkJson({ value }, { ...limits, text: 100 }, fail), /structure limit/);
  const hidden = Object.defineProperty({}, 'value', { value: true });
  const arrayProperty = Object.assign([], { extra: true });
  for (const input of [hidden, arrayProperty, { value: 1n }]) assert.throws(() => checkJson(input, limits, fail), /JSON/);
  assert.doesNotThrow(() => checkJson(Object.create(null), limits, fail));
});
