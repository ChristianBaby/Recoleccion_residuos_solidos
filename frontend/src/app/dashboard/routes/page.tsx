'use client'

import { useEffect, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useAuth } from '@/context/AuthContext'
import { api, ApiError } from '@/lib/api'
import type { ApiResponse, Route, Zone, Vehicle, Operator } from '@/types'
import { toast } from 'sonner'
import {
  Plus, Pencil, X, Route as RouteIcon, Loader2,
  Trash2, Clock, MapPin, Truck, Map, MousePointerClick, CheckCircle2, Copy,
} from 'lucide-react'
import RouteMapModal from '@/components/RouteMapModal'
import type { WaypointDraft } from '@/components/LeafletWaypointEditor'

// Leaflet must be client-only
const LeafletWaypointEditor = dynamic(
  () => import('@/components/LeafletWaypointEditor'),
  { ssr: false, loading: () => <div className="flex-1 flex items-center justify-center bg-slate-50"><Loader2 size={24} className="animate-spin text-slate-300" /></div> },
)

const LeafletRouteMap = dynamic(
  () => import('@/components/LeafletRouteMap'),
  { ssr: false, loading: () => <div className="h-full w-full flex items-center justify-center bg-slate-100"><Loader2 size={20} className="animate-spin text-slate-300" /></div> }
)


// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  DRAFT:    { label: 'Borrador', cls: 'bg-slate-100 text-slate-600' },
  ACTIVE:   { label: 'Activa',   cls: 'bg-emerald-50 text-emerald-700' },
  INACTIVE: { label: 'Inactiva', cls: 'bg-red-50 text-red-600' },
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface WaypointForm {
  order: number
  name: string
  lat: string
  lng: string
  estimatedTime: string
}

interface FormState {
  name: string
  zoneId: string
  vehicleId: string
  operatorId: string
  dayOfWeek: number[]
  startTime: string
  estimatedDuration: string
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  waypoints: WaypointForm[]
}

const defaultForm: FormState = {
  name: '', zoneId: '', vehicleId: '', operatorId: '',
  dayOfWeek: [], startTime: '', estimatedDuration: '',
  status: 'DRAFT', waypoints: [],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function draftToForm(d: WaypointDraft): WaypointForm {
  return { order: d.order, name: d.name, lat: String(d.lat), lng: String(d.lng), estimatedTime: '' }
}

function formToDraft(f: WaypointForm): WaypointDraft | null {
  const lat = parseFloat(f.lat)
  const lng = parseFloat(f.lng)
  if (isNaN(lat) || isNaN(lng)) return null
  return { order: f.order, lat, lng, name: f.name }
}

// ─── Map Editor Modal ─────────────────────────────────────────────────────────

function WaypointMapEditorModal({
  initial,
  zone,
  onConfirm,
  onClose,
}: {
  initial: WaypointForm[]
  zone: Zone | null
  onConfirm: (wps: WaypointForm[]) => void
  onClose: () => void
}) {
  const [drafts, setDrafts] = useState<WaypointDraft[]>(
    initial.map((f, i) => formToDraft(f) ?? { order: i + 1, lat: 0, lng: 0, name: f.name }).filter((d) => d.lat !== 0),
  )

  function updateName(idx: number, name: string) {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, name } : d)))
  }

  function remove(idx: number) {
    setDrafts((prev) =>
      prev.filter((_, i) => i !== idx).map((d, i) => ({ ...d, order: i + 1 })),
    )
  }

  function clearAll() {
    setDrafts([])
  }

  function confirm() {
    onConfirm(drafts.map(draftToForm))
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 bg-white shrink-0">
        <div>
          <h2 className="font-semibold text-slate-900 flex items-center gap-2">
            <MousePointerClick size={16} className="text-blue-600" />
            Diseñar ruta en el mapa
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Haz clic en el mapa para agregar paradas · Arrastra los marcadores para ajustar posición
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
          <X size={18} />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — waypoints list */}
        <div className="w-72 border-r border-slate-200 flex flex-col bg-white shrink-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              {drafts.length} parada{drafts.length !== 1 ? 's' : ''}
            </span>
            {drafts.length > 0 && (
              <button
                onClick={clearAll}
                className="text-xs text-red-500 hover:underline"
              >
                Limpiar todo
              </button>
            )}
          </div>

          <div className="flex-1 overflow-auto p-3 space-y-2">
            {drafts.length === 0 ? (
              <div className="flex flex-col items-center py-12 text-center text-slate-400 gap-2">
                <MousePointerClick size={32} className="opacity-30" />
                <p className="text-xs">Haz clic en el mapa para añadir la primera parada</p>
              </div>
            ) : (
              drafts.map((d, idx) => {
                const isFirst = idx === 0
                const isLast = idx === drafts.length - 1
                const dotColor = isFirst ? '#16a34a' : isLast ? '#dc2626' : (zone?.color ?? '#2563eb')
                return (
                  <div key={idx} className="flex items-center gap-2 bg-slate-50 rounded-lg px-2 py-2">
                    <div
                      className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center
                        text-white text-xs font-bold"
                      style={{ backgroundColor: dotColor }}
                    >
                      {idx + 1}
                    </div>
                    <input
                      type="text"
                      value={d.name}
                      onChange={(e) => updateName(idx, e.target.value)}
                      placeholder={`Parada ${idx + 1}`}
                      className="flex-1 text-xs bg-transparent border-none outline-none text-slate-700
                        placeholder-slate-400"
                    />
                    <button
                      onClick={() => remove(idx)}
                      className="text-slate-300 hover:text-red-500 transition-colors shrink-0"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )
              })
            )}
          </div>

          {/* Legend */}
          <div className="p-3 border-t border-slate-100 space-y-1.5 shrink-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <div className="w-4 h-4 rounded-full bg-green-600 shrink-0" /> Inicio de ruta
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <div className="w-4 h-4 rounded-full bg-red-600 shrink-0" /> Fin de ruta
            </div>
          </div>
        </div>

        {/* Map */}
        <div className="flex-1 relative">
          <LeafletWaypointEditor waypoints={drafts} onChange={setDrafts} zone={zone} />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 bg-white shrink-0">
        <p className="text-xs text-slate-400">
          Los marcadores son arrastrables para ajustar la posición exacta
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg
              hover:bg-slate-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={confirm}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white
              bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <CheckCircle2 size={14} />
            Confirmar {drafts.length} parada{drafts.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function RoutesPage() {
  const { accessToken, user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  const [routes, setRoutes] = useState<Route[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editRoute, setEditRoute] = useState<Route | null>(null)
  const [form, setForm] = useState<FormState>(defaultForm)
  const [saving, setSaving] = useState(false)
  const [loadingWaypoints, setLoadingWaypoints] = useState(false)
  const [mapRouteId, setMapRouteId] = useState<string | null>(null)
  const [showMapEditor, setShowMapEditor] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!accessToken) return
    try {
      const [routesRes, zonesRes, vehiclesRes] = await Promise.all([
        api.get<ApiResponse<Route[]>>('/routes', accessToken),
        api.get<ApiResponse<Zone[]>>('/zones', accessToken),
        api.get<ApiResponse<Vehicle[]>>('/vehicles', accessToken),
      ])
      setRoutes(routesRes.data ?? [])
      setZones((zonesRes.data ?? []).filter((z) => z.isActive))
      setVehicles((vehiclesRes.data ?? []).filter((v) => v.isActive))

      if (isAdmin) {
        const opRes = await api.get<ApiResponse<Operator[]>>('/routes/operators', accessToken)
        setOperators(opRes.data ?? [])
      }
    } catch {
      toast.error('Error al cargar los datos')
    } finally {
      setLoading(false)
    }
  }, [accessToken, isAdmin])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchAll()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchAll])

  function openCreate() {
    setEditRoute(null)
    setForm(defaultForm)
    setLoadingWaypoints(false)
    setShowModal(true)
  }

  function openEdit(route: Route) {
    setEditRoute(route)
    setForm({
      name: route.name,
      zoneId: route.zoneId,
      vehicleId: route.vehicleId ?? '',
      operatorId: route.operatorId ?? '',
      dayOfWeek: route.dayOfWeek,
      startTime: route.startTime ?? '',
      estimatedDuration: route.estimatedDuration?.toString() ?? '',
      status: route.status,
      waypoints: [], // Cargadas asíncronamente
    })
    setShowModal(true)

    if (accessToken) {
      setLoadingWaypoints(true)
      const getRouteDetail = api.get as (endpoint: string, token?: string) => Promise<ApiResponse<Route>>
      getRouteDetail(`/routes/${route.id}`, accessToken)
        .then((r) => {
          if (r.data?.waypoints) {
            setForm((f) => ({
              ...f,
              waypoints: (r.data!.waypoints ?? []).map((wp) => ({
                order: wp.order,
                name: wp.name ?? '',
                lat: wp.lat.toString(),
                lng: wp.lng.toString(),
                estimatedTime: wp.estimatedTime ?? '',
              })),
            }))
          }
        })
        .catch(() => {
          toast.error('Error al cargar las paradas de la ruta')
        })
        .finally(() => {
          setLoadingWaypoints(false)
        })
    }
  }

  function toggleDay(day: number) {
    setForm((f) => ({
      ...f,
      dayOfWeek: f.dayOfWeek.includes(day)
        ? f.dayOfWeek.filter((d) => d !== day)
        : [...f.dayOfWeek, day].sort(),
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!accessToken) return

    if (form.dayOfWeek.length === 0) {
      toast.error('Selecciona al menos un día de la semana')
      return
    }

    for (const wp of form.waypoints) {
      if (isNaN(parseFloat(wp.lat)) || isNaN(parseFloat(wp.lng))) {
        toast.error('Coordenadas de parada inválidas. Usa el editor de mapa.')
        return
      }
    }

    setSaving(true)
    try {
      const payload = {
        name: form.name,
        zoneId: form.zoneId,
        vehicleId: form.vehicleId || undefined,
        operatorId: form.operatorId || undefined,
        dayOfWeek: form.dayOfWeek,
        startTime: form.startTime || undefined,
        estimatedDuration: form.estimatedDuration ? parseInt(form.estimatedDuration) : undefined,
        status: form.status,
        waypoints: form.waypoints.map((wp) => ({
          order: wp.order,
          name: wp.name || undefined,
          lat: parseFloat(wp.lat),
          lng: parseFloat(wp.lng),
          estimatedTime: wp.estimatedTime || undefined,
        })),
      }

      if (editRoute) {
        await api.put(`/routes/${editRoute.id}`, payload, accessToken)
        toast.success('Ruta actualizada')
      } else {
        await api.post('/routes', payload, accessToken)
        toast.success('Ruta creada')
      }

      setShowModal(false)
      fetchAll()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  // RF-09.1: Duplicar ruta — la copia queda en borrador, sin operador ni vehículo
  async function handleDuplicate(route: Route) {
    if (!accessToken || duplicatingId) return
    setDuplicatingId(route.id)
    try {
      const res = await api.post<ApiResponse<Route>>(`/routes/${route.id}/duplicate`, {}, accessToken)
      toast.success(`Ruta duplicada como "${res.data?.name ?? route.name}" (borrador)`)
      fetchAll()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al duplicar la ruta')
    } finally {
      setDuplicatingId(null)
    }
  }

  async function handleDeactivate(route: Route) {
    if (!accessToken) return
    if (!confirm(`¿Desactivar la ruta "${route.name}"?`)) return
    try {
      await api.patch(`/routes/${route.id}/deactivate`, undefined, accessToken)
      toast.success('Ruta desactivada')
      fetchAll()
    } catch {
      toast.error('Error al desactivar la ruta')
    }
  }

  const selectedZone = zones.find((z) => z.id === form.zoneId) ?? null

  const filteredRoutes = routes.filter((r) => !filterStatus || r.status === filterStatus)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-200 bg-white shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <RouteIcon size={18} className="text-blue-600" /> Rutas de recolección
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {routes.length} ruta(s) ·{' '}
              {routes.filter((r) => r.status === 'ACTIVE').length} activas
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={openCreate}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg
                text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <Plus size={16} /> Nueva ruta
            </button>
          )}
        </div>

        {/* Status filter */}
        <div className="flex gap-2">
          {(['', 'ACTIVE', 'DRAFT', 'INACTIVE'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                filterStatus === s
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-blue-400'
              }`}
            >
              {s === '' ? 'Todas' : STATUS_LABELS[s]?.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-slate-300" />
          </div>
        ) : filteredRoutes.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <RouteIcon size={40} className="text-slate-200 mb-3" />
            <p className="text-slate-400 text-sm">Sin rutas registradas</p>
            {isAdmin && (
              <button onClick={openCreate} className="mt-2 text-blue-600 text-sm hover:underline">
                Crear primera ruta
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold
                  text-slate-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Ruta</th>
                  <th className="text-left px-4 py-3">Zona</th>
                  <th className="text-left px-4 py-3">Días</th>
                  <th className="text-left px-4 py-3">Hora</th>
                  <th className="text-left px-4 py-3">Vehículo</th>
                  <th className="text-left px-4 py-3">Operador</th>
                  <th className="text-left px-4 py-3">Estado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRoutes.map((route) => {
                  const status = STATUS_LABELS[route.status] ?? STATUS_LABELS.DRAFT
                  return (
                    <tr key={route.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{route.name}</div>
                        {route._count && (
                          <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                            <MapPin size={10} /> {route._count.waypoints} paradas
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {route.zone && (
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: route.zone.color }} />
                            <span className="text-slate-700">{route.zone.name}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-0.5 flex-wrap">
                          {route.dayOfWeek.map((d) => (
                            <span key={d}
                              className="px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-700 font-medium">
                              {DAY_NAMES[d]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {route.startTime ?? '—'}
                        {route.estimatedDuration && (
                          <span className="text-slate-400"> ({route.estimatedDuration} min)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {route.vehicle ? (
                          <div className="flex items-center gap-1">
                            <Truck size={13} className="text-slate-400" />
                            {route.vehicle.plate}
                          </div>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {route.operator
                          ? `${route.operator.firstName} ${route.operator.lastName}`
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${status.cls}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => setMapRouteId(route.id)}
                            className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400
                              hover:text-blue-600 transition-colors"
                            title="Ver ruta en mapa"
                          >
                            <Map size={13} />
                          </button>
                          {isAdmin && (
                            <>
                              <button
                                onClick={() => openEdit(route)}
                                className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400
                                  transition-colors"
                                title="Editar"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => handleDuplicate(route)}
                                disabled={duplicatingId !== null}
                                className="p-1.5 rounded-lg hover:bg-teal-50 text-slate-400
                                  hover:text-teal-700 transition-colors disabled:opacity-50"
                                title="Duplicar"
                              >
                                {duplicatingId === route.id
                                  ? <Loader2 size={13} className="animate-spin" />
                                  : <Copy size={13} />}
                              </button>
                              {route.status !== 'INACTIVE' && (
                                <button
                                  onClick={() => handleDeactivate(route)}
                                  className="p-1.5 rounded-lg hover:bg-red-100 text-slate-400
                                    hover:text-red-500 transition-colors"
                                  title="Desactivar"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* View route on map modal */}
      {mapRouteId && (
        <RouteMapModal routeId={mapRouteId} zones={zones} onClose={() => setMapRouteId(null)} />
      )}

      {/* CRUD form modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <h2 className="font-semibold text-slate-900">
                {editRoute ? 'Editar ruta' : 'Nueva ruta de recolección'}
              </h2>
              <button onClick={() => setShowModal(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
              <div className="px-6 py-5 space-y-5">

                {/* Name + Zone */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Nombre <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                      placeholder="Ej: Ruta Norte Mañana"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg
                        focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      <MapPin size={11} className="inline mr-1" />Zona <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={form.zoneId}
                      onChange={(e) => setForm({ ...form, zoneId: e.target.value })}
                      required
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg
                        focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="">Seleccionar zona...</option>
                      {zones.map((z) => (
                        <option key={z.id} value={z.id}>{z.name} — {z.district}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Vehicle + Operator */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      <Truck size={11} className="inline mr-1" />Vehículo
                    </label>
                    <select
                      value={form.vehicleId}
                      onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg
                        focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="">Sin asignar</option>
                      {vehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.plate} — {v.type.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Operador</label>
                    <select
                      value={form.operatorId}
                      onChange={(e) => setForm({ ...form, operatorId: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg
                        focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="">Sin asignar</option>
                      {operators.map((op) => (
                        <option key={op.id} value={op.id}>
                          {op.firstName} {op.lastName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Days */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2">
                    Días de recolección <span className="text-red-500">*</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {DAY_NAMES.map((name, d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDay(d)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          form.dayOfWeek.includes(d)
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Time + Duration + Status */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      <Clock size={11} className="inline mr-1" />Hora inicio
                    </label>
                    <input
                      type="time"
                      value={form.startTime}
                      onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg
                        focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Duración (min)
                    </label>
                    <input
                      type="number"
                      value={form.estimatedDuration}
                      onChange={(e) => setForm({ ...form, estimatedDuration: e.target.value })}
                      placeholder="Ej: 120"
                      min={1}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg
                        focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Estado</label>
                    <select
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value as FormState['status'] })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg
                        focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="DRAFT">Borrador</option>
                      <option value="ACTIVE">Activa</option>
                      <option value="INACTIVE">Inactiva</option>
                    </select>
                  </div>
                </div>

                {/* Waypoints */}
                <div>
                  {(() => {
                    const simulatedRoute: Route = {
                      id: editRoute?.id ?? 'temp-id',
                      name: form.name || 'Ruta en diseño',
                      zoneId: form.zoneId,
                      vehicleId: form.vehicleId || null,
                      operatorId: form.operatorId || null,
                      dayOfWeek: form.dayOfWeek,
                      startTime: form.startTime || null,
                      estimatedDuration: form.estimatedDuration ? parseInt(form.estimatedDuration) : null,
                      status: form.status,
                      zone: selectedZone ? { id: selectedZone.id, name: selectedZone.name, color: selectedZone.color } : undefined,
                      waypoints: form.waypoints.map((wp, idx) => ({
                        id: `wp-${idx}`,
                        routeId: editRoute?.id ?? 'temp-id',
                        order: wp.order,
                        name: wp.name,
                        description: null,
                        lat: parseFloat(wp.lat),
                        lng: parseFloat(wp.lng),
                        estimatedTime: wp.estimatedTime || null,
                      })).filter(wp => !isNaN(wp.lat) && !isNaN(wp.lng)),
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                    }

                    return loadingWaypoints ? (
                      <div className="flex flex-col items-center justify-center py-10 bg-slate-50 border border-slate-200 rounded-2xl">
                        <Loader2 size={24} className="animate-spin text-blue-600 mb-2" />
                        <span className="text-xs text-slate-500 font-medium">Cargando paradas...</span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                        {/* Left: Waypoints list */}
                        <div className="md:col-span-7 flex flex-col justify-between bg-slate-50/50 border border-slate-100 rounded-2xl p-4 h-[240px]">
                          <div>
                            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
                              <span className="text-xs font-bold text-slate-650 flex items-center gap-1.5">
                                <MapPin size={13} className="text-slate-400" />
                                {form.waypoints.length === 0 ? 'Sin paradas' : `${form.waypoints.length} paradas configuradas`}
                              </span>
                            </div>
                            
                            {form.waypoints.length === 0 ? (
                              <div className="flex flex-col items-center justify-center py-6 text-center text-slate-400 gap-2 h-[150px]">
                                <MousePointerClick size={28} className="opacity-30 text-blue-500 animate-pulse" />
                                <p className="text-xs font-medium text-slate-500">Diseña el trazado en el mapa</p>
                                <p className="text-[10px] text-slate-400 max-w-[200px] leading-relaxed">
                                  Haz clic en el mapa de la derecha para agregar paradas en la zona seleccionada.
                                </p>
                              </div>
                            ) : (
                              <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                                {form.waypoints.map((wp, idx) => {
                                  const isFirst = idx === 0
                                  const isLast = idx === form.waypoints.length - 1
                                  const dotColor = isFirst ? '#16a34a' : isLast ? '#dc2626' : '#2563eb'
                                  return (
                                    <div key={idx} className="flex items-center gap-2.5 text-xs text-slate-650 bg-white rounded-xl p-2 border border-slate-100 shadow-sm animate-fade-in">
                                      <span className="w-5 h-5 rounded-full text-white flex items-center justify-center text-[10px] font-bold shrink-0 shadow-sm"
                                        style={{ backgroundColor: dotColor }}
                                      >
                                        {idx + 1}
                                      </span>
                                      <span className="flex-1 truncate font-medium text-slate-700">
                                        {wp.name || `Parada ${idx + 1}`}
                                      </span>
                                      <span className="text-[10px] text-slate-400 font-mono shrink-0">
                                        {parseFloat(wp.lat).toFixed(4)}, {parseFloat(wp.lng).toFixed(4)}
                                      </span>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Right: Map Trigger Area / Mini Map */}
                        <div className="md:col-span-5 h-[240px] border border-slate-200 rounded-2xl relative overflow-hidden bg-slate-50 flex flex-col items-center justify-center">
                          <div className="w-full h-full relative group">
                            <LeafletRouteMap
                              key={simulatedRoute.id}
                              route={simulatedRoute}
                              zones={zones}
                            />
                            {/* Hover overlay to edit */}
                            <div
                              onClick={() => setShowMapEditor(true)}
                              className="absolute inset-0 bg-black/[0.02] hover:bg-black/30 z-[1000] flex flex-col items-center justify-center transition-all duration-200 cursor-pointer"
                            >
                              <button
                                type="button"
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold tracking-wider uppercase shadow-md flex items-center gap-1.5 transform scale-95 hover:scale-100 transition-all duration-200 shadow-blue-500/20"
                              >
                                <Pencil size={12} />
                                <span>{form.waypoints.length === 0 ? 'Dibujar paradas' : 'Editar en mapa'}</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              </div>

              <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-300
                    rounded-lg hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg
                    hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  {editRoute ? 'Guardar cambios' : 'Crear ruta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Full-screen map editor */}
      {showMapEditor && (
        <WaypointMapEditorModal
          initial={form.waypoints}
          zone={selectedZone}
          onConfirm={(wps) => setForm((f) => ({ ...f, waypoints: wps }))}
          onClose={() => setShowMapEditor(false)}
        />
      )}
    </div>
  )
}
