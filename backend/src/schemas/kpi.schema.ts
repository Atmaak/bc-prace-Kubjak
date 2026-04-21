import { z } from 'zod';

export const companyKpiParamsSchema = z.object({
    id: z.coerce.number().int().positive()
});
