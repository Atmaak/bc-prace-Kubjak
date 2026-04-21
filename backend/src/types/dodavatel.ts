import { Agent } from './agent';
import { Nabidka } from './nabidka';
import { Firma } from './firma';
import { Souradnice } from './souradnice';
import { getGeoDistance } from '../utils/distance';
import config from '../config.json'
import { createRng } from '../utils/rng';
import { TypSuroviny } from './typSuroviny';
import { Objednavka } from './objednavka';
import { SimulationEngine } from '../simulation';

export class Dodavatel implements Agent {
    public id: number
    public cena: number
    public celkovyObjem: number
    public deniObjem: number
    public poloha: Souradnice
    public typSuroviny: TypSuroviny
    private objednavky: Objednavka[]
    private ownSeed: string
    private seed: string;
    private priceRng: () => number; // Generator for price
    private volumeRng: () => number;
    private sim: SimulationEngine | null;
    private baseDenniObjem: number;
    private minDenniObjem: number;
    
    constructor(seed: string, poloha: Souradnice, id: number, typSuroviny: TypSuroviny, sim?: SimulationEngine){
        this.id = id
        this.seed = seed
        this.ownSeed = this.seed + this.id + typSuroviny
        this.poloha = poloha
        this.priceRng = createRng(this.ownSeed + "priceRNG");
        this.volumeRng = createRng(this.ownSeed + "volumeRNG");
        this.typSuroviny = typSuroviny
        if(typSuroviny == TypSuroviny["ZELEZNA_RUDA"]){
            this.cena = config.dodavatel.pocatecniCenaRudy
            this.deniObjem = config.dodavatel.pocatecniObjemRudy

        }else {
            this.cena = config.dodavatel.pocatecniCenaKoksu
            this.deniObjem = config.dodavatel.pocatecniObjemKoksu
        }
        this.baseDenniObjem = this.deniObjem
        this.minDenniObjem = Math.max(1, Math.floor(this.baseDenniObjem * 0.35))
        this.celkovyObjem = 0;
        this.objednavky = []
        this.sim = sim ?? null
    }

    public tick(tick: number){
        // START PRICING
        const direction = (this.priceRng() - 0.5) * 2; 
        const changePercent = 1 + (direction * config.dodavatel.volatility);

        this.cena = Number((this.cena * changePercent).toFixed(2));
        if (this.cena < config.dodavatel.minPrice) this.cena = config.dodavatel.minPrice;

        const volVariance = (this.volumeRng() - 0.5) * (config.dodavatel.dailyVolumeVariance * 2);
        const targetDenniObjem = this.baseDenniObjem * (1 + volVariance)
        this.deniObjem = Math.max(this.minDenniObjem, Math.floor(targetDenniObjem));
        this.celkovyObjem += this.deniObjem

        // Log supplier state update
        if (this.sim) {
            const logger = this.sim.getLogger()
            logger.logEvent(
                logger.createEvent(tick, 'SUPPLIER_STOCK_CHANGED', this.id, {
                    materialType: this.typSuroviny,
                    price: this.cena,
                    dailyVolume: this.deniObjem,
                    totalStock: this.celkovyObjem,
                    queuedOrders: this.objednavky.length
                })
            )
        }

        this.odeslatObjednavky(tick)

        return {
            time: tick,
            agentId: this.id,
            type: `Dodavatel: ${this.typSuroviny}`,
            data: { cena: this.cena, objem: this.deniObjem }
        }
    }

    public ohlasCenu(firma: Firma): Nabidka {
        return {
            vzdalenost: getGeoDistance(firma.poloha, this.poloha),
            cenaZaTunu: this.cena
        }
    }

    private odeslatObjednavky(tick: number): void {
        while (true){
            if(this.objednavky.length == 0) break
            const firstObjednavka = this.objednavky[0];
            if(!firstObjednavka || firstObjednavka.objem > this.celkovyObjem) break

            const objednavka = this.objednavky.shift()
            if (objednavka) {
                objednavka.datumOdeslani = tick
                this.celkovyObjem -= objednavka.objem
                objednavka.firma.prijmoutObjednavku(objednavka)
                
                // Log order shipped
                if (this.sim) {
                    const logger = this.sim.getLogger()
                    logger.logEvent(
                        logger.createEvent(tick, 'SUPPLIER_ORDER_SHIPPED', this.id, {
                            buyerId: objednavka.firma.id,
                            materialType: objednavka.typSuroviny,
                            quantity: objednavka.objem,
                            pricePerUnit: objednavka.cenaZaTunu,
                            totalValue: objednavka.objem * objednavka.cenaZaTunu,
                            datumZadani: objednavka.datumZadani,
                            datumOdeslani: tick
                        })
                    )
                }
            }
        }
    }

    public pridatObjednavku(objednavka: Objednavka): void {
        this.objednavky.push(objednavka)
        
        // Log order received
        if (this.sim) {
            const logger = this.sim.getLogger()
            logger.logEvent(
                logger.createEvent(this.sim['currentTime'] || 0, 'SUPPLIER_ORDER_RECEIVED', this.id, {
                    buyerId: objednavka.firma.id,
                    materialType: objednavka.typSuroviny,
                    quantity: objednavka.objem,
                    pricePerUnit: objednavka.cenaZaTunu,
                    totalValue: objednavka.objem * objednavka.cenaZaTunu,
                    queuePosition: this.objednavky.length
                })
            )
        }
    }
    
	public setId(id: number){
		this.id = id
        this.ownSeed = this.seed + this.id + this.typSuroviny
        this.priceRng = createRng(this.ownSeed + "priceRNG");
        this.volumeRng = createRng(this.ownSeed + "volumeRNG");
    }

    public toJSON() {
        return {
            id: this.id,
            cena: this.cena,
            celkovyObjem: this.celkovyObjem,
            deniObjem: this.deniObjem,
            poloha: this.poloha,
            typSuroviny: this.typSuroviny,
            objednavky: this.objednavky.map((objednavka) => ({
                firmaId: objednavka.firma.id,
                objem: objednavka.objem,
                typSuroviny: objednavka.typSuroviny,
                cenaZaTunu: objednavka.cenaZaTunu,
                datumZadani: objednavka.datumZadani,
                datumOdeslani: objednavka.datumOdeslani,
            })),
        }
    }
}