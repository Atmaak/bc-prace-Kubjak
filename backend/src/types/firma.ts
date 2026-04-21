import { KPI } from "./kpi"
import { Souradnice } from './souradnice';
import { Budova } from './budova';
import { Strategie } from "./strategie"
import { Velikost } from './velikost';
import { Agent } from './agent';
import { SimulationEngine } from '../simulation';
import { TypSuroviny } from './typSuroviny';
import { SimulationEvent } from './simulationEvent';
import { AdaptiveStrategy } from './strategie/AdaptiveStrategy';
import { getGeoDistance } from '../utils/distance';
import type { Dodavatel } from './dodavatel';

import config from '../config.json'
import { Objednavka } from './objednavka';

type ExpansionTaskType = 'EXPAND_LINE' | 'EXPAND_STORAGE'

interface ExpansionTask {
	type: ExpansionTaskType
	queuedAtTick: number
	reason: string
}

type PendingCompanyActionType =
	| 'BUY_BUILDING'
	| 'BUY_LINE'
	| 'BUY_STORAGE'
	| 'BUY_SUPPLIES'
	| 'PRODUCE_OCEL'
	| 'SELL_PRODUCT'

interface PendingCompanyAction {
	id: number
	type: PendingCompanyActionType
	startedAtTick: number
	completeAtTick: number
	payload: any
}

export class Firma implements Agent{
	private static readonly FINANCIAL_LOOKAHEAD_TICKS = config.firma.financialLookaheadTicks
	private static readonly EXPANSION_LOOKAHEAD_TICKS = Math.max(15, Math.floor(config.firma.financialLookaheadTicks * 0.35))
	private static readonly DEBT_RECOVERY_PRODUCTION_FLOOR = 0.25
	private static readonly DEBT_RECOVERY_SOFT_LIMIT_RATIO = 0.08
	private static readonly DEBT_RECOVERY_SUPPLY_HEADROOM_RATIO = 0.05

	public id: number
	public name: string
	public nazev: string
	public finance: number
	public budovy: Budova[]
	public KPI: KPI
	public poloha: Souradnice
	public velikost: Velikost
	public spotrebaEnergie: number = 0;
	public strategie: Strategie
	public strategyVariant: string
	private sim: SimulationEngine
	
	// Historical tracking for KPI calculations
	private initialFinance: number
	private totalInvestment: number = 0
	private totalRevenue: number = 0
	private totalCosts: number = 0
	private ordersPlaced: number = 0
	private ordersFulfilled: number = 0
	private totalWaitTime: number = 0
	private waitTimeCount: number = 0
	private expansionTasksQueue: ExpansionTask[] = []
	private pendingActions: PendingCompanyAction[] = []
	private nextActionId: number = 1
	private productionEnabled: boolean = true
	private storageEnabled: boolean = true
	
	// Market demand tracking
	private totalMarketDemand: number = 0
	private totalMarketSatisfied: number = 0

	constructor(id: number | string, poloha: Souradnice, strategie: Strategie, sim: SimulationEngine, initialFinance: number = config.pocatecniFinance, name: string = `Company-${id}`, strategyVariant: string = 'UNKNOWN') {
		this.id = typeof id === 'number' ? id : parseInt(String(id), 10)
		this.name = name
		this.nazev = name
		this.finance = initialFinance
		this.initialFinance = initialFinance
		this.strategie = strategie
		this.strategyVariant = strategyVariant
		this.budovy = [] // Buildings will be assigned from available pool
		this.poloha = poloha
		this.velikost = new Velikost(0, 0)
		this.sim = sim
		this.totalInvestment = 0 // Will be set when initial building is assigned
		this.KPI = {
			celkovaInvestice: 0,
			cistyZisk: 0,
			financniRezerva: 0,
			likviditniKrytiProvozu: 0,
			miraNesplnenePoptavky: 0,
			nakladovostTrzeb: 0,
			provozniMarze: 0,
			miraVyuzitiSkladovaciJednotky: 0,
			miraVyuzitiVyrobniKapacity: 0,
			prumernaDobaCekaniSurovin: 0,
			ROI: 0,
			spotrebaEnergie: 0,
			uspesnostPlneniObjednavek: 0
		}
	}

	public tick(tick: number): void {
		this.processPendingActions(tick)
		this.applyFinancialPressureOperationsMode(tick)
		if (this.finance >= 0) {
			this.processExpansionTasks(tick)
		}
		this.applyDailyOperatingCosts(tick)
		
		// Before checking finances, try to sell any existing OCEL to generate cash
		const existingOcel = this.getInventory(TypSuroviny.OCEL)
		if (this.storageEnabled && existingOcel > 0) {
			this.sellProduct(existingOcel, TypSuroviny.OCEL, tick)
		}

		if (this.finance < 0) {
			const logger = this.sim.getLogger()
			logger.logEvent(
				logger.createEvent(tick, 'COMPANY_STRATEGIC_DECISION', this.id, {
					decision: 'DEBT_RECOVERY_MODE',
					reason: 'Negative finance, expansion is blocked; company focuses on buy/produce/sell recovery',
					finance: this.finance
				}, { companyId: this.id, severity: 'warning' })
			)
		}
		
		// Execute strategy decision (which may trigger production)
		this.strategie.vykonejRozhodnuti(this, tick, this.sim)
		this.prepocitejKPI()
	}

	private enqueueExpansionTask(type: ExpansionTaskType, tick: number, reason: string): void {
		const logger = this.sim.getLogger()
		const existingTask = this.expansionTasksQueue.find(task => task.type === type)
		if (existingTask) {
			return
		}

		this.expansionTasksQueue.push({
			type,
			queuedAtTick: tick,
			reason
		})

		logger.logEvent(
			logger.createEvent(tick, 'COMPANY_STRATEGIC_DECISION', this.id, {
				decision: 'QUEUE_EXPANSION_TASK',
				taskType: type,
				reason,
				queueLength: this.expansionTasksQueue.length
			}, { companyId: this.id, severity: 'info' })
		)
	}

	private processExpansionTasks(tick: number): void {
		if (this.expansionTasksQueue.length === 0) {
			return
		}

		const logger = this.sim.getLogger()
		const pendingTasks = [...this.expansionTasksQueue]

		for (const task of pendingTasks) {
			let completed = false

			if (task.type === 'EXPAND_LINE') {
				if (!this.hasSpaceForLine()) {
					if (this.hasPendingAction('BUY_BUILDING')) {
						continue
					}

					const buildingBought = this.koupitBudovu()
					if (!buildingBought) {
						continue
					}
				}

				completed = this.koupitLinku()
			} else if (task.type === 'EXPAND_STORAGE') {
				if (!this.hasSpaceForStorage()) {
					if (this.hasPendingAction('BUY_BUILDING')) {
						continue
					}

					const buildingBought = this.koupitBudovu()
					if (!buildingBought) {
						continue
					}
				}

				completed = this.koupitSklad()
			}

			if (completed) {
				this.expansionTasksQueue = this.expansionTasksQueue.filter(
					queued => !(queued.type === task.type && queued.queuedAtTick === task.queuedAtTick)
				)

				logger.logEvent(
					logger.createEvent(tick, 'COMPANY_STRATEGIC_DECISION', this.id, {
						decision: 'COMPLETE_EXPANSION_TASK',
						taskType: task.type,
						queuedAtTick: task.queuedAtTick,
						queueLength: this.expansionTasksQueue.length
					}, { companyId: this.id })
				)
			}
		}
	}

	private hasSpaceForLine(): boolean {
		const lineSize = new Velikost(config.linka.velikost.x, config.linka.velikost.y)
		return this.budovy.some(budova => budova.canFitItem(lineSize))
	}

	private hasSpaceForStorage(): boolean {
		const storageSize = new Velikost(config.sklad.velikost.x, config.sklad.velikost.y)
		return this.budovy.some(budova => budova.canFitItem(storageSize))
	}

	private hasPendingAction(actionType: PendingCompanyActionType): boolean {
		return this.pendingActions.some(action => action.type === actionType)
	}

	private getKoksPerOcel(): number {
		return config.production.koksPerOcel
	}

	private getRudaPerOcel(): number {
		return config.production.rudaPerOcel
	}

	private getActionDurationTicks(actionType: PendingCompanyActionType): number {
		switch (actionType) {
			case 'BUY_BUILDING':
				return config.firma.actionDurationsTicks.buyBuilding
			case 'BUY_LINE':
				return config.firma.actionDurationsTicks.buyLine
			case 'BUY_STORAGE':
				return config.firma.actionDurationsTicks.buyStorage
			case 'BUY_SUPPLIES':
				return config.firma.actionDurationsTicks.buySupplies
			case 'PRODUCE_OCEL':
				return config.firma.actionDurationsTicks.produceSteel
			case 'SELL_PRODUCT':
				return config.firma.actionDurationsTicks.sellProduct
			default:
				return 0
		}
	}

	private scheduleCompanyAction(actionType: PendingCompanyActionType, payload: any, tick: number): void {
		const durationTicks = Math.max(0, this.getActionDurationTicks(actionType))
		const action: PendingCompanyAction = {
			id: this.nextActionId++,
			type: actionType,
			startedAtTick: tick,
			completeAtTick: tick + durationTicks,
			payload
		}

		if (durationTicks === 0) {
			this.completeCompanyAction(action, tick)
			return
		}

		this.pendingActions.push(action)

		const logger = this.sim.getLogger()
		logger.logEvent(
			logger.createEvent(tick, 'COMPANY_STRATEGIC_DECISION', this.id, {
				decision: 'ACTION_STARTED',
				actionType,
				actionId: action.id,
				durationTicks,
				completeAtTick: action.completeAtTick
			}, { companyId: this.id })
		)
	}

	private processPendingActions(tick: number): void {
		if (this.pendingActions.length === 0) {
			return
		}

		const actionsToComplete = this.pendingActions.filter(action => action.completeAtTick <= tick)
		if (actionsToComplete.length === 0) {
			return
		}

		const completedIds = new Set(actionsToComplete.map(action => action.id))
		this.pendingActions = this.pendingActions.filter(action => !completedIds.has(action.id))

		actionsToComplete.forEach(action => this.completeCompanyAction(action, tick))
	}

	private completeCompanyAction(action: PendingCompanyAction, tick: number): void {
		const logger = this.sim.getLogger()

		switch (action.type) {
			case 'BUY_BUILDING': {
				const region = this.sim.region
				const availableBuildings = region.volneBudovy.slice().sort((a, b) => a.cenaKoupi - b.cenaKoupi)
				const budovaToAdd = availableBuildings[0]

				if (!budovaToAdd) {
					logger.logEvent(
						logger.createEvent(tick, 'COMPANY_EXPANSION_FAILED', this.id, {
							expandType: 'BUDOVA',
							reason: 'No available buildings at completion',
							actionId: action.id,
							startedAtTick: action.startedAtTick,
							available: this.finance
						}, { companyId: this.id, severity: 'warning' })
					)
					break
				}

				const cost = budovaToAdd.cenaKoupi
				if (this.finance < cost) {
					logger.logEvent(
						logger.createEvent(tick, 'COMPANY_EXPANSION_FAILED', this.id, {
							expandType: 'BUDOVA',
							reason: 'Insufficient funds at completion',
							actionId: action.id,
							startedAtTick: action.startedAtTick,
							required: cost,
							available: this.finance
						}, { companyId: this.id, severity: 'warning' })
					)
					break
				}

				const expansionLookaheadTicks = Firma.EXPANSION_LOOKAHEAD_TICKS
				if (!this.canAffordWithFutureReserve(cost, expansionLookaheadTicks)) {
					logger.logEvent(
						logger.createEvent(tick, 'COMPANY_EXPANSION_FAILED', this.id, {
							expandType: 'BUDOVA',
							reason: 'Insufficient future reserve at completion',
							actionId: action.id,
							startedAtTick: action.startedAtTick,
							required: cost,
							available: this.finance,
							futureReserveNeeded: this.getFutureReserveNeeded(expansionLookaheadTicks),
							lookaheadTicks: expansionLookaheadTicks
						}, { companyId: this.id, severity: 'warning' })
					)
					break
				}

				const purchasedBuilding = region.purchaseBuilding(budovaToAdd.id, this.id)
				if (!purchasedBuilding) {
					logger.logEvent(
						logger.createEvent(tick, 'COMPANY_EXPANSION_FAILED', this.id, {
							expandType: 'BUDOVA',
							reason: 'Failed to purchase building at completion',
							actionId: action.id,
							startedAtTick: action.startedAtTick,
							available: this.finance
						}, { companyId: this.id, severity: 'warning' })
					)
					break
				}

				this.finance -= cost
				this.totalInvestment += cost
				this.budovy.push(purchasedBuilding)

				logger.logEvent(
					logger.createEvent(tick, 'COMPANY_EXPANDED', this.id, {
						expandType: 'BUDOVA',
						actionId: action.id,
						startedAtTick: action.startedAtTick,
						cost,
						costEstimateAtStart: action.payload.costEstimate,
						buildingDataId: purchasedBuilding.dataId,
						newBudovaCount: this.budovy.length,
						remainingFinance: this.finance
					}, { companyId: this.id })
				)
				break
			}
			case 'BUY_LINE': {
				let lineAdded = false
				for (const budova of this.budovy) {
					if (budova.pridatLinku()) {
						lineAdded = true
						break
					}
				}

				if (!lineAdded) {
					this.finance += action.payload.cost
					this.totalInvestment -= action.payload.cost
					logger.logEvent(
						logger.createEvent(tick, 'COMPANY_EXPANSION_FAILED', this.id, {
							expandType: 'LINKA',
							reason: 'No space when action completed',
							actionId: action.id,
							refund: action.payload.cost,
							available: this.finance
						}, { companyId: this.id, severity: 'warning' })
					)
					break
				}

				logger.logEvent(
					logger.createEvent(tick, 'COMPANY_EXPANDED', this.id, {
						expandType: 'LINKA',
						actionId: action.id,
						startedAtTick: action.startedAtTick,
						cost: action.payload.cost,
						remainingFinance: this.finance,
						totalLinky: this.budovy.reduce((sum, b) => sum + b.linky.length, 0)
					}, { companyId: this.id })
				)
				break
			}
			case 'BUY_STORAGE': {
				let storageAdded = false
				for (const budova of this.budovy) {
					if (budova.pridatSklad()) {
						storageAdded = true
						break
					}
				}

				if (!storageAdded) {
					this.finance += action.payload.cost
					this.totalInvestment -= action.payload.cost
					logger.logEvent(
						logger.createEvent(tick, 'COMPANY_EXPANSION_FAILED', this.id, {
							expandType: 'SKLAD',
							reason: 'No space when action completed',
							actionId: action.id,
							refund: action.payload.cost,
							available: this.finance
						}, { companyId: this.id, severity: 'warning' })
					)
					break
				}

				logger.logEvent(
					logger.createEvent(tick, 'COMPANY_EXPANDED', this.id, {
						expandType: 'SKLAD',
						actionId: action.id,
						startedAtTick: action.startedAtTick,
						cost: action.payload.cost,
						remainingFinance: this.finance,
						totalSklady: this.budovy.reduce((sum, b) => sum + b.skladovaciJednotky.length, 0)
					}, { companyId: this.id })
				)
				break
			}
			case 'BUY_SUPPLIES': {
				let remainingRudy = action.payload.rudyToBuy as number
				let remainingKoks = action.payload.koksToBuy as number

				for (const budova of this.budovy) {
					for (const sklad of budova.skladovaciJednotky) {
						if (remainingRudy > 0) {
							const notStored = sklad.naskladniSurovinu(TypSuroviny.ZELEZNA_RUDA, remainingRudy)
							remainingRudy = notStored
						}
						if (remainingKoks > 0) {
							const notStored = sklad.naskladniSurovinu(TypSuroviny.KOKS, remainingKoks)
							remainingKoks = notStored
						}
						if (remainingRudy === 0 && remainingKoks === 0) break
					}
					if (remainingRudy === 0 && remainingKoks === 0) break
				}

				logger.logEvent(
					logger.createEvent(tick, 'COMPANY_SUPPLIES_BOUGHT', this.id, {
						totalCost: action.payload.totalCost,
						remainingFinance: this.finance
					}, { companyId: this.id })
				)

				// Update order statistics
				const rudyBought = (action.payload.rudyToBuy as number) - remainingRudy
				const koksBought = (action.payload.koksToBuy as number) - remainingKoks
				const transitTime = Math.max(0, tick - action.startedAtTick)

				if (rudyBought > 0 || (action.payload.rudyToBuy > 0 && remainingRudy === 0)) {
					this.ordersFulfilled++
					this.totalWaitTime += transitTime
					this.waitTimeCount++
				}
				if (koksBought > 0 || (action.payload.koksToBuy > 0 && remainingKoks === 0)) {
					this.ordersFulfilled++
					this.totalWaitTime += transitTime
					this.waitTimeCount++
				}
				break
			}
			case 'PRODUCE_OCEL': {
				let remainingOcel = action.payload.actualProduction as number
				for (const budova of this.budovy) {
					for (const sklad of budova.skladovaciJednotky) {
						if (remainingOcel > 0) {
							const notStored = sklad.naskladniSurovinu(TypSuroviny.OCEL, remainingOcel)
							remainingOcel = notStored
						}
						if (remainingOcel === 0) break
					}
					if (remainingOcel === 0) break
				}

				logger.logEvent(
					logger.createEvent(tick, 'COMPANY_PRODUCED', this.id, {
						product: 'OCEL',
						actionId: action.id,
						startedAtTick: action.startedAtTick,
						amount: (action.payload.actualProduction as number) - remainingOcel,
						notStoredOcel: remainingOcel,
						koksUsed: action.payload.actualKoksUsed,
						rudyUsed: action.payload.actualRudyUsed
					}, { companyId: this.id })
				)
				break
			}
			case 'SELL_PRODUCT': {
				const region = this.sim.getRegion()
				const requestedAmountToSell = action.payload.amountToSell as number
				const productType = action.payload.productType as TypSuroviny
				const price = action.payload.price as number

				const availableProduct = this.getInventory(productType)
				const amountToSell = Math.min(requestedAmountToSell, availableProduct)
				
				// Track potential market demand
				const currentRemainingDemand = region.getRemainingDemand(productType) || region.getAktualniPoptavka(productType)
				this.totalMarketDemand += currentRemainingDemand
				
				const amountSold = amountToSell > 0 ? region.buyFromCompany(productType, amountToSell) : 0
				this.totalMarketSatisfied += amountSold

				let productToRemove = amountSold
				for (const budova of this.budovy) {
					for (const sklad of budova.skladovaciJednotky) {
						if (productToRemove > 0) {
							const notRemoved = sklad.vyskladniSurovinu(productType, productToRemove)
							productToRemove = notRemoved
						}
						if (productToRemove === 0) break
					}
					if (productToRemove === 0) break
				}

				const revenue = amountSold * price

				this.finance += revenue
				this.totalRevenue += revenue

				logger.logEvent(
					logger.createEvent(tick, 'COMPANY_SOLD_PRODUCT', this.id, {
						product: productType,
						actionId: action.id,
						startedAtTick: action.startedAtTick,
						requestedAmount: requestedAmountToSell,
						availableAtCompletion: availableProduct,
						amount: amountSold,
						pricePerUnit: price,
						revenue,
						newFinance: this.finance
					}, { companyId: this.id })
				)
				break
			}
		}

		logger.logEvent(
			logger.createEvent(tick, 'COMPANY_STRATEGIC_DECISION', this.id, {
				decision: 'ACTION_COMPLETED',
				actionType: action.type,
				actionId: action.id,
				startedAtTick: action.startedAtTick,
				completedAtTick: tick
			}, { companyId: this.id })
		)
	}

	public objednatZasoby(mnozstviZelezneRudy: number, mnozstviKoksu: number, tick: number): void {
		const logger = this.sim.getLogger()
		const dodavatelRudy = this.strategie.zjistiDodavatele(this, this.sim.getDodavatele(), TypSuroviny["ZELEZNA_RUDA"])
		const dodavatelKoksu = this.strategie.zjistiDodavatele(this, this.sim.getDodavatele(), TypSuroviny["KOKS"])

		if(dodavatelRudy){
			const costRuda = mnozstviZelezneRudy * dodavatelRudy.cena
			this.totalCosts += costRuda
			this.ordersPlaced++
			
			dodavatelRudy.pridatObjednavku({
				firma: this,
				supplierId: dodavatelRudy.id,
				objem: mnozstviZelezneRudy,
				typSuroviny: TypSuroviny["ZELEZNA_RUDA"],
				cenaZaTunu: dodavatelRudy.cena,
				datumZadani: tick,
				datumOdeslani: -1
			})
			
			// Log order placed
			logger.logEvent(
				logger.createEvent(tick, 'COMPANY_ORDER_PLACED', this.id, {
					supplierId: dodavatelRudy.id,
					materialType: 'ZELEZNA_RUDA',
					quantity: mnozstviZelezneRudy,
					pricePerUnit: dodavatelRudy.cena,
					totalCost: mnozstviZelezneRudy * dodavatelRudy.cena
				}, { companyId: this.id })
			)
		}	
		else {
			logger.logEvent(
				logger.createEvent(tick, 'COMPANY_ORDER_FAILED', this.id, {
					materialType: 'ZELEZNA_RUDA',
					quantity: mnozstviZelezneRudy,
					reason: 'No supplier found'
				}, { companyId: this.id, severity: 'warning' })
			)
		}

		if(dodavatelKoksu){
			const costKoks = mnozstviKoksu * dodavatelKoksu.cena
			this.totalCosts += costKoks
			this.ordersPlaced++
			
			dodavatelKoksu.pridatObjednavku({
				firma: this,
				supplierId: dodavatelKoksu.id,
				objem: mnozstviKoksu,
				typSuroviny: TypSuroviny["KOKS"],
				cenaZaTunu: dodavatelKoksu.cena,
				datumZadani: tick,
				datumOdeslani: -1
			})
			
			// Log order placed
			logger.logEvent(
				logger.createEvent(tick, 'COMPANY_ORDER_PLACED', this.id, {
					supplierId: dodavatelKoksu.id,
					materialType: 'KOKS',
					quantity: mnozstviKoksu,
					pricePerUnit: dodavatelKoksu.cena,
					totalCost: mnozstviKoksu * dodavatelKoksu.cena
				}, { companyId: this.id })
			)
		}else {
			logger.logEvent(
				logger.createEvent(tick, 'COMPANY_ORDER_FAILED', this.id, {
					materialType: 'KOKS',
					quantity: mnozstviKoksu,
					reason: 'No supplier found'
				}, { companyId: this.id, severity: 'warning' })
			)
		}
	}

	public prijmoutObjednavku(objednavka: Objednavka): void {
		const logger = this.sim.getLogger()
		const currentTick = this.sim['currentTime'] || 0

		if (!this.storageEnabled) {
			logger.logEvent(
				logger.createEvent(currentTick, 'COMPANY_ORDER_FAILED', this.id, {
					materialType: objednavka.typSuroviny,
					quantity: objednavka.objem,
					reason: 'Storage operations are disabled'
				}, { companyId: this.id, severity: 'warning' })
			)
			return
		}

		const deliveryTick = objednavka.datumOdeslani >= 0 ? objednavka.datumOdeslani : currentTick
		const waitTime = Math.max(0, deliveryTick - objednavka.datumZadani)

		let remainingMaterial = objednavka.objem
		for (const budova of this.budovy) {
			for (const sklad of budova.skladovaciJednotky) {
				if (remainingMaterial > 0) {
					const notStored = sklad.naskladniSurovinu(objednavka.typSuroviny, remainingMaterial)
					remainingMaterial = notStored
				}
				if (remainingMaterial === 0) break
			}
			if (remainingMaterial === 0) break
		}

		const receivedQuantity = objednavka.objem - remainingMaterial
		if (receivedQuantity > 0) {
			this.ordersFulfilled++
			this.totalWaitTime += waitTime
			this.waitTimeCount++
		}

		if (this.strategie instanceof AdaptiveStrategy) {
			if (receivedQuantity > 0) {
				this.strategie.recordSupplierFeedback(
					objednavka.supplierId,
					true,
					receivedQuantity * objednavka.cenaZaTunu,
					receivedQuantity,
					waitTime
				)
			} else {
				this.strategie.recordSupplierFeedback(
					objednavka.supplierId,
					false,
					0,
					0,
					waitTime
				)
			}
		}
		
		logger.logEvent(
			logger.createEvent(currentTick, 'COMPANY_ORDER_FULFILLED', this.id, {
				supplierId: objednavka.supplierId,
				materialType: objednavka.typSuroviny,
				quantity: receivedQuantity,
				notStoredQuantity: remainingMaterial,
				cenaZaTunu: objednavka.cenaZaTunu,
				totalCost: receivedQuantity * objednavka.cenaZaTunu,
				datumZadani: objednavka.datumZadani,
				datumOdeslani: objednavka.datumOdeslani,
				waitTimeTicks: waitTime
			}, { companyId: this.id })
		)
	}

	private prepocitejKPI(): void {
		// Calculate total investment (buildings, lines, warehouses)
		let productionLines = 0
		let totalProductionCapacity = 0
		let totalStorageCapacity = 0
		let currentStorageUsed = 0
		
		this.budovy.forEach(budova => {
			productionLines += budova.linky.length
			
			budova.linky.forEach(linka => {
				totalProductionCapacity += linka.kapacita
			})
			
			budova.skladovaciJednotky.forEach(sklad => {
				totalStorageCapacity += sklad.kapacita
				currentStorageUsed += sklad.aktualniCelkoveMnozstvi
			})
		})
		
		this.KPI.celkovaInvestice = this.totalInvestment
		
		// Net profit = current finance - initial finance
		this.KPI.cistyZisk = this.finance - this.initialFinance
		
		// Financial reserve (portion of finance kept as buffer)
		this.KPI.financniRezerva = Math.max(0, this.finance * config.kpi.financialReserveRatio)

		const operatingResult = this.totalRevenue - this.totalCosts
		this.KPI.provozniMarze = this.totalRevenue > 0
			? operatingResult / this.totalRevenue
			: 0

		this.KPI.nakladovostTrzeb = this.totalRevenue > 0
			? this.totalCosts / this.totalRevenue
			: (this.totalCosts > 0 ? 10 : 0)

		this.KPI.uspesnostPlneniObjednavek = this.ordersPlaced > 0
			? this.ordersFulfilled / this.ordersPlaced
			: 0

		const futureReserveNeeded = this.getFutureReserveNeeded()
		this.KPI.likviditniKrytiProvozu = futureReserveNeeded > 0
			? this.finance / futureReserveNeeded
			: (this.finance >= 0 ? 1 : 0)
		
		// Unmet demand rate (blended supply and market failures)
		const supplyFailure = this.ordersPlaced > 0 
			? Math.max(0, (this.ordersPlaced - this.ordersFulfilled) / this.ordersPlaced)
			: 0
		
		const marketFailure = this.totalMarketDemand > 0
			? Math.max(0, (this.totalMarketDemand - this.totalMarketSatisfied) / this.totalMarketDemand)
			: 0

		// Blend: 30% supply reliability, 70% market satisfaction
		this.KPI.miraNesplnenePoptavky = this.totalMarketDemand > 0
			? (supplyFailure * 0.3 + marketFailure * 0.7)
			: supplyFailure
		
		// Storage utilization
		this.KPI.miraVyuzitiSkladovaciJednotky = totalStorageCapacity > 0
			? currentStorageUsed / totalStorageCapacity
			: 0
		
		// Production capacity utilization (simplified - based on having lines)
		this.KPI.miraVyuzitiVyrobniKapacity = productionLines > 0
			? Math.min(1, productionLines / config.kpi.productionCapacityReferenceLines)
			: 0
		
		// Average wait time for materials
		this.KPI.prumernaDobaCekaniSurovin = this.waitTimeCount > 0
			? this.totalWaitTime / this.waitTimeCount
			: 0
		
		// ROI calculation
		this.KPI.ROI = this.KPI.celkovaInvestice > 0
			? this.KPI.cistyZisk / this.KPI.celkovaInvestice
			: 0
		
		// Energy consumption (sum from all production lines)
		this.KPI.spotrebaEnergie = this.spotrebaEnergie
	}

	public koupitBudovu(): boolean {
		const logger = this.sim.getLogger()
		const currentTick = this.sim['currentTime'] || 0
		const region = this.sim.region

		if (this.finance < 0) {
			return false
		}
		
		// Get the next available building from the region
		if (region.volneBudovy.length === 0) {
			logger.logEvent(
				logger.createEvent(currentTick, 'COMPANY_EXPANSION_FAILED', this.id, {
					expandType: 'BUDOVA',
					reason: 'No available buildings',
					available: this.finance
				}, { companyId: this.id, severity: 'warning' })
			)
			return false
		}
		
		// Get cheapest available building
		const availableBuildings = region.volneBudovy.slice().sort((a, b) => a.cenaKoupi - b.cenaKoupi);
		const budovaToAdd = availableBuildings[0];
		
		if (!budovaToAdd) {
			logger.logEvent(
				logger.createEvent(currentTick, 'COMPANY_EXPANSION_FAILED', this.id, {
					expandType: 'BUDOVA',
					reason: 'No available buildings',
					available: this.finance
				}, { companyId: this.id, severity: 'warning' })
			)
			return false
		}

		const cost = budovaToAdd.cenaKoupi;
		
		if (this.finance < cost) {
			logger.logEvent(
				logger.createEvent(currentTick, 'COMPANY_EXPANSION_FAILED', this.id, {
					expandType: 'BUDOVA',
					reason: 'Insufficient funds',
					required: cost,
					available: this.finance
				}, { companyId: this.id, severity: 'warning' })
			)
			return false
		}

		const expansionLookaheadTicks = Firma.EXPANSION_LOOKAHEAD_TICKS
		if (!this.canAffordWithFutureReserve(cost, expansionLookaheadTicks)) {
			logger.logEvent(
				logger.createEvent(currentTick, 'COMPANY_EXPANSION_FAILED', this.id, {
					expandType: 'BUDOVA',
					reason: 'Insufficient future reserve',
					required: cost,
					available: this.finance,
					futureReserveNeeded: this.getFutureReserveNeeded(expansionLookaheadTicks),
					lookaheadTicks: expansionLookaheadTicks
				}, { companyId: this.id, severity: 'warning' })
			)
			return false
		}

		this.scheduleCompanyAction('BUY_BUILDING', {
			costEstimate: cost,
			queueStartedAtTick: currentTick
		}, currentTick)

		return true
	}
	
	public koupitLinku(): boolean {
		const logger = this.sim.getLogger()
		const currentTick = this.sim['currentTime'] || 0
		const cost = config.linka.pocatecniCena

		if (this.finance < 0) {
			return false
		}
		
		if (this.finance < cost) {
			logger.logEvent(
				logger.createEvent(currentTick, 'COMPANY_EXPANSION_FAILED', this.id, {
					expandType: 'LINKA',
					reason: 'Insufficient funds',
					required: cost,
					available: this.finance
				}, { companyId: this.id, severity: 'warning' })
			)
			return false
		}

		const additionalDailyOperatingCost = this.getAdditionalDailyOperatingCostForLine()
		const expansionLookaheadTicks = Firma.EXPANSION_LOOKAHEAD_TICKS
		if (!this.canAffordWithFutureReserveAndOperatingImpact(cost, additionalDailyOperatingCost, expansionLookaheadTicks)) {
			logger.logEvent(
				logger.createEvent(currentTick, 'COMPANY_EXPANSION_FAILED', this.id, {
					expandType: 'LINKA',
					reason: 'Insufficient future reserve including operating impact',
					required: cost,
					available: this.finance,
					futureReserveNeeded: this.getFutureReserveNeeded(expansionLookaheadTicks),
					additionalDailyOperatingCost,
					additionalReserveNeeded: additionalDailyOperatingCost * expansionLookaheadTicks,
					lookaheadTicks: expansionLookaheadTicks
				}, { companyId: this.id, severity: 'warning' })
			)
			return false
		}
		
		if (!this.hasSpaceForLine()) {
			logger.logEvent(
				logger.createEvent(currentTick, 'COMPANY_EXPANSION_FAILED', this.id, {
					expandType: 'LINKA',
					reason: 'No space in any building',
					buddingsCount: this.budovy.length
				}, { companyId: this.id, severity: 'warning' })
			)
			return false
		}
		
		this.finance -= cost
		this.totalInvestment += cost

		this.scheduleCompanyAction('BUY_LINE', {
			cost
		}, currentTick)

		return true
	}

	public koupitSklad(): boolean {
		const logger = this.sim.getLogger()
		const currentTick = this.sim['currentTime'] || 0
		const cost = config.sklad.pocatecniCena

		if (this.finance < 0) {
			return false
		}
		
		if (this.finance < cost) {
			logger.logEvent(
				logger.createEvent(currentTick, 'COMPANY_EXPANSION_FAILED', this.id, {
					expandType: 'SKLAD',
					reason: 'Insufficient funds',
					required: cost,
					available: this.finance
				}, { companyId: this.id, severity: 'warning' })
			)
			return false
		}

		const additionalDailyOperatingCost = this.getAdditionalDailyOperatingCostForStorage()
		const expansionLookaheadTicks = Firma.EXPANSION_LOOKAHEAD_TICKS
		if (!this.canAffordWithFutureReserveAndOperatingImpact(cost, additionalDailyOperatingCost, expansionLookaheadTicks)) {
			logger.logEvent(
				logger.createEvent(currentTick, 'COMPANY_EXPANSION_FAILED', this.id, {
					expandType: 'SKLAD',
					reason: 'Insufficient future reserve including operating impact',
					required: cost,
					available: this.finance,
					futureReserveNeeded: this.getFutureReserveNeeded(expansionLookaheadTicks),
					additionalDailyOperatingCost,
					additionalReserveNeeded: additionalDailyOperatingCost * expansionLookaheadTicks,
					lookaheadTicks: expansionLookaheadTicks
				}, { companyId: this.id, severity: 'warning' })
			)
			return false
		}
		
		if (!this.hasSpaceForStorage()) {
			logger.logEvent(
				logger.createEvent(currentTick, 'COMPANY_EXPANSION_FAILED', this.id, {
					expandType: 'SKLAD',
					reason: 'No space in any building',
					buddingsCount: this.budovy.length
				}, { companyId: this.id, severity: 'warning' })
			)
			return false
		}
		
		this.finance -= cost
		this.totalInvestment += cost

		this.scheduleCompanyAction('BUY_STORAGE', {
			cost
		}, currentTick)

		return true
	}

	public getMistoVeSkladu(): /* Map<TypSuroviny, number> */ void {
		const logger = this.sim.getLogger()
		const skladovyProstor = this.budovy[0]?.getVsechnyVeciNaSkladech()
		
		if (skladovyProstor) {
			logger.logEvent(
				logger.createEvent(this.sim['currentTime'] || 0, 'STATE_INVENTORY_CHANGED', this.id, {
					inventory: skladovyProstor
				}, { companyId: this.id })
			)
		}
		// return this.budovy[0]?.getVsechnyVeciNaSkladech()
	}

	public setId(id: number){
		this.id = id
		// this.ownSeed = this.seed + this.id + typSuroviny //TODO: pokud rng tak toto
		// this.priceRng = createRng(this.ownSeed + "priceRNG");
        // this.volumeRng = createRng(this.ownSeed + "volumeRNG");
		this.getMistoVeSkladu()
	}

	/**
	 * Calculate operational costs per tick:
	 * - Employee wages from all production lines
	 * - Energy costs from lines and warehouses
	 */
	private calculateOperationalCosts(): number {
		let totalWages = 0
		let totalEnergyConsumption = 0
		const productionLoadFactor = this.getProductionLoadFactor()
		
		this.budovy.forEach(budova => {
			if (this.productionEnabled) {
				budova.linky.forEach(linka => {
					totalWages += linka.getMzdy() * productionLoadFactor
					totalEnergyConsumption += linka.spotrebaEnergie * productionLoadFactor
				})
			}

			if (this.storageEnabled) {
				budova.skladovaciJednotky.forEach(sklad => {
					totalEnergyConsumption += sklad.spotrebaEnergie
				})
			}
		})
		
		const energyCosts = totalEnergyConsumption * config.cenaEnergie
		
		// Update company energy consumption tracker
		this.spotrebaEnergie = totalEnergyConsumption
		
		return totalWages + energyCosts
	}

	private getAdditionalDailyOperatingCostForLine(): number {
		const lineWages = (config.linka.pocetZamestnancu * config.mzdaZamestnance) / 30
		const lineEnergyCost = config.linka.spotrebaEnergie * config.cenaEnergie
		return lineWages + lineEnergyCost
	}

	private getAdditionalDailyOperatingCostForStorage(): number {
		return config.sklad.spotrebaEnergie * config.cenaEnergie
	}

	private canAffordWithFutureReserveAndOperatingImpact(
		purchaseCost: number,
		additionalDailyOperatingCost: number,
		lookaheadTicks: number = Firma.FINANCIAL_LOOKAHEAD_TICKS
	): boolean {
		const baseReserveNeeded = this.getFutureReserveNeeded(lookaheadTicks)
		const additionalReserveNeeded = Math.max(0, additionalDailyOperatingCost) * lookaheadTicks
		return (this.finance - purchaseCost) >= (baseReserveNeeded + additionalReserveNeeded)
	}

	private getTotalInventoryAmount(): number {
		return this.getInventory(TypSuroviny.OCEL)
			+ this.getInventory(TypSuroviny.ZELEZNA_RUDA)
			+ this.getInventory(TypSuroviny.KOKS)
	}

	private getProductionLoadFactor(): number {
		if (this.finance >= 0) {
			return 1
		}

		const debtSoftLimit = Math.max(1, this.initialFinance * Firma.DEBT_RECOVERY_SOFT_LIMIT_RATIO)
		const debtRatio = Math.min(1, Math.abs(this.finance) / debtSoftLimit)
		return Math.max(Firma.DEBT_RECOVERY_PRODUCTION_FLOOR, 1 - (debtRatio * (1 - Firma.DEBT_RECOVERY_PRODUCTION_FLOOR)))
	}

	private hasProductionInfrastructure(): boolean {
		return this.budovy.some(budova => budova.linky.length > 0)
	}

	private hasStorageInfrastructure(): boolean {
		return this.budovy.some(budova => budova.skladovaciJednotky.length > 0)
	}

	private applyFinancialPressureOperationsMode(tick: number): void {
		const logger = this.sim.getLogger()
		const expectedProductionEnabled = this.hasProductionInfrastructure()
		const expectedStorageEnabled = this.hasStorageInfrastructure()

		if (expectedProductionEnabled === this.productionEnabled && expectedStorageEnabled === this.storageEnabled) {
			return
		}

		this.productionEnabled = expectedProductionEnabled
		this.storageEnabled = expectedStorageEnabled

		logger.logEvent(
			logger.createEvent(tick, 'COMPANY_STRATEGIC_DECISION', this.id, {
				decision: 'AUTO_OPERATIONS_MODE_ADJUSTMENT',
				reason: 'Infrastructure-aware operations mode',
				finance: this.finance,
				productionLoadFactor: this.getProductionLoadFactor(),
				productionEnabled: this.productionEnabled,
				storageEnabled: this.storageEnabled
			}, { companyId: this.id, severity: this.finance < 0 ? 'warning' : 'info' })
		)
	}

	private applyDailyOperatingCosts(tick: number): void {
		const dailyOperationalCost = this.calculateOperationalCosts()
		if (dailyOperationalCost <= 0) {
			return
		}

		this.finance -= dailyOperationalCost
		this.totalCosts += dailyOperationalCost

		const logger = this.sim.getLogger()
		logger.logEvent(
			logger.createEvent(tick, 'COMPANY_STRATEGIC_DECISION', this.id, {
				decision: 'DAILY_OPERATING_COST_APPLIED',
				dailyOperationalCost,
				remainingFinance: this.finance,
				energyConsumption: this.spotrebaEnergie
			}, { companyId: this.id })
		)
	}

	private estimateSupplyCostForTicks(ticks: number): number {
		if (ticks <= 0) {
			return 0
		}

		const suppliers = this.sim.getDodavatele()
		const dodavatelRudy = this.strategie.zjistiDodavatele(this, suppliers, TypSuroviny.ZELEZNA_RUDA)
		const dodavatelKoksu = this.strategie.zjistiDodavatele(this, suppliers, TypSuroviny.KOKS)

		if (!dodavatelRudy || !dodavatelKoksu) {
			return 0
		}

		const maxCapacity = this.getMaxProductionCapacity()
		const targetRudy = maxCapacity * this.getRudaPerOcel() * ticks
		const targetKoks = maxCapacity * this.getKoksPerOcel() * ticks

		const currentRudy = this.getInventory(TypSuroviny.ZELEZNA_RUDA)
		const currentKoks = this.getInventory(TypSuroviny.KOKS)

		const neededRudy = Math.max(0, targetRudy - currentRudy)
		const neededKoks = Math.max(0, targetKoks - currentKoks)

		return (neededRudy * dodavatelRudy.cena) + (neededKoks * dodavatelKoksu.cena)
	}

	private getFutureReserveNeeded(lookaheadTicks: number = Firma.FINANCIAL_LOOKAHEAD_TICKS): number {
		const operationalReserve = this.calculateOperationalCosts() * lookaheadTicks
		const supplyReserve = this.estimateSupplyCostForTicks(lookaheadTicks)
		return operationalReserve + supplyReserve
	}

	private canAffordWithFutureReserve(cost: number, lookaheadTicks: number = Firma.FINANCIAL_LOOKAHEAD_TICKS): boolean {
		const reserveNeeded = this.getFutureReserveNeeded(lookaheadTicks)
		return (this.finance - cost) >= reserveNeeded
	}

	/**
	 * Calculate maximum production capacity based on all linky
	 */
	public getMaxProductionCapacity(): number {
		let totalCapacity = 0
		this.budovy.forEach(budova => {
			budova.linky.forEach(linka => {
				totalCapacity += linka.kapacita
			})
		})
		return totalCapacity
	}

	/**
	 * Get current inventory of a specific material type
	 */
	public getInventory(materialType: TypSuroviny): number {
		let total = 0
		this.budovy.forEach(budova => {
			budova.skladovaciJednotky.forEach(sklad => {
				total += sklad.ziskejMnozstvi(materialType)
			})
		})
		return total
	}

	private selectSupplierWithStock(materialType: TypSuroviny, preferredSupplier: Dodavatel | null): Dodavatel | null {
		if (preferredSupplier && preferredSupplier.typSuroviny === materialType && preferredSupplier.celkovyObjem > 0) {
			return preferredSupplier
		}

		const candidates = this.sim
			.getDodavatele()
			.filter(supplier => supplier.typSuroviny === materialType && supplier.celkovyObjem > 0)

		if (candidates.length === 0) {
			return null
		}

		candidates.sort((a, b) => {
			const scoreA = a.cena + (getGeoDistance(this.poloha, a.poloha) * config.cenaZaKm) / 100
			const scoreB = b.cena + (getGeoDistance(this.poloha, b.poloha) * config.cenaZaKm) / 100
			return scoreA - scoreB
		})

		return candidates[0] ?? null
	}

	/**
	 * Dynamically calculate and buy supplies based on current inventory, storage, and production needs
	 * Buys enough materials for about 2-3 ticks of production at current capacity
	 */
	public buySuppliesDynamically(tick: number): boolean {
		const logger = this.sim.getLogger()

		if (!this.storageEnabled) {
			logger.logEvent(
				logger.createEvent(tick, 'COMPANY_BUY_FAILED', this.id, {
					reason: 'Storage operations are disabled'
				}, { companyId: this.id, severity: 'warning' })
			)
			return false
		}
		
		// Get current production capacity
		const maxCapacity = this.getMaxProductionCapacity()
		
		// Check available storage space
		let availableSpace = 0
		this.budovy.forEach(budova => {
			budova.skladovaciJednotky.forEach(sklad => {
				availableSpace += sklad.zbyvaMista()
			})
		})
		
		// If no space at all, we can't buy anything - try to sell existing OCEL first
		if (availableSpace <= 0) {
			const existingOcel = this.getInventory(TypSuroviny.OCEL)
			if (existingOcel > config.firma.fullStorageSellThreshold) {
				this.sellProduct(Math.floor(existingOcel * config.firma.fullStorageSellRatio), TypSuroviny.OCEL, tick)
			}
			return false  // Can't buy, storage is full
		}
		
		// Get current inventory
		const currentRudy = this.getInventory(TypSuroviny.ZELEZNA_RUDA)
		const currentKoks = this.getInventory(TypSuroviny.KOKS)
		
		// Calculate materials needed for 2-3 ticks of production at max capacity
		// Production ratio: 0.25 KOKS + 0.75 RUDA -> 0.5 OCEL (1.5 RUDA + 0.5 KOKS per OCEL)
		const ticksToSupply = config.firma.dynamicSupplyTicks
		const totalRudyNeeded = maxCapacity * this.getRudaPerOcel() * ticksToSupply
		const totalKoksNeeded = maxCapacity * this.getKoksPerOcel() * ticksToSupply
		
		// Calculate what we need to buy (what we're missing)
		let rudyToBuy = Math.max(0, totalRudyNeeded - currentRudy)
		let koksToBuy = Math.max(0, totalKoksNeeded - currentKoks)
		
		// Limit by available storage space
		const totalToBuy = rudyToBuy + koksToBuy
		if (totalToBuy > availableSpace) {
			// Scale down proportionally
			const scale = availableSpace / totalToBuy
			rudyToBuy = Math.floor(rudyToBuy * scale)
			koksToBuy = Math.floor(koksToBuy * scale)
		}
		
		// If we don't need anything, don't buy
		if (rudyToBuy <= 0 && koksToBuy <= 0) {
			return true // Not a failure, just no need to buy
		}
		
		// Use the existing buySupplies method to do the actual purchase
		return this.buySupplies(rudyToBuy, koksToBuy, tick)
	}

	/**
	 * Buy raw materials directly using finances
	 * This is a simplified version that instantly purchases materials
	 */
	public buySupplies(mnozstviZelezneRudy: number, mnozstviKoksu: number, tick: number): boolean {
		const logger = this.sim.getLogger()

		if (!this.storageEnabled) {
			logger.logEvent(
				logger.createEvent(tick, 'COMPANY_BUY_FAILED', this.id, {
					reason: 'Storage operations are disabled'
				}, { companyId: this.id, severity: 'warning' })
			)
			return false
		}

		const preferredRudaSupplier = this.strategie.zjistiDodavatele(this, this.sim.getDodavatele(), TypSuroviny["ZELEZNA_RUDA"])
		const preferredKoksSupplier = this.strategie.zjistiDodavatele(this, this.sim.getDodavatele(), TypSuroviny["KOKS"])
		const dodavatelRudy = this.selectSupplierWithStock(TypSuroviny["ZELEZNA_RUDA"], preferredRudaSupplier)
		const dodavatelKoksu = this.selectSupplierWithStock(TypSuroviny["KOKS"], preferredKoksSupplier)

		if (!dodavatelRudy || !dodavatelKoksu) {
			logger.logEvent(
				logger.createEvent(tick, 'COMPANY_BUY_FAILED', this.id, {
					reason: 'Supplier not found'
				}, { companyId: this.id, severity: 'warning' })
			)
			return false
		}

		let rudyToBuy = mnozstviZelezneRudy
		let koksToBuy = mnozstviKoksu
		const availableRudyAtSupplier = Math.max(0, Math.floor(dodavatelRudy.celkovyObjem))
		const availableKoksAtSupplier = Math.max(0, Math.floor(dodavatelKoksu.celkovyObjem))
		rudyToBuy = Math.min(rudyToBuy, availableRudyAtSupplier)
		koksToBuy = Math.min(koksToBuy, availableKoksAtSupplier)

		if (rudyToBuy <= 0 && koksToBuy <= 0) {
			logger.logEvent(
				logger.createEvent(tick, 'COMPANY_BUY_FAILED', this.id, {
					reason: 'Suppliers have no available stock',
					supplierRudyStock: availableRudyAtSupplier,
					supplierKoksStock: availableKoksAtSupplier
				}, { companyId: this.id, severity: 'warning' })
			)
			return false
		}

		const currentRudyInventory = this.getInventory(TypSuroviny.ZELEZNA_RUDA)
		const currentKoksInventory = this.getInventory(TypSuroviny.KOKS)
		const calculateTransportCost = (rudyQty: number, koksQty: number): number => {
			const distanceToRudySupplier = rudyQty > 0 ? getGeoDistance(this.poloha, dodavatelRudy.poloha) : 0
			const distanceToKoksSupplier = koksQty > 0 ? getGeoDistance(this.poloha, dodavatelKoksu.poloha) : 0
			return (distanceToRudySupplier + distanceToKoksSupplier) * config.cenaZaKm
		}

		let transportCost = calculateTransportCost(rudyToBuy, koksToBuy)
		let totalCost = (rudyToBuy * dodavatelRudy.cena) + (koksToBuy * dodavatelKoksu.cena) + transportCost
		// Limit spending based on strategy's risk appetite: only a fraction of current
		// finances may be spent on supplies per tick, preventing firms from draining all
		// their money at the start of the simulation.
		const spendRatio = this.strategie.getSupplySpendRatio()
		const positiveCash = Math.max(0, this.finance)
		const debtRecoveryHeadroom = this.finance < 0
			? Math.max(0, (this.initialFinance * Firma.DEBT_RECOVERY_SUPPLY_HEADROOM_RATIO) + this.finance)
			: 0
		const maxSpendableForSupplies = Math.max(0, (positiveCash + debtRecoveryHeadroom) * spendRatio)

		// If request is too expensive, scale it down to what is affordable instead of failing completely
		if (maxSpendableForSupplies < totalCost) {
			const affordableScale = totalCost > 0 ? maxSpendableForSupplies / totalCost : 0
			rudyToBuy = Math.floor(rudyToBuy * affordableScale)
			koksToBuy = Math.floor(koksToBuy * affordableScale)

			// Spend any remaining budget on the current production bottleneck first
			// to avoid systematic RUDA surplus and KOKS shortages.
			let remainingBudget = Math.max(0, maxSpendableForSupplies - transportCost - ((rudyToBuy * dodavatelRudy.cena) + (koksToBuy * dodavatelKoksu.cena)))
			let remainingRudyDemand = Math.max(0, mnozstviZelezneRudy - rudyToBuy)
			let remainingKoksDemand = Math.max(0, mnozstviKoksu - koksToBuy)

			const buyMoreRudy = () => {
				if (remainingBudget <= 0 || remainingRudyDemand <= 0 || dodavatelRudy.cena <= 0) return
				const addRudy = Math.min(remainingRudyDemand, Math.max(0, availableRudyAtSupplier - rudyToBuy), Math.floor(remainingBudget / dodavatelRudy.cena))
				if (addRudy <= 0) return
				rudyToBuy += addRudy
				remainingRudyDemand -= addRudy
				remainingBudget -= addRudy * dodavatelRudy.cena
			}

			const buyMoreKoks = () => {
				if (remainingBudget <= 0 || remainingKoksDemand <= 0 || dodavatelKoksu.cena <= 0) return
				const addKoks = Math.min(remainingKoksDemand, Math.max(0, availableKoksAtSupplier - koksToBuy), Math.floor(remainingBudget / dodavatelKoksu.cena))
				if (addKoks <= 0) return
				koksToBuy += addKoks
				remainingKoksDemand -= addKoks
				remainingBudget -= addKoks * dodavatelKoksu.cena
			}

			const projectedSteelByRudy = (currentRudyInventory + rudyToBuy) / this.getRudaPerOcel()
			const projectedSteelByKoks = (currentKoksInventory + koksToBuy) / this.getKoksPerOcel()
			const koksIsBottleneck = projectedSteelByKoks < projectedSteelByRudy

			if (koksIsBottleneck) {
				buyMoreKoks()
				buyMoreRudy()
			} else {
				buyMoreRudy()
				buyMoreKoks()
			}

			// Fallback: if scaling rounded everything to zero, prefer bottleneck material
			// (or whichever type is actually requested) instead of always choosing cheaper one.
			if (rudyToBuy <= 0 && koksToBuy <= 0) {
				const prefersKoks = (mnozstviKoksu > 0 && (mnozstviZelezneRudy <= 0 || koksIsBottleneck))
				if (prefersKoks && availableKoksAtSupplier > 0 && maxSpendableForSupplies >= (dodavatelKoksu.cena + transportCost)) {
					koksToBuy = config.firma.minimumFallbackOrderQuantity
				} else if (mnozstviZelezneRudy > 0 && availableRudyAtSupplier > 0 && maxSpendableForSupplies >= (dodavatelRudy.cena + transportCost)) {
					rudyToBuy = config.firma.minimumFallbackOrderQuantity
				} else if (mnozstviKoksu > 0 && availableKoksAtSupplier > 0 && maxSpendableForSupplies >= (dodavatelKoksu.cena + transportCost)) {
					koksToBuy = config.firma.minimumFallbackOrderQuantity
				}
			}

			transportCost = calculateTransportCost(rudyToBuy, koksToBuy)
			totalCost = (rudyToBuy * dodavatelRudy.cena) + (koksToBuy * dodavatelKoksu.cena) + transportCost

			if (totalCost <= 0 || maxSpendableForSupplies < totalCost) {
				logger.logEvent(
					logger.createEvent(tick, 'COMPANY_BUY_FAILED', this.id, {
						reason: 'Insufficient funds',
						required: (mnozstviZelezneRudy * dodavatelRudy.cena) + (mnozstviKoksu * dodavatelKoksu.cena),
						available: this.finance
					}, { companyId: this.id, severity: 'warning' })
				)
				return false
			}

			logger.logEvent(
				logger.createEvent(tick, 'COMPANY_STRATEGIC_DECISION', this.id, {
					decision: 'DOWNSCALE_SUPPLY_ORDER',
					requestedRudy: mnozstviZelezneRudy,
					requestedKoks: mnozstviKoksu,
					affordableRudy: rudyToBuy,
					affordableKoks: koksToBuy,
					requestedCost: (mnozstviZelezneRudy * dodavatelRudy.cena) + (mnozstviKoksu * dodavatelKoksu.cena),
					affordableCost: totalCost,
					availableFinance: this.finance
				}, { companyId: this.id })
			)
		}

		rudyToBuy = Math.min(rudyToBuy, Math.max(0, Math.floor(dodavatelRudy.celkovyObjem)))
		koksToBuy = Math.min(koksToBuy, Math.max(0, Math.floor(dodavatelKoksu.celkovyObjem)))
		transportCost = calculateTransportCost(rudyToBuy, koksToBuy)
		totalCost = (rudyToBuy * dodavatelRudy.cena) + (koksToBuy * dodavatelKoksu.cena) + transportCost

		if ((rudyToBuy <= 0 && koksToBuy <= 0) || totalCost <= 0 || totalCost > maxSpendableForSupplies) {
			logger.logEvent(
				logger.createEvent(tick, 'COMPANY_BUY_FAILED', this.id, {
					reason: 'Insufficient funds or supplier stock after constraints',
					requestedRudy: mnozstviZelezneRudy,
					requestedKoks: mnozstviKoksu,
					affordableRudy: rudyToBuy,
					affordableKoks: koksToBuy,
					availableFinance: this.finance,
					maxSpendableForSupplies,
					totalCost
				}, { companyId: this.id, severity: 'warning' })
			)
			return false
		}

		// Check if we have storage space
		let availableSpace = 0
		this.budovy.forEach(budova => {
			budova.skladovaciJednotky.forEach(sklad => {
				availableSpace += sklad.zbyvaMista()
			})
		})

		const requiredSpace = rudyToBuy + koksToBuy
		if (availableSpace < requiredSpace) {
			logger.logEvent(
				logger.createEvent(tick, 'COMPANY_BUY_FAILED', this.id, {
					reason: 'Insufficient storage space',
					required: requiredSpace,
					available: availableSpace
				}, { companyId: this.id, severity: 'warning' })
			)
			return false
		}

		// Deduct finances
		this.finance -= totalCost
		this.totalCosts += totalCost
		this.ordersPlaced += (rudyToBuy > 0 ? 1 : 0) + (koksToBuy > 0 ? 1 : 0)
		dodavatelRudy.celkovyObjem = Math.max(0, dodavatelRudy.celkovyObjem - rudyToBuy)
		dodavatelKoksu.celkovyObjem = Math.max(0, dodavatelKoksu.celkovyObjem - koksToBuy)

		this.scheduleCompanyAction('BUY_SUPPLIES', {
			rudyToBuy,
			koksToBuy,
			totalCost,
			transportCost,
			supplierRudyId: dodavatelRudy.id,
			supplierKoksId: dodavatelKoksu.id
		}, tick)

		// Update order statistics
		if (rudyToBuy > 0) this.ordersPlaced++
		if (koksToBuy > 0) this.ordersPlaced++

		return true
	}

	/**
	 * Check if expansion is needed and affordable
	 */
	public shouldExpand(): boolean {
		if (this.finance < 0) {
			return false
		}

		if (
			this.hasPendingAction('BUY_BUILDING') ||
			this.hasPendingAction('BUY_LINE') ||
			this.hasPendingAction('BUY_STORAGE') ||
			this.expansionTasksQueue.length > 0
		) {
			return false
		}

		// Expand only if we keep reserve for future operations and supplies
		const reserveNeeded = this.getFutureReserveNeeded(Firma.EXPANSION_LOOKAHEAD_TICKS)
		const minimumExpansionCost = Math.min(config.linka.pocatecniCena, config.sklad.pocatecniCena)
		const profitMargin = this.finance - reserveNeeded - minimumExpansionCost
		
		return profitMargin > config.firma.expansionProfitBuffer
	}

	/**
	 * Expand production by adding a new line
	 */
	public expandProduction(tick: number): boolean {
		const logger = this.sim.getLogger()
		const cost = config.linka.pocatecniCena
		
		if (this.finance < cost) {
			return false
		}

		if (!this.hasSpaceForLine()) {
			this.enqueueExpansionTask('EXPAND_LINE', tick, 'No space for production line, need to buy building first')
			return false
		}
		
		const expanded = this.koupitLinku()
		if (!expanded) {
			if (!this.hasSpaceForLine()) {
				this.enqueueExpansionTask('EXPAND_LINE', tick, 'No space for production line, deferred to queue')
			}
			return false
		}
		
		logger.logEvent(
			logger.createEvent(tick, 'COMPANY_STRATEGIC_DECISION', this.id, {
				decision: 'EXPAND_PRODUCTION',
				cost: cost,
				remainingFinance: this.finance,
				totalLines: this.budovy.reduce((sum, b) => sum + b.linky.length, 0)
			}, { companyId: this.id })
		)
		
		return true
	}

	/**
	 * Expand storage capacity
	 */
	public expandStorage(tick: number): boolean {
		const logger = this.sim.getLogger()
		const cost = config.sklad.pocatecniCena
		
		if (this.finance < cost) {
			return false
		}

		if (!this.hasSpaceForStorage()) {
			this.enqueueExpansionTask('EXPAND_STORAGE', tick, 'No space for storage, need to buy building first')
			return false
		}
		
		const expanded = this.koupitSklad()
		if (!expanded) {
			if (!this.hasSpaceForStorage()) {
				this.enqueueExpansionTask('EXPAND_STORAGE', tick, 'No space for storage, deferred to queue')
			}
			return false
		}
		
		logger.logEvent(
			logger.createEvent(tick, 'COMPANY_STRATEGIC_DECISION', this.id, {
				decision: 'EXPAND_STORAGE',
				cost: cost,
				remainingFinance: this.finance,
				totalStorage: this.budovy.reduce((sum, b) => sum + b.skladovaciJednotky.length, 0)
			}, { companyId: this.id })
		)
		
		return true
	}

	/**
	 * Produce OCEL (steel) using raw materials
	 * Production amount is limited by:
	 * 1. Available raw materials
	 * 2. Total linka capacity
	 * 3. Desired production amount
	 */
	public produce(desiredAmount: number, tick: number): number {
		const logger = this.sim.getLogger()

		if (!this.productionEnabled) {
			logger.logEvent(
				logger.createEvent(tick, 'COMPANY_PRODUCTION_FAILED', this.id, {
					reason: 'Production is disabled',
					desiredAmount
				}, { companyId: this.id, severity: 'warning' })
			)
			return 0
		}

		if (!this.storageEnabled) {
			logger.logEvent(
				logger.createEvent(tick, 'COMPANY_PRODUCTION_FAILED', this.id, {
					reason: 'Storage operations are disabled',
					desiredAmount
				}, { companyId: this.id, severity: 'warning' })
			)
			return 0
		}

		const maxCapacity = this.getMaxProductionCapacity()
		const productionLoadFactor = this.getProductionLoadFactor()
		const effectiveCapacity = Math.max(0, Math.floor(maxCapacity * productionLoadFactor))
		const adjustedDesiredAmount = desiredAmount > 0 && productionLoadFactor > 0
			? Math.max(1, Math.floor(desiredAmount * productionLoadFactor))
			: 0
		
		// Cap production by capacity
		const cappedAmount = Math.min(adjustedDesiredAmount, effectiveCapacity)
		
		// Recipe: 0.25 KOKS + 0.75 RUDA -> 0.5 OCEL
		// Per unit OCEL: 0.5 KOKS + 1.5 RUDA
		let availableKoks = 0
		let availableRudy = 0
		
		this.budovy.forEach(budova => {
			budova.skladovaciJednotky.forEach(sklad => {
				availableKoks += sklad.ziskejMnozstvi(TypSuroviny.KOKS)
				availableRudy += sklad.ziskejMnozstvi(TypSuroviny.ZELEZNA_RUDA)
			})
		})
		
		// Calculate how much we can actually produce
		// Fractional values allowed
		const maxByKoks = availableKoks / this.getKoksPerOcel()
		const maxByRudy = availableRudy / this.getRudaPerOcel()
		const actualProduction = Math.min(cappedAmount, maxByKoks, maxByRudy)
		
		if (actualProduction <= 0) {
			logger.logEvent(
				logger.createEvent(tick, 'COMPANY_PRODUCTION_FAILED', this.id, {
					reason: 'Insufficient raw materials',
					availableKoks: availableKoks,
					availableRudy: availableRudy,
					desiredAmount: desiredAmount
				}, { companyId: this.id, severity: 'warning' })
			)
			return 0
		}
		
		// Calculate actual materials consumed
		const actualKoksUsed = actualProduction * this.getKoksPerOcel()
		const actualRudyUsed = actualProduction * this.getRudaPerOcel()
		
		// Remove materials from storage
		let koksToRemove = actualKoksUsed
		let rudyToRemove = actualRudyUsed
		
		for (const budova of this.budovy) {
			for (const sklad of budova.skladovaciJednotky) {
				if (koksToRemove > 0) {
					const notRemoved = sklad.vyskladniSurovinu(TypSuroviny.KOKS, koksToRemove)
					koksToRemove = notRemoved
				}
				if (rudyToRemove > 0) {
					const notRemoved = sklad.vyskladniSurovinu(TypSuroviny.ZELEZNA_RUDA, rudyToRemove)
					rudyToRemove = notRemoved
				}
				if (koksToRemove === 0 && rudyToRemove === 0) break
			}
			if (koksToRemove === 0 && rudyToRemove === 0) break
		}
		
		this.scheduleCompanyAction('PRODUCE_OCEL', {
			actualProduction,
			actualKoksUsed,
			actualRudyUsed,
			remainingKoksAfterStart: availableKoks - actualKoksUsed,
			remainingRudyAfterStart: availableRudy - actualRudyUsed
		}, tick)

		if (this.getActionDurationTicks('PRODUCE_OCEL') > 0) {
			return 0
		}

		return actualProduction
	}

	/**
	 * Sell products to the region at regional price
	 */
	public sellProduct(amount: number, productType: TypSuroviny, tick: number): number {
		const logger = this.sim.getLogger()

		if (!this.storageEnabled) {
			logger.logEvent(
				logger.createEvent(tick, 'COMPANY_SOLD_PRODUCT', this.id, {
					product: productType,
					amount: 0,
					reason: 'Storage operations are disabled'
				}, { companyId: this.id, severity: 'warning' })
			)
			return 0
		}

		const region = this.sim.getRegion()
		const price = region.getRegionalPrice(productType)
		
		// Check how much product we actually have in storage
		let availableProduct = 0
		this.budovy.forEach(budova => {
			budova.skladovaciJednotky.forEach(sklad => {
				availableProduct += sklad.ziskejMnozstvi(productType)
			})
		})
		
		// Can only sell what we have
		const amountToSell = Math.min(amount, availableProduct)
		
		if (amountToSell === 0) {
			logger.logEvent(
				logger.createEvent(tick, 'COMPANY_SOLD_PRODUCT', this.id, {
					product: productType,
					amount: 0,
					pricePerUnit: price,
					reason: 'No product available in storage'
				}, { companyId: this.id, severity: 'warning' })
			)
			return 0
		}
		
		this.scheduleCompanyAction('SELL_PRODUCT', {
			amountToSell,
			productType,
			price
		}, tick)

		if (this.getActionDurationTicks('SELL_PRODUCT') > 0) {
			return 0
		}

		return amountToSell
	}

	public setOperationsMode(params: { productionEnabled?: boolean; storageEnabled?: boolean }, tick?: number): void {
		if (typeof params.productionEnabled === 'boolean') {
			this.productionEnabled = params.productionEnabled
		}

		if (typeof params.storageEnabled === 'boolean') {
			this.storageEnabled = params.storageEnabled
		}

		const logger = this.sim.getLogger()
		const currentTick = tick ?? (this.sim['currentTime'] || 0)
		logger.logEvent(
			logger.createEvent(currentTick, 'COMPANY_STRATEGIC_DECISION', this.id, {
				decision: 'OPERATIONS_MODE_UPDATED',
				productionEnabled: this.productionEnabled,
				storageEnabled: this.storageEnabled
			}, { companyId: this.id })
		)
	}

	public getOperationsMode(): { productionEnabled: boolean; storageEnabled: boolean } {
		return {
			productionEnabled: this.productionEnabled,
			storageEnabled: this.storageEnabled
		}
	}

	public getTotalInvestment(): number {
		return this.totalInvestment
	}

	public setTotalInvestment(amount: number): void {
		this.totalInvestment = amount
	}

	public toJSON() {
		// Calculate simplified metrics for JSON serialization
		const zasoby: any = { 
			KOKS: { mnozstvi: 0 }, 
			ZELEZNA_RUDA: { mnozstvi: 0 },
			OCEL: { mnozstvi: 0 }
		}
		const linky: any[] = []
		const sklady: any[] = []
		let produkce = 0
		
		this.budovy.forEach(budova => {
			budova.linky.forEach(linka => {
				linky.push({ id: linka.id, kapacita: linka.kapacita })
				produkce += linka.kapacita
			})
			budova.skladovaciJednotky.forEach(sklad => {
				sklady.push({ id: sklad.id, kapacita: sklad.kapacita, obsazeno: sklad.aktualniCelkoveMnozstvi })
				const obsah = sklad.obsah
				if (obsah.has(TypSuroviny.KOKS)) {
					zasoby.KOKS.mnozstvi += obsah.get(TypSuroviny.KOKS) || 0
				}
				if (obsah.has(TypSuroviny.ZELEZNA_RUDA)) {
					zasoby.ZELEZNA_RUDA.mnozstvi += obsah.get(TypSuroviny.ZELEZNA_RUDA) || 0
				}
				if (obsah.has(TypSuroviny.OCEL)) {
					zasoby.OCEL.mnozstvi += obsah.get(TypSuroviny.OCEL) || 0
				}
			})
		})
		
		return {
			id: this.id,
			nazev: this.nazev,
			finance: this.finance,
			budovy: this.budovy,
			linky: linky,
			sklady: sklady,
			zasoby: zasoby,
			produkce: produkce,
			nakladniVozidla: [],
			KPI: this.KPI,
			poloha: this.poloha,
			velikost: this.velikost,
			spotrebaEnergie: this.spotrebaEnergie,
			operationsMode: this.getOperationsMode(),
			pendingActions: this.pendingActions.map(action => ({
				id: action.id,
				type: action.type,
				startedAtTick: action.startedAtTick,
				completeAtTick: action.completeAtTick
			})),
			strategie: this.strategie,
			strategyVariant: this.strategyVariant
		}
	}
}
