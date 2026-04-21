import { Agent } from './types/agent';
import { Region } from './types/region';

import config from './config.json'
import { saveSim } from './utils/saveSimulation';
import { calculateDimensionsFromArea } from './utils/dimensionCalculator';
import { Budova } from './types/budova';
import { Dodavatel } from './types/dodavatel';
import { TypSuroviny } from './types/typSuroviny';
import { Velikost } from './types/velikost';
import { getGeoDistance } from './utils/distance';

import Budovy from './data/data_budov 30.json'
import { Firma } from './types/firma';
import { VyvazenaStrategie } from './types/strategie/VyvazenaStrategie';
import { SimulationLogger } from './utils/logger';
import { StrategyFactory, CompanyConfig, StrategyVariant } from './utils/strategyFactory';
import { simulationHistory } from './utils/simulationHistory';
import { createRng } from './utils/rng';

export class SimulationEngine {
    private seed: string
    private agents: Agent[] = [];
    private currentTime: number = 0;
    public region: Region;
    private logger: SimulationLogger;
    private simulationHistoryId: string | null = null;
    
    private tickRate: number = config.simulation.defaultTickRateMs;

    private numberOfIterations: number
    private intervalHandle: any = null
    private running: boolean = false
    private finished: boolean = false
    private tickDurations: number[] = []
    private readonly maxInMemoryLogs = config.simulation.maxInMemoryLogs
    private readonly persistenceEnabled: boolean

    private logs: string[] = [] // kept for backward compatibility

    constructor(region: Region, seed: string, tickRate?: number, persistenceEnabled: boolean = true){
        this.region = region
        this.numberOfIterations = config.simulation.numberOfIterations
        this.seed = seed
        this.region.setDemandSeed(seed)
        this.persistenceEnabled = persistenceEnabled
        if (tickRate !== undefined) this.tickRate = tickRate
        
        // Initialize history tracking
        if (this.persistenceEnabled) {
            this.simulationHistoryId = simulationHistory.startNewSimulation(this, seed, region.nazev);
        }
        
        // Initialize logger
        this.logger = new SimulationLogger('logs', { persistToDisk: this.persistenceEnabled })
        
        this.loadBuildings()
        
        //Agents
        const defaultPoloha = config.simulation.defaultPoloha
        const getPoloha = (index: number) => {
            return this.region.volneBudovy[index]?.poloha ??
            defaultPoloha}
        
        const koksSupplierCount = config.suppliers.koksCount
        const rudaSupplierCount = config.suppliers.rudaCount

        for (let i = 0; i < koksSupplierCount; i++) {
            this.addAgent(new Dodavatel(seed, getPoloha(i), 0, TypSuroviny.KOKS, this))
        }

        for (let i = 0; i < rudaSupplierCount; i++) {
            const positionIndex = koksSupplierCount + i
            this.addAgent(new Dodavatel(seed, getPoloha(positionIndex), 0, TypSuroviny.ZELEZNA_RUDA, this))
        }

        // Add multiple companies with different strategies
        const companies: CompanyConfig[] = config.companies.map((company: any) =>
            new CompanyConfig(
                company.id,
                company.name,
                company.strategyVariant as StrategyVariant,
                company.initialFinance ?? config.pocatecniFinance
            )
        )
        
        companies.forEach((companyConfig, idx) => {
            const supplierCount = koksSupplierCount + rudaSupplierCount
            const randomOffsetMax = Math.max(1, config.simulation.randomBuildingOffsetMax)
            const placementRng = createRng(`${this.seed}-company-placement-${companyConfig.id}`)
            const randOffset = Math.floor(placementRng() * randomOffsetMax)
            const polohaIdx = Math.min(supplierCount + idx + randOffset, this.region.volneBudovy.length - 1)
            const strategy = StrategyFactory.createStrategy(companyConfig.strategyVariant, String(companyConfig.id), `${this.seed}-strategy-${companyConfig.id}`)
            
            // Get a starting building from available pool (cheapest available)
            const availableBuildings = this.region.volneBudovy.sort((a, b) => a.cenaKoupi - b.cenaKoupi);
            const startingBuilding = availableBuildings[0];
            
            if (startingBuilding) {
                const building = this.region.purchaseBuilding(startingBuilding.id, companyConfig.id);
                if (building) {
                    // Free starter buildings begin with default infrastructure
                    building.inicializovatStartovniVybaveni();

                    const firma = new Firma(
                        companyConfig.id,
                        building.poloha, // Use building's location as company location
                        strategy,
                        this,
                        companyConfig.initialFinance,
                        companyConfig.name,
                        companyConfig.strategyVariant
                    )
                    firma.budovy.push(building);
                    firma.setTotalInvestment(building.cenaKoupi); // Set initial investment
                    this.addAgent(firma)
                    
                    // Log initial building assignment
                    this.logger.logEvent(
                        this.logger.createEvent(0, 'COMPANY_EXPANDED', firma.id, {
                            expandType: 'INITIAL_BUILDING',
                            cost: building.cenaKoupi,
                            buildingDataId: building.dataId,
                            buildingLocation: building.poloha,
                            companyName: companyConfig.name
                        }, { companyId: firma.id })
                    )
                }
            }
        })
    }

    public addAgent(agent: Agent){
        agent.setId(this.agents.length + 1)
        this.agents.push(agent)
        
        // Log agent added event
        this.logger.logEvent(
            this.logger.createEvent(
                this.currentTime,
                'AGENT_ADDED',
                agent.id,
                {
                    agentType: agent.constructor.name,
                    totalAgents: this.agents.length
                }
            )
        )
    }

    public step(){
        const start = Date.now()

        this.currentTime ++; // one tick = one day
        this.region.resetProductionTracking()

        // Emit tick start event
        this.logger.logEvent(
            this.logger.createEvent(this.currentTime, 'TICK_START', 0, {
                totalAgents: this.agents.length
            })
        )

        // call tick on all agents
        for (const agent of this.agents.slice()) {
            try {
                const result = agent.tick(this.currentTime)
                // Keep backward compatibility with logs array
                this.logs.push(result)
                if (this.logs.length > this.maxInMemoryLogs) {
                    this.logs.shift()
                }
                // If agent returned an event, it's already logged by the agent
            } catch (e) {
                // Emit error event
                const errorMessage = e instanceof Error ? e.message : String(e)
                const errorStack = e instanceof Error ? e.stack : undefined
                
                const errorObj: { message: string; stack?: string } = {
                    message: errorMessage
                }
                if (errorStack) {
                    errorObj.stack = errorStack
                }
                
                this.logger.logEvent(
                    this.logger.createEvent(
                        this.currentTime,
                        'AGENT_ERROR',
                        agent.id,
                        {},
                        {
                            severity: 'error',
                            error: errorObj
                        }
                    )
                )
            }
        }

        // Emit tick end event
        this.region.finalizeMarketTick()
        const duration = Date.now() - start
        this.logger.logEvent(
            this.logger.createEvent(this.currentTime, 'TICK_END', 0, {
                durationMs: duration,
                agentCount: this.agents.length
            })
        )

        this.tickDurations.push(duration)
        if (this.tickDurations.length > config.simulation.avgTickWindowSize) this.tickDurations.shift()
        
        // Record snapshot for history
        if (this.persistenceEnabled) {
            simulationHistory.recordSnapshot(this);
        }
    }
    public findAgentById(id: number): (Agent | undefined) {
        return this.agents.find(a => a.id === id)
    }

    public getLogger(): SimulationLogger {
        return this.logger
    }

    public getCurrentTick(): number {
        return this.currentTime
    }

    public removeAgent(id: number): boolean {
        const idx = this.agents.findIndex(a => a.id === id)
        if (idx === -1) return false
        
        const agent = this.agents[idx]
        if (!agent) return false
        
        this.agents.splice(idx, 1)
        
        // Log agent removed event
        this.logger.logEvent(
            this.logger.createEvent(
                this.currentTime,
                'AGENT_REMOVED',
                id,
                {
                    agentType: agent.constructor.name,
                    totalAgents: this.agents.length
                }
            )
        )
        
        return true
    }

    public serializeState() {
        const avgTick = this.tickDurations.length ? (this.tickDurations.reduce((s, v) => s + v, 0) / this.tickDurations.length) : 0

        return {
            time: this.currentTime,
            tick: this.currentTime,
            seed: this.seed,
            running: this.running,
            finished: this.finished,
            summaries: {
                totalAgents: this.agents.length,
                avgTickDurationMs: avgTick
            },
            logMetadata: {
                filePath: this.persistenceEnabled ? this.logger.getLogFilePath() : null,
                eventCount: this.logger.getEventCount(),
                note: this.persistenceEnabled
                    ? 'Full event logs are stored in the file referenced by filePath. Access via /data/logs/recent or /data/logs/filter endpoints.'
                    : 'Log persistence is disabled in learning mode. Events are available only in memory for the current run.'
            },
            region: {
                id: this.region.id,
                nazev: this.region.nazev
            },
            agents: this.agents,
            buildings: this.region.purchasedBuildings  // Include purchased buildings for map visualization
        }
    }

    public getDodavatele(): Dodavatel[] {
        return this.agents.filter((agent): agent is Dodavatel => agent instanceof Dodavatel)
    }

    public getAgents(): Agent[] {
        return this.agents
    }
    
    public getRegion(): Region {
        return this.region
    }

    public broadcastState(sendFn: (data: any) => void) {
        const state = this.serializeState()
        try { sendFn(JSON.stringify({ type: 'state', data: state })) } catch (e) { /* ignore */ }
    }

    public setTickRate(msPerTick: number) {
        this.tickRate = msPerTick
        if (this.running) {
            this.pause()
            this.startRealTime()
        }
    }

    public isRunning(): boolean {
        return this.running
    }

    public getTickRate(): number {
        return this.tickRate
    }

    public startRealTime() {
        if (this.running) return
        if (this.finished) return
        this.running = true
        
        // Log simulation started event
        this.logger.logEvent(
            this.logger.createEvent(this.currentTime, 'SIM_STARTED', 0, {
                tickRate: this.tickRate,
                numberOfIterations: this.numberOfIterations
            })
        )
        
        this.intervalHandle = setInterval(() => {
            this.step()
            if (this.numberOfIterations > 0 && this.currentTime >= this.numberOfIterations) {
                this.stop(false)
            }
        }, this.tickRate)
    }

    public pause() {
        if (!this.running) return
        clearInterval(this.intervalHandle)
        this.intervalHandle = null
        this.running = false
        
        // Log simulation paused event
        this.logger.logEvent(
            this.logger.createEvent(this.currentTime, 'SIM_PAUSED', 0, {
                currentTick: this.currentTime
            })
        )
    }

    public stop(resetRuntimeState: boolean = true) {
        // Log simulation stopped event
        this.logger.logEvent(
            this.logger.createEvent(this.currentTime, 'SIM_STOPPED', 0, {
                finalTick: this.currentTime,
                totalAgents: this.agents.length
            })
        )
        
        if (this.persistenceEnabled) {
            // Flush all pending events to disk
            this.logger.flushSync()

            console.log(saveSim(this))

            // Finish simulation history tracking
            simulationHistory.finishSimulation(this);
        }
        
        this.pause()
        this.finished = true
        if (resetRuntimeState) {
            this.currentTime = 0
            this.tickDurations = []
            this.finished = false
        }
    }

    private loadBuildings() {
        console.log("loading buildings")
        try {
            Budovy.forEach((budova: any, index) => {
                // Calculate dimensions from the actual area in square meters
                const dimensions = calculateDimensionsFromArea(budova.area_sqm);
                const newBudova = new Budova(
                    index, 
                    budova.location, 
                    dimensions,  // Use calculated dimensions based on actual area
                    budova.price,
                    budova.id,  // dataId from source file
                    budova.area_sqm  // Pass actual area in square meters
                )
                this.region.addBudova(newBudova)
            })
            // Sort buildings by distance to center
            const center = config.simulation.sortingCenter
            this.region.volneBudovy.sort((a: Budova, b: Budova) =>
                getGeoDistance(a.poloha, center) - getGeoDistance(b.poloha, center)
            )
        } catch (error) {
            console.log("Error loading buildings:", error)
        }
        finally{
            console.log(`Done loading ${this.region.volneBudovy.length} buildings`)
        }
    }

    private findBuildingsInPrice(price: number){
        const buildings = this.region.volneBudovy.filter((item: Budova) => item.cenaKoupi < price)
        return buildings
    }

    public getSimulationHistoryId(): string | null {
        return this.simulationHistoryId;
    }
}