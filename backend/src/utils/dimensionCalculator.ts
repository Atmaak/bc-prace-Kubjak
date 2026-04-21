import { Velikost } from '../types/velikost';

/**
 * Calculate x and y dimensions from area in square meters
 * Creates roughly square dimensions for better space utilization
 * @param areaSqm - Area in square meters
 * @returns Velikost object with calculated x and y dimensions
 */
export function calculateDimensionsFromArea(areaSqm: number): Velikost {
    if (areaSqm <= 0) {
        throw new Error('Area must be greater than 0');
    }
    
    // Create roughly square dimensions for balanced space
    const dimension = Math.sqrt(areaSqm);
    
    // Round to nearest reasonable value (e.g., meter increments)
    const roundedDimension = Math.round(dimension * 10) / 10;
    
    return new Velikost(roundedDimension, roundedDimension);
}
