import { Router } from 'express';
import {
    getRecentLogs,
    filterLogs,
    getLogStats,
    getAgentActivity,
    getCompanyActivity,
    getAdaptiveStrategyMetrics,
    getCompanyAdaptiveMetrics,
    getMarketTelemetry,
    getFinalSummary,
    getAdaptiveStrategyLearningHistory
} from '../controllers/logs.controller';
import {
    getAllCompanyKPIs,
    getCompanyKPI,
    getKPIComparison,
    getKPIStatistics
} from '../controllers/kpi.controller';
import { validateRequest } from '../middleware/validation';
import { companyKpiParamsSchema } from '../schemas/kpi.schema';
import {
    agentActivityParamsSchema,
    companyActivityParamsSchema,
    filterLogsQuerySchema,
    recentLogsQuerySchema
} from '../schemas/logs.schema';

export const router = Router();

// Log retrieval endpoints
router.get('/logs/recent', validateRequest({ query: recentLogsQuerySchema }), getRecentLogs);
router.get('/logs/filter', validateRequest({ query: filterLogsQuerySchema }), filterLogs);
router.get('/logs/stats', getLogStats);
router.get('/agent/:agentId/activity', validateRequest({ params: agentActivityParamsSchema }), getAgentActivity);
router.get('/company/:companyId/activity', validateRequest({ params: companyActivityParamsSchema }), getCompanyActivity);

// Adaptive strategy endpoints
router.get('/strategies/adaptive/all', getAdaptiveStrategyMetrics);
router.get('/strategies/adaptive/:companyId', getCompanyAdaptiveMetrics);
router.get('/strategies/adaptive/learning/history', getAdaptiveStrategyLearningHistory);
router.get('/market/telemetry', getMarketTelemetry);

// KPI endpoints
router.get('/kpi/all', getAllCompanyKPIs);
router.get('/kpi/company/:id', validateRequest({ params: companyKpiParamsSchema }), getCompanyKPI);
router.get('/kpi/comparison', getKPIComparison);
router.get('/kpi/statistics', getKPIStatistics);

// Final summary endpoint
router.get('/sim/final-summary', getFinalSummary);
