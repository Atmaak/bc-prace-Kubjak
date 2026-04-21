export interface Agent {
    id: number,
    tick(tick: number): any,
    setId(id: number): void
}
