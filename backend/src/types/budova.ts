import { Linka, createLinka } from "./linka"
import { Sklad, createSklad } from './sklad';
import { Souradnice } from "./souradnice"
import { Velikost } from "./velikost"
import config from '../config.json'
import { TypSuroviny } from './typSuroviny';
export class Budova {
	public id: number
	public dataId?: string  // Reference to building from data_budov.json
	public poloha: Souradnice
	public linky: Linka[]
	public skladovaciJednotky: Sklad[]
	public velikost: Velikost
	public cenaKoupi: number
	public ownerId?: string | number  // Company that owns this building
	public celkovaPlocha: number  // Total area in square meters
	private nextLinkaId: number = 1;
	private nextSkladId: number = 1;

	constructor(id: number, poloha: Souradnice, velikost: Velikost, cenaKoupi: number, dataId?: string, areaSqm?: number) {
		this.id = id
		if (dataId) this.dataId = dataId
		this.poloha = poloha
		this.velikost = velikost
		this.cenaKoupi = cenaKoupi
		this.celkovaPlocha = velikost.getPlocha()
		

		this.linky = []
		this.skladovaciJednotky = []
	}
	public inicializovatStartovniVybaveni(): void {
		if (this.linky.length === 0) {
			this.pridatLinkaInit()
		}
		if (this.skladovaciJednotky.length === 0) {
			this.pridatSkladInit()
		}
	}

	//Initialize with default line (no space checks, for new buildings)
	private pridatLinkaInit(): void {
		const linka = createLinka(this.nextLinkaId++)
		this.linky.push(linka)
	}

	//Initialize with default storage (no space checks, for new buildings)
	private pridatSkladInit(): void {
		let sklad = createSklad(this.nextSkladId++, new Velikost(config.sklad.velikost.x, config.sklad.velikost.y))
		sklad.naskladniSurovinu(TypSuroviny.ZELEZNA_RUDA, config.starterInventory.ZELEZNA_RUDA)
		sklad.naskladniSurovinu(TypSuroviny.KOKS, config.starterInventory.KOKS)
		this.skladovaciJednotky.push(sklad)
	}
	
	public getVolnyProstor(): number {
		const usedSpace = this.getUziteProstor()
		return this.celkovaPlocha - usedSpace
	}

	public getUziteProstor(): number {
		let total = 0
		
		// Sum up all line spaces
		this.linky.forEach(linka => {
			total += linka.velikost.getPlocha()
		});

		// Sum up all storage spaces
		this.skladovaciJednotky.forEach(skladovaciJednotka => {
			total += skladovaciJednotka.velikost.getPlocha()

		});

		return total
	}

	public canFitItem(itemSize: Velikost): boolean {
		return this.getVolnyProstor() >= itemSize.getPlocha()
	}

	public pridatSklad(): boolean {
		// Check if storage unit will fit
		const config_sklad_size = new Velikost(config.sklad.velikost.x, config.sklad.velikost.y)
		if (!this.canFitItem(config_sklad_size)) {
			return false
		}

		let sklad = createSklad(this.nextSkladId++, config_sklad_size)
		this.skladovaciJednotky.push(sklad)
		return true
	}

	public pridatLinku(): boolean {
		// Check if production line will fit
		const config_linka_size = new Velikost(config.linka.velikost.x, config.linka.velikost.y)
		if (!this.canFitItem(config_linka_size)) {
			return false
		}

		const linka = createLinka(this.nextLinkaId++)
		this.linky.push(linka)
		return true
	}

	public getVsechnyVeciNaSkladech(): Map<TypSuroviny, number> {
		let map = new Map<TypSuroviny, number>()
		this.skladovaciJednotky.forEach(skladovaciJednotka => {
			Array.from(skladovaciJednotka.obsah.entries()).map(([typ, mnozstvi]) => {
				const stareMnozstvi = skladovaciJednotka.ziskejMnozstvi(typ);
				map.set(typ, stareMnozstvi + mnozstvi)
			})
			
		});
		return map
	}

	public getSpaceInfo(): string {
		const totalSpace = this.celkovaPlocha
		const usedSpace = this.getUziteProstor()
		const freeSpace = this.getVolnyProstor()
		const usagePercent = ((usedSpace / totalSpace) * 100).toFixed(1)
		return `Building ${this.id}: ${usedSpace.toFixed(0)}/${totalSpace.toFixed(0)} m² (${usagePercent}%), Free: ${freeSpace.toFixed(0)} m²`
	}
}