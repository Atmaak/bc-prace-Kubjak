import { Router } from 'express';
import { getState, start, startLearning, pause, stop, reset, setCompanyOperations, getLearningModeStatus } from '../controllers/controls.controller';
import { validateRequest } from '../middleware/validation';
import { companyOperationsBodySchema, companyOperationsParamsSchema } from '../schemas/controls.schema';

export const router = Router();

router.get('/sim/state', getState)

router.post('/sim/start', start)

router.post('/sim/start-learning', startLearning)

router.post('/sim/pause', pause)

router.post('/sim/stop', stop)

router.post('/sim/reset', reset)

router.get('/learning-mode/status', getLearningModeStatus)

router.post(
    '/company/:companyId/operations',
    validateRequest({
        params: companyOperationsParamsSchema,
        body: companyOperationsBodySchema
    }),
    setCompanyOperations
)