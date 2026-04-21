import { endCurrentSimulation, getSimulation, startBroadcasting, stopBroadcasting, getLearningModeState, resetSimulationForCurrentMode } from '../server';
import { Agent } from '../types/agent';
import { Firma } from '../types/firma';
import { generateSimulationFinalSummary } from '../services/summary.service';
import { Request, Response } from 'express';
import { sendApiError } from '../middleware/validation';

export const getState = (_req: Request, res: Response) => {
	const sim = getSimulation()
    res.json(sim.serializeState())
}

export const start = (_req: Request, res: Response) => {
	const sim = getSimulation()
    sim.startRealTime()
    startBroadcasting()
    res.json({ ok: true })
}

export const startLearning = (_req: Request, res: Response) => {
	const learningState = getLearningModeState()
	
	// Enable learning mode
	learningState.enabled = true
	learningState.completedIterations = 0
    resetSimulationForCurrentMode()
	
	const sim = getSimulation()
	sim.startRealTime()
	startBroadcasting()
	
	res.json({ ok: true, learningMode: learningState })
}

export const pause = (_req: Request, res: Response) => {
	const sim = getSimulation()
    sim.pause()
    stopBroadcasting()
    res.json({ ok: true })
}

export const stop = async (_req: Request, res: Response) => {
    const sim = getSimulation()
    const logLimit = Number(process.env.SUMMARY_LOG_EVENTS_LIMIT || 120)
    const finalStateBeforeStop = sim.serializeState()
    const recentLogs = sim.getLogger().getRecentEvents(logLimit)

    const finalState = endCurrentSimulation()
    const finalSummary = await generateSimulationFinalSummary({
        finalState: finalStateBeforeStop,
        recentLogs,
    })

    res.json({ ok: true, finalState, finalSummary })
}

export const reset = (_req: Request, res: Response) => {
    resetSimulationForCurrentMode()
    res.json({ ok: true })
}

export const setCompanyOperations = (req: Request, res: Response) => {
    const sim = getSimulation()
    const companyId = Number(req.params.companyId)

    if (!Number.isFinite(companyId)) {
        return sendApiError(res, 400, 'VALIDATION_ERROR', 'Invalid companyId')
    }

    const productionEnabled = req.body?.productionEnabled
    const storageEnabled = req.body?.storageEnabled
    const hasProductionUpdate = typeof productionEnabled === 'boolean'
    const hasStorageUpdate = typeof storageEnabled === 'boolean'

    if (!hasProductionUpdate && !hasStorageUpdate) {
        return sendApiError(
            res,
            400,
            'VALIDATION_ERROR',
            'At least one of productionEnabled or storageEnabled must be boolean'
        )
    }

    const company = sim
        .getAgents()
        .filter((agent: Agent): agent is Firma => agent instanceof Firma)
        .find((firma: Firma) => firma.id === companyId)

    if (!company) {
        return sendApiError(res, 404, 'NOT_FOUND', `Company ${companyId} not found`)
    }

    const operationUpdate: { productionEnabled?: boolean; storageEnabled?: boolean } = {}
    if (hasProductionUpdate) {
        operationUpdate.productionEnabled = productionEnabled
    }
    if (hasStorageUpdate) {
        operationUpdate.storageEnabled = storageEnabled
    }

    company.setOperationsMode(operationUpdate, sim.getCurrentTick())

    return res.json({
        ok: true,
        companyId,
        operationsMode: company.getOperationsMode()
    })
}

export const getLearningModeStatus = (_req: Request, res: Response) => {
    const state = getLearningModeState()
    res.json({
        ok: true,
        learningMode: {
            enabled: state.enabled,
            autoRestartIterations: state.autoRestartIterations,
            completedIterations: state.completedIterations,
            lastSeedUsed: state.lastSeedUsed,
            currentIteration: state.seedGenerator.getIteration()
        }
    })
}
