import { Request, Response, NextFunction } from 'express';
import { z, ZodTypeAny } from 'zod';

type RequestSchemas = {
    params?: ZodTypeAny;
    query?: ZodTypeAny;
    body?: ZodTypeAny;
};

type ValidationErrorDetail = {
    path: string;
    message: string;
};

function formatZodError(error: z.ZodError): ValidationErrorDetail[] {
    return error.issues.map((issue) => ({
        path: issue.path.join('.') || 'root',
        message: issue.message
    }));
}

export function sendApiError(
    res: Response,
    status: number,
    code: string,
    message: string,
    details?: unknown
) {
    return res.status(status).json({
        ok: false,
        error: {
            code,
            message,
            details: details ?? null
        }
    });
}

export function validateRequest(schemas: RequestSchemas) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (schemas.params) {
            const parsed = schemas.params.safeParse(req.params);
            if (!parsed.success) {
                return sendApiError(res, 400, 'VALIDATION_ERROR', 'Invalid route params', formatZodError(parsed.error));
            }
            Object.assign(req.params, parsed.data);
        }

        if (schemas.query) {
            const parsed = schemas.query.safeParse(req.query);
            if (!parsed.success) {
                return sendApiError(res, 400, 'VALIDATION_ERROR', 'Invalid query params', formatZodError(parsed.error));
            }
            Object.assign(req.query as Record<string, unknown>, parsed.data);
        }

        if (schemas.body) {
            const parsed = schemas.body.safeParse(req.body);
            if (!parsed.success) {
                return sendApiError(res, 400, 'VALIDATION_ERROR', 'Invalid request body', formatZodError(parsed.error));
            }
            req.body = parsed.data;
        }

        next();
    };
}
