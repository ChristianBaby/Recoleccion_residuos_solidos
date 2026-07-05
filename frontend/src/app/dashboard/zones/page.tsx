'use client'

import { useEffect, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useAuth } from '@/context/AuthContext'
import { api, ApiError } from '@/lib/api'
import { verticesToGeoJson, geoJsonToVertices } from '@/lib/geoUtils'
import type { ApiResponse, Zone } from '@/types'
import { toast } from 'sonner'
import {
  Plus, Pencil, ToggleLeft, ToggleRight, X, MapPin, Loader2, Trash2, ChevronDown,
  RotateCcw, CheckCircle, Info,
} from 'lucide-react'

const LeafletZoneMap = dynamic(() => import('@/components/LeafletZoneMap'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-slate-100 rounded-lg">
      <Loader2 size={24} className="animate-spin text-slate-400" />
    </div>
  ),
})

const LeafletPolygonEditor = dynamic(() => import('@/components/LeafletPolygonEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-64 bg-slate-100 rounded-lg">
      <Loader2 size={24} className="animate-spin text-slate-400" />
    </div>
  ),
})

const DISTRICTS = ['Poroy']

const COLORS = [
  '#22c55e', '#3b82f6', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#ec4899',
]

const compareColors = (c1: string, c2: string) => c1.toLowerCase() === c2.toLowerCase()

interface FormState {
  name: string
  description: string
  district: string
  color: string
  vertices: [number, number][]
}

const defaultForm: FormState = {
  name: '', description: '', district: 'Poroy', color: '#22c55e', vertices: [],
}

export default function ZonesPage() {
  const { accessToken, user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  const [zones, setZones] = useState<Zone[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editZone, setEditZone] = useState<Zone | null>(null)
  const [form, setForm] = useState<FormState>(defaultForm)
  const [saving, setSaving] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [zoneToDelete, setZoneToDelete] = useState<Zone | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [activeTab, setActiveTab] = useState<'list' | 'map'>('list')

  const fetchZones = useCallback(async () => {
    if (!accessToken) return
    try {
      const res = await api.get<ApiResponse<Zone[]>>('/zones', accessToken)
      const data = res.data ?? []
      setZones(data)
      setSelectedZone((prev) => {
        if (!prev) return null
        const updated = data.find((z) => z.id === prev.id)
        return updated ?? null
      })
    } catch {
      toast.error('Error al cargar las zonas')
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => { fetchZones() }, [fetchZones])

  function openCreate() {
    setEditZone(null)
    setForm(defaultForm)
    setShowColorPicker(false)
    setShowModal(true)
  }

  function openEdit(zone: Zone) {
    setEditZone(zone)
    setForm({
      name: zone.name,
      description: zone.description ?? '',
      district: zone.district,
      color: zone.color,
      vertices: geoJsonToVertices(zone.geometry),
    })
    setShowColorPicker(false)
    setShowModal(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!accessToken) return

    if (form.vertices.length < 3) {
      toast.error('Dibuja el polígono en el mapa (mínimo 3 puntos)')
      return
    }

    const geometry = verticesToGeoJson(form.vertices)
    if (!geometry) return

    setSaving(true)
    try {
      const payload = {
        name: form.name,
        description: form.description || undefined,
        district: form.district,
        color: form.color,
        geometry,
      }

      if (editZone) {
        await api.put(`/zones/${editZone.id}`, payload, accessToken)
        toast.success('Zona actualizada')
      } else {
        await api.post('/zones', payload, accessToken)
        toast.success('Zona creada')
      }

      setShowModal(false)
      fetchZones()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(zone: Zone) {
    if (!accessToken) return
    try {
      await api.patch(`/zones/${zone.id}/toggle-status`, undefined, accessToken)
      toast.success(zone.isActive ? 'Zona desactivada' : 'Zona activada')
      fetchZones()
    } catch {
      toast.error('Error al cambiar el estado')
    }
  }

  function handleDelete(zone: Zone) {
    setZoneToDelete(zone)
    setShowDeleteConfirm(true)
  }

  async function confirmDelete() {
    if (!accessToken || !zoneToDelete) return
    setDeleting(true)
    try {
      await api.delete(`/zones/${zoneToDelete.id}`, accessToken)
      toast.success('Zona eliminada exitosamente')
      setShowDeleteConfirm(false)
      setZoneToDelete(null)
      fetchZones()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al eliminar la zona')
    } finally {
      setDeleting(false)
    }
  }


  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-200 bg-white flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <MapPin size={18} className="text-emerald-600" />
            Zonas de recolección
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">RF-03 · {zones.length} zona(s) registradas</p>
        </div>
        {isAdmin && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg
              text-sm font-medium hover:bg-emerald-700 transition-colors"
          >
            <Plus size={16} /> Nueva zona
          </button>
        )}
      </div>

      {/* Mobile tabs */}
      <div className="flex md:hidden border-b border-slate-200 bg-white shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('list')}
          className={`flex-1 py-3 text-center text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
            activeTab === 'list'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-400'
          }`}
        >
          Lista de Zonas
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('map')}
          className={`flex-1 py-3 text-center text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
            activeTab === 'map'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-400'
          }`}
        >
          Mapa
        </button>
      </div>

      {/* Content: list + map */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* Zone list */}
        <div className={`w-full md:w-80 md:border-r border-slate-200 overflow-y-auto bg-white shrink-0 md:block ${
          activeTab === 'list' ? 'block h-full' : 'hidden'
        }`}>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-slate-300" />
            </div>
          ) : zones.length === 0 ? (
            <div className="flex flex-col items-center py-16 px-6 text-center">
              <MapPin size={32} className="text-slate-200 mb-3" />
              <p className="text-slate-400 text-sm">Sin zonas registradas</p>
              {isAdmin && (
                <button onClick={openCreate} className="mt-2 text-emerald-600 text-sm hover:underline">
                  Crear primera zona
                </button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {zones.map((zone) => {
                const isSelected = selectedZone?.id === zone.id
                return (
                  <li
                    key={zone.id}
                    onClick={() => setSelectedZone(isSelected ? null : zone)}
                    className={`px-4 py-3 cursor-pointer transition-all border-l-4 ${
                      isSelected
                        ? zone.isActive
                          ? 'bg-emerald-50/70 border-emerald-500'
                          : 'bg-slate-100 border-slate-400'
                        : zone.isActive
                          ? 'border-transparent hover:bg-slate-50'
                          : 'border-transparent bg-slate-50/40 hover:bg-slate-100/50'
                    } ${!zone.isActive ? 'opacity-70' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: zone.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-900 truncate">
                            {zone.name}
                          </span>
                          <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                            zone.isActive
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border border-rose-100'
                          }`}>
                            {zone.isActive ? 'Activa' : 'Inactiva'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 truncate">{zone.district}</p>
                        {zone.description && (
                          <p className="text-xs text-slate-500 truncate mt-0.5" title={zone.description}>
                            {zone.description}
                          </p>
                        )}
                        {zone._count && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            {zone._count.users} ciudadanos · {zone._count.routes} rutas
                          </p>
                        )}
                      </div>
                      {isAdmin && (
                        <div className="flex gap-0.5 shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); openEdit(zone) }}
                            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400"
                            title="Editar"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleToggle(zone) }}
                            className={`p-1.5 rounded-lg transition-colors ${
                              zone.isActive
                                ? 'text-emerald-600 hover:bg-emerald-100/50'
                                : 'text-slate-400 hover:bg-slate-200/50'
                            }`}
                            title={zone.isActive ? 'Desactivar' : 'Activar'}
                          >
                            {zone.isActive ? (
                              <ToggleRight size={18} className="text-emerald-500" />
                            ) : (
                              <ToggleLeft size={18} className="text-slate-400" />
                            )}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(zone) }}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 hover:text-red-700 transition-colors"
                            title="Eliminar"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Map */}
        <div className={`flex-1 p-2 md:p-4 md:block ${
          activeTab === 'map' ? 'block h-full' : 'hidden'
        }`}>
          <LeafletZoneMap
            zones={zones}
            selectedZoneId={selectedZone?.id}
            onZoneClick={(z) => setSelectedZone(z.id === selectedZone?.id ? null : z)}
          />
        </div>
            {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm transition-all">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl flex flex-col overflow-y-auto md:overflow-hidden border border-slate-100"
            style={{ height: 'min(95vh, 700px)' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4.5 border-b border-slate-100 bg-slate-50 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shadow" style={{ backgroundColor: form.color }} />
                <h2 className="font-bold text-slate-900 text-base">
                  {editZone ? `Editar zona: ${form.name || 'Sin nombre'}` : 'Nueva zona de recolección'}
                </h2>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-xl hover:bg-slate-200/60 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body: Split screen (form left, map right) */}
            <form onSubmit={handleSubmit} className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden bg-slate-50">

              {/* Form Side (Left) */}
              <div className="w-full md:w-96 bg-white md:border-r border-slate-200 flex flex-col md:overflow-hidden shrink-0 shadow-sm">
                <div className="px-6 py-6 space-y-6 flex-1 overflow-y-auto scrollbar-thin">
                  
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Nombre *</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                      placeholder="Ej: Zona Centro Histórico"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl bg-white text-slate-800
                        focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all shadow-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Descripción</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      rows={4}
                      placeholder="Agrega notas sobre la cobertura o tipos de residuos..."
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl bg-white text-slate-800
                        focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all shadow-sm resize-none scrollbar-thin"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Color de la zona</label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowColorPicker(!showColorPicker)}
                        className="flex items-center gap-3 px-3.5 py-2.5 border border-slate-200 rounded-xl bg-white hover:bg-slate-50 transition-all shadow-sm w-full focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      >
                        <div className="w-5 h-5 rounded-full border border-black/10 shrink-0 shadow-sm" style={{ backgroundColor: form.color }} />
                        <span className="text-sm text-slate-700 font-medium flex-1 text-left">
                          {compareColors(form.color, '#22c55e') ? 'Verde' :
                           compareColors(form.color, '#3b82f6') ? 'Azul' :
                           compareColors(form.color, '#f59e0b') ? 'Amarillo' :
                           compareColors(form.color, '#ef4444') ? 'Rojo' :
                           compareColors(form.color, '#8b5cf6') ? 'Morado' :
                           compareColors(form.color, '#06b6d4') ? 'Celeste' :
                           compareColors(form.color, '#f97316') ? 'Naranja' :
                           compareColors(form.color, '#ec4899') ? 'Rosado' : 'Personalizado'}
                        </span>
                        <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 ${showColorPicker ? 'rotate-180 text-emerald-600' : ''}`} />
                      </button>

                      {showColorPicker && (
                        <>
                          {/* Backdrop invisible para cerrar al hacer click afuera */}
                          <div className="fixed inset-0 z-[1000]" onClick={() => setShowColorPicker(false)} />
                          {/* Panel flotante */}
                          <div className="absolute top-full left-0 right-0 mt-2 z-[1001] bg-white border border-slate-200/80 rounded-2xl p-3 shadow-xl grid grid-cols-4 gap-2 animate-in fade-in slide-in-from-top-2 duration-150">
                            {COLORS.map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => {
                                  setForm({ ...form, color: c })
                                  setShowColorPicker(false)
                                }}
                                className={`w-9 h-9 rounded-full border-2 transition-all hover:scale-110 active:scale-95 shadow-sm relative flex items-center justify-center ${
                                  compareColors(form.color, c) ? 'border-emerald-500 scale-105 ring-2 ring-emerald-100' : 'border-slate-100 hover:border-slate-300'
                                }`}
                                style={{ backgroundColor: c }}
                              >
                                {compareColors(form.color, c) && (
                                  <span className="w-1.5 h-1.5 bg-white rounded-full shadow" />
                                )}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Trazado de la Zona (Vertical / Fuera del Mapa) */}
                  <div className="pt-4 border-t border-slate-100 space-y-4">
                    <div>
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Trazado de la zona</h4>
                      
                      {/* Estado del dibujo (Asistente dinámico) */}
                      <div className={`p-3.5 rounded-xl border flex items-start gap-2.5 ${
                        form.vertices.length === 0 ? 'bg-slate-50 text-slate-500 border-slate-100' :
                        form.vertices.length < 3 ? 'bg-amber-50/60 text-amber-800 border-amber-100/50' :
                        'bg-emerald-50/60 text-emerald-800 border-emerald-100/50'
                      }`}>
                        {form.vertices.length === 0 ? (
                          <>
                            <Info size={16} className="text-slate-400 shrink-0 mt-0.5" />
                            <div className="flex flex-col gap-0.5 text-xs text-slate-600">
                              <span className="font-bold text-slate-700">Dibujar zona</span>
                              <span>Haz clic en el mapa de la derecha para iniciar el trazado.</span>
                            </div>
                          </>
                        ) : form.vertices.length === 1 ? (
                          <>
                            <Info size={16} className="text-amber-500 shrink-0 mt-0.5" />
                            <div className="flex flex-col gap-0.5 text-xs text-slate-600">
                              <span className="font-bold text-amber-700">Trazado iniciado</span>
                              <span>Faltan <span className="font-bold text-amber-600">2 vértices</span> más para poder formar la zona.</span>
                            </div>
                          </>
                        ) : form.vertices.length === 2 ? (
                          <>
                            <Info size={16} className="text-amber-500 shrink-0 mt-0.5" />
                            <div className="flex flex-col gap-0.5 text-xs text-slate-600">
                              <span className="font-bold text-amber-700">Trazado iniciado</span>
                              <span>Falta <span className="font-bold text-amber-600">1 vértice</span> más para poder formar la zona.</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <CheckCircle size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                            <div className="flex flex-col gap-0.5 text-xs text-emerald-800">
                              <span className="font-bold text-emerald-700">Zona lista</span>
                              <span>Polígono delimitado correctamente.</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Métricas de puntos */}
                    <div className="flex items-center justify-between py-1.5 px-1 border-b border-slate-100">
                      <span className="text-xs font-semibold text-slate-500">Puntos trazados</span>
                      <span className="text-xs text-slate-800 bg-slate-100 px-2.5 py-0.5 rounded-md font-bold shadow-sm">
                        {form.vertices.length} / mín 3
                      </span>
                    </div>

                    {/* Botones de acción del dibujo */}
                    {form.vertices.length > 0 && (
                      <div className="flex gap-2 animate-in fade-in duration-200">
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, vertices: form.vertices.slice(0, -1) })}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs text-amber-700 bg-amber-50 hover:bg-amber-100/80 border border-amber-200/40 rounded-xl transition-all font-semibold active:scale-98"
                          title="Deshacer el último vértice"
                        >
                          <RotateCcw size={13} />
                          <span>Deshacer</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, vertices: [] })}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs text-red-600 bg-red-50 hover:bg-red-100/80 border border-red-200/40 rounded-xl transition-all font-semibold active:scale-98"
                          title="Borrar todo el dibujo"
                        >
                          <Trash2 size={13} />
                          <span>Limpiar</span>
                        </button>
                      </div>
                    )}
                  </div>

                </div>

                {/* Footer buttons inside card */}
                <div className="px-6 py-5 bg-slate-50 border-t border-slate-200 flex flex-col gap-2 shrink-0">
                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700
                      active:scale-98 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 transition-all shadow-md shadow-emerald-600/10"
                  >
                    {saving && <Loader2 size={14} className="animate-spin" />}
                    {editZone ? 'Guardar cambios' : 'Crear zona'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="w-full px-4 py-2.5 text-sm font-semibold text-slate-600 bg-white
                      border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-sm active:scale-98"
                  >
                    Cancelar
                  </button>
                </div>
              </div>

              {/* Map Side (Right) */}
              <div className="w-full h-80 md:h-full md:flex-1 relative shrink-0 border-t md:border-t-0 border-slate-200">
                <LeafletPolygonEditor
                  vertices={form.vertices}
                  onChange={(v) => setForm({ ...form, vertices: v })}
                  otherZones={zones.filter((z) => z.id !== editZone?.id)}
                />
              </div>

            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && zoneToDelete && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm transition-all animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-100 p-6 flex flex-col items-center text-center animate-in zoom-in-95 duration-200">
            {/* Warning Icon */}
            <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center text-rose-500 mb-4 animate-bounce">
              <Trash2 size={24} />
            </div>

            <h3 className="text-lg font-bold text-slate-900">
              ¿Eliminar zona de recolección?
            </h3>
            
            <p className="text-xs text-slate-500 mt-2.5 mb-6 leading-relaxed">
              ¿Estás seguro de que deseas eliminar la zona <strong className="text-slate-800 font-semibold">"{zoneToDelete.name}"</strong>? La zona quedará inactiva y dejará de usarse para nuevas asignaciones, pero se conservará su historial de rutas, reportes y ciudadanos asociados.
            </p>

            <div className="flex gap-3 w-full">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false)
                  setZoneToDelete(null)
                }}
                className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 font-semibold rounded-xl text-sm transition-all"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 active:scale-98 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-rose-600/10"
              >
                {deleting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  'Eliminar'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      </div>
    </div>
  )
}
