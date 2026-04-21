import { Velikost } from './velikost';
import config from '../config.json'
import { TypSuroviny } from './typSuroviny';
export class Sklad {
    public id: number;
    public obsah: Map<TypSuroviny, number> = new Map()
    
    public cenaZakoupeni: number = config.sklad.pocatecniCena;
    public kapacita: number = config.sklad.kapacita;
    public velikost: Velikost
    public spotrebaEnergie: number = config.sklad.spotrebaEnergie;
    
    constructor(id: number, velikost: Velikost){
        this.id = id;
        this.velikost = velikost
    }

    public get aktualniCelkoveMnozstvi(): number {
        let soucet = 0;
        // Projdeme všechny položky v mapě a sečteme je
        for (const mnozstvi of this.obsah.values()) {
            soucet += mnozstvi;
        }
        return soucet;
    }

    public ziskejMnozstvi(typ: TypSuroviny): number {
        return this.obsah.get(typ) || 0; // Pokud tam není, vrátí 0
    }

    public zbyvaMista(): number {
        return this.kapacita - this.aktualniCelkoveMnozstvi;
    }

    public naskladniSurovinu(typ: TypSuroviny, mnozstvi: number): number {
        if (mnozstvi <= 0) return 0;
        
        // Zjistíme, kolik se vejde
        const volneMisto = this.zbyvaMista();
        const naskladneno = Math.min(mnozstvi, volneMisto);
        
        if (naskladneno > 0) {
            // Zápis do mapy
            const stareMnozstvi = this.ziskejMnozstvi(typ);
            this.obsah.set(typ, stareMnozstvi + naskladneno);
        }
        
        // Vrátíme kolik se NEPODARILO naskladnit
        return mnozstvi - naskladneno;
    }

    public vyskladniSurovinu(typ: TypSuroviny, mnozstvi: number): number {
        if (mnozstvi <= 0) return 0;
        
        const dostupne = this.ziskejMnozstvi(typ);
        
        // Vyskladníme co můžeme
        const vyskladneno = Math.min(dostupne, mnozstvi);
        
        if (vyskladneno > 0) {
            const noveMnozstvi = dostupne - vyskladneno;
            
            if (noveMnozstvi === 0) {
                this.obsah.delete(typ); // Úklid mapy, pokud je 0
            } else {
                this.obsah.set(typ, noveMnozstvi);
            }
        }
        
        // Vrátíme kolik se NEPODARILO vyskladnit
        return mnozstvi - vyskladneno;
    }


    public toString(): string {
        const obsahStr = Array.from(this.obsah.entries())
            .map(([typ, mnozstvi]) => `${typ}: ${mnozstvi}`)
            .join(', ');
        
        return `Sklad(id=${this.id}, kapacita=${this.kapacita}, obsah={${obsahStr}}, volneMisto=${this.zbyvaMista()})`;
    }
}

export function createSklad(id: number, velikost?: Velikost) {
    return new Sklad(id, velikost || new Velikost(config.sklad.velikost.x, config.sklad.velikost.y));
}