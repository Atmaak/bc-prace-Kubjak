"use client"

import { useEffect, useState, useRef } from "react"
import { apiFetch } from "@/lib/api"

type SimulationEvent = {
  tick: number
  eventType: string
  severity: "info" | "warning" | "error"
  agentId?: string
  companyId?: string
  strategyId?: string
  payload?: Record<string, unknown>
  error?: string
}

export default function LogViewer() {
  const [logs, setLogs] = useState<SimulationEvent[]>([])
  const [isAutoScroll, setIsAutoScroll] = useState(true)
  const [filter, setFilter] = useState<string>("all")
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logsContainerRef = useRef<HTMLDivElement>(null)

  // Fetch logs periodically
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await apiFetch("/data/logs/recent?limit=100")
        const data = await res.json()
        if (data.events) {
          setLogs(data.events)
        }
      } catch (e) {
        console.error("Failed to fetch logs:", e)
      }
    }

    // Initial fetch
    fetchLogs()

    // Poll every 500ms for new logs
    const interval = setInterval(fetchLogs, 500)

    return () => clearInterval(interval)
  }, [])

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (isAutoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [logs, isAutoScroll])

  // Detect manual scroll
  useEffect(() => {
    const container = logsContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50
      setIsAutoScroll(isAtBottom)
    }

    container.addEventListener("scroll", handleScroll)
    return () => container.removeEventListener("scroll", handleScroll)
  }, [])

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "error":
        return "bg-red-900 border-red-500"
      case "warning":
        return "bg-yellow-900 border-yellow-500"
      case "info":
      default:
        return "bg-gray-900 border-gray-600"
    }
  }

  const getEventTypeColor = (eventType: string) => {
    if (eventType.startsWith("SIM_")) return "text-purple-400"
    if (eventType.startsWith("COMPANY_")) return "text-blue-400"
    if (eventType.startsWith("SUPPLIER_")) return "text-green-400"
    if (eventType.startsWith("STRATEGY_")) return "text-yellow-400"
    if (eventType.startsWith("AGENT_")) return "text-red-400"
    return "text-gray-400"
  }

  const filteredLogs = logs.filter((log) => {
    if (filter === "all") return true
    if (filter === "errors") return log.severity === "error"
    if (filter === "warnings") return log.severity === "warning"
    if (filter === "company") return log.eventType.startsWith("COMPANY_")
    if (filter === "supplier") return log.eventType.startsWith("SUPPLIER_")
    if (filter === "strategy") return log.eventType.startsWith("STRATEGY_")
    return true
  })

  return (
    <div className="bg-gray-800 text-white rounded-lg h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold">Logy simulace (live)</h2>
          <span className="text-sm text-gray-400">
            {filteredLogs.length} záznamů
          </span>
        </div>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap text-sm">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1 rounded ${
              filter === "all"
                ? "bg-blue-600"
                : "bg-gray-700 hover:bg-gray-600"
            }`}
          >
            Vše
          </button>
          <button
            onClick={() => setFilter("errors")}
            className={`px-3 py-1 rounded ${
              filter === "errors"
                ? "bg-red-600"
                : "bg-gray-700 hover:bg-gray-600"
            }`}
          >
            Chyby
          </button>
          <button
            onClick={() => setFilter("warnings")}
            className={`px-3 py-1 rounded ${
              filter === "warnings"
                ? "bg-yellow-600"
                : "bg-gray-700 hover:bg-gray-600"
            }`}
          >
            Upozornění
          </button>
          <button
            onClick={() => setFilter("company")}
            className={`px-3 py-1 rounded ${
              filter === "company"
                ? "bg-blue-600"
                : "bg-gray-700 hover:bg-gray-600"
            }`}
          >
            Firmy
          </button>
          <button
            onClick={() => setFilter("supplier")}
            className={`px-3 py-1 rounded ${
              filter === "supplier"
                ? "bg-green-600"
                : "bg-gray-700 hover:bg-gray-600"
            }`}
          >
            Dodavatelé
          </button>
          <button
            onClick={() => setFilter("strategy")}
            className={`px-3 py-1 rounded ${
              filter === "strategy"
                ? "bg-yellow-600"
                : "bg-gray-700 hover:bg-gray-600"
            }`}
          >
            Strategie
          </button>
        </div>
      </div>

      {/* Logs Container */}
      <div
        ref={logsContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-2"
      >
        {filteredLogs.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            Žádné logy. Spusťte simulaci pro zobrazení událostí.
          </div>
        ) : (
          filteredLogs.map((log, index) => (
            <div
              key={index}
              className={`border-l-4 p-3 rounded ${getSeverityColor(
                log.severity
              )}`}
            >
              <div className="flex items-start justify-between mb-1">
                <span
                  className={`font-mono text-sm font-semibold ${getEventTypeColor(
                    log.eventType
                  )}`}
                >
                  {log.eventType}
                </span>
                <span className="text-xs text-gray-400">Tick {log.tick}</span>
              </div>

              {log.agentId && (
                <div className="text-xs text-gray-400 mb-1">
                  Agent: {log.agentId}
                  {log.companyId && ` | Firma: ${log.companyId}`}
                  {log.strategyId && ` | Strategie: ${log.strategyId}`}
                </div>
              )}

              {log.payload && (
                <div className="text-sm text-gray-300 mt-2 font-mono bg-black bg-opacity-30 p-2 rounded overflow-x-auto">
                  <pre className="text-xs">
                    {JSON.stringify(log.payload, null, 2)}
                  </pre>
                </div>
              )}

              {log.error && (
                <div className="text-sm text-red-400 mt-2 font-mono">
                  Error: {log.error}
                </div>
              )}
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>

      {/* Auto-scroll indicator */}
      {!isAutoScroll && (
        <div className="p-2 bg-blue-600 text-center cursor-pointer hover:bg-blue-500">
          <button
            onClick={() => {
              setIsAutoScroll(true)
              logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
            }}
            className="text-sm font-semibold"
          >
            ↓ Nové záznamy – klikněte pro posun dolů ↓
          </button>
        </div>
      )}
    </div>
  )
}
