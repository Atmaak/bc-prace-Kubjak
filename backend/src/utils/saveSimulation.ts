import { SimulationEngine } from '../simulation';
import fs from 'fs';
import path from 'path';

export function saveSim(simulation: SimulationEngine, filename?: string): string {
    const state = simulation.serializeState()
    const json = JSON.stringify(state, null, 2)

    const savesDir = path.resolve(process.cwd(), 'saves')
    if (!fs.existsSync(savesDir)) fs.mkdirSync(savesDir, { recursive: true })

    const safeName = filename ?? `simulation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    const filePath = path.join(savesDir, safeName)

    fs.writeFileSync(filePath, json, 'utf8')
    return filePath
}