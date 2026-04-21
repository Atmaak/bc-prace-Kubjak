"use client"

import { useState } from "react"

interface TimelineProps {
  finalTick: number
  availableTicks: number[]
  selectedTick: number | null
  onTickSelect: (tick: number) => void
}

export default function Timeline({
  finalTick,
  availableTicks,
  selectedTick,
  onTickSelect,
}: TimelineProps) {
  const [hoveredTick, setHoveredTick] = useState<number | null>(null)

  if (availableTicks.length === 0) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <p className="text-gray-400">No snapshots available</p>
      </div>
    )
  }

  // Calculate percentage position for each tick
  const getPercentage = (tick: number) => {
    return (tick / finalTick) * 100
  }

  return (
    <></>
  )
}
