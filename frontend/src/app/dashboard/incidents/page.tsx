'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useAuth } from '@/context/AuthContext'
import { api, ApiError } from '@/lib/api'
import type { ApiResponse, Incident, IncidentStatus } from '@/types'
import { toast } from 'sonner'
import ZoneGuard from '@/components/ZoneGuard'
import type { Zone } from '@/types'
import { saveOfflineIncident, getOfflineIncidents, deleteOfflineIncident } from '@/lib/offlineDb'
import { Pencil, Trash2, MapPin, X, MousePointerClick, CheckCircle2, Eye, User as UserIcon, Phone, Mail, Calendar, ExternalLink, ShieldCheck, FileText } from 'lucide-react'
import { useSearchParams } from 'next/navigation'

const INCIDENT_TYPE_LABELS: Record<string, string> = {
  WASTE_ACCUMULATION: 'Acumulación de residuos',
  DAMAGED_CONTAINER:  'Contenedor dañado',
  MISSED_COLLECTION:  'Recolección no realizada',
  OTHER:              'Otro',
}

const STATUS_CONFIG: Record<IncidentStatus, { label: string; cls: string }> = {
  OPEN:      { label: 'Abierta',       cls: 'bg-red-50 text-red-700 border-red-200' },
  IN_REVIEW: { label: 'En revisión',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  RESOLVED:  { label: 'Resuelta',      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CLOSED:    { label: 'Cerrada',       cls: 'bg-slate-100 text-slate-600 border-slate-200' },
}

const STATUS_ORDER: IncidentStatus[] = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED']

interface FormState {
  type: string
  description: string
  imageUrl: string
  address: string
  lat: string
  lng: string
}

const defaultForm: FormState = {
  type: 'WASTE_ACCUMULATION',
  description: '',
  imageUrl: '',
  address: '',
  lat: '',
  lng: '',
}

function IncidentsPageContent() {
  const { accessToken, user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  const searchParams = useSearchParams()
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null)

  useEffect(() => {
    if (searchParams.get('create') === 'true' || searchParams.get('openModal') === 'true') {
      setShowModal(true)
    }
  }, [searchParams])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<IncidentStatus | 'ALL'>('ALL')
  const [filterZoneId, setFilterZoneId] = useState('')
  const [zones, setZones] = useState<Zone[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editingIncident, setEditingIncident] = useState<Incident | null>(null)
  const [form, setForm] = useState<FormState>(defaultForm)
  const [saving, setSaving] = useState(false)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [geoLoading, setGeoLoading] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [offlineCount, setOfflineCount] = useState(0)

  const loadOfflineCount = useCallback(async () => {
    const list = await getOfflineIncidents()
    setOfflineCount(list.length)
  }, [])

  const fetchIncidents = useCallback(async () => {
    if (!accessToken) return
    try {
      const params = new URLSearchParams()
      if (filterStatus !== 'ALL') params.set('status', filterStatus)
      if (isAdmin && filterZoneId) params.set('zoneId', filterZoneId)
      const res = await api.get<ApiResponse<Incident[]>>(`/incidents?${params}`, accessToken)
      setIncidents(res.data ?? [])
    } catch {
      toast.error('Error al cargar las incidencias')
    } finally {
      setLoading(false)
    }
  }, [accessToken, filterStatus, filterZoneId, isAdmin])

  useEffect(() => {
    if (!accessToken || !isAdmin) return
    api.get<ApiResponse<Zone[]>>('/zones', accessToken)
      .then((r) => setZones((r.data ?? []).filter((z) => z.isActive)))
      .catch(() => {})
  }, [accessToken, isAdmin])

  useEffect(() => { fetchIncidents() }, [fetchIncidents])

  const syncOfflineIncidents = useCallback(async () => {
    if (!accessToken) return
    if (typeof window !== 'undefined' && !navigator.onLine) {
      toast.error('No hay conexión a internet para sincronizar.')
      return
    }

    try {
      const offline = await getOfflineIncidents()
      if (offline.length === 0) return

      toast.info(`Sincronizando ${offline.length} reporte(s) guardado(s) localmente...`)
      let successCount = 0

      for (const item of offline) {
        try {
          let imageUrl = ''
          if (item.base64Image) {
            const resBlob = await fetch(item.base64Image)
            const blob = await resBlob.blob()
            const file = new File([blob], 'offline-image.jpg', { type: 'image/jpeg' })
            imageUrl = await uploadToImgBB(file)
          }

          const payload: Record<string, unknown> = {
            type: item.type,
            description: item.description,
          }
          if (imageUrl) payload.imageUrl = imageUrl
          if (item.address) payload.address = item.address
          if (item.lat && item.lng) {
            payload.lat = item.lat
            payload.lng = item.lng
          }

          await api.post('/incidents', payload, accessToken)
          await deleteOfflineIncident(item.id!)
          successCount++
        } catch (error) {
          console.error('Error al sincronizar item offline:', error)
          if (error instanceof ApiError && error.status === 400) {
            await deleteOfflineIncident(item.id!)
            toast.error(`Un reporte guardado localmente tenía datos inválidos y fue descartado: ${error.message}`)
          }
        }
      }

      await loadOfflineCount()
      if (successCount > 0) {
        toast.success(`Sincronización exitosa: ${successCount} reporte(s) enviado(s).`)
        fetchIncidents()
      }
    } catch (err) {
      console.error('Fallo en la sincronización offline:', err)
    }
  }, [accessToken, fetchIncidents, loadOfflineCount])

  useEffect(() => {
    if (!accessToken) return
    loadOfflineCount()

    const handleOnline = () => {
      toast.success('¡Conexión de red restablecida! Sincronizando reportes locales...')
      syncOfflineIncidents()
    }

    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('online', handleOnline)
    }
  }, [accessToken, loadOfflineCount, syncOfflineIncidents])

  function useMyLocation() {
    if (!navigator.geolocation) {
      toast.error('Tu navegador no soporta geolocalización')
      return
    }
    setGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
        }))
        setGeoLoading(false)
        toast.success('Ubicación obtenida')
      },
      () => {
        setGeoLoading(false)
        toast.error('No se pudo obtener la ubicación')
      },
    )
  }

  function compressImage(file: File, maxWidth = 1024, maxHeight = 1024, quality = 0.75): Promise<File> {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = (event) => {
        const img = new Image()
        img.src = event.target?.result as string
        img.onload = () => {
          const canvas = document.createElement('canvas')
          let width = img.width
          let height = img.height

          if (width > height) {
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width)
              width = maxWidth
            }
          } else {
            if (height > maxHeight) {
              width = Math.round((width * maxHeight) / height)
              height = maxHeight
            }
          }

          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          ctx?.drawImage(img, 0, 0, width, height)

          canvas.toBlob(
            (blob) => {
              if (blob) {
                const compressedFile = new File([blob], file.name, {
                  type: 'image/jpeg',
                  lastModified: Date.now(),
                })
                resolve(compressedFile)
              } else {
                resolve(file)
              }
            },
            'image/jpeg',
            quality
          )
        }
        img.onerror = () => resolve(file)
      }
      reader.onerror = () => resolve(file)
    })
  }

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    
    setUploadingImage(true)
    try {
      toast.info('Procesando y comprimiendo imagen localmente...')
      const compressed = await compressImage(file)
      
      let finalFile = compressed
      if (compressed.size > 500 * 1024) {
        finalFile = await compressImage(compressed, 800, 800, 0.55)
      }
      
      setImageFile(finalFile)
      setImagePreview(URL.createObjectURL(finalFile))
      toast.success(`Imagen lista (${(finalFile.size / 1024).toFixed(1)} KB). Cumple con el límite de 500 KB.`)
    } catch {
      toast.error('Error al procesar la imagen')
    } finally {
      setUploadingImage(false)
    }
  }

  function removeImage() {
    setImageFile(null)
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImagePreview(null)
    setForm((f) => ({ ...f, imageUrl: '' }))
  }

  async function uploadToImgBB(file: File): Promise<string> {
    const apiKey = process.env.NEXT_PUBLIC_IMGBB_API_KEY
    if (!apiKey) throw new Error('IMGBB_API_KEY no configurada')
    const formData = new FormData()
    formData.append('image', file)
    const res = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
      method: 'POST',
      body: formData,
    })
    const json = await res.json()
    if (!json.success) throw new Error('Error al subir imagen')
    return json.data.url as string
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = (error) => reject(error)
    })
  }

  async function handleOfflineSave() {
    try {
      let base64Image = ''
      if (imageFile) {
        base64Image = await fileToBase64(imageFile)
      }

      await saveOfflineIncident({
        type: form.type,
        description: form.description,
        address: form.address.trim() || undefined,
        lat: form.lat ? parseFloat(form.lat) : undefined,
        lng: form.lng ? parseFloat(form.lng) : undefined,
        base64Image: base64Image || undefined
      })

      toast.success('Sin conexión o error de red. Reporte guardado localmente (Offline). Se enviará al recuperar conexión.')
      setShowModal(false)
      setForm(defaultForm)
      removeImage()
      loadOfflineCount()
    } catch (err) {
      console.error(err)
      toast.error('No se pudo guardar el reporte localmente')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!accessToken) return

    if (form.description.trim().length < 10) {
      toast.error('La descripción de la incidencia debe tener al menos 10 caracteres')
      return
    }

    setSaving(true)

    try {
      let imageUrl = form.imageUrl.trim()

      if (imageFile) {
        setUploadingImage(true)
        try {
          imageUrl = await uploadToImgBB(imageFile)
        } catch {
          toast.error('No se pudo subir la imagen. Se guardará con la foto anterior o sin foto.')
        } finally {
          setUploadingImage(false)
        }
      }

      const payload: Record<string, unknown> = {
        type: form.type,
        description: form.description,
      }
      if (form.address.trim()) payload.address = form.address.trim()
      if (form.lat) payload.lat = parseFloat(form.lat)
      if (form.lng) payload.lng = parseFloat(form.lng)
      if (imageUrl) payload.imageUrl = imageUrl

      if (editingIncident) {
        // En edición, si el usuario es admin/operador y modificó el estado en el form,
        // también lo incluimos en el payload.
        if (isAdmin || user?.role === 'OPERATOR') {
          payload.status = (form as any).status || editingIncident.status
        }
        await api.patch(`/incidents/${editingIncident.id}`, payload, accessToken)
        toast.success('Incidencia actualizada exitosamente')
      } else {
        if (typeof window !== 'undefined' && !navigator.onLine) {
          await handleOfflineSave()
          setSaving(false)
          return
        }
        const res = await api.post<ApiResponse<Incident>>('/incidents', payload, accessToken)
        const created = res.data!
        toast.success(
          `Incidencia registrada — código: ${created.trackingCode}`,
          { duration: 6000 },
        )
      }

      closeModal()
      fetchIncidents()
    } catch (err) {
      if (!editingIncident && !(err instanceof ApiError) && typeof window !== 'undefined' && !navigator.onLine) {
        await handleOfflineSave()
      } else {
        toast.error(err instanceof ApiError ? err.message : 'Error al guardar la incidencia')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(incident: Incident, status: IncidentStatus) {
    const isStaff = isAdmin || user?.role === 'OPERATOR'
    if (!accessToken || !isStaff) return
    setUpdatingId(incident.id)
    try {
      await api.patch(`/incidents/${incident.id}/status`, { status }, accessToken)
      toast.success(`Estado actualizado a: ${STATUS_CONFIG[status].label}`)
      fetchIncidents()
    } catch {
      toast.error('Error al actualizar el estado')
    } finally {
      setUpdatingId(null)
    }
  }

  async function handleDelete(id: string) {
    if (!accessToken) return
    if (!window.confirm('¿Está seguro de que desea eliminar esta incidencia? Esta acción no se puede deshacer.')) return

    try {
      await api.delete(`/incidents/${id}`, accessToken)
      toast.success('Incidencia eliminada exitosamente')
      fetchIncidents()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al eliminar la incidencia')
    }
  }

  function openEditModal(inc: Incident) {
    setEditingIncident(inc)
    setForm({
      type: inc.type,
      description: inc.description,
      imageUrl: inc.imageUrl || '',
      address: inc.address || '',
      lat: inc.lat ? String(inc.lat) : '',
      lng: inc.lng ? String(inc.lng) : '',
      status: inc.status,
    } as any)
    setImagePreview(inc.imageUrl || null)
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditingIncident(null)
    setForm(defaultForm)
    removeImage()
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code)
      setTimeout(() => setCopiedCode(null), 2000)
    })
  }

  const displayedIncidents =
    filterStatus === 'ALL'
      ? incidents
      : incidents.filter((i) => i.status === filterStatus)

  return (
    <ZoneGuard role={user?.role ?? ''} zoneId={user?.zoneId}>
      <div className="p-8 max-w-6xl mx-auto w-full">
        {/* Banner de reportes offline pendientes */}
        {offlineCount > 0 && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm animate-pulse">
            <div className="flex-1 min-w-0">
              <h4 className="text-[10px] font-bold text-amber-800 uppercase tracking-widest">Reportes Offline</h4>
              <h5 className="text-sm font-bold text-amber-950 mt-1">Sincronización pendiente ({offlineCount})</h5>
              <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                Tienes reportes de incidencias guardados localmente debido a la falta de conexión a internet.
              </p>
            </div>
            <button
              onClick={() => syncOfflineIncidents()}
              className="shrink-0 px-4 py-2 bg-amber-850 hover:bg-amber-900 text-white rounded text-xs font-bold tracking-wider uppercase transition-colors"
            >
              Sincronizar ahora
            </button>
          </div>
        )}

        {/* Header */}
        <div className="mb-8 border-b border-slate-100 pb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-light text-slate-900 tracking-tight">Incidencias</h1>
            <p className="text-slate-500 text-xs tracking-wider uppercase mt-1.5 font-bold">
              Gestión de reportes y anomalías de recolección
              {!isAdmin && ' · Tu zona de residencia'}
            </p>
          </div>
          {!isAdmin && (
            <button
              onClick={() => { setForm(defaultForm); setShowModal(true) }}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold tracking-wider uppercase rounded transition-colors"
            >
              Reportar incidencia
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => { setForm(defaultForm); setShowModal(true) }}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold tracking-wider uppercase rounded transition-colors"
            >
              Registrar incidencia
            </button>
          )}
        </div>

        {/* Filters and Controls */}
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center mb-6">
          <div className="flex flex-wrap gap-1.5">
            {(['ALL', ...STATUS_ORDER] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 rounded text-xs font-bold tracking-wider uppercase transition-colors ${
                  filterStatus === s
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {s === 'ALL' ? 'Todas' : STATUS_CONFIG[s].label}
              </button>
            ))}
          </div>

          {/* Admin zone filter */}
          {isAdmin && (
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest shrink-0">Zona:</span>
              <select
                value={filterZoneId}
                onChange={(e) => setFilterZoneId(e.target.value)}
                className="w-full sm:w-auto border border-slate-200 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-slate-800 bg-white transition-colors"
              >
                <option value="">Todas las zonas</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>{z.name} — {z.district}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Incidents Table / List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="w-6 h-6 rounded-full border-2 border-slate-200 border-t-teal-700 animate-spin" />
          </div>
        ) : displayedIncidents.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Sin Incidencias</p>
            <p className="text-slate-500 text-sm">
              {filterStatus !== 'ALL'
                ? `No se encontraron incidencias con el estado "${STATUS_CONFIG[filterStatus].label}"`
                : 'No hay incidencias registradas en el sistema.'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[800px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left">
                    <th className="px-5 py-3.5">Código</th>
                    <th className="px-5 py-3.5">Tipo</th>
                    <th className="px-5 py-3.5">Descripción</th>
                    {isAdmin && <th className="px-5 py-3.5">Ciudadano</th>}
                    <th className="px-5 py-3.5">Foto</th>
                    <th className="px-5 py-3.5">Ubicación</th>
                    <th className="px-5 py-3.5">Fecha</th>
                    <th className="px-5 py-3.5">Estado</th>
                    <th className="px-5 py-3.5 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {displayedIncidents.map((inc) => {
                    const status = STATUS_CONFIG[inc.status]
                    return (
                      <tr key={inc.id} className="hover:bg-slate-50/50 transition-colors">
                        {/* Tracking code */}
                        <td className="px-5 py-4 font-mono font-bold text-slate-500">
                          <button
                            onClick={() => copyCode(inc.trackingCode)}
                            className="hover:text-slate-900 transition-colors uppercase"
                            title="Copiar código"
                          >
                            {inc.trackingCode.slice(0, 8)}…
                            {copiedCode === inc.trackingCode && (
                              <span className="text-emerald-700 ml-1 font-bold text-[9px] lowercase">(copiado)</span>
                            )}
                          </button>
                        </td>

                        {/* Type */}
                        <td className="px-5 py-4 font-semibold text-slate-800">
                          {INCIDENT_TYPE_LABELS[inc.type] ?? inc.type}
                        </td>

                        {/* Description */}
                        <td className="px-5 py-4 max-w-xs text-slate-650">
                          <p className="truncate" title={inc.description}>
                            {inc.description}
                          </p>
                        </td>

                        {/* Citizen (admin only) */}
                        {isAdmin && (
                          <td className="px-5 py-4 text-slate-650 whitespace-nowrap">
                            {inc.citizen
                              ? `${inc.citizen.firstName} ${inc.citizen.lastName}`
                              : '—'}
                          </td>
                        )}

                        {/* Image */}
                        <td className="px-5 py-4">
                          {inc.imageUrl ? (
                            <a href={inc.imageUrl} target="_blank" rel="noopener noreferrer" className="inline-block">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={inc.imageUrl}
                                alt="foto"
                                className="w-9 h-9 object-cover rounded border border-slate-200 hover:scale-150 transition-all duration-200"
                              />
                            </a>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>

                        {/* Location */}
                        <td className="px-5 py-4 text-slate-600 max-w-xs truncate">
                          {inc.address ? (
                            <span title={inc.address}>{inc.address}</span>
                          ) : inc.lat && inc.lng ? (
                            <span className="font-mono text-slate-400">
                              {inc.lat?.toFixed(5)}, {inc.lng?.toFixed(5)}
                            </span>
                          ) : (
                            <span className="text-slate-350">Sin coordenadas</span>
                          )}
                        </td>

                        {/* Date */}
                        <td className="px-5 py-4 text-slate-400 whitespace-nowrap">
                          {new Date(inc.createdAt).toLocaleDateString('es-PE', {
                            day: '2-digit', month: 'short', year: 'numeric',
                          })}
                        </td>

                        {/* Status */}
                        <td className="px-5 py-4">
                          {(isAdmin || user?.role === 'OPERATOR') ? (
                            <div className="relative inline-block text-left">
                              <select
                                value={inc.status}
                                onChange={(e) =>
                                  handleStatusChange(inc, e.target.value as IncidentStatus)
                                }
                                disabled={updatingId === inc.id}
                                className={`appearance-none text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 pr-8 rounded-full
                                  border border-slate-200 bg-white cursor-pointer focus:outline-none focus:border-slate-800
                                  disabled:opacity-50 transition-all ${status.cls}`}
                              >
                                {STATUS_ORDER.map((s) => (
                                  <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                                ))}
                              </select>
                              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-[10px]">▼</span>
                            </div>
                          ) : (
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${status.cls}`}>
                              {status.label}
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-5 py-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2.5">
                            <button
                              onClick={() => setSelectedIncident(inc)}
                              className="p-1.5 text-teal-600 hover:text-teal-800 bg-teal-50 hover:bg-teal-100 rounded transition-colors"
                              title="Ver detalle completo de la incidencia"
                            >
                              <Eye size={14} />
                            </button>

                            {inc.lat && inc.lng ? (
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${inc.lat},${inc.lng}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors inline-block"
                                title="Ver en Google Maps"
                              >
                                <MapPin size={14} />
                              </a>
                            ) : null}

                            {(isAdmin || user?.role === 'OPERATOR' || (user?.role === 'CITIZEN' && inc.status === 'OPEN' && inc.citizenId === user.id)) ? (
                              <>
                                <button
                                  onClick={() => openEditModal(inc)}
                                  className="p-1.5 text-slate-400 hover:text-amber-600 transition-colors"
                                  title="Editar"
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  onClick={() => handleDelete(inc.id)}
                                  className="p-1.5 text-slate-400 hover:text-red-600 transition-colors"
                                  title="Eliminar"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </>
                            ) : null}
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

      {/* Modal: Ver Detalle Completo de la Incidencia (Inspección para Admin / Operador / Ciudadano) */}
      {selectedIncident && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-100">
            {/* Header del Modal de Detalle */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-teal-500/20 text-teal-400 rounded-xl">
                  <FileText size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-black text-sm tracking-wider text-teal-300">
                      {selectedIncident.trackingCode}
                    </span>
                    <span className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full border ${STATUS_CONFIG[selectedIncident.status].cls}`}>
                      {STATUS_CONFIG[selectedIncident.status].label}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Registrada el {new Date(selectedIncident.createdAt).toLocaleString('es-PE', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedIncident(null)}
                className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-slate-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Contenido con Scroll */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Tarjeta de Ciudadano / Denunciante (Admin / Operador) */}
              {selectedIncident.citizen && (
                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4">
                  <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5">
                    <UserIcon size={14} className="text-teal-600" />
                    <span>Datos del Denunciante / Ciudadano</span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-slate-400 text-[11px] block">Nombre completo</span>
                      <span className="font-bold text-slate-800">
                        {selectedIncident.citizen.firstName} {selectedIncident.citizen.lastName}
                      </span>
                    </div>
                    {selectedIncident.citizen.dni && (
                      <div>
                        <span className="text-slate-400 text-[11px] block">DNI / Documento</span>
                        <span className="font-mono font-semibold text-slate-800">{selectedIncident.citizen.dni}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-slate-400 text-[11px] block flex items-center gap-1">
                        <Mail size={11} /> Email de contacto
                      </span>
                      <a href={`mailto:${selectedIncident.citizen.email}`} className="text-teal-700 hover:underline font-medium">
                        {selectedIncident.citizen.email}
                      </a>
                    </div>
                    {selectedIncident.citizen.phone && (
                      <div>
                        <span className="text-slate-400 text-[11px] block flex items-center gap-1">
                          <Phone size={11} /> Teléfono
                        </span>
                        <a href={`tel:${selectedIncident.citizen.phone}`} className="text-slate-800 hover:underline font-semibold">
                          {selectedIncident.citizen.phone}
                        </a>
                      </div>
                    )}
                    {selectedIncident.citizen.zone && (
                      <div className="col-span-1 sm:col-span-2">
                        <span className="text-slate-400 text-[11px] block">Zona registrada</span>
                        <span className="font-semibold text-slate-800">
                          {selectedIncident.citizen.zone.name} ({selectedIncident.citizen.zone.district})
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Detalle del Problema Reportado */}
              <div className="space-y-3">
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 block mb-1">
                    Tipo de Problema
                  </span>
                  <span className="inline-block bg-teal-50 border border-teal-200 text-teal-800 text-xs font-bold px-3 py-1 rounded-lg">
                    {INCIDENT_TYPE_LABELS[selectedIncident.type] ?? selectedIncident.type}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 block mb-1">
                    Descripción del Reporte
                  </span>
                  <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200/60 p-3.5 rounded-xl leading-relaxed whitespace-pre-wrap font-sans">
                    {selectedIncident.description}
                  </p>
                </div>
              </div>

              {/* Fotografía Adjunta */}
              {selectedIncident.imageUrl && (
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 block mb-2">
                    Evidencia Fotográfica
                  </span>
                  <div className="relative group overflow-hidden rounded-2xl border border-slate-200 max-h-72 bg-slate-950 flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={selectedIncident.imageUrl}
                      alt="Evidencia fotográfica de la incidencia"
                      className="w-full h-auto max-h-72 object-contain"
                    />
                    <a
                      href={selectedIncident.imageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-white font-bold text-xs"
                    >
                      <ExternalLink size={16} />
                      <span>Abrir imagen en alta resolución</span>
                    </a>
                  </div>
                </div>
              )}

              {/* Ubicación GPS y Mapa */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4">
                <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
                  <MapPin size={14} className="text-teal-600" />
                  <span>Ubicación de la Incidencia</span>
                </h4>
                {selectedIncident.address && (
                  <p className="text-xs font-semibold text-slate-800 mb-2">
                    {selectedIncident.address}
                  </p>
                )}
                {selectedIncident.lat && selectedIncident.lng ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-200/60">
                    <div className="text-xs font-mono text-slate-500">
                      Coordenadas GPS: <span className="font-bold text-slate-800">{selectedIncident.lat.toFixed(6)}, {selectedIncident.lng.toFixed(6)}</span>
                    </div>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${selectedIncident.lat},${selectedIncident.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm shrink-0"
                    >
                      <MapPin size={13} />
                      <span>Abrir en Google Maps</span>
                    </a>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">No se proporcionaron coordenadas GPS exactas.</p>
                )}
              </div>

              {/* Cambio de Estado Rápido para Admin / Operador */}
              {(isAdmin || user?.role === 'OPERATOR') && (
                <div className="bg-teal-50/70 border border-teal-200 rounded-2xl p-4">
                  <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-teal-800 mb-3 flex items-center gap-1.5">
                    <ShieldCheck size={14} className="text-teal-700" />
                    <span>Gestión de Estado (Atención Municipal)</span>
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {STATUS_ORDER.map((s) => {
                      const isActive = selectedIncident.status === s
                      return (
                        <button
                          key={s}
                          onClick={() => {
                            handleStatusChange(selectedIncident, s)
                            setSelectedIncident({ ...selectedIncident, status: s })
                          }}
                          disabled={updatingId === selectedIncident.id}
                          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                            isActive
                              ? 'bg-slate-900 text-white shadow-md'
                              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {isActive && <CheckCircle2 size={13} className="text-teal-400" />}
                          <span>{STATUS_CONFIG[s].label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Footer con Cierre */}
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs">
              <span className="text-slate-400 font-mono text-[11px]">ID: {selectedIncident.id}</span>
              <button
                onClick={() => setSelectedIncident(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold text-xs transition-all shadow-sm"
              >
                Cerrar Detalle
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Crear/Editar incidencia */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <h2 className="font-bold text-slate-900 text-xs tracking-wider uppercase">
                {editingIncident ? 'Editar incidencia' : 'Reportar incidencia'}
              </h2>
              <button 
                onClick={closeModal} 
                className="px-3 py-1.5 text-[10px] font-bold tracking-wider text-slate-400 hover:text-slate-900 uppercase transition-colors"
              >
                Cerrar
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
              {/* Fields Container (Scrollable) */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                {/* Type */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-450 uppercase tracking-wider mb-1.5">Tipo de incidencia *</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    required
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:border-slate-800 bg-white transition-colors"
                  >
                    {Object.entries(INCIDENT_TYPE_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-455 uppercase tracking-wider mb-1.5">
                    Descripción * <span className="font-normal text-slate-400">(mínimo 10 caracteres)</span>
                  </label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    required
                    rows={3}
                    placeholder="Describe el problema con el mayor detalle posible..."
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:border-slate-800 resize-none transition-colors"
                  />
                </div>

                {/* Status (Edit mode & Admin/Operator only) */}
                {editingIncident && (isAdmin || user?.role === 'OPERATOR') && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-455 uppercase tracking-wider mb-1.5">Estado *</label>
                    <select
                      value={(form as any).status || editingIncident.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value } as any)}
                      required
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:border-slate-800 bg-white transition-colors"
                    >
                      {STATUS_ORDER.map((s) => (
                        <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Location */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider">Ubicación</label>
                    <button
                      type="button"
                      onClick={useMyLocation}
                      disabled={geoLoading}
                      className="text-[10px] font-bold tracking-wider text-amber-700 hover:text-amber-900 uppercase transition-colors disabled:opacity-50"
                    >
                      {geoLoading ? 'Obteniendo GPS...' : 'Usar mi ubicación GPS'}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder="Dirección o referencia (Ej: Av. El Sol 123)"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:border-slate-800 mb-2 transition-colors"
                  />
                  {(form.lat || form.lng) && (
                    <p className="text-[10px] text-slate-400 font-mono">
                      Coordenadas: {form.lat}, {form.lng}
                    </p>
                  )}
                </div>

                {/* Image upload */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-455 uppercase tracking-wider mb-1.5">
                    Foto <span className="font-normal text-slate-400">(opcional, máx. 500 KB)</span>
                  </label>
                  {imagePreview ? (
                    <div className="relative rounded overflow-hidden border border-slate-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imagePreview} alt="Preview" className="w-full max-h-40 object-cover" />
                      <button
                        type="button"
                        onClick={removeImage}
                        className="absolute top-2 right-2 px-2.5 py-1 bg-white/95 rounded border border-slate-250 text-red-600 hover:text-red-700 text-[10px] font-bold tracking-wider uppercase transition-colors"
                        title="Eliminar imagen"
                      >
                        Quitar foto
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center gap-1.5 w-full h-24
                      border border-dashed border-slate-300 rounded cursor-pointer
                      hover:border-slate-850 hover:bg-slate-50 transition-colors">
                      <span className="text-[11px] font-bold tracking-wider text-slate-550 uppercase">Adjuntar foto</span>
                      <span className="text-[9px] text-slate-400 uppercase tracking-wider">Haga clic para seleccionar archivo</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageSelect}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>

                {/* Advertencia Ético-Legal y Consentimiento (Create mode only) */}
                {!editingIncident && (
                  <>
                    {/* Advertencia Ético-Legal (Privacidad) */}
                    <div className="bg-slate-50 border border-slate-200 rounded p-4 text-[10px] text-slate-650 leading-relaxed">
                      <span className="font-bold uppercase tracking-wider text-slate-900 block mb-1">Aviso de Privacidad (Ley N.º 29733):</span>
                      Al capturar la fotografía, evite registrar rostros de personas o placas de vehículos ajenos para proteger los datos personales de terceros.
                    </div>

                    {/* Consentimiento obligatorio */}
                    <div className="flex items-start gap-3 pt-3 border-t border-slate-100">
                      <input
                        type="checkbox"
                        id="termsConsent"
                        required
                        className="mt-1 h-4 w-4 text-amber-600 border-slate-350 rounded focus:ring-amber-500 cursor-pointer accent-amber-600"
                      />
                      <label htmlFor="termsConsent" className="text-[10px] text-slate-550 select-none leading-relaxed cursor-pointer font-medium">
                        Doy mi consentimiento para el tratamiento de mis datos personales y autorizo el acceso a mi ubicación GPS con el único fin de procesar esta incidencia conforme a la <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-amber-700 hover:text-amber-900 hover:underline font-bold inline-flex items-center gap-1">Política de Privacidad<svg className="w-3 h-3 inline-block shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg><span className="sr-only">(se abre en una nueva pestaña)</span></a> de la Ley N.º 29733. *
                      </label>
                    </div>
                  </>
                )}
              </div>

              {/* Footer (Fixed) */}
              <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3 shrink-0 bg-slate-50">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-xs font-bold tracking-wider text-slate-650 border border-slate-200 bg-white rounded hover:bg-slate-50 uppercase transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || uploadingImage}
                  className="inline-flex items-center justify-center px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white text-xs font-bold tracking-wider uppercase rounded transition-colors shadow-sm"
                >
                  {saving || uploadingImage ? (
                    <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin mr-2" />
                  ) : null}
                  {uploadingImage ? 'Subiendo...' : saving ? 'Guardando...' : editingIncident ? 'Guardar cambios' : 'Enviar reporte'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </ZoneGuard>
  )
}

export default function IncidentsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Cargando incidencias...</div>}>
      <IncidentsPageContent />
    </Suspense>
  )
}
