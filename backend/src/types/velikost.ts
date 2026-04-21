export class Velikost {
    public velikostX: number;
    public velikostY: number;

    constructor(velikostX:number, velikostY:number){
        this.velikostX = velikostX;
        this.velikostY = velikostY;
    }

    public getPlocha(): number{
        return this.velikostX * this.velikostY
    }

}
