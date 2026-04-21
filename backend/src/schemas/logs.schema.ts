import { z } from 'zod';

export const recentLogsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(5000).optional()
});

export const filterLogsQuerySchema = z.object({
    tick: z.coerce.number().int().min(0).optional(),
    agentId: z.coerce.number().int().positive().optional(),
    companyId: z.string().min(1).optional(),
    correlationId: z.string().min(1).optional(),
    eventType: z.string().min(1).optional(),
    severity: z.enum(['info', 'warning', 'error']).optional(),
    limit: z.coerce.number().int().min(1).max(5000).optional()
});

export const agentActivityParamsSchema = z.object({
    agentId: z.coerce.number().int().positive()
});

export const companyActivityParamsSchema = z.object({
    companyId: z.string().min(1)
});
