import 'dotenv/config'
import express from "express"
import { WebSocketServer } from "ws"
import http from "http"
import { SimulationEngine } from "./simulation"
import { Region } from "./types/region"
import { Velikost } from "./types/velikost"
import cors from 'cors'
import { router as controllsRouter } from "./routes/controls.route"
import { router as dataRouter } from "./routes/data.route"
import { router as historyRouter } from "./routes/history.route"
import { router as experimentsRouter } from "./routes/experiments.route"
import { setSimulation as setLogsSimulation } from "./controllers/logs.controller"
import { setSimulation as setKPISimulation } from "./controllers/kpi.controller"
import config from "./config.json"
import { StrategyFactory } from "./utils/strategyFactory"
import { AdaptiveStrategy } from "./types/strategie/AdaptiveStrategy"
import { saveAdaptiveWeights } from "./utils/adaptiveStrategyLearning"
import { SeededSeedGenerator } from "./utils/seedGenerator"
import { Firma } from "./types/firma"

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(cors())
app.get("/", (req, res) => {
	res.send({ running: true, message: "WebSocket Server is running" })
})

// Create HTTP server
const server = http.createServer(app)

// Create WebSocket server
const wss = new WebSocketServer({ server })

// Learning mode state
const learningModeState = {
	enabled: config.learningMode?.enabled ?? false,
	autoRestartIterations: config.learningMode?.autoRestartIterations ?? 10,
	fixedSeedEachRun: config.learningMode?.fixedSeedEachRun ?? false,
	seedGenerator: new SeededSeedGenerator(
		config.learningMode?.seedGeneratorSeed && config.learningMode.seedGeneratorSeed !== "RANDOM" 
		? config.learningMode.seedGeneratorSeed 
		: `RL_GEN_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
	),
	completedIterations: 0,
	lastSeedUsed: ""
}

function createSimulationEngine(forcedSeed?: string) {
	const region = new Region(
		config.region.id,
		config.region.nazev,
		new Velikost(config.region.velikost.x, config.region.velikost.y),
		config.region.stred,
	)

	// Use forced seed or generate new one in learning mode
	let seed = forcedSeed ?? config.simulation.seed
	if (learningModeState.enabled && !forcedSeed) {
		if (learningModeState.fixedSeedEachRun) {
			seed = config.simulation.seed
			console.log(`[Learning Mode] Using fixed seed for this run: ${seed}`)
		} else {
			seed = learningModeState.seedGenerator.nextSeed()
			console.log(`[Learning Mode] Generated seed #${learningModeState.seedGenerator.getIteration()}: ${seed}`)
		}
		learningModeState.lastSeedUsed = seed
	}

	return new SimulationEngine(region, seed, undefined, !learningModeState.enabled)
}

let sim = createSimulationEngine()

export function getSimulation() {
	return sim
}

export function getLearningModeState() {
	return learningModeState
}

export function resetSimulationForCurrentMode() {
	if (sim.isRunning()) {
		sim.pause()
	}
	stopBroadcasting()
	sim = createSimulationEngine()
	syncSimulationControllers()
}

function syncSimulationControllers() {
	setLogsSimulation(sim)
	setKPISimulation(sim)
}

// Initialize controllers with simulation
syncSimulationControllers()

let broadcastInterval: any = null
const BROADCAST_INTERVAL_MS = config.simulation.broadcastIntervalMs
const LEARNING_MODE_RESTART_DELAY_MS = 200
let learningModeRestartTimeout: NodeJS.Timeout | null = null

export function startBroadcasting() {
	if (broadcastInterval) return
	// Only start broadcasting if the simulation is currently running
	if (!sim.isRunning()) return

	broadcastInterval = setInterval(() => {
		if (!sim.isRunning()) {
			if (learningModeState.enabled) {
				endCurrentSimulation()
				return
			}

			const finalPayload = sim.serializeState()
			broadcastStateToAllClients(finalPayload)
			stopBroadcasting()
			return
		}

		const payload = sim.serializeState()
		broadcastStateToAllClients(payload)
	}, BROADCAST_INTERVAL_MS)
}

export function stopBroadcasting() {
	if (!broadcastInterval) return
	clearInterval(broadcastInterval)
	broadcastInterval = null
}

function broadcastStateToAllClients(state: ReturnType<SimulationEngine['serializeState']>) {
	const msg = JSON.stringify({ 
		type: "state", 
		data: state,
		learningMode: learningModeState.enabled ? {
			enabled: true,
			completedIterations: learningModeState.completedIterations,
			autoRestartIterations: learningModeState.autoRestartIterations,
			fixedSeedEachRun: learningModeState.fixedSeedEachRun,
			lastSeedUsed: learningModeState.lastSeedUsed,
			currentIteration: learningModeState.seedGenerator.getIteration()
		} : undefined
	})
	wss.clients.forEach((client) => {
		try {
			client.send(msg)
		} catch (e) {
			/* ignore */
		}
	})
}

export function endCurrentSimulation() {
	if (learningModeRestartTimeout) {
		const finalState = sim.serializeState()
		broadcastStateToAllClients(finalState)
		return finalState
	}

	const finalState = sim.serializeState()
	broadcastStateToAllClients(finalState)
	stopBroadcasting()

	const saveAdaptiveLearning = () => {
		const adaptiveInstances = StrategyFactory.getAllAdaptiveInstancesWithMetadata()
		adaptiveInstances.forEach(({ instanceId, variant, strategy }) => {
			if (strategy instanceof AdaptiveStrategy) {
				const weights = strategy.exportWeights()
				const persistenceKey = variant === 'RL'
					? 'rl'
					: variant === 'EVOLUTIONARY'
						? 'evolutionary'
						: 'adaptive'
				saveAdaptiveWeights(weights, persistenceKey)
				console.log(`Saved ${variant} strategy weights (${instanceId}) - Success rate: ${(strategy.getPerformanceMetrics().overallSuccessRate * 100).toFixed(1)}%`)
			}
		})
	}

	const resetSimulation = () => {
		if (sim.isRunning()) {
			sim.stop()
		}
		sim = createSimulationEngine()
		syncSimulationControllers()
	}

	// In learning mode, automatically restart simulation
	if (learningModeState.enabled) {
		learningModeState.completedIterations++
		console.log(`[Learning Mode] Completed iteration ${learningModeState.completedIterations}/${learningModeState.autoRestartIterations}`)

		if (learningModeState.completedIterations < learningModeState.autoRestartIterations) {
			// Broadcast restart message to UI
			const restartMsg = JSON.stringify({
				type: "learning-mode-restart",
				data: {
					completedIterations: learningModeState.completedIterations,
					autoRestartIterations: learningModeState.autoRestartIterations,
					currentIteration: learningModeState.seedGenerator.getIteration(),
					lastSeedUsed: learningModeState.lastSeedUsed,
					message: `Learning iteration ${learningModeState.completedIterations + 1}/${learningModeState.autoRestartIterations} restarting in ${LEARNING_MODE_RESTART_DELAY_MS / 1000} seconds...`
				}
			})
			wss.clients.forEach((client) => {
				try {
					client.send(restartMsg)
				} catch (e) {
					/* ignore */
				}
			})

			learningModeRestartTimeout = setTimeout(() => {
				saveAdaptiveLearning()
				resetSimulation()

				console.log(`[Learning Mode] Starting iteration ${learningModeState.completedIterations + 1}...`)
				sim.startRealTime()
				startBroadcasting()

				// Broadcast the new state to all clients
				try {
					const newState = sim.serializeState()
					broadcastStateToAllClients(newState)
				} catch (e) {
					console.error('Error broadcasting new simulation state:', e)
				} finally {
					learningModeRestartTimeout = null
				}
			}, LEARNING_MODE_RESTART_DELAY_MS)
		} else {
			learningModeRestartTimeout = setTimeout(() => {
				saveAdaptiveLearning()

				console.log(`[Learning Mode] All ${learningModeState.completedIterations} iterations completed!`)
				learningModeState.enabled = false
				
				// Broadcast completion message
				const completionMsg = JSON.stringify({
					type: "learning-mode-completed",
					data: {
						completedIterations: learningModeState.completedIterations,
						autoRestartIterations: learningModeState.autoRestartIterations,
						message: `Learning mode completed! ${learningModeState.completedIterations} iterations finished.`
					}
				})
				wss.clients.forEach((client) => {
					try {
						client.send(completionMsg)
					} catch (e) {
						/* ignore */
					}
				})

				resetSimulation()
				learningModeRestartTimeout = null
			}, LEARNING_MODE_RESTART_DELAY_MS)
		}
	} else {
		// Normal mode: just stop and create new simulation
		saveAdaptiveLearning()
		resetSimulation()
	}

	return finalState
}

wss.on("connection", (ws) => {
	console.log("New client connected")
	// Send welcome message and current state
	ws.send(
		JSON.stringify({
			type: "connection",
			message: "Connected to WebSocket server",
		}),
	)
	try {
		ws.send(JSON.stringify({ type: "state", data: sim.serializeState() }))
	} catch {}

	// Handle incoming messages (basic control)
	ws.on("message", (data) => {
		try {
			const message = JSON.parse(data.toString())
			if (message?.action === "start") {
				sim.startRealTime()
				startBroadcasting()
				ws.send(
					JSON.stringify({
						type: "ok",
						message: "simulation started",
					}),
				)
				return
			}
			if (message?.action === "pause") {
				sim.pause()
				stopBroadcasting()
				ws.send(
					JSON.stringify({
						type: "ok",
						message: "simulation paused",
					}),
				)
				return
			}
			if (message?.action === "stop") {
				const finalState = endCurrentSimulation()
				try {
					ws.send(JSON.stringify({ type: "state", data: finalState }))
				} catch {}
				ws.send(
					JSON.stringify({ type: "ok", message: "simulation ended" }),
				)
				return
			}
			if (message?.action === "strategy-feedback") {
				const { companyId, supplierId, success, cost, quantity, deliveryTime } = message.data ?? {}
				if (typeof companyId === 'number' && typeof supplierId === 'number') {
					const agents = sim.getAgents()
					const company = agents.find((f: any) => f instanceof Firma && f.id === companyId) as Firma | undefined
					if (company && company.strategie instanceof AdaptiveStrategy) {
						company.strategie.recordSupplierFeedback(
							supplierId,
							!!success,
							Number(cost) || 0,
							Number(quantity) || 0,
							Number(deliveryTime) || 0
						)
						const updatedState = sim.serializeState()
						broadcastStateToAllClients(updatedState)
						ws.send(JSON.stringify({ type: "ok", message: "strategy feedback applied" }))
					} else {
						ws.send(JSON.stringify({ type: "error", message: "Company not found or not adaptive" }))
					}
				} else {
					ws.send(JSON.stringify({ type: "error", message: "Invalid feedback data" }))
				}
				return
			}
			// Echo unknown messages
			ws.send(
				JSON.stringify({
					type: "echo",
					data: message,
					timestamp: new Date().toISOString(),
				}),
			)
		} catch (error) {
			ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }))
		}
	})

	// Handle client disconnect
	ws.on("close", () => {
		console.log("Client disconnected")
	})

	// Handle errors
	ws.on("error", (error) => {
		console.error("WebSocket error:", error)
	})
})

// HTTP endpoints to control and inspect simulation
app.use("/controls", controllsRouter)
app.use('/data', dataRouter)
app.use('/history', historyRouter)
app.use('/experiments', experimentsRouter)

// Start server
server.listen(PORT, () => {
	console.log(`HTTP server running on http://localhost:${PORT}`)
	console.log(`WebSocket server running on ws://localhost:${PORT}`)
})
