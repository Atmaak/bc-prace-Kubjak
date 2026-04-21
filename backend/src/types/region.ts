import { Velikost } from './velikost';
import { Souradnice } from './souradnice';
import { Budova } from './budova';
import { TypSuroviny } from './typSuroviny';
import config from '../config.json';
import { createRng } from '../utils/rng';

export type Ekonomika = {
    koeficientPoptavky: number;   // 1.0 = normál, 0.5 = krize, 1.5 = hodne
    cenaEnergie: number;          // Cena za provoz linky/budovy
}

export class Region {
    public id: number;
    public nazev: string;
    public stred: Souradnice;
    public velikost: Velikost; // Hranice mapy (např. 100x100 km)
    public volneBudovy: Budova[] = []
    public purchasedBuildings: Budova[] = []  // Track buildings owned by companies
    
    // 2. Přírodní bohatství (Globální limit zdrojů v zemi)
    private loziskaSurovin: Map<TypSuroviny, number>; //TODO: mozna

    // 3. Socio-ekonomické prostředí
    
    // Regional pricing - all companies sell at this price
    public regionalPrices: Map<TypSuroviny, number>;
    
    // Regional demand tracking
    public baseDemand: number = config.region.baseDemand; // Base demand per tick
    public demandCoefficient: number = config.koeficientPoptavky; // Economic multiplier
    public totalProduction: number = 0; // Track total production this tick
    private remainingDemandByType: Map<TypSuroviny, number> = new Map();
    private attemptedSalesByType: Map<TypSuroviny, number> = new Map();
    private soldByType: Map<TypSuroviny, number> = new Map();
    private basePrices: Map<TypSuroviny, number> = new Map();

    private readonly marketPriceSensitivity = config.region?.market?.priceSensitivity ?? 0.12;
    private readonly marketMinMultiplier = config.region?.market?.minPriceMultiplier ?? 0.7;
    private readonly marketMaxMultiplier = config.region?.market?.maxPriceMultiplier ?? 1.5;

    private readonly demandModel = config.region?.demandModel ?? {};
    private marketTick: number = 0;
    private readonly demandByType: Map<TypSuroviny, number> = new Map();
    private demandRng: () => number = Math.random;

    constructor(id: number, nazev: string, velikost: Velikost, stred: Souradnice) {
        this.id = id;
        this.nazev = nazev;
        this.velikost = velikost;
        this.loziskaSurovin = new Map();
        this.stred = stred;
        
        // Initialize regional prices for products
        this.regionalPrices = new Map();
        this.regionalPrices.set(TypSuroviny.OCEL, config.cenaOceli);
        this.basePrices.set(TypSuroviny.OCEL, config.cenaOceli);
    }

    public getRemainingDemand(typ: TypSuroviny): number {
        return this.remainingDemandByType.get(typ) ?? 0;
    }

    public getAktualniPoptavka(typ: TypSuroviny): number {
        const cachedDemand = this.demandByType.get(typ);
        if (typeof cachedDemand === 'number') {
            return cachedDemand;
        }

        const periodTicks = this.demandModel.seasonalityPeriodTicks ?? 365;
        const seasonalityAmplitude = this.demandModel.seasonalityAmplitude ?? 0;
        const seasonalityPhaseShift = this.demandModel.seasonalityPhaseShiftTicks ?? 0;

        const shockProbability = this.demandModel.shockProbabilityPerTick ?? 0;
        const shockMaxImpact = this.demandModel.shockMaxImpact ?? 0;

        const basePrice = (this.basePrices.get(typ) ?? this.getRegionalPrice(typ)) || 1;
        const currentPrice = this.getRegionalPrice(typ) || basePrice;
        const elasticity = this.demandModel.priceElasticity ?? 0;
        const minDemandMultiplier = this.demandModel.minDemandMultiplier ?? 0.1;

        const seasonalComponent = periodTicks > 0
            ? Math.sin(((2 * Math.PI) / periodTicks) * (this.marketTick + seasonalityPhaseShift))
            : 0;
        const seasonalMultiplier = 1 + seasonalityAmplitude * seasonalComponent;

        const hasShock = this.demandRng() < shockProbability;
        const shockImpact = hasShock
            ? (this.demandRng() * 2 - 1) * shockMaxImpact
            : 0;
        const shockMultiplier = 1 + shockImpact;

        const relativePriceDelta = basePrice > 0 ? (currentPrice - basePrice) / basePrice : 0;
        const priceMultiplier = Math.max(minDemandMultiplier, 1 - elasticity * relativePriceDelta);

        const effectiveDemand = Math.max(
            0,
            this.baseDemand * this.demandCoefficient * seasonalMultiplier * shockMultiplier * priceMultiplier
        );

        const roundedDemand = Number(effectiveDemand.toFixed(2));
        this.demandByType.set(typ, roundedDemand);
        return roundedDemand;
    }
    
    public getRegionalPrice(typ: TypSuroviny): number {
        return this.regionalPrices.get(typ) || 0;
    }
    
    public setRegionalPrice(typ: TypSuroviny, price: number): void {
        this.regionalPrices.set(typ, price);
    }
    
    /**
     * Companies sell to the region. Region has limited demand.
     * Returns amount actually sold.
     */
    public buyFromCompany(typ: TypSuroviny, quantity: number): number {
        const currentDemand = this.remainingDemandByType.get(typ);
        const remainingDemand = currentDemand ?? this.getAktualniPoptavka(typ);
        const soldQuantity = Math.max(0, Math.min(quantity, remainingDemand));
        const attempted = this.attemptedSalesByType.get(typ) ?? 0;
        const sold = this.soldByType.get(typ) ?? 0;

        this.remainingDemandByType.set(typ, Math.max(0, remainingDemand - soldQuantity));
        this.attemptedSalesByType.set(typ, attempted + quantity);
        this.soldByType.set(typ, sold + soldQuantity);
        this.totalProduction += soldQuantity;
        return soldQuantity;
    }

    public finalizeMarketTick(): void {
        for (const [typ, currentPrice] of this.regionalPrices.entries()) {
            const demand = Math.max(1, this.getAktualniPoptavka(typ));
            const attempted = this.attemptedSalesByType.get(typ) ?? 0;

            const pressure = (demand - attempted) / demand;
            const rawNextPrice = currentPrice * (1 + pressure * this.marketPriceSensitivity);

            const basePrice = this.basePrices.get(typ) ?? currentPrice;
            const minPrice = basePrice * this.marketMinMultiplier;
            const maxPrice = basePrice * this.marketMaxMultiplier;
            const nextPrice = Math.max(minPrice, Math.min(maxPrice, rawNextPrice));

            this.regionalPrices.set(typ, Number(nextPrice.toFixed(2)));
        }
    }

    public getMarketTelemetry(typ: TypSuroviny) {
        const demand = this.getAktualniPoptavka(typ);
        const remainingDemand = this.remainingDemandByType.get(typ) ?? demand;
        const attemptedSales = this.attemptedSalesByType.get(typ) ?? 0;
        const sold = this.soldByType.get(typ) ?? 0;
        const fulfillmentRate = demand > 0 ? sold / demand : 0;

        return {
            materialType: typ,
            currentPrice: this.getRegionalPrice(typ),
            demand,
            remainingDemand,
            attemptedSales,
            sold,
            fulfillmentRate
        };
    }
    
    public resetProductionTracking(): void {
        this.marketTick += 1;
        this.totalProduction = 0;
        this.remainingDemandByType.clear();
        this.attemptedSalesByType.clear();
        this.soldByType.clear();
        this.demandByType.clear();
    }
    
    /**
     * Adjust demand coefficient based on economic conditions
     */
    public setDemandCoefficient(coefficient: number): void {
        this.demandCoefficient = coefficient;
    }

    public setDemandSeed(seed: string): void {
        this.demandRng = createRng(`${seed}-region-demand`);
    }

    public addBudova(budova: Budova) {
        this.volneBudovy.push(budova)
    }

    /**
     * Purchase a building from available buildings
     * Removes it from volneBudovy and adds to purchasedBuildings
     */
    public purchaseBuilding(budovaId: number, companyId: string | number): Budova | null {
        const index = this.volneBudovy.findIndex(b => b.id === budovaId);
        if (index >= 0) {
            const building = this.volneBudovy.splice(index, 1)[0];
            if (building) {
                building.ownerId = companyId;
                this.purchasedBuildings.push(building);
                return building;
            }
        }
        return null;
    }

    /**
     * Get building by ID from available or purchased
     */
    public getBuildingById(budovaId: number): Budova | undefined {
        return this.volneBudovy.find(b => b.id === budovaId) || 
               this.purchasedBuildings.find(b => b.id === budovaId);
    }

    /**
     * Get all buildings owned by a specific company
     */
    public getBuildingsByCompany(companyId: string | number): Budova[] {
        return this.purchasedBuildings.filter(b => b.ownerId === companyId);
    }

    /**
     * Get all purchased buildings
     */
    public getPurchasedBuildings(): Budova[] {
        return this.purchasedBuildings;
    }
}