import { z } from 'zod';

export const companyOperationsParamsSchema = z.object({
    companyId: z.coerce.number().int().positive()
});

export const companyOperationsBodySchema = z.object({
    productionEnabled: z.boolean().optional(),
    storageEnabled: z.boolean().optional(),
}).refine((data) => data.productionEnabled !== undefined || data.storageEnabled !== undefined, {
    message: 'At least one of productionEnabled or storageEnabled must be provided',
    path: ['productionEnabled']
});
