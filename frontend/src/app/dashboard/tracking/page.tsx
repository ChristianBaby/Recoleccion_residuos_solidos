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
  AlertCircle, X, CheckCircle2, Circle, TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import ZoneGuard from '@/components/ZoneGuard'
import type { RouteOverlay } from '@/components/LeafletTrackingMap'

const LeafletTrackingMap = dynamic(() => import('@/components/LeafletTrackingMap'), { ssr: false })

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const WAYPOINT_VISIT_RADIUS = 50 // metres

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

// ─── Page ─────────────────────────────────────────────────────────────────────

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

  // idle GPS — operator's position before tracking starts
  const [idlePosition, setIdlePosition] = useState<{ lat: number; lng: number } | null>(null)

  // start-position warning
  const [showStartWarning, setShowStartWarning] = useState(false)
  const [distanceToStart, setDistanceToStart] = useState(0)
  const [startWaypointName, setStartWaypointName] = useState('')

  // RF-13
  const [showDelayModal, setShowDelayModal] = useState(false)
  const [delayMinutes, setDelayMinutes] = useState(20)
  const [delayReason, setDelayReason] = useState('')
  const [delayReported, setDelayReported] = useState(false)

  const todayDay = new Date().getDay() // 0=Dom … 6=Sáb

  // ── Load zones + operator routes ──────────────────────────────────────────
  useEffect(() => {
    if (!accessToken) return
    api.get<ApiResponse<Zone[]>>('/zones', accessToken).then((r) => setZones(r.data ?? []))

    if (user?.role === 'OPERATOR') {
      api.get<ApiResponse<Route[]>>('/routes', accessToken).then((r) => {
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

  // ── Load full route detail (with waypoints) when operator selects a route ──
  useEffect(() => {
    if (!accessToken || !selectedRouteId) {
      setSelectedRouteDetail(null)
      return
    }
    api.get<ApiResponse<Route>>(`/routes/${selectedRouteId}`, accessToken)
      .then((r) => setSelectedRouteDetail(r.data ?? null))
      .catch(() => {})
  }, [accessToken, selectedRouteId])

  // ── Get idle GPS position for OPERATOR (so they can see themselves on the map
  //    before pressing "Iniciar ruta" and for the proximity check) ─────────────
  useEffect(() => {
    if (user?.role !== 'OPERATOR') return
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setIdlePosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* GPS not available — silently ignore */ },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }, [user?.role])

  // ── Mark waypoints visited when position changes ───────────────────────────
  useEffect(() => {
    if (!myPosition || !selectedRouteDetail?.waypoints || !isTracking) return
    const { lat, lng } = myPosition
    const wps = selectedRouteDetail.waypoints
    const updates = new Set(visitedWaypoints)
    let changed = false
    for (const wp of wps) {
      if (!updates.has(wp.id) && haversineMeters(lat, lng, wp.lat, wp.lng) <= WAYPOINT_VISIT_RADIUS) {
        updates.add(wp.id)
        changed = true
      }
    }
    if (changed) setVisitedWaypoints(new Set(updates))
  }, [myPosition, selectedRouteDetail, isTracking]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Socket setup ──────────────────────────────────────────────────────────
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

    function onProximityAlert({ operatorName, distance }: { operatorName: string; distance: number }) {
      const distText = distance >= 1000
        ? `${(distance / 1000).toFixed(1)} km`
        : `${distance} m`
      toast('🚛 ¡El camión está cerca!', {
        description: `${operatorName} está a ${distText} de tu domicilio. Prepara tus residuos.`,
        duration: 30000,
      })
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('tracking:trucks', onTrucks)
    socket.on('tracking:truck_update', onTruckUpdate)
    socket.on('tracking:truck_removed', onTruckRemoved)
    socket.on('tracking:delay_reported', onDelayReported)
    socket.on('proximity:alert', onProximityAlert)
    if (socket.connected) { setIsConnected(true); setOwnSocketId(socket.id ?? undefined) }

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('tracking:trucks', onTrucks)
      socket.off('tracking:truck_update', onTruckUpdate)
      socket.off('tracking:truck_removed', onTruckRemoved)
      socket.off('tracking:delay_reported', onDelayReported)
      socket.off('proximity:alert', onProximityAlert)
    }
  }, [accessToken])

  // ── Citizen zone subscription ─────────────────────────────────────────────
  useEffect(() => {
    if (user?.role === 'CITIZEN' && user.zoneId && !selectedZoneId) {
      setSelectedZoneId(user.zoneId)
    }
  }, [user?.zoneId, user?.role, selectedZoneId])

  useEffect(() => {
    const socket = socketRef.current
    if (!socket || !isConnected || user?.role !== 'CITIZEN') return
    const zoneToSubscribe = user.zoneId ?? selectedZoneId
    if (zoneToSubscribe) socket.emit('tracking:subscribe', { zoneId: zoneToSubscribe })
    else socket.emit('tracking:all')
  }, [selectedZoneId, isConnected, user?.role, user?.zoneId])

  // ── Internal: begin GPS watch + emit tracking:start ──────────────────────
  const beginTracking = useCallback(() => {
    const socket = socketRef.current
    if (!socket) return
    socket.emit('tracking:start', { routeId: selectedRouteId || undefined })
    setIsTracking(true)
    isTrackingRef.current = true
    setVisitedWaypoints(new Set())
    setShowStartWarning(false)

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, speed } = pos.coords
        setMyPosition({ lat: latitude, lng: longitude })
        setIdlePosition(null) // clear idle dot once tracking is live
        socket.emit('tracking:position', {
          lat: latitude, lng: longitude,
          speed: speed != null ? speed * 3.6 : undefined,
        })
      },
      () => toast.error('No se pudo obtener la ubicación GPS'),
      { enableHighAccuracy: true, maximumAge: 5000 },
    )
  }, [selectedRouteId])

  // ── GPS start — checks proximity to first waypoint first ─────────────────
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
    socketRef.current?.emit('tracking:stop')
    setIsTracking(false)
    isTrackingRef.current = false
    setMyPosition(null)
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
    }
  }, [])

  // ── Derived state ─────────────────────────────────────────────────────────
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

  return (
    <ZoneGuard role={user?.role ?? ''} zoneId={user?.zoneId}>
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Rastreo en tiempo real</h1>
          <p className="text-xs text-slate-500 mt-0.5">Seguimiento GPS de camiones de recolección</p>
        </div>
        <div className={`flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full ${
          isConnected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
        }`}>
          {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
          {isConnected ? 'Conectado' : 'Desconectado'}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── OPERATOR PANEL ──────────────────────────────────────────────── */}
        {user?.role === 'OPERATOR' && (
          <div className="w-80 border-r border-slate-200 bg-white flex flex-col shrink-0 overflow-auto">

            {/* Today's route card */}
            <div className="p-4 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                {DAY_NAMES[todayDay]} — Rutas de hoy
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
                        {r.name} — {r.dayOfWeek.map((d) => DAY_NAMES[d]).join(', ')}
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
                    <Navigation size={11} className="text-emerald-600" /> Transmitiendo posición
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

        {/* ── CITIZEN PANEL ───────────────────────────────────────────────── */}
        {user?.role === 'CITIZEN' && (
          <div className="w-64 border-r border-slate-200 bg-white flex flex-col p-4 gap-4 shrink-0">
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
              Selecciona tu zona para ver los camiones de recolección en tiempo real.
            </div>

            {trucks.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-slate-500 mb-2">
                  Camiones activos ({trucks.length})
                </p>
                <div className="space-y-1.5">
                  {trucks.map((t) => (
                    <div key={t.socketId}
                      className="flex items-center gap-2.5 p-2.5 bg-slate-50 rounded-lg">
                      <span className="shrink-0">🚛</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-800 truncate">{t.operatorName}</p>
                        <p className="text-xs text-slate-400">
                          {new Date(t.lastSeen).toLocaleTimeString('es-PE')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 text-center">No hay camiones activos en esta zona</p>
            )}
          </div>
        )}

        {/* ── ADMIN PANEL ─────────────────────────────────────────────────── */}
        {user?.role === 'ADMIN' && trucks.length > 0 && (
          <div className="w-64 border-r border-slate-200 bg-white flex flex-col p-4 gap-3 shrink-0 overflow-auto">
            <p className="text-xs font-semibold text-slate-600">Camiones activos ({trucks.length})</p>
            {trucks.map((t) => (
              <div key={t.socketId}
                className="flex items-start gap-2.5 p-2.5 bg-slate-50 rounded-lg">
                <span className="shrink-0 mt-0.5">🚛</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-800 truncate">{t.operatorName}</p>
                  {t.speed !== undefined && (
                    <p className="text-xs text-slate-500">{Math.round(t.speed)} km/h</p>
                  )}
                  <p className="text-xs text-slate-400">
                    {new Date(t.lastSeen).toLocaleTimeString('es-PE')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Map ──────────────────────────────────────────────────────────── */}
        <div className="flex-1 relative">
          <LeafletTrackingMap
            zones={zones}
            trucks={trucks}
            myPosition={myPosition}
            idlePosition={idlePosition}
            ownSocketId={ownSocketId}
            routeOverlay={routeOverlay}
            isTracking={isTracking}
          />
          {/* Map legend for operator */}
          {user?.role === 'OPERATOR' && routeOverlay && (
            <div className="absolute bottom-4 right-4 z-[1000] bg-white rounded-xl shadow-lg
              border border-slate-200 px-3 py-2.5 space-y-1.5 text-xs">
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
                <div className="w-4 h-4 rounded-full bg-emerald-100 border-2 border-emerald-400 shrink-0 flex items-center justify-center text-emerald-600 font-bold" style={{fontSize:'8px'}}>✓</div>
                Visitada
              </div>
              {isTracking ? (
                <div className="flex items-center gap-2 text-slate-600">
                  <div className="w-4 h-4 rounded-full bg-blue-500 shrink-0" /> Mi posición
                </div>
              ) : (
                <div className="flex items-center gap-2 text-slate-600">
                  <div className="w-4 h-4 rounded-full bg-blue-500 shrink-0" /> Mi ubicación
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
                <p className="text-xs text-slate-500 mt-0.5">Verifica tu posición antes de iniciar</p>
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
              Tu posición actual está a más de 500 m del inicio de la ruta.
              Dirígete al punto de partida o inicia de todos modos si ya te encuentras en ruta.
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
                <input type="text" placeholder="Ej: Tráfico, falla mecánica..."
                  value={delayReason} onChange={(e) => setDelayReason(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <p className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2">
                Los ciudadanos de tu zona recibirán una notificación inmediata.
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
    </div>
    </ZoneGuard>
  )
}
