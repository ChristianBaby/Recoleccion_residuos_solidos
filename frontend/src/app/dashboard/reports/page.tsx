'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/lib/api'
import type { ApiResponse, Zone } from '@/types'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WasteZone {
  zoneId: string
  zoneName: string
  district: string
  color: string
  executions: number
  // RF-18: pesaje declarado por el operador al cierre de ruta
  weighedExecutions: number
  totalKg: number
  categories: { category: string; name: string; colorCode: string; count: number; kg: number }[]
}

interface ComplianceRoute {
  routeId: string
  routeName: string
  zone: { id: string; name: string; color: string }
  operator: { id: string; firstName: string; lastName: string } | null
  vehicle: { id: string; plate: string; type: string } | null
  dayOfWeek: number[]
  totalExecutions: number
  completed: number
  delayed: number
  cancelled: number
  inProgress: number
  compliancePct: number
  avgDelayMinutes: number
  totalWaypoints: number
  missedStopsTotal: number
  missedStopsPct: number
}

interface ParticipationRecommendation {
  zoneId: string
  zoneName: string
  district: string
  participationIndex: number
  averageIndex: number
  message: string
}

interface ParticipationData {
  summary: { totalCitizens: number; totalIncidents: number; totalLearnVisits: number }
  byZone: {
    zoneId: string
    zoneName: string
    district: string
    color: string
    citizenCount: number
    incidents: { total: number; open: number; resolved: number; byType: Record<string, number> }
    learnVisits: number
    learnUniqueUsers: number
  }[]
  recommendations?: ParticipationRecommendation[]
}

// ─── Export helpers ───────────────────────────────────────────────────────────

function downloadCSV(filename: string, rows: string[][], headers: string[]) {
  const lines = [headers, ...rows].map((r) =>
    r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','),
  )
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadExcel(filename: string, rows: string[][], headers: string[]) {
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const toRow = (cells: string[], isHeader = false) =>
    `<Row>${cells.map((c) => `<Cell${isHeader ? ' ss:StyleID="h"' : ''}><Data ss:Type="String">${esc(c)}</Data></Cell>`).join('')}</Row>`

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#115e59" ss:Pattern="Solid"/><Font ss:Color="#FFFFFF" ss:Bold="1"/></Style>
  </Styles>
  <Worksheet ss:Name="Reporte">
    <Table>
      ${toRow(headers, true)}
      ${rows.map((r) => toRow(r)).join('\n      ')}
    </Table>
  </Worksheet>
</Workbook>`

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function printPDF(title: string, headers: string[], rows: string[][]) {
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const thCells = headers.map((h) => `<th>${esc(h)}</th>`).join('')
  const trRows = rows.map(
    (r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`,
  ).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; color: #1e293b; padding: 24px; }
    h2 { color: #115e59; margin-bottom: 4px; }
    p.sub { color: #64748b; font-size: 11px; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; }
    th { background: #115e59; color: #fff; padding: 8px 10px; text-align: left; font-size: 11px; }
    td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; }
    tr:nth-child(even) td { background: #f8fafc; }
    @media print { body { padding: 0; } }
  </style></head><body>
  <h2>Sistema de Gestión de Residuos — ${esc(title)}</h2>
  <p class="sub">Generado el ${new Date().toLocaleDateString('es-PE', { dateStyle: 'long' })}</p>
  <table><thead><tr>${thCells}</tr></thead><tbody>${trRows}</tbody></table>
  <script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}<\/script>
  </body></html>`

  const w = window.open('', '_blank', 'width=900,height=700')
  w?.document.write(html)
  w?.document.close()
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
}: {
  label: string
  value: string | number
  sub?: string
}) {
  return (
    <div className="bg-white rounded border border-slate-200 p-5 shadow-sm">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      <p className="text-2xl font-light text-slate-900 tracking-tight">{value}</p>
      {sub && <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-1.5">{sub}</p>}
    </div>
  )
}

function ExportButtons({
  onCSV, onExcel, onPDF,
}: { onCSV: () => void; onExcel: () => void; onPDF: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={onCSV}
        className="text-[10px] font-bold tracking-wider text-slate-600 hover:text-teal-800 hover:border-teal-400
          border border-slate-200 rounded px-2.5 py-1.5 uppercase transition-colors bg-white"
        title="Exportar CSV"
      >
        CSV
      </button>
      <button
        onClick={onExcel}
        className="text-[10px] font-bold tracking-wider text-slate-600 hover:text-teal-800 hover:border-teal-400
          border border-slate-200 rounded px-2.5 py-1.5 uppercase transition-colors bg-white"
        title="Excel"
      >
        Excel
      </button>
      <button
        onClick={onPDF}
        className="text-[10px] font-bold tracking-wider text-slate-600 hover:text-red-700 hover:border-red-450
          border border-slate-200 rounded px-2.5 py-1.5 uppercase transition-colors bg-white"
        title="PDF"
      >
        PDF
      </button>
    </div>
  )
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-2 border border-dashed border-slate-200 rounded">
      <p className="text-xs font-semibold uppercase tracking-wider">{message}</p>
    </div>
  )
}

// ─── Tab: RF-14 Residuos por zona ────────────────────────────────────────────

function WasteTab({
  accessToken,
  from,
  to,
  zoneId,
}: {
  accessToken: string
  from: string
  to: string
  zoneId: string
}) {
  const [data, setData] = useState<WasteZone[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (zoneId) params.set('zoneId', zoneId)
    api
      .get<ApiResponse<WasteZone[]>>(`/reports/waste-by-zone?${params}`, accessToken)
      .then((r) => setData(r.data ?? []))
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [accessToken, from, to, zoneId])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const totalExecutions = data.reduce((s, z) => s + z.executions, 0)
  const totalKg = Math.round(data.reduce((s, z) => s + (z.totalKg ?? 0), 0) * 100) / 100
  const mostActive =
    totalExecutions > 0
      ? data.reduce<WasteZone | null>(
          (best, z) => (!best || z.executions > best.executions ? z : best),
          null,
        )
      : null

  const chartData = data.map((z) => ({ name: z.zoneName, Ejecuciones: z.executions, fill: z.color }))

  function getExportData() {
    const headers = ['Zona', 'Distrito', 'Ejecuciones', 'Tipo Residuo', 'Categoría', 'Conteo', 'Kg recolectados']
    const rows = data.flatMap((z) =>
      z.categories.length > 0
        ? z.categories.map((c) => [z.zoneName, z.district, String(z.executions), c.name, c.category, String(c.count), String(c.kg ?? 0)])
        : [[z.zoneName, z.district, String(z.executions), '—', '—', '0', '0']],
    )
    return { headers, rows }
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
        <StatCard label="Total ejecuciones" value={totalExecutions} />
        <StatCard
          label="Kg recolectados"
          value={totalKg > 0 ? `${totalKg} kg` : '—'}
          sub={totalKg > 0 ? 'declarados al cierre de ruta' : 'sin datos de pesaje'}
        />
        <StatCard
          label="Zona más activa"
          value={mostActive?.zoneName ?? '—'}
          sub={mostActive ? `${mostActive.executions} ejecuciones` : undefined}
        />
        <StatCard label="Zonas monitoreadas" value={data.length} />
      </div>

      {/* Chart */}
      <div className="bg-white rounded border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Ejecuciones de rutas por zona</h3>
          <ExportButtons
            onCSV={() => { const { headers, rows } = getExportData(); downloadCSV('residuos_por_zona.csv', rows, headers) }}
            onExcel={() => { const { headers, rows } = getExportData(); downloadExcel('residuos_por_zona.xls', rows, headers) }}
            onPDF={() => { const { headers, rows } = getExportData(); printPDF('Residuos por zona', headers, rows) }}
          />
        </div>
        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <span className="w-6 h-6 rounded-full border-2 border-slate-200 border-t-teal-700 animate-spin" />
          </div>
        ) : totalExecutions === 0 ? (
          <EmptyChart message="Sin ejecuciones registradas en el período seleccionado" />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 4, right: 16, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Bar dataKey="Ejecuciones" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Detail table */}
      {data.length > 0 && (
        <div className="bg-white rounded border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[600px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left">
                  <th className="px-5 py-3.5">Zona</th>
                  <th className="px-5 py-3.5">Distrito</th>
                  <th className="px-5 py-3.5 text-right font-bold">Ejecuciones</th>
                  <th className="px-5 py-3.5 text-right font-bold">Kg recolectados</th>
                  <th className="px-5 py-3.5">Tipos de residuo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((z) => (
                  <tr key={z.zoneId} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: z.color }} />
                        <span className="font-semibold text-slate-800">{z.zoneName}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-slate-500 font-semibold">{z.district}</td>
                    <td className="px-5 py-4 text-right font-bold text-slate-850">{z.executions}</td>
                    <td className="px-5 py-4 text-right">
                      {(z.totalKg ?? 0) > 0 ? (
                        <span className="font-bold text-slate-850">{z.totalKg} kg</span>
                      ) : z.executions > 0 ? (
                        <span className="text-slate-400 italic">sin datos de pesaje</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {z.categories.length === 0 ? (
                        <span className="text-slate-400">Sin datos</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {z.categories.map((c) => (
                            <span
                              key={c.category}
                              className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-white"
                              style={{ backgroundColor: c.colorCode }}
                            >
                              {c.name}{(c.kg ?? 0) > 0 ? ` · ${c.kg} kg` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab: RF-15 Cumplimiento de rutas ────────────────────────────────────────

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function ComplianceTab({
  accessToken,
  from,
  to,
  zoneId,
}: {
  accessToken: string
  from: string
  to: string
  zoneId: string
}) {
  const [data, setData] = useState<ComplianceRoute[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (zoneId) params.set('zoneId', zoneId)
    api
      .get<ApiResponse<ComplianceRoute[]>>(`/reports/route-compliance?${params}`, accessToken)
      .then((r) => setData(r.data ?? []))
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [accessToken, from, to, zoneId])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const totalRoutes = data.length
  const totalExec = data.reduce((s, r) => s + r.totalExecutions, 0)
  const avgCompliance =
    totalExec > 0
      ? Math.round(data.reduce((s, r) => s + r.compliancePct * r.totalExecutions, 0) / totalExec)
      : 0

  // Chart: top 15 routes by compliance (or all if fewer)
  const chartData = [...data]
    .sort((a, b) => b.compliancePct - a.compliancePct)
    .slice(0, 15)
    .map((r) => ({
      name: r.routeName.length > 12 ? r.routeName.slice(0, 12) + '…' : r.routeName,
      Cumplimiento: r.compliancePct,
      fill: r.zone?.color ?? '#64748b',
    }))

  function getExportDataCompliance() {
    const headers = ['Ruta', 'Zona', 'Operador', 'Vehículo', 'Total Ejec.', 'Completadas', 'Con Retraso', 'Canceladas', 'Cumplimiento %', 'Retraso Prom. (min)', 'Paradas omitidas', '% Omisión']
    const rows = data.map((r) => [
      r.routeName, r.zone?.name ?? '',
      r.operator ? `${r.operator.firstName} ${r.operator.lastName}` : '',
      r.vehicle?.plate ?? '',
      String(r.totalExecutions), String(r.completed), String(r.delayed),
      String(r.cancelled), `${r.compliancePct}%`, String(r.avgDelayMinutes),
      r.totalWaypoints > 0 ? String(r.missedStopsTotal) : 'Sin paradas',
      r.totalWaypoints > 0 ? `${r.missedStopsPct}%` : '—',
    ])
    return { headers, rows }
  }

  function complianceColor(pct: number) {
    if (pct >= 80) return 'text-emerald-700 bg-emerald-50'
    if (pct >= 50) return 'text-amber-700 bg-amber-50'
    return 'text-red-700 bg-red-50'
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <StatCard label="Rutas activas" value={totalRoutes} />
        <StatCard label="% Cumplimiento global" value={totalExec > 0 ? `${avgCompliance}%` : '—'} />
        <StatCard label="Ejecuciones totales" value={totalExec} sub="En el período" />
      </div>

      {/* Chart */}
      <div className="bg-white rounded border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">% Cumplimiento por ruta</h3>
          <ExportButtons
            onCSV={() => { const { headers, rows } = getExportDataCompliance(); downloadCSV('cumplimiento_rutas.csv', rows, headers) }}
            onExcel={() => { const { headers, rows } = getExportDataCompliance(); downloadExcel('cumplimiento_rutas.xls', rows, headers) }}
            onPDF={() => { const { headers, rows } = getExportDataCompliance(); printPDF('Cumplimiento de rutas', headers, rows) }}
          />
        </div>
        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <span className="w-6 h-6 rounded-full border-2 border-slate-200 border-t-teal-700 animate-spin" />
          </div>
        ) : totalExec === 0 ? (
          <EmptyChart message="Sin ejecuciones registradas — el gráfico se actualizará cuando los operadores inicien rutas" />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 4, right: 16, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} unit="%" />
              <Tooltip
                formatter={(val) => [`${val}%`, 'Cumplimiento']}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Bar dataKey="Cumplimiento" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Table */}
      {data.length > 0 && (
        <div className="bg-white rounded border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[700px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left">
                  <th className="px-5 py-3.5">Ruta</th>
                  <th className="px-5 py-3.5">Zona</th>
                  <th className="px-5 py-3.5">Días</th>
                  <th className="px-5 py-3.5 text-right">Ejec.</th>
                  <th className="px-5 py-3.5 text-right">Compl.</th>
                  <th className="px-5 py-3.5 text-right">Retraso prom.</th>
                  <th className="px-5 py-3.5 text-center">Paradas omitidas</th>
                  <th className="px-5 py-3.5 text-center">Cumplimiento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((r) => (
                  <tr key={r.routeId} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-850">{r.routeName}</p>
                      {r.operator && (
                        <p className="text-[9px] text-slate-400 uppercase tracking-wider font-bold mt-0.5">
                          Operador: {r.operator.firstName} {r.operator.lastName}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.zone?.color }} />
                        <span className="text-slate-650 font-semibold">{r.zone?.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex gap-1 flex-wrap">
                        {r.dayOfWeek.map((d) => (
                          <span key={d} className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-slate-100 rounded text-slate-600">
                            {DAY_NAMES[d]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right font-medium text-slate-700">{r.totalExecutions}</td>
                    <td className="px-5 py-4 text-right font-semibold text-emerald-700">{r.completed}</td>
                    <td className="px-5 py-4 text-right font-medium text-slate-500">
                      {r.avgDelayMinutes > 0 ? `${r.avgDelayMinutes} min` : '—'}
                    </td>
                    <td className="px-5 py-4 text-center">
                      {r.totalWaypoints === 0 ? (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-350">Sin paradas</span>
                      ) : r.totalExecutions === 0 || (r.missedStopsTotal === 0 && r.missedStopsPct === 0) ? (
                        <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
                          0 omitidas
                        </span>
                      ) : (
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                            r.missedStopsPct >= 50
                              ? 'bg-red-50 text-red-650'
                              : r.missedStopsPct >= 20
                              ? 'bg-amber-50 text-amber-650'
                              : 'bg-yellow-50 text-yellow-800'
                          }`}
                        >
                          {r.missedStopsTotal} ({r.missedStopsPct}%)
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span
                        className={`inline-block px-2.5 py-1 rounded text-[9px] font-bold uppercase tracking-wider ${complianceColor(r.compliancePct)}`}
                      >
                        {r.totalExecutions === 0 ? 'Sin datos' : `${r.compliancePct}%`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab: RF-16 Participación ciudadana ──────────────────────────────────────

const INCIDENT_LABELS: Record<string, string> = {
  WASTE_ACCUMULATION: 'Acumulación',
  DAMAGED_CONTAINER: 'Contenedor dañado',
  MISSED_COLLECTION: 'Recolección perdida',
  OTHER: 'Otro',
}

// RF-16.2: escala de calor — intensidad proporcional al nivel de participación
// (teal = alta, ámbar = media, rojo = baja)
function heatCellClass(ratio: number): string {
  if (ratio >= 0.85) return 'bg-teal-700 text-white'
  if (ratio >= 0.65) return 'bg-teal-500 text-white'
  if (ratio >= 0.5) return 'bg-teal-200 text-teal-950'
  if (ratio >= 0.35) return 'bg-amber-200 text-amber-950'
  if (ratio >= 0.15) return 'bg-amber-100 text-amber-900'
  if (ratio > 0) return 'bg-red-100 text-red-900'
  return 'bg-red-200 text-red-950'
}

const HEAT_LEGEND: { label: string; cls: string }[] = [
  { label: 'Alta', cls: 'bg-teal-700' },
  { label: 'Media-alta', cls: 'bg-teal-200' },
  { label: 'Media', cls: 'bg-amber-200' },
  { label: 'Baja', cls: 'bg-red-100 border border-red-200' },
  { label: 'Nula', cls: 'bg-red-200' },
]

function ParticipationTab({
  accessToken,
  from,
  to,
  zoneId,
}: {
  accessToken: string
  from: string
  to: string
  zoneId: string
}) {
  const [data, setData] = useState<ParticipationData | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (zoneId) params.set('zoneId', zoneId)
    api
      .get<ApiResponse<ParticipationData>>(`/reports/citizen-participation?${params}`, accessToken)
      .then((r) => setData(r.data ?? null))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [accessToken, from, to, zoneId])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const byZone = data?.byZone ?? []
  const chartData = byZone.map((z) => ({
    name: z.zoneName,
    Ciudadanos: z.citizenCount,
    Incidencias: z.incidents.total,
    fill: z.color,
  }))

  function getExportDataParticipation() {
    const headers = ['Zona', 'Distrito', 'Ciudadanos', 'Total Incidencias', 'Abiertas', 'Resueltas', 'Consultas educativas', 'Usuarios únicos (edu.)']
    const rows = byZone.map((z) => [
      z.zoneName, z.district, String(z.citizenCount),
      String(z.incidents.total), String(z.incidents.open), String(z.incidents.resolved),
      String(z.learnVisits), String(z.learnUniqueUsers),
    ])
    return { headers, rows }
  }

  const lowParticipationZones = byZone.filter(
    (z) => z.citizenCount > 0 && z.incidents.total < 2 && z.learnVisits < 3,
  )

  // RF-16.2: índice de participación por zona para el mapa de calor
  const participationIndex = (z: ParticipationData['byZone'][number]) =>
    z.citizenCount + z.incidents.total + z.learnVisits
  const maxIndex = byZone.reduce((m, z) => Math.max(m, participationIndex(z)), 0)
  const maxCitizens = byZone.reduce((m, z) => Math.max(m, z.citizenCount), 0)
  const maxIncidents = byZone.reduce((m, z) => Math.max(m, z.incidents.total), 0)
  const maxLearn = byZone.reduce((m, z) => Math.max(m, z.learnVisits), 0)
  const ratio = (value: number, max: number) => (max > 0 ? value / max : 0)

  // RF-16.3: recomendaciones automáticas calculadas por el backend
  const recommendations = data?.recommendations ?? []

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <span className="w-6 h-6 rounded-full border-2 border-slate-200 border-t-teal-700 animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
            <StatCard
              label="Ciudadanos registrados"
              value={data?.summary.totalCitizens ?? 0}
              sub="Usuarios activos"
            />
            <StatCard
              label="Total incidencias"
              value={data?.summary.totalIncidents ?? 0}
              sub="Reportadas"
            />
            <StatCard
              label="Incidencias resueltas"
              value={byZone.reduce((s, z) => s + z.incidents.resolved, 0)}
              sub="Cerradas o resueltas"
            />
            <StatCard
              label="Consultas educativas"
              value={data?.summary.totalLearnVisits ?? 0}
              sub="Visitas a Aprende a segregar"
            />
          </div>

          {/* RF-16: Sugerencia de difusión para zonas con baja participación */}
          {lowParticipationZones.length > 0 && (
            <div className="bg-amber-50/40 border border-amber-200 rounded p-5">
              <div>
                <h4 className="text-[10px] font-bold text-amber-800 uppercase tracking-widest">Sugerencia de difusión</h4>
                <h5 className="text-sm font-bold text-amber-950 mt-1">Zonas con baja participación ciudadana</h5>
                <p className="text-xs text-amber-800 mt-1.5 leading-relaxed">
                  Las siguientes zonas tienen pocos reportes de incidencias y escasas consultas educativas.
                  Se recomienda implementar campañas de sensibilización o notificaciones dirigidas.
                </p>
                <div className="flex flex-wrap gap-2 mt-3.5">
                  {lowParticipationZones.map((z) => (
                    <span
                      key={z.zoneId}
                      className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider bg-white border border-amber-200/60
                        text-amber-800 px-3 py-1 rounded"
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: z.color }} />
                      {z.zoneName}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Chart */}
          <div className="bg-white rounded border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Ciudadanos e incidencias por zona</h3>
              <ExportButtons
                onCSV={() => { const { headers, rows } = getExportDataParticipation(); downloadCSV('participacion_ciudadana.csv', rows, headers) }}
                onExcel={() => { const { headers, rows } = getExportDataParticipation(); downloadExcel('participacion_ciudadana.xls', rows, headers) }}
                onPDF={() => { const { headers, rows } = getExportDataParticipation(); printPDF('Participación ciudadana', headers, rows) }}
              />
            </div>
            {byZone.length === 0 ? (
              <EmptyChart message="Sin datos de participación" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 4, right: 16, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Ciudadanos" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Incidencias" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* RF-16.2: Mapa de calor de participación por zona */}
          {byZone.length > 0 && (
            <div className="bg-white rounded border border-slate-200 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Mapa de calor — Nivel de participación por zona
                </h3>
                {/* Leyenda */}
                <div className="flex items-center gap-3">
                  {HEAT_LEGEND.map((l) => (
                    <span key={l.label} className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                      <span className={`w-3 h-3 rounded-sm shrink-0 ${l.cls}`} />
                      {l.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[560px] border-separate border-spacing-1">
                  <thead>
                    <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left">
                      <th className="px-3 py-2">Zona</th>
                      <th className="px-3 py-2 text-center">Ciudadanos</th>
                      <th className="px-3 py-2 text-center">Incidencias</th>
                      <th className="px-3 py-2 text-center">Consultas edu.</th>
                      <th className="px-3 py-2 text-center">Índice de participación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byZone.map((z) => {
                      const idx = participationIndex(z)
                      return (
                        <tr key={z.zoneId}>
                          <td className="px-3 py-2.5 bg-slate-50 rounded">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: z.color }} />
                              <span className="font-semibold text-slate-800">{z.zoneName}</span>
                              <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">{z.district}</span>
                            </div>
                          </td>
                          <td className={`px-3 py-2.5 text-center font-bold rounded transition-colors ${heatCellClass(ratio(z.citizenCount, maxCitizens))}`}>
                            {z.citizenCount}
                          </td>
                          <td className={`px-3 py-2.5 text-center font-bold rounded transition-colors ${heatCellClass(ratio(z.incidents.total, maxIncidents))}`}>
                            {z.incidents.total}
                          </td>
                          <td className={`px-3 py-2.5 text-center font-bold rounded transition-colors ${heatCellClass(ratio(z.learnVisits, maxLearn))}`}>
                            {z.learnVisits}
                          </td>
                          <td className={`px-3 py-2.5 text-center font-bold rounded transition-colors ${heatCellClass(ratio(idx, maxIndex))}`}>
                            {idx}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mt-3">
                Intensidad de color proporcional al nivel de participación (ciudadanos + incidencias + consultas educativas)
              </p>
            </div>
          )}

          {/* RF-16.3: Recomendaciones automáticas del backend */}
          {recommendations.length > 0 && (
            <div className="bg-white rounded border border-slate-200 p-5">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Recomendaciones</h3>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-4">
                Campañas y talleres sugeridos para zonas con participación bajo el promedio
              </p>
              <ul className="space-y-2.5">
                {recommendations.map((rec) => (
                  <li
                    key={rec.zoneId}
                    className="flex items-start gap-3 bg-red-50/50 border border-red-100 rounded p-3.5"
                  >
                    <span className="mt-0.5 shrink-0 text-[9px] font-bold uppercase tracking-wider bg-red-100 text-red-800 px-2 py-0.5 rounded">
                      Índice {rec.participationIndex} / prom. {rec.averageIndex}
                    </span>
                    <p className="text-xs text-slate-700 leading-relaxed">{rec.message}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Table */}
          {byZone.length > 0 && (
            <div className="bg-white rounded border border-slate-200 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[600px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left">
                      <th className="px-5 py-3.5">Zona</th>
                      <th className="px-5 py-3.5 text-right">Ciudadanos</th>
                      <th className="px-5 py-3.5 text-right">Incidencias</th>
                      <th className="px-5 py-3.5 text-right">Abiertas</th>
                      <th className="px-5 py-3.5 text-right">Resueltas</th>
                      <th className="px-5 py-3.5 text-right">Consultas edu.</th>
                      <th className="px-5 py-3.5">Por tipo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {byZone.map((z) => (
                      <tr key={z.zoneId} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: z.color }} />
                            <div>
                              <span className="font-semibold text-slate-800">{z.zoneName}</span>
                              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">{z.district}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-right font-bold text-blue-800">{z.citizenCount}</td>
                        <td className="px-5 py-4 text-right font-bold text-slate-700">{z.incidents.total}</td>
                        <td className="px-5 py-4 text-right font-semibold text-amber-700">{z.incidents.open}</td>
                        <td className="px-5 py-4 text-right font-semibold text-emerald-700">{z.incidents.resolved}</td>
                        <td className="px-5 py-4 text-right">
                          <span className="font-bold text-slate-800">{z.learnVisits}</span>
                          {z.learnUniqueUsers > 0 && (
                            <span className="text-slate-400 text-[10px] font-medium ml-1">
                              ({z.learnUniqueUsers} ún.)
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          {Object.keys(z.incidents.byType).length === 0 ? (
                            <span className="text-slate-350">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(z.incidents.byType).map(([type, count]) => (
                                <span
                                  key={type}
                                  className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 bg-slate-100 text-slate-650 rounded"
                                >
                                  {INCIDENT_LABELS[type] ?? type}: {count}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

type TabKey = 'waste' | 'compliance' | 'participation'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'waste', label: 'Residuos por zona' },
  { key: 'compliance', label: 'Cumplimiento de rutas' },
  { key: 'participation', label: 'Participación ciudadana' },
]

export default function ReportsPage() {
  const { accessToken } = useAuth()
  const [activeTab, setActiveTab] = useState<TabKey>('waste')
  const [zones, setZones] = useState<Zone[]>([])

  // Default date range: last 30 days
  const today = new Date()
  const thirtyDaysAgo = new Date(today)
  thirtyDaysAgo.setDate(today.getDate() - 30)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  const [from, setFrom] = useState(fmt(thirtyDaysAgo))
  const [to, setTo] = useState(fmt(today))
  const [zoneId, setZoneId] = useState('')

  useEffect(() => {
    if (!accessToken) return
    api
      .get<ApiResponse<Zone[]>>('/zones', accessToken)
      .then((r) => setZones((r.data ?? []).filter((z) => z.isActive)))
      .catch(() => {})
  }, [accessToken])

  if (!accessToken) return null

  return (
    <div className="p-8 max-w-6xl mx-auto w-full">
      {/* Header */}
      <div className="mb-8 border-b border-slate-100 pb-6">
        <h1 className="text-3xl font-light text-slate-900 tracking-tight">Reportes</h1>
        <p className="text-slate-500 text-xs tracking-wider uppercase mt-1.5 font-bold">
          Análisis de recolección de residuos, cumplimiento de rutas y participación ciudadana
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded border border-slate-200 p-4 sm:p-5 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-[auto_minmax(160px,1fr)_minmax(160px,1fr)_minmax(220px,1.4fr)] items-end gap-4">
          <div className="pb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Filtros</span>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="reports-from" className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Desde
            </label>
            <div className="relative">
              <input
                id="reports-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full h-10 rounded border border-slate-200 bg-slate-50/50 px-3 pr-9 text-sm text-slate-800
                  shadow-inner shadow-slate-100/60 outline-none transition-colors
                  hover:border-slate-300 focus:border-teal-700 focus:bg-white focus:ring-2 focus:ring-teal-700/10"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="reports-to" className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Hasta
            </label>
            <div className="relative">
              <input
                id="reports-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full h-10 rounded border border-slate-200 bg-slate-50/50 px-3 pr-9 text-sm text-slate-800
                  shadow-inner shadow-slate-100/60 outline-none transition-colors
                  hover:border-slate-300 focus:border-teal-700 focus:bg-white focus:ring-2 focus:ring-teal-700/10"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="reports-zone" className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Zona
            </label>
            <select
              id="reports-zone"
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              className="w-full h-10 rounded border border-slate-200 bg-slate-50/50 px-3 text-sm text-slate-800
                outline-none transition-colors hover:border-slate-300
                focus:border-teal-700 focus:bg-white focus:ring-2 focus:ring-teal-700/10"
            >
              <option value="">Todas las zonas</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Content */}
      <ComplianceTab accessToken={accessToken} from={from} to={to} zoneId={zoneId} />
    </div>
  )
}

