import { z } from 'zod';

export const simulationIdParamsSchema = z.object({
    id: z.string().min(1)
});

export const snapshotParamsSchema = z.object({
    id: z.string().min(1),
    tick: z.coerce.number().int().min(0)
});

export const companyTimelineParamsSchema = z.object({
    id: z.string().min(1),
    companyId: z.coerce.number().int().positive().optional()
});

export const exportQuerySchema = z.object({
    format: z.enum(['json', 'csv']).optional(),
    mode: z.enum(['final', 'timeline']).optional()
});
