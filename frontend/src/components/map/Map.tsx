"use client"

import { useEffect, useRef, useState } from "react"
import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { Protocol } from "pmtiles"
import { createWebSocket } from "@/lib/api"

export default function Map() {
  const [buildings, setBuildings] = useState<Array<Record<string, unknown>>>([])
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  
  // Track markers to prevent duplicates
  const markersRef = useRef<maplibregl.Marker[]>([])
  const previousBuildingsRef = useRef<Array<Record<string, unknown>>>([])

  function createSquareGeoJSON(corner1: [number, number], corner2: [number, number]): GeoJSON.Feature {
    const minLng = Math.min(corner1[0], corner2[0]);
    const maxLng = Math.max(corner1[0], corner2[0]);
    const minLat = Math.min(corner1[1], corner2[1]);
    const maxLat = Math.max(corner1[1], corner2[1]);

    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [minLng, minLat],
          [maxLng, minLat],
          [maxLng, maxLat],
          [minLng, maxLat],
          [minLng, minLat]
        ]]
      },
      properties: {}
    } as GeoJSON.Feature;
  }

  // Get company name from company ID
  const getCompanyName = (companyId: string | number | undefined): string => {
    if (!companyId) return "Unowned";
    const companyNames: Record<string, string> = {
      "COMPANY-RL": "Reinforcement Learning",
      "COMPANY-EVO": "Evolutionary",
      "COMPANY-DOMINANT": "Dominant",
      "COMPANY-1": "Balanced Steelworks",
      "COMPANY-2": "Aggressive Manufacturing",
      "COMPANY-3": "Conservative Trading",
      "COMPANY-4": "Market Leader Corp",
      "COMPANY-5": "Adaptive Industrial",
    };
    return companyNames[String(companyId)] || String(companyId);
  }

  // Connect to WebSocket for real-time building updates
  useEffect(() => {
    let ws: WebSocket | null = null
    let reconnectAttempts = 0
    const maxReconnectAttempts = 5
    const baseReconnectDelay = 1000 // Start with 1 second

    const connect = () => {
      try {
        ws = createWebSocket()

        ws.onopen = () => {
          console.log("Connected to simulation WebSocket")
          reconnectAttempts = 0 // Reset on successful connection
        }

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data)
            if (message.type === "state" && message.data && message.data.buildings) {
              const newBuildings = message.data.buildings.slice(0, 50)
              const prevBuildings = previousBuildingsRef.current
              
              // Only update if the first 50 buildings have actually changed
              const hasChanged = newBuildings.length !== prevBuildings.length ||
                newBuildings.some((building: Record<string, unknown>, index: number) => {
                  const prev = prevBuildings[index]
                  if (!prev) return true
                  return building.id !== prev.id || 
                         building.ownerId !== prev.ownerId ||
                         building.dataId !== prev.dataId
                })
              
              if (hasChanged) {
                previousBuildingsRef.current = newBuildings
                setBuildings(newBuildings)
              }
            }
          } catch (error) {
            console.error("Error parsing WebSocket message:", error)
          }
        }

        ws.onerror = (error) => {
          console.error("WebSocket error:", error)
        }

        ws.onclose = () => {
          console.log("Disconnected from simulation WebSocket")
          
          // Attempt reconnection with exponential backoff
          if (reconnectAttempts < maxReconnectAttempts) {
            const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts)
            console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})`)
            reconnectAttempts++
            
            setTimeout(() => {
              connect()
            }, delay)
          } else {
            console.error("Max reconnection attempts reached")
          }
        }
      } catch (error) {
        console.error("Error creating WebSocket:", error)
      }
    }

    connect()

    return () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
    }
  }, [])

  // Initialize map
  useEffect(() => {
    if (map.current) return;

    const protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    map.current = new maplibregl.Map({
      container: mapContainer.current!,
      center: [15.8, 50.2],
      zoom: 12,
      style: {
        version: 8,
        sources: {
          czech_source: {
            type: "vector",
            url: "pmtiles://" + window.location.origin + "/map.pmtiles",
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#f0f0f0" } },
          { id: "water", type: "fill", source: "czech_source", "source-layer": "water", paint: { "fill-color": "#80b3d6" } },
          { id: "roads", type: "line", source: "czech_source", "source-layer": "transportation", filter: ["==", "$type", "LineString"], paint: { "line-color": "#ffffff", "line-width": 2 } },
          { id: "buildings", type: "fill", source: "czech_source", "source-layer": "building", paint: { "fill-color": "#d9d9d9", "fill-outline-color": "#bfbfbf" } }
        ],
      },
    });

    map.current.on('load', () => {
      const cornerA: [number, number] = [15.40, 49.95];
      const cornerB: [number, number] = [16.20, 50.45];

      map.current!.addSource('my-square-source', {
        type: 'geojson',
        data: createSquareGeoJSON(cornerA, cornerB)
      });

      map.current!.addLayer({
        id: 'square-fill',
        type: 'fill',
        source: 'my-square-source',
        paint: { 'fill-color': '#0080ff', 'fill-opacity': 0 }
      });

      map.current!.addLayer({
        id: 'square-outline',
        type: 'line',
        source: 'my-square-source',
        paint: { 'line-color': '#FF0000', 'line-width': 2 }
      });
    });

  }, []);

  // Render company building markers
  useEffect(() => {
    if (!map.current || buildings.length === 0) return

    // Clear old markers
    markersRef.current.forEach(marker => marker.remove())
    markersRef.current = []

    // Buildings are already limited to 50 in the WebSocket handler
    buildings.forEach((building: Record<string, unknown>) => {
      if (!building.poloha || !(building.poloha as Record<string, unknown>).lat || !(building.poloha as Record<string, unknown>).lng) return

      const companyName = getCompanyName(building.ownerId as string | number | undefined)
      
      const formatPrice = (price: number) => {
        return price.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Kč'
      }

      const popup = new maplibregl.Popup({ offset: 25 })
        .setHTML(`
          <div style="font-family: sans-serif;">
            <strong>${companyName}</strong><br>
            Price: ${building.cenaKoupi ? formatPrice(building.cenaKoupi as number) : 'N/A'}<br>
            ID: ${building.dataId || building.id}
          </div>
        `)

      const marker = new maplibregl.Marker()
        .setLngLat([(building.poloha as Record<string, unknown>).lng as number, (building.poloha as Record<string, unknown>).lat as number])
        .setPopup(popup)
        .addTo(map.current!)

      markersRef.current.push(marker)
    })
  }, [buildings])

  return <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />
}