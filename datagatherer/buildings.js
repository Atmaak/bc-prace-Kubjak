const axios = require('axios');
const osmtogeojson = require('osmtogeojson');
const turf = require('@turf/turf');
const fs = require('fs'); // Knihovna pro práci se soubory

// Nastavení oblasti (Bounding Box) - Příklad: Ostrava Hrabová
// Formát: Jih, Západ, Sever, Východ
const BBOX = "49.95, 15.40, 50.45, 16.20"
// const BBOX = "49.75,18.25,49.80,18.30"

// Název výstupního souboru
const OUTPUT_FILE = 'data_budov.json';
const MIN_AREA_SQM = 4500;
const VERY_LARGE_AREA_SQM = 12000;
const MIN_DISTANCE_FROM_CITY_CENTER_KM = 3;

function getBBoxCenter(bbox) {
    const [south, west, north, east] = bbox.split(',').map((value) => Number(value.trim()));
    return {
        lat: (south + north) / 2,
        lng: (west + east) / 2
    };
}

const CITY_CENTER = getBBoxCenter(BBOX);

const HEAVY_INDUSTRIAL_VALUES = new Set([
    'steel',
    'metal_processing',
    'smelter',
    'refinery',
    'chemical',
    'factory'
]);

function isHeavyIndustrialCandidate(tags, area) {
    const industrialValue = String(tags.industrial || '').toLowerCase();
    const buildingValue = String(tags.building || '').toLowerCase();
    const manMadeValue = String(tags.man_made || '').toLowerCase();
    const landuseValue = String(tags.landuse || '').toLowerCase();

    const isClearlyCommercial = Boolean(tags.shop) || Boolean(tags.amenity) || Boolean(tags.office);

    const hasHeavyIndustryTag =
        HEAVY_INDUSTRIAL_VALUES.has(industrialValue) ||
        manMadeValue === 'works' ||
        landuseValue === 'industrial';

    const isLargeEnough = area >= MIN_AREA_SQM;
    const isVeryLarge = area >= VERY_LARGE_AREA_SQM;
    const isIndustrialBuildingType = ['industrial', 'warehouse', 'manufacture', 'factory'].includes(buildingValue);
    const hasIndustrialEnvelope = isIndustrialBuildingType || landuseValue === 'industrial' || manMadeValue === 'works';

    return hasIndustrialEnvelope && isLargeEnough && !isClearlyCommercial && (hasHeavyIndustryTag || isVeryLarge);
}

function isOutsideCityCenter(lat, lng) {
    const cityCenterPoint = turf.point([CITY_CENTER.lng, CITY_CENTER.lat]);
    const candidatePoint = turf.point([lng, lat]);
    const distanceFromCenterKm = turf.distance(cityCenterPoint, candidatePoint, { units: 'kilometers' });
    return distanceFromCenterKm >= MIN_DISTANCE_FROM_CITY_CENTER_KM;
}

async function fetchAndSaveBuildings() {
    const overpassUrl = 'http://overpass-api.de/api/interpreter';
    
    // Rozšířený dotaz: Hledáme 'way' i 'relation' (pro komplexní budovy)
    // const query = `
    // [out:json][timeout:25];
    // (
    //   way["building"="warehouse"](${BBOX});
    //   way["building"="industrial"](${BBOX});
    //   relation["building"="warehouse"](${BBOX});
    //   relation["building"="industrial"](${BBOX});
    // );
    // out geom;
    // `;
        const query = `
        [out:json][timeout:40];
        (
            way["building"~"^(industrial|warehouse|manufacture|factory)$"](${BBOX});
            relation["building"~"^(industrial|warehouse|manufacture|factory)$"](${BBOX});
            way["industrial"~"^(steel|metal_processing|smelter|factory)$"](${BBOX});
            relation["industrial"~"^(steel|metal_processing|smelter|factory)$"](${BBOX});
            way["man_made"="works"](${BBOX});
            relation["man_made"="works"](${BBOX});
            way["landuse"="industrial"](${BBOX});
            relation["landuse"="industrial"](${BBOX});
        );
        out geom;
        `;

    console.log(`📡 Stahuji data z OSM pro oblast: ${BBOX}...`);

    try {
        const response = await axios.get(overpassUrl, { params: { data: query } });

        
        // Převod na GeoJSON
        const geoJsonData = osmtogeojson(response.data);
        const processedBuildings = [];
        const seenIds = new Set();

        console.log(`⚙️ Zpracovávám ${geoJsonData.features.length} nalezených objektů...`);

        geoJsonData.features.forEach(feature => {
            // Zajímá nás jen Polygon nebo MultiPolygon (ignorujeme body)
            if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
                
                // 1. Výpočet plochy (Turf.js - geodeticky správně)
                const area = turf.area(feature);

                // 2. Výpočet středu
                const center = turf.center(feature);
                const [lng, lat] = center.geometry.coordinates;

                // 3. Extrakce metadat (pokud existují)
                const tags = feature.properties;
                const uniqueId = String(tags.id || feature.id || `${lat},${lng}`);

                if (seenIds.has(uniqueId)) {
                    return;
                }

                // Sestavení čistého objektu pro tvůj model
                const buildingObject = {
                    id: tags.id || feature.id, // OSM ID
                    type: tags.building || 'unknown',
                    area_sqm: area, // Zaokrouhleno na celé m2
                    price: area * 30000, // cena haly
                    location: {
                        lat: lat, // Oříznutí na 6 des. míst
                        lng: lng
                    }
                };

                // Filtr: pouze velké těžké průmyslové objekty (bez obchodů/služeb)
                if (isHeavyIndustrialCandidate(tags, buildingObject.area_sqm) && isOutsideCityCenter(lat, lng)) {
                    seenIds.add(uniqueId);
                    processedBuildings.push(buildingObject);
                }
            }
        });

        // Třízení podle velikosti (od největší po nejmenší) - pro přehlednost
        processedBuildings.sort((a, b) => b.area_sqm - a.area_sqm);

        // Uložení do souboru
        const jsonOutput = JSON.stringify(processedBuildings, null, 2);
        fs.writeFileSync(OUTPUT_FILE, jsonOutput, 'utf8');

        console.log(`✅ HOTOVO! Uloženo ${processedBuildings.length} budov do souboru '${OUTPUT_FILE}'.`);

    } catch (error) {
        console.error("❌ Chyba:", error.message);
    }
}

// Spuštění
fetchAndSaveBuildings();