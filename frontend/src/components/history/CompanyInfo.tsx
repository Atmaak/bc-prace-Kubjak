"use client"

interface CompanyInfoProps {
  id: number
  name: string
  strategy?: string
  finance: number
  buildings: number
  selectedCompanyId?: number
  onSelectCompany: (id: number) => void
}

export default function CompanyInfo({
  id,
  name,
  strategy,
  finance,
  buildings,
  selectedCompanyId,
  onSelectCompany,
}: CompanyInfoProps) {
  const isSelected = selectedCompanyId === id

  return (
    <button
      onClick={() => onSelectCompany(id)}
      className={`w-full text-left p-4 rounded-lg border transition-all ${
        isSelected
          ? "bg-blue-900 border-blue-500 ring-2 ring-blue-400"
          : "bg-gray-800 border-gray-700 hover:bg-gray-750 hover:border-gray-600"
      }`}
    >
      <div className="flex justify-between items-start mb-2">
        <div>
          <h4 className="font-semibold text-lg">{name}</h4>
          {strategy && <p className="text-gray-400 text-sm">{strategy}</p>}
        </div>
        {isSelected && (
          <div className="bg-blue-500 text-white px-2 py-1 rounded text-xs font-semibold">
            Vybráno
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-gray-400">Finance</p>
          <p className="font-mono text-green-400">
            {(finance / 1000).toFixed(1)}K Kč
          </p>
        </div>
        <div>
          <p className="text-gray-400">Budovy</p>
          <p className="font-semibold">{buildings}</p>
        </div>
      </div>
    </button>
  )
}
