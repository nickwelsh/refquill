import assert from 'node:assert/strict';
import test from 'node:test';
import { docsMetaSchema } from '../src/lib/docs-metadata.ts';

void test('version metadata supports status and custom badges without changing folder metadata', () => {
    const meta = docsMetaSchema.parse({
        title: '1.x',
        root: 'version',
        pages: ['index'],
        version: { status: 'latest', badges: [' LTS '] },
    });
    assert.equal(meta.root, 'version');
    assert.deepEqual(meta.pages, ['index']);
    assert.deepEqual(meta.version, { status: 'latest', badges: ['LTS'] });
    assert.deepEqual(docsMetaSchema.parse({ version: {} }).version, { status: 'stable', badges: [] });
    assert.equal(docsMetaSchema.parse({ title: 'Guides', root: 'section' }).version, undefined);
});

void test('invalid version statuses and empty badges fail metadata validation', () => {
    assert.equal(docsMetaSchema.safeParse({ version: { status: 'unknown' } }).success, false);
    assert.equal(docsMetaSchema.safeParse({ version: { badges: [' '] } }).success, false);
});
