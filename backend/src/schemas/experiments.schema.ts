import { z } from 'zod';

export const runExperimentsBodySchema = z.object({
    runsPerStrategy: z.coerce.number().int().min(10).max(500).optional(),
    tickCount: z.coerce.number().int().min(1).max(20000).optional(),
    seedPrefix: z.string().min(1).max(200).optional(),
    adaptiveCarryoverLearning: z.coerce.boolean().optional()
});

export const experimentIdParamsSchema = z.object({
    id: z.string().min(1)
});
