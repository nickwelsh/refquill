import { metaSchema } from 'fumadocs-core/source/schema';
import { z } from 'zod';

const badgeSchema = z.string().trim().min(1);
const versionSchema = z.object({
    status: z.enum(['latest', 'stable', 'deprecated']).default('stable'),
    badges: z.array(badgeSchema).default([]),
});

export const docsMetaSchema = metaSchema.extend({ version: versionSchema.optional() });
