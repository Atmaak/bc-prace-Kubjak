import { Router } from 'express';
import {
    getExperimentById,
    getLatestExperiment,
    listExperiments,
    runExperiments,
    downloadExperimentById,
    downloadLatestExperiment
} from '../controllers/experiments.controller';
import { validateRequest } from '../middleware/validation';
import { experimentIdParamsSchema, runExperimentsBodySchema } from '../schemas/experiments.schema';

export const router = Router();

router.get('/', listExperiments);
router.get('/latest', getLatestExperiment);
router.get('/latest/download', downloadLatestExperiment);
router.get('/:id', validateRequest({ params: experimentIdParamsSchema }), getExperimentById);
router.get('/:id/download', validateRequest({ params: experimentIdParamsSchema }), downloadExperimentById);
router.post('/run', validateRequest({ body: runExperimentsBodySchema }), runExperiments);
