import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const { parse } = createRequire(new URL('../apps/docs/package.json', import.meta.url))('yaml');
const workflow = (name) => parse(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));

test('only version tags can reach the docs deployment workflow', () => {
    const publish = workflow('publish');
    const docs = workflow('docs');
    const ci = workflow('ci');
    assert.deepEqual(publish.on.push, { tags: ['v*'] });
    assert.deepEqual(Object.keys(docs.on), ['workflow_call']);
    assert.match(docs.jobs.deploy.if, /github.ref_type == 'tag'/);
    assert.deepEqual(ci.on.push, { branches: ['**'] });
    assert.ok(!Object.values(ci.jobs).some((job) => job.uses === './.github/workflows/docs.yml'));
});

test('docs deployment waits for verification and package tests and reuses their artifact', () => {
    const publish = workflow('publish');
    const docs = workflow('docs');
    const ci = workflow('ci');
    assert.deepEqual(publish.jobs.docs.needs, ['verify', 'packages']);
    assert.equal(publish.jobs.docs.uses, './.github/workflows/docs.yml');
    const uploaded = ci.jobs.verify.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
    const downloaded = docs.jobs.deploy.steps.find((step) => step.uses?.startsWith('actions/download-artifact@'));
    assert.equal(uploaded.with.name, 'docs-worker');
    assert.equal(downloaded.with.name, uploaded.with.name);
    assert.ok(ci.jobs.verify.steps.some((step) => step.run === 'pnpm docs:smoke'));
    assert.equal(docs.jobs.deploy.environment.name, 'cloudflare');
    assert.ok(!docs.jobs.deploy.steps.some((step) => step.run?.includes('docs:build')));
});
