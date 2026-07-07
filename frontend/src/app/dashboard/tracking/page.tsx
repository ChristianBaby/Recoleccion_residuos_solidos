'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/lib/api'
import { getSocket } from '@/lib/socket'
import type { ApiResponse, Route, Zone, Waypoint } from '@/types'
import type { TruckPosition } from '@/components/LeafletTrackingMap'
import {
  Radio, Square, Navigation, Wifi, WifiOff, MapPin, Clock,
  AlertCircle, X, CheckCircle2, Circle, TriangleAlert, Truck
} from 'lucide-react'
import { toast } from 'sonner'
import ZoneGuard from '@/components/ZoneGuard'
import type { RouteOverlay } from '@/components/LeafletTrackingMap'

const LeafletTrackingMap = dynamic(() => import('@/components/LeafletTrackingMap'), { ssr: false })

// === Helpers ==================================================================

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const WAYPOINT_VISIT_RADIUS = 50 // metres

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab']

// RF-18: categorias oficiales NTP 900.058 para el registro de pesaje
const COLLECTION_CATEGORIES = [
  { key: 'ORGANIC', label: 'Organico', color: '#92400e' },
  { key: 'RECYCLABLE', label: 'Reciclable', color: '#15803d' },
  { key: 'NON_RECYCLABLE', label: 'No reciclable', color: '#334155' },
  { key: 'HAZARDOUS', label: 'Peligroso', color: '#b91c1c' },
] as const

// === Page =====================================================================

export default function TrackingPage() {
  const { user, accessToken } = useAuth()
  const [zones, setZones] = useState<Zone[]>([])
  const [trucks, setTrucks] = useState<TruckPosition[]>([])
  const [myPosition, setMyPosition] = useState<{ lat: number; lng: number } | null>(null)
  const [isTracking, setIsTracking] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [selectedRouteId, setSelectedRouteId] = useState('')
  const [myRoutes, setMyRoutes] = useState<Route[]>([])
  const [selectedRouteDetail, setSelectedRouteDetail] = useState<Route | null>(null)
  const [visitedWaypoints, setVisitedWaypoints] = useState(new Set<string>())
  const [selectedZoneId, setSelectedZoneId] = useState('')
  const [ownSocketId, setOwnSocketId] = useState<string | undefined>()
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null)
  const watchIdRef = useRef<number | null>(null)
  const isTrackingRef = useRef(false)
  const wakeLockRef = useRef<any>(null)

  // idle GPS - operator's position before tracking starts
  const [idlePosition, setIdlePosition] = useState<{ lat: number; lng: number } | null>(null)

  // start-position warning
  const [showStartWarning, setShowStartWarning] = useState(false)
  const [distanceToStart, setDistanceToStart] = useState(0)
  const [startWaypointName, setStartWaypointName] = useState('')

  // RF-13
  const [showDelayModal, setShowDelayModal] = useState(false)
  const [delayMinutes, setDelayMinutes] = useState(20)
  const [delayReason, setDelayReason] = useState('')
  const [activeTab, setActiveTab] = useState<'panel' | 'map'>('map')
  const [delayReported, setDelayReported] = useState(false)
  const [mapCenterTrigger, setMapCenterTrigger] = useState<{ lat: number; lng: number; time: number } | null>(null)

  // RF-18: registro de cantidades recolectadas al cierre de ruta
  const [executionId, setExecutionId] = useState<string | null>(null)
  const [showCollectionModal, setShowCollectionModal] = useState(false)
  const [collectionKg, setCollectionKg] = useState<Record<string, string>>({})
  const [savingCollection, setSavingCollection] = useState(false)

  const todayDay = new Date().getDay() // 0=Dom ... 6=Sab

  // --- Load zones + operator routes ------------------------------------------
  useEffect(() => {
    if (!accessToken) return
    const getZones = api.get as (endpoint: string, token?: string) => Promise<ApiResponse<Zone[]>>
    getZones('/zones', accessToken).then((r) => setZones(r.data ?? []))

    if (user?.role === 'OPERATOR') {
      const getRoutes = api.get as (endpoint: string, token?: string) => Promise<ApiResponse<Route[]>>
      getRoutes('/routes', accessToken).then((r) => {
        const mine = (r.data ?? []).filter(
          (route) => route.operatorId === user.id && route.status === 'ACTIVE',
        )
        setMyRoutes(mine)
        // auto-select today's route if exactly one
        const todayRoutes = mine.filter((r) => r.dayOfWeek.includes(todayDay))
        if (todayRoutes.length === 1) setSelectedRouteId(todayRoutes[0].id)
      })
    }
  }, [accessToken, user?.id, user?.role, todayDay])

  // --- Auto-select citizen's assigned zone on mount ---
  useEffect(() => {
    if (user?.role === 'CITIZEN' && user?.zoneId) {
      setSelectedZoneId(user.zoneId)
    }
  }, [user?.role, user?.zoneId])

  // --- Load full route detail (with waypoints) when operator selects a route ---
  useEffect(() => {
    if (!accessToken || !selectedRouteId) {
      const timer = window.setTimeout(() => setSelectedRouteDetail(null), 0)
      return () => window.clearTimeout(timer)
    }
    let cancelled = false
    const getRouteDetail = api.get as (endpoint: string, token?: string) => Promise<ApiResponse<Route>>
    getRouteDetail(`/routes/${selectedRouteId}`, accessToken)
      .then((r) => {
        if (!cancelled) setSelectedRouteDetail(r.data ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [accessToken, selectedRouteId])

  // --- Get idle GPS position for OPERATOR (so they can see themselves on the map before pressing Iniciar ruta)
  useEffect(() => {
    if (user?.role !== 'OPERATOR') return
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setIdlePosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* GPS not available - silently ignore */ },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }, [user?.role])

  // --- Mark waypoints visited when position changes ---------------------------
  useEffect(() => {
    if (!myPosition || !selectedRouteDetail?.waypoints || !isTracking) return
    const timer = window.setTimeout(() => {
      const { lat, lng } = myPosition
      const wps = selectedRouteDetail.waypoints ?? []
      const updates = new Set(visitedWaypoints)
      let changed = false
      for (const wp of wps) {
        if (!updates.has(wp.id) && haversineMeters(lat, lng, wp.lat, wp.lng) <= WAYPOINT_VISIT_RADIUS) {
          updates.add(wp.id)
          changed = true
        }
      }
      if (changed) setVisitedWaypoints(new Set(updates))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [myPosition, selectedRouteDetail, isTracking]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Socket setup ----------------------------------------------------------
  useEffect(() => {
    if (!accessToken) return
    const socket = getSocket(accessToken)
    socketRef.current = socket

    function onConnect() { setIsConnected(true); setOwnSocketId(socket.id ?? undefined) }
    function onDisconnect() { setIsConnected(false) }
    function onTrucks(data: TruckPosition[]) { setTrucks(data) }
    function onTruckUpdate(truck: TruckPosition) {
      setTrucks((prev) => {
        const idx = prev.findIndex((t) => t.socketId === truck.socketId)
        if (idx >= 0) { const next = [...prev]; next[idx] = truck; return next }
        return [...prev, truck]
      })
    }
    function onTruckRemoved({ socketId }: { socketId: string }) {
      setTrucks((prev) => prev.filter((t) => t.socketId !== socketId))
    }
    function onDelayReported() {
      setDelayReported(true)
      setShowDelayModal(false)
      toast.success('Retraso notificado a los ciudadanos de la zona.')
    }

    // RF-18: capturar el executionId de la ejecucion creada al iniciar la ruta
    function onTrackingStarted({ executionId: execId }: { executionId?: string | null }) {
      setExecutionId(execId ?? null)
    }

    function onProximityAlert({ vehicleCode, distance }: { vehicleCode: string; distance: number }) {
      const distText = distance >= 1000
        ? `${(distance / 1000).toFixed(1)} km`
        : `${distance} m`
      toast('El camion esta cerca', {
        description: `Vehiculo ${vehicleCode} a ${distText} de tu domicilio. Prepara tus residuos.`,
        duration: 30000,
      })
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('tracking:trucks', onTrucks)
    socket.on('tracking:truck_update', onTruckUpdate)
    socket.on('tracking:truck_removed', onTruckRemoved)
    socket.on('tracking:delay_reported', onDelayReported)
    socket.on('tracking:started', onTrackingStarted)
    socket.on('proximity:alert', onProximityAlert)
    const timer = window.setTimeout(() => {
      if (socket.connected) {
        setIsConnected(true)
        setOwnSocketId(socket.id ?? undefined)
      }
    }, 0)

    return () => {
      window.clearTimeout(timer)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('tracking:trucks', onTrucks)
      socket.off('tracking:truck_update', onTruckUpdate)
      socket.off('tracking:truck_removed', onTruckRemoved)
      socket.off('tracking:delay_reported', onDelayReported)
      socket.off('tracking:started', onTrackingStarted)
      socket.off('proximity:alert', onProximityAlert)
    }
  }, [accessToken])

  // --- Citizen zone subscription --------------------------------------------
  useEffect(() => {
    if (user?.role === 'CITIZEN' && user.zoneId && !selectedZoneId) {
      const timer = window.setTimeout(() => setSelectedZoneId(user.zoneId!), 0)
      return () => window.clearTimeout(timer)
    }
  }, [user?.zoneId, user?.role, selectedZoneId])

  useEffect(() => {
    const socket = socketRef.current
    if (!socket || !isConnected || user?.role !== 'CITIZEN') return
    const zoneToSubscribe = selectedZoneId
    if (zoneToSubscribe) socket.emit('tracking:subscribe', { zoneId: zoneToSubscribe })
    else socket.emit('tracking:all')
  }, [selectedZoneId, isConnected, user?.role])

  useEffect(() => {
    const socket = socketRef.current
    if (!socket || !isConnected || user?.role !== 'ADMIN') return
    socket.emit('tracking:all')
  }, [isConnected, user?.role])

  // Adquirir bloqueo de pantalla para evitar suspensión en móviles
  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator.wakeLock as any).request('screen')
        console.log('✅ Wake Lock activado: pantalla encendida')
      }
    } catch (err) {
      console.warn('⚠️ No se pudo activar Wake Lock:', err)
    }
  }, [])

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().then(() => {
        wakeLockRef.current = null
        console.log('❌ Wake Lock liberado')
      }).catch(() => {})
    }
  }, [])

  const startWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, speed } = pos.coords
        setMyPosition({ lat: latitude, lng: longitude })
        setIdlePosition(null)
        socketRef.current?.emit('tracking:position', {
          lat: latitude, lng: longitude,
          speed: speed != null ? speed * 3.6 : undefined,
        })
      },
      (err) => {
        console.warn('[GPS] Error en watchPosition:', err.message)
        // Reinicio automático en caso de pérdida temporal de señal (TIMEOUT / POSITION_UNAVAILABLE)
        if (isTrackingRef.current) {
          console.log('[GPS] Reiniciando watchPosition por error temporal...')
          setTimeout(() => {
            if (isTrackingRef.current) startWatch()
          }, 2000)
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  }, [])

  // --- Internal: begin GPS watch + emit tracking:start ----------------------
  const beginTracking = useCallback(() => {
    const socket = socketRef.current
    if (!socket) return
    socket.emit('tracking:start', { routeId: selectedRouteId || undefined })
    setIsTracking(true)
    isTrackingRef.current = true
    setVisitedWaypoints(new Set())
    setShowStartWarning(false)

    requestWakeLock()
    startWatch()
  }, [selectedRouteId, requestWakeLock, startWatch])

  // --- GPS start - checks proximity to first waypoint first -----------------
  const startTracking = useCallback(() => {
    const sortedWps = [...(selectedRouteDetail?.waypoints ?? [])].sort(
      (a, b) => a.order - b.order,
    )
    const firstWp = sortedWps[0]
    const pos = idlePosition

    if (firstWp && pos) {
      const dist = haversineMeters(pos.lat, pos.lng, firstWp.lat, firstWp.lng)
      if (dist > 500) {
        setDistanceToStart(Math.round(dist))
        setStartWaypointName(firstWp.name ?? `Parada 1`)
        setShowStartWarning(true)
        return
      }
    }
    beginTracking()
  }, [idlePosition, selectedRouteDetail, beginTracking])

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    releaseWakeLock()
    socketRef.current?.emit('tracking:stop')
    setIsTracking(false)
    isTrackingRef.current = false
    setMyPosition(null)
    // RF-18: al cerrar la ruta, pedir al operador las cantidades recolectadas
    if (executionId && user?.role === 'OPERATOR') {
      setCollectionKg({})
      setShowCollectionModal(true)
    }
  }, [executionId, user?.role, releaseWakeLock])

  // RF-18: enviar las cantidades declaradas al backend
  const submitCollection = useCallback(async () => {
    if (!executionId || !accessToken) return
    const items = COLLECTION_CATEGORIES
      .map((c) => ({ category: c.key, quantityKg: parseFloat(collectionKg[c.key] ?? '') }))
      .filter((i) => !Number.isNaN(i.quantityKg) && i.quantityKg >= 0)
    if (items.length === 0) {
      toast.warning('Ingresa al menos una cantidad o pulsa Omitir.')
      return
    }
    setSavingCollection(true)
    try {
      await api.post(`/routes/executions/${executionId}/collection`, { items }, accessToken)
      toast.success('Cantidades recolectadas registradas. Gracias por reportar.')
      setShowCollectionModal(false)
      setExecutionId(null)
    } catch {
      toast.error('No se pudo registrar el pesaje. Intenta de nuevo.')
    } finally {
      setSavingCollection(false)
    }
  }, [executionId, accessToken, collectionKg])

  const skipCollection = useCallback(() => {
    setShowCollectionModal(false)
    setExecutionId(null)
    toast.warning('Ruta cerrada sin datos de pesaje: el reporte de residuos no reflejara esta ejecucion.')
  }, [])

  const handleCenterOnTruck = useCallback((lat: number, lng: number) => {
    setMapCenterTrigger({ lat, lng, time: Date.now() })
    setActiveTab('map')
  }, [])

  const submitDelay = useCallback(() => {
    const socket = socketRef.current
    if (!socket) return
    socket.emit('tracking:report_delay', { delayMinutes, reason: delayReason.trim() || undefined })
  }, [delayMinutes, delayReason])

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
      if (isTrackingRef.current) socketRef.current?.emit('tracking:stop')
      releaseWakeLock()
    }
  }, [releaseWakeLock])

  // --- Derived state --------------------------------------------------------
  const todayRoutes = myRoutes.filter((r) => r.dayOfWeek.includes(todayDay))
  const otherRoutes = myRoutes.filter((r) => !r.dayOfWeek.includes(todayDay))
  const selectedRoute = myRoutes.find((r) => r.id === selectedRouteId) ?? null
  const waypoints: Waypoint[] = [...(selectedRouteDetail?.waypoints ?? [])].sort(
    (a, b) => a.order - b.order,
  )
  const visitedCount = waypoints.filter((wp) => visitedWaypoints.has(wp.id)).length
  const progressPct = waypoints.length > 0 ? Math.round((visitedCount / waypoints.length) * 100) : 0

  const routeOverlay: RouteOverlay | null = selectedRouteDetail && waypoints.length > 0
    ? {
        routeId: selectedRouteDetail.id,
        waypoints,
        zoneColor: selectedRoute?.zone?.color ?? '#2563eb',
        visitedIds: visitedWaypoints,
      }
    : null

  const mapSelectedZoneId = user?.role === 'CITIZEN'
    ? selectedZoneId
    : selectedRoute?.zoneId ?? undefined

  return (
    <ZoneGuard role={user?.role ?? ''} zoneId={user?.zoneId}>
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Rastreo en tiempo real</h1>
          <p className="text-xs text-slate-500 mt-0.5">Seguimiento GPS de camiones de recoleccion</p>
        </div>
        <div className={`flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full ${
          isConnected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
        }`}>
          {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
          {isConnected ? 'Conectado' : 'Desconectado'}
        </div>
      </div>

      {/* Mobile tabs */}
      <div className="flex md:hidden border-b border-slate-200 bg-white shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('panel')}
          className={`flex-1 py-3 text-center text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
            activeTab === 'panel'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-400'
          }`}
        >
          {user?.role === 'OPERATOR' ? 'Paradas / Control' : 'Camiones / Filtros'}
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
          Mapa de Rastreo
        </button>
      </div>

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">

        {/* --- OPERATOR PANEL ---------------------------------------------- */}
        {user?.role === 'OPERATOR' && (
          <div className={`w-full md:w-80 md:border-r border-slate-200 bg-white flex flex-col shrink-0 overflow-auto md:block ${
            activeTab === 'panel' ? 'block h-full' : 'hidden'
          }`}>

            {/* Today's route card */}
            <div className="p-4 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                {DAY_NAMES[todayDay]} - Rutas de hoy
              </p>

              {todayRoutes.length === 0 ? (
                <div className="bg-slate-50 rounded-xl p-4 text-center">
                  <p className="text-xs text-slate-400">No tienes rutas programadas para hoy.</p>
                </div>
              ) : (
                todayRoutes.map((route) => {
                  const isSelected = selectedRouteId === route.id
                  const zoneColor = route.zone?.color ?? '#2563eb'
                  return (
                    <button
                      key={route.id}
                      onClick={() => !isTracking && setSelectedRouteId(route.id)}
                      disabled={isTracking && !isSelected}
                      className={`w-full text-left rounded-xl p-3.5 border-2 transition-all mb-2
                        ${isSelected
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-transparent bg-slate-50 hover:bg-slate-100'
                        } disabled:opacity-50`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="w-3 h-3 rounded-full mt-0.5 shrink-0"
                          style={{ backgroundColor: zoneColor }} />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-slate-900 leading-tight">
                            {route.name}
                          </p>
                          {route.zone && (
                            <p className="text-xs text-slate-500 mt-0.5">{route.zone.name}</p>
                          )}
                          <div className="flex items-center gap-3 mt-1.5">
                            {route.startTime && (
                              <span className="flex items-center gap-1 text-xs text-slate-500">
                                <Clock size={10} /> {route.startTime}
                              </span>
                            )}
                            {route._count && (
                              <span className="flex items-center gap-1 text-xs text-slate-500">
                                <MapPin size={10} /> {route._count.waypoints} paradas
                              </span>
                            )}
                          </div>
                        </div>
                        {isSelected && (
                          <CheckCircle2 size={16} className="text-blue-600 shrink-0" />
                        )}
                      </div>
                    </button>
                  )
                })
              )}

              {/* Other routes on other days */}
              {otherRoutes.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-slate-400 mb-1.5">Otras rutas asignadas</p>
                  <select
                    value={todayRoutes.length > 0 ? '' : selectedRouteId}
                    onChange={(e) => setSelectedRouteId(e.target.value)}
                    disabled={isTracking}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs
                      focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50
                      bg-white text-slate-600"
                  >
                    <option value="">Seleccionar otra ruta...</option>
                    {otherRoutes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} - {r.dayOfWeek.map((d) => DAY_NAMES[d]).join(', ')}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Start / Stop buttons */}
            <div className="p-4 border-b border-slate-100 space-y-3">
              {isTracking ? (
                <button
                  onClick={stopTracking}
                  className="flex items-center justify-center gap-2 w-full bg-red-600
                    hover:bg-red-700 text-white rounded-xl py-3 text-sm font-semibold transition-colors"
                >
                  <Square size={14} /> Finalizar ruta
                </button>
              ) : (
                <button
                  onClick={startTracking}
                  disabled={!isConnected}
                  className="flex items-center justify-center gap-2 w-full bg-emerald-600
                    hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl py-3
                    text-sm font-semibold transition-colors"
                >
                  <Radio size={14} />
                  {selectedRouteId ? 'Iniciar ruta' : 'Iniciar (sin ruta)'}
                </button>
              )}

              {isTracking && myPosition && (
                <div className="bg-emerald-50 rounded-lg px-3 py-2.5 text-xs text-emerald-800 space-y-0.5">
                  <p className="font-semibold flex items-center gap-1.5">
                    <Navigation size={11} className="text-emerald-600" /> Transmitiendo posicion
                  </p>
                  <p className="font-mono text-emerald-600">
                    {myPosition.lat.toFixed(5)}, {myPosition.lng.toFixed(5)}
                  </p>
                </div>
              )}

              {/* RF-13 */}
              {isTracking && (
                <button
                  onClick={() => { setShowDelayModal(true); setDelayReported(false) }}
                  className="flex items-center justify-center gap-2 w-full border border-amber-300
                    bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg py-2 text-xs
                    font-medium transition-colors"
                >
                  <Clock size={13} /> Reportar retraso
                </button>
              )}

              {delayReported && (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50
                  border border-amber-200 rounded-lg px-3 py-2">
                  <AlertCircle size={13} /> Retraso notificado a la zona
                </div>
              )}
            </div>

            {/* Waypoint progress */}
            {selectedRouteId && waypoints.length > 0 && (
              <div className="p-4 flex-1 overflow-auto">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                    Progreso de paradas
                  </p>
                  <span className="text-xs font-semibold text-blue-600">
                    {visitedCount}/{waypoints.length}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="h-1.5 bg-slate-100 rounded-full mb-3 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>

                <ol className="space-y-1.5">
                  {waypoints.map((wp, idx) => {
                    const visited = visitedWaypoints.has(wp.id)
                    const routeColor = selectedRoute?.zone?.color ?? '#2563eb'
                    const dotColor = idx === 0 ? '#16a34a'
                      : idx === waypoints.length - 1 ? '#dc2626'
                      : routeColor
                    return (
                      <li key={wp.id}
                        className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-colors
                          ${visited ? 'bg-emerald-50' : 'bg-slate-50'}`}>
                        {visited ? (
                          <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                        ) : (
                          <div
                            className="w-4 h-4 rounded-full border-2 shrink-0 flex items-center
                              justify-center text-white text-xs font-bold"
                            style={{ borderColor: dotColor, backgroundColor: isTracking ? 'transparent' : 'transparent' }}
                          >
                            <Circle size={10} style={{ color: dotColor }} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium truncate ${
                            visited ? 'text-emerald-700 line-through opacity-60' : 'text-slate-700'
                          }`}>
                            {wp.name || `Parada ${wp.order}`}
                          </p>
                          {wp.estimatedTime && (
                            <p className="text-xs text-slate-400">⏱ {wp.estimatedTime}</p>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </div>
            )}
          </div>
        )}

        {/* --- CITIZEN PANEL ----------------------------------------------- */}
        {user?.role === 'CITIZEN' && (
          <div className={`w-full md:w-64 md:border-r border-slate-200 bg-white flex flex-col p-4 gap-4 shrink-0 md:block ${
            activeTab === 'panel' ? 'block h-full' : 'hidden'
          }`}>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1.5 block">
                <MapPin size={12} className="inline mr-1" /> Zona a monitorear
              </label>
              <select
                value={selectedZoneId}
                onChange={(e) => setSelectedZoneId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm
                  focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">Todas las zonas</option>
                {zones.filter((z) => z.isActive).map((z) => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
            </div>

            <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700 leading-relaxed">
              Selecciona tu zona para ver los camiones de recoleccion en tiempo real.
            </div>

            {trucks.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-slate-500 mb-2">
                  Camiones activos ({trucks.length})
                </p>
                <div className="space-y-1.5">
                  {trucks.map((t) => (
                    <button key={t.socketId}
                      onClick={() => handleCenterOnTruck(t.lat, t.lng)}
                      title="Centrar mapa en este vehículo"
                      className="w-full text-left flex items-center gap-2.5 p-2.5 bg-slate-50 hover:bg-blue-50/50 active:scale-[0.98] border border-slate-100 hover:border-blue-200 rounded-lg transition-all">
                      <Truck size={14} className="text-blue-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{t.vehicleCode || t.operatorName}</p>
                        <p className="text-[10px] text-slate-450 mt-0.5">
                          Última señal: {new Date(t.lastSeen).toLocaleTimeString('es-PE')}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 text-center">No hay camiones activos en esta zona</p>
            )}
          </div>
        )}

        {/* --- ADMIN PANEL ------------------------------------------------- */}
        {user?.role === 'ADMIN' && trucks.length > 0 && (
          <div className={`w-full md:w-64 md:border-r border-slate-200 bg-white flex flex-col p-4 gap-3 shrink-0 overflow-auto md:block ${
            activeTab === 'panel' ? 'block h-full' : 'hidden'
          }`}>
            <p className="text-xs font-semibold text-slate-600">Camiones activos ({trucks.length})</p>
            {trucks.map((t) => (
              <button key={t.socketId}
                onClick={() => handleCenterOnTruck(t.lat, t.lng)}
                title="Centrar mapa en este vehículo"
                className="w-full text-left flex items-start gap-2.5 p-2.5 bg-slate-50 hover:bg-blue-50/50 active:scale-[0.98] border border-slate-100 hover:border-blue-200 rounded-lg transition-all">
                <Truck size={14} className="text-blue-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-800 truncate">{t.vehicleCode || t.operatorName}</p>
                  {t.speed !== undefined && (
                    <p className="text-[10px] text-slate-500 mt-0.5">{Math.round(t.speed)} km/h</p>
                  )}
                  <p className="text-[10px] text-slate-450 mt-0.5">
                    Última señal: {new Date(t.lastSeen).toLocaleTimeString('es-PE')}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* --- Map ---------------------------------------------------------- */}
        <div className={`flex-1 relative md:block ${
          activeTab === 'map' ? 'block h-full' : 'hidden'
        }`}>
          <LeafletTrackingMap
            zones={zones}
            trucks={trucks}
            myPosition={myPosition}
            idlePosition={idlePosition}
            ownSocketId={ownSocketId}
            routeOverlay={routeOverlay}
            isTracking={isTracking}
            selectedZoneId={mapSelectedZoneId}
            centerCoordinates={mapCenterTrigger}
          />
          {/* Map legend for operator */}
          {user?.role === 'OPERATOR' && routeOverlay && (
            <div className="absolute bottom-4 right-4 z-[1000] bg-white rounded-xl shadow-lg
              border border-slate-200 px-3 py-2.5 space-y-1.5 text-xs hidden md:block">
              <p className="font-semibold text-slate-600 uppercase tracking-wide text-xs mb-2">
                Leyenda
              </p>
              <div className="flex items-center gap-2 text-slate-600">
                <div className="w-4 h-4 rounded-full bg-green-600 shrink-0" /> Inicio
              </div>
              <div className="flex items-center gap-2 text-slate-600">
                <div className="w-4 h-4 rounded-full bg-red-600 shrink-0" /> Final
              </div>
              <div className="flex items-center gap-2 text-slate-600">
                <div className="w-4 h-4 rounded-full bg-emerald-100 border-2 border-emerald-400 shrink-0 flex items-center justify-center text-emerald-600 font-bold" style={{fontSize:'8px'}}>OK</div>
                Visitada
              </div>
              {isTracking ? (
                <div className="flex items-center gap-2 text-slate-600">
                  <div className="w-4 h-4 rounded-full bg-blue-500 shrink-0" /> Mi posicion
                </div>
              ) : (
                <div className="flex items-center gap-2 text-slate-600">
                  <div className="w-4 h-4 rounded-full bg-blue-500 shrink-0" /> Mi ubicacion
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Start-position warning modal */}
      {showStartWarning && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
                <TriangleAlert size={20} className="text-amber-500" />
              </div>
              <div>
                <h2 className="font-semibold text-slate-900">Lejos del inicio de la ruta</h2>
                <p className="text-xs text-slate-500 mt-0.5">Verifica tu posicion antes de iniciar</p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-amber-700 font-medium">Distancia al inicio</span>
                <span className="text-sm font-bold text-amber-800">
                  {distanceToStart >= 1000
                    ? `${(distanceToStart / 1000).toFixed(1)} km`
                    : `${distanceToStart} m`}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-amber-700 font-medium">Punto de inicio</span>
                <span className="text-xs text-amber-800 font-medium max-w-[160px] text-right truncate">
                  {startWaypointName}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-500 mb-5 leading-relaxed">
              Tu posicion actual esta a mas de 500 m del inicio de la ruta.
              Dirigete al punto de partida o inicia de todos modos si ya te encuentras en ruta.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowStartWarning(false)}
                className="flex-1 border border-slate-200 rounded-xl py-2.5 text-sm
                  text-slate-600 hover:bg-slate-50 transition-colors font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={beginTracking}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white rounded-xl
                  py-2.5 text-sm font-semibold transition-colors"
              >
                Iniciar de todos modos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RF-13 delay modal */}
      {showDelayModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Clock size={16} className="text-amber-500" /> Reportar retraso
              </h2>
              <button onClick={() => setShowDelayModal(false)}
                className="p-1 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={16} className="text-slate-400" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">
                  Minutos de retraso
                </label>
                <input type="number" min={1} max={240} value={delayMinutes}
                  onChange={(e) => setDelayMinutes(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">
                  Motivo (opcional)
                </label>
                <input type="text" placeholder="Ej: Trafico, falla mecanica..."
                  value={delayReason} onChange={(e) => setDelayReason(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <p className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2">
                Los ciudadanos de tu zona recibiran una notificacion inmediata.
              </p>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowDelayModal(false)}
                  className="flex-1 border border-slate-200 rounded-lg py-2 text-sm
                    text-slate-600 hover:bg-slate-50 transition-colors">
                  Cancelar
                </button>
                <button onClick={submitDelay}
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg
                    py-2 text-sm font-semibold transition-colors">
                  Notificar retraso
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* RF-18: collection weights modal */}
      {showCollectionModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Truck size={16} className="text-emerald-600" /> Registro de recoleccion
              </h2>
              <button onClick={skipCollection}
                className="p-1 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={16} className="text-slate-400" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Ingresa los kilogramos aproximados recolectados por categoria.
              Estos datos alimentan los reportes municipales.
            </p>
            <div className="space-y-3">
              {COLLECTION_CATEGORIES.map((c) => (
                <div key={c.key} className="flex items-center gap-3">
                  <span
                    className="w-28 shrink-0 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider text-white text-center"
                    style={{ backgroundColor: c.color }}
                  >
                    {c.label}
                  </span>
                  <div className="flex-1 relative">
                    <input
                      type="number" min={0} step={0.5} placeholder="0"
                      value={collectionKg[c.key] ?? ''}
                      onChange={(e) => setCollectionKg((prev) => ({ ...prev, [c.key]: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 pr-9 text-sm
                        focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">kg</span>
                  </div>
                </div>
              ))}
              <p className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2">
                Puedes dejar en blanco las categorias que no apliquen a tu ruta.
              </p>
              <div className="flex gap-2 pt-1">
                <button onClick={skipCollection} disabled={savingCollection}
                  className="flex-1 border border-slate-200 rounded-lg py-2 text-sm
                    text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50">
                  Omitir
                </button>
                <button onClick={submitCollection} disabled={savingCollection}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg
                    py-2 text-sm font-semibold transition-colors disabled:opacity-50">
                  {savingCollection ? 'Guardando...' : 'Guardar pesaje'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </ZoneGuard>
  )
}
