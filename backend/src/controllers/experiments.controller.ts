import { Request, Response } from 'express';
import { experimentRunner } from '../services/experimentRunner';
import { sendApiError } from '../middleware/validation';

export function downloadExperimentById(req: Request, res: Response) {
    try {
        const id = String(req.params.id);
        const experiment = experimentRunner.getById(id);
        if (!experiment) {
            return sendApiError(res, 404, 'NOT_FOUND', `Experiment ${id} not found`);
        }
        const safeId = id.endsWith('.json') ? id : `${id}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${safeId}"`);
        return res.send(JSON.stringify(experiment, null, 2));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return sendApiError(res, 500, 'EXPERIMENT_READ_FAILED', message);
    }
}

export function downloadLatestExperiment(_req: Request, res: Response) {
    try {
        const latest = experimentRunner.getLatest();
        if (!latest) {
            return sendApiError(res, 404, 'NOT_FOUND', 'No experiment result found');
        }
        const filename = `${latest.experimentId}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(JSON.stringify(latest, null, 2));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return sendApiError(res, 500, 'EXPERIMENT_READ_FAILED', message);
    }
}

export function runExperiments(req: Request, res: Response) {
    try {
        const body = req.body as {
            runsPerStrategy?: number;
            tickCount?: number;
            seedPrefix?: string;
            adaptiveCarryoverLearning?: boolean;
        };

        const runConfig: {
            runsPerStrategy?: number;
            tickCount?: number;
            seedPrefix?: string;
            adaptiveCarryoverLearning?: boolean;
        } = {};

        if (typeof body.runsPerStrategy === 'number') {
            runConfig.runsPerStrategy = body.runsPerStrategy;
        }
        if (typeof body.tickCount === 'number') {
            runConfig.tickCount = body.tickCount;
        }
        if (typeof body.seedPrefix === 'string') {
            runConfig.seedPrefix = body.seedPrefix;
        }
        if (typeof body.adaptiveCarryoverLearning === 'boolean') {
            runConfig.adaptiveCarryoverLearning = body.adaptiveCarryoverLearning;
        }

        const result = experimentRunner.run(runConfig);

        return res.json({
            ok: true,
            experiment: result
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return sendApiError(res, 500, 'EXPERIMENT_RUN_FAILED', message);
    }
}

export function listExperiments(_req: Request, res: Response) {
    try {
        const files = experimentRunner.list();
        return res.json({
            ok: true,
            count: files.length,
            files
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return sendApiError(res, 500, 'EXPERIMENT_LIST_FAILED', message);
    }
}

export function getLatestExperiment(_req: Request, res: Response) {
    try {
        const latest = experimentRunner.getLatest();
        if (!latest) {
            return sendApiError(res, 404, 'NOT_FOUND', 'No experiment result found');
        }

        return res.json({
            ok: true,
            experiment: latest
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return sendApiError(res, 500, 'EXPERIMENT_READ_FAILED', message);
    }
}

export function getExperimentById(req: Request, res: Response) {
    try {
        const id = String(req.params.id);
        if (!id) {
            return sendApiError(res, 400, 'VALIDATION_ERROR', 'Experiment id is required');
        }

        const experiment = experimentRunner.getById(id);
        if (!experiment) {
            return sendApiError(res, 404, 'NOT_FOUND', `Experiment ${id} not found`);
        }

        return res.json({
            ok: true,
            experiment
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return sendApiError(res, 500, 'EXPERIMENT_READ_FAILED', message);
    }
}
