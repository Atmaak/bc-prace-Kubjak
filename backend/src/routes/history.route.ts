import { Router } from 'express';
import {
    getSimulationHistoryList,
    getSimulationDetail,
    getSnapshotAtTick,
    getCompanyKPITimeline,
    deleteSimulation,
    exportSimulationDataset
} from '../controllers/history.controller';
import { validateRequest } from '../middleware/validation';
import {
    companyTimelineParamsSchema,
    exportQuerySchema,
    simulationIdParamsSchema,
    snapshotParamsSchema
} from '../schemas/history.schema';

export const router = Router();

// Get all simulations history
router.get('/', getSimulationHistoryList);

// Get detail of a specific simulation
router.get('/:id', validateRequest({ params: simulationIdParamsSchema }), getSimulationDetail);

// Get snapshot at specific tick
router.get('/:id/snapshot/:tick', validateRequest({ params: snapshotParamsSchema }), getSnapshotAtTick);

// Get KPI timeline for a simulation (all companies or specific company)
router.get('/:id/kpi-timeline', validateRequest({ params: companyTimelineParamsSchema }), getCompanyKPITimeline);
router.get('/:id/kpi-timeline/:companyId', validateRequest({ params: companyTimelineParamsSchema }), getCompanyKPITimeline);

// Export dataset for experiment analysis (format=json|csv, mode=final|timeline)
router.get('/:id/export', validateRequest({ params: simulationIdParamsSchema, query: exportQuerySchema }), exportSimulationDataset);

// Delete a simulation
router.delete('/:id', validateRequest({ params: simulationIdParamsSchema }), deleteSimulation);
