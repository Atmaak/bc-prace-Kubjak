"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api"

interface SimulationRecord {
  id: string
  seed: string
  startedAt: number
  endedAt?: number
  finalTick: number
  companyCount: number
  buildingCount: number
  regionName: string
  duration?: number | null
}

const formatTimeAgo = (timestamp: number): string => {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return "právě teď"
  if (minutes < 60) return `před ${minutes} min`
  if (hours < 24) return `před ${hours} hod`
  return `před ${days} dny`
}

export default function SimulationHistoryList() {
  const [simulations, setSimulations] = useState<SimulationRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        console.log('[History List] Fetching history...')
        const response = await apiFetch("/history")
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          console.error('[History List] Error:', { status: response.status, error: errorData })
          throw new Error(`Failed to fetch simulation history: ${response.status}`)
        }
        const data = await response.json()
        console.log('[History List] Received', data.total, 'simulations')
        setSimulations(data.simulations || [])
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error"
        console.error('[History List] Exception:', errorMsg)
        setError(errorMsg)
      } finally {
        setLoading(false)
      }
    }

    fetchHistory()
  }, [])

  const handleDelete = async (id: string) => {
    if (!confirm("Opravdu chcete smazat tuto simulaci?")) return

    try {
      const response = await apiFetch(`/history/${id}`, {
        method: "DELETE",
      })
      if (!response.ok) throw new Error("Nepodařilo se smazat simulaci")
      setSimulations(simulations.filter(s => s.id !== id))
    } catch (err) {
      alert(err instanceof Error ? err.message : "Nepodařilo se smazat simulaci")
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="text-white text-xl">Načítám simulace...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2">Historie simulací</h1>
            <p className="text-gray-400">{simulations.length} simulací nalezeno</p>
          </div>
          <Link
            href="/"
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors"
          >
            Spustit novou simulaci
          </Link>
        </div>

        {error && (
          <div className="bg-red-900 border border-red-700 text-red-100 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}

        {simulations.length === 0 ? (
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-8 text-center">
            <p className="text-gray-400 text-lg">Žádné simulace nenalezeny</p>
            <Link
              href="/"
              className="inline-block mt-4 px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors"
            >
              Spustit první simulaci
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {simulations.map((sim) => (
              <Link key={sim.id} href={`/history/${sim.id}`}>
                <div className="bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-blue-500 rounded-lg p-6 transition-all cursor-pointer">
                  <div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-start">
                    {/* Simulation Info */}
                    <div className="md:col-span-2">
                      <h3 className="text-lg font-semibold mb-2">
                        {sim.id.slice(0, 12)}...
                      </h3>
                      <p className="text-gray-400 text-sm truncate" title={sim.seed}>
                        Seed: {sim.seed.slice(0, 20)}...
                      </p>
                      <p className="text-gray-500 text-xs mt-1">
                        {formatTimeAgo(sim.startedAt)}
                      </p>
                    </div>

                    {/* Stats */}
                    <div className="md:col-span-3">
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <p className="text-gray-400 text-sm">Duration</p>
                          <p className="text-xl font-semibold">
                            {sim.finalTick} ticks
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-400 text-sm">Companies</p>
                          <p className="text-xl font-semibold">{sim.companyCount}</p>
                        </div>
                        <div>
                          <p className="text-gray-400 text-sm">Buildings</p>
                          <p className="text-xl font-semibold">{sim.buildingCount}</p>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={(e) => {
                          e.preventDefault()
                          handleDelete(sim.id)
                        }}
                        className="px-3 py-2 bg-red-900 hover:bg-red-800 border border-red-700 rounded text-sm font-medium transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
