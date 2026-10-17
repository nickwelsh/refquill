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

test('the release explicitly passes the required Cloudflare environment secrets', () => {
    const publish = workflow('publish');
    const docs = workflow('docs');
    const names = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
    assert.deepEqual(Object.keys(publish.jobs.docs.secrets).sort(), [...names].sort());
    for (const name of names) {
        assert.equal(publish.jobs.docs.secrets[name], '${{ secrets.' + name + ' }}');
        assert.equal(docs.on.workflow_call.secrets[name].required, true);
    }
    const deploy = docs.jobs.deploy.steps.find((step) => step.name === 'Deploy the exact verified assets');
    for (const name of names) {
        assert.equal(deploy.env[name], '${{ secrets.' + name + ' }}');
        assert.ok(deploy.run.includes('test -n "$' + name + '"'));
    }
});

test('manual release retries can preserve existing npm stages while deploying docs', () => {
    const publish = workflow('publish');
    assert.equal(publish.on.workflow_dispatch.inputs['stage-npm'].type, 'boolean');
    assert.equal(publish.on.workflow_dispatch.inputs['stage-npm'].default, true);
    assert.equal(publish.jobs.stage.if, "github.event_name != 'workflow_dispatch' || inputs.stage-npm");
    assert.deepEqual(publish.jobs['github-release'].needs, 'stage');
    assert.deepEqual(publish.jobs.docs.needs, ['verify', 'packages']);
    assert.ok(!publish.jobs.docs.if);
});
