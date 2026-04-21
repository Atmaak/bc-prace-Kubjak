import { Velikost } from './velikost';
import config from '../config.json'
export class Linka {
    public id: number;
    public cenaZakoupeni: number = config.linka.pocatecniCena;
    public kapacita: number = config.linka.kapacita;
    public velikost: Velikost = new Velikost(config.linka.velikost.x, config.linka.velikost.y);
    public spotrebaEnergie: number = config.linka.spotrebaEnergie;
    public pocetZamestnancu: number = config.linka.pocetZamestnancu

    constructor(id: number){
        this.id = id
    }

    vyrob(): void{
        
    }

    public getMzdy(): number {
        return (this.pocetZamestnancu * config.mzdaZamestnance) / 30
    }
}

export function createLinka(id: number) {
    return new Linka(id);
}
