import { Request, Response } from 'express';
import { SimulationEngine } from '../simulation';
import { StrategyFactory } from '../utils/strategyFactory';
import { AdaptiveStrategy } from '../types/strategie/AdaptiveStrategy';
import { TypSuroviny } from '../types/typSuroviny';
import { generateSimulationFinalSummary } from '../services/summary.service';
import { getLearningHistory } from '../utils/adaptiveStrategyLearning';

let simulation: SimulationEngine | null = null;

export function setSimulation(sim: SimulationEngine) {
    simulation = sim;
}

/**
 * Get recent logs (last N events)
 */
export function getRecentLogs(req: Request, res: Response) {
    if (!simulation) {
        return res.status(503).json({ error: 'Simulation not initialized' });
    }

    try {
        const limit = parseInt(req.query.limit as string) || 100;
        const logger = simulation.getLogger();
        const events = logger.getRecentEvents(limit);
        
        res.json({
            count: events.length,
            events
        });
    } catch (err) {
        res.status(500).json({ 
            error: err instanceof Error ? err.message : 'Unknown error' 
        });
    }
}

/**
 * Filter logs by criteria
 */
export function filterLogs(req: Request, res: Response) {
    if (!simulation) {
        return res.status(503).json({ error: 'Simulation not initialized' });
    }

    try {
        const {
            tick,
            agentId,
            companyId,
            correlationId,
            eventType,
            severity,
            limit = 200
        } = req.query;

        const logger = simulation.getLogger();
        const filter: any = {};

        if (tick) filter.tick = parseInt(tick as string);
        if (agentId) filter.agentId = parseInt(agentId as string);
        if (companyId) filter.companyId = companyId;
        if (correlationId) filter.correlationId = correlationId;
        if (eventType) filter.eventType = eventType;
        if (severity) filter.severity = severity;

        let events = logger.filterEvents(filter);
        
        // Apply limit
        const limitNum = parseInt(limit as string) || 200;
        events = events.slice(-limitNum);

        res.json({
            count: events.length,
            filter,
            events
        });
    } catch (err) {
        res.status(500).json({ 
            error: err instanceof Error ? err.message : 'Unknown error' 
        });
    }
}

/**
 * Get log statistics
 */
export function getLogStats(req: Request, res: Response) {
    if (!simulation) {
        return res.status(503).json({ error: 'Simulation not initialized' });
    }

    try {
        const logger = simulation.getLogger();
        const stats = {
            totalEvents: logger.getEventCount(),
            logFilePath: logger.getLogFilePath()
        };
        
        res.json(stats);
    } catch (err) {
        res.status(500).json({ 
            error: err instanceof Error ? err.message : 'Unknown error' 
        });
    }
}

/**
 * Get all agents and their activity
 */
export function getAgentActivity(req: Request, res: Response) {
    if (!simulation) {
        return res.status(503).json({ error: 'Simulation not initialized' });
    }

    try {
        const logger = simulation.getLogger();
        const agentId = parseInt(req.params.agentId as string);
        
        if (isNaN(agentId)) {
            return res.status(400).json({ error: 'Invalid agentId' });
        }

        const events = logger.filterEvents({ agentId });
        
        res.json({
            agentId,
            eventCount: events.length,
            events: events.slice(-100) // Last 100 events
        });
    } catch (err) {
        res.status(500).json({ 
            error: err instanceof Error ? err.message : 'Unknown error' 
        });
    }
}

/**
 * Get company activity
 */
export function getCompanyActivity(req: Request, res: Response) {
    if (!simulation) {
        return res.status(503).json({ error: 'Simulation not initialized' });
    }

    try {
        const logger = simulation.getLogger();
        const companyId = req.params.companyId as string;
        
        if (!companyId) {
            return res.status(400).json({ error: 'Missing companyId' });
        }

        const events = logger.filterEvents({ companyId });
        
        res.json({
            companyId,
            eventCount: events.length,
            events: events.slice(-100) // Last 100 events
        });
    } catch (err) {
        res.status(500).json({ 
            error: err instanceof Error ? err.message : 'Unknown error' 
        });
    }
}

/**
 * Get adaptive strategy performance metrics
 */
export function getAdaptiveStrategyMetrics(req: Request, res: Response) {
    try {
        const allAdaptive = StrategyFactory.getAllAdaptiveInstances();
        
        const metrics = allAdaptive.map(strategy => {
            if (strategy instanceof AdaptiveStrategy) {
                return strategy.getPerformanceMetrics();
            }
            return null;
        }).filter(m => m !== null);

        res.json({
            adaptiveStrategiesCount: allAdaptive.length,
            metrics
        });
    } catch (err) {
        res.status(500).json({ 
            error: err instanceof Error ? err.message : 'Unknown error' 
        });
    }
}

/**
 * Get specific adaptive strategy metrics by company ID
 */
export function getCompanyAdaptiveMetrics(req: Request, res: Response) {
    try {
        const companyId = req.params.companyId as string;
        const strategy = StrategyFactory.getAdaptiveInstance(companyId);

        if (!strategy || !(strategy instanceof AdaptiveStrategy)) {
            return res.status(404).json({ 
                error: `No adaptive strategy found for company ${companyId}` 
            });
        }

        res.json({
            companyId,
            metrics: strategy.getPerformanceMetrics()
        });
    } catch (err) {
        res.status(500).json({ 
            error: err instanceof Error ? err.message : 'Unknown error' 
        });
    }
}

/**
 * Get current market telemetry for steel
 */
export function getMarketTelemetry(req: Request, res: Response) {
    if (!simulation) {
        return res.status(503).json({ error: 'Simulation not initialized' });
    }

    try {
        const region = simulation.getRegion();
        const market = region.getMarketTelemetry(TypSuroviny.OCEL);

        res.json({
            tick: simulation.getCurrentTick(),
            market
        });
    } catch (err) {
        res.status(500).json({
            error: err instanceof Error ? err.message : 'Unknown error'
        });
    }
}

/**
 * Generate final summary from current simulation state and recent logs
 */
export async function getFinalSummary(req: Request, res: Response) {
    if (!simulation) {
        return res.status(503).json({ error: 'Simulation not initialized' });
    }

    try {
        const logLimit = Number(process.env.SUMMARY_LOG_EVENTS_LIMIT || 120);
        const finalState = simulation.serializeState();
        const recentLogs = simulation.getLogger().getRecentEvents(logLimit);
        const finalSummary = await generateSimulationFinalSummary({ finalState, recentLogs });

        res.json({
            ok: true,
            finalSummary,
            finalState
        });
    } catch (err) {
        res.status(500).json({
            error: err instanceof Error ? err.message : 'Unknown error'
        });
    }
}

/**
 * Get adaptive strategy learning history across all simulations
 * Shows progression of weights and success rates over time
 */
export function getAdaptiveStrategyLearningHistory(req: Request, res: Response) {
    try {
        const history = getLearningHistory();
        
        res.json({
            simulationCount: history.length,
            history,
            latestMetrics: history.length > 0 ? history[history.length - 1] : null
        });
    } catch (err) {
        res.status(500).json({
            error: err instanceof Error ? err.message : 'Unknown error'
        });
    }
}

