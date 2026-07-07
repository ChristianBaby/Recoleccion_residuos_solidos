'use client'

import { useEffect, useRef, useCallback } from 'react'
import {
  MapContainer, TileLayer, Polygon, Tooltip,
  Marker, Popup, Polyline, useMap,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Zone } from '@/types'

const CUSCO_CENTER: [number, number] = [-13.5319, -71.9675]

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TruckPosition {
  socketId: string
  operatorId: string
  operatorName: string
  vehicleCode: string
  routeId: string | null
  zoneId: string | null
  lat: number
  lng: number
  speed?: number
  lastSeen: string
}

export interface WaypointOverlay {
  id: string
  order: number
  name: string | null
  lat: number
  lng: number
  estimatedTime?: string | null
}

export interface RouteOverlay {
  routeId: string
  waypoints: WaypointOverlay[]
  zoneColor: string
  visitedIds: Set<string>
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function makeTruckIcon(isOwn: boolean) {
  return L.divIcon({
    html: `<div style="
      width:36px;height:36px;border-radius:50%;
      background:${isOwn ? '#2563eb' : '#dc2626'};
      display:flex;align-items:center;justify-content:center;
      font-size:18px;border:3px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
    ">🚛</div>`,
    className: '',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
  })
}

// Live tracking position — solid blue
const livePositionIcon = L.divIcon({
  html: `<div style="
    width:16px;height:16px;border-radius:50%;
    background:#3b82f6;border:3px solid white;
    box-shadow:0 0 0 4px rgba(59,130,246,0.3);
  "></div>`,
  className: '',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

// Idle position (before tracking) — blue with pulsing ring
const idlePositionIcon = L.divIcon({
  html: `<div style="position:relative;width:22px;height:22px;display:flex;align-items:center;justify-content:center;">
    <div style="
      position:absolute;inset:0;border-radius:50%;
      background:rgba(59,130,246,0.25);
      animation:idle-pulse 2s ease-in-out infinite;
    "></div>
    <div style="
      width:12px;height:12px;border-radius:50%;
      background:#3b82f6;border:2.5px solid white;
      box-shadow:0 1px 4px rgba(59,130,246,0.4);
      position:relative;z-index:1;
    "></div>
  </div>
  <style>
    @keyframes idle-pulse {
      0%,100%{transform:scale(1);opacity:0.5}
      50%{transform:scale(1.6);opacity:0.15}
    }
  </style>`,
  className: '',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

function makeWaypointIcon(label: string, color: string, visited: boolean) {
  if (visited) {
    return L.divIcon({
      html: `<div style="
        width:26px;height:26px;border-radius:50%;
        background:#d1fae5;border:2px solid #6ee7b7;
        display:flex;align-items:center;justify-content:center;
        font-size:13px;opacity:0.8;
      ">✓</div>`,
      className: '',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    })
  }
  return L.divIcon({
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:${color};color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:700;
      border:2.5px solid #fff;
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
    ">${label}</div>`,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  })
}

function makeStartIcon(color: string) {
  return L.divIcon({
    html: `<div style="position:relative;width:36px;height:36px;">
      <div style="
        position:absolute;inset:0;border-radius:50%;
        background:${color};opacity:0.2;
        animation:start-pulse 1.5s ease-out infinite;
      "></div>
      <div style="
        position:absolute;inset:4px;border-radius:50%;
        background:${color};color:#fff;
        display:flex;align-items:center;justify-content:center;
        font-size:11px;font-weight:700;
        border:2px solid #fff;
        box-shadow:0 2px 8px rgba(0,0,0,0.35);
      ">1</div>
    </div>
    <style>
      @keyframes start-pulse{0%{transform:scale(.8);opacity:.4}100%{transform:scale(1.8);opacity:0}}
    </style>`,
    className: '',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
  })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FitToRoute({ routeId, waypoints }: { routeId: string | null; waypoints: WaypointOverlay[] }) {
  const map = useMap()
  const lastId = useRef<string | null>(null)

  useEffect(() => {
    if (!routeId || routeId === lastId.current || waypoints.length === 0) return
    lastId.current = routeId
    const timer = window.setTimeout(() => {
      map.invalidateSize()
      const bounds = L.latLngBounds(waypoints.map((wp) => [wp.lat, wp.lng] as [number, number]))
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16, animate: false })
    }, 0)
    return () => {
      window.clearTimeout(timer)
    }
  }, [map, routeId, waypoints])

  return null
}

function FitToZones({
  zones,
  selectedZoneId,
  routeId,
  hasRouteBounds,
}: {
  zones: Zone[]
  selectedZoneId?: string
  routeId: string | null
  hasRouteBounds: boolean
}) {
  const map = useMap()

  useEffect(() => {
    if (routeId && hasRouteBounds) return

    const activeZones = zones.filter((z) => z.isActive)
    const selectedZone = activeZones.find((z) => z.id === selectedZoneId)
    const zonesToFit = selectedZone ? [selectedZone] : activeZones
    if (zonesToFit.length === 0) return

    const points = zonesToFit.flatMap((z) =>
      z.geometry.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number]),
    )
    if (points.length === 0) return

    const timer = window.setTimeout(() => {
      map.invalidateSize()
      map.fitBounds(L.latLngBounds(points), {
        padding: selectedZone ? [70, 70] : [45, 45],
        maxZoom: selectedZone ? 15 : 14,
        animate: false,
      })
    }, 0)
    return () => {
      window.clearTimeout(timer)
    }
  }, [map, zones, selectedZoneId, routeId, hasRouteBounds])

  return null
}

// Captures the Leaflet map instance into a ref owned by the parent component
function MapCapturer({ onReady }: { onReady: (map: L.Map) => void }) {
  const map = useMap()
  const called = useRef(false)
  useEffect(() => {
    if (called.current) return
    called.current = true
    onReady(map)
  }, [map, onReady])
  return null
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  zones: Zone[]
  trucks: TruckPosition[]
  myPosition?: { lat: number; lng: number } | null
  idlePosition?: { lat: number; lng: number } | null
  ownSocketId?: string
  routeOverlay?: RouteOverlay | null
  isTracking?: boolean
  selectedZoneId?: string
  centerCoordinates?: { lat: number; lng: number; time: number } | null
}



// ─── Component ────────────────────────────────────────────────────────────────

export default function LeafletTrackingMap({
  zones, trucks, myPosition, idlePosition,
  ownSocketId, routeOverlay, isTracking = false, selectedZoneId,
  centerCoordinates,
}: Props) {
  const mapRef = useRef<L.Map | null>(null)
  const onReady = useCallback((m: L.Map) => { mapRef.current = m }, [])

  useEffect(() => {
    if (centerCoordinates && mapRef.current) {
      mapRef.current.setView(
        [centerCoordinates.lat, centerCoordinates.lng],
        Math.max(mapRef.current.getZoom(), 16),
        { animate: true }
      )
    }
  }, [centerCoordinates])

  const waypoints = routeOverlay?.waypoints ?? []
  const polyline: [number, number][] = waypoints.map((wp) => [wp.lat, wp.lng])
  const zoneColor = routeOverlay?.zoneColor ?? '#2563eb'
  const visitedIds = routeOverlay?.visitedIds ?? new Set<string>()

  // Current position to fly to (live tracking takes priority over idle)
  const currentPos = myPosition ?? idlePosition

  function handleLocate() {
    if (!currentPos || !mapRef.current) return
    mapRef.current.setView([currentPos.lat, currentPos.lng], Math.max(mapRef.current.getZoom(), 17), { animate: false })
  }

  function wpColor(idx: number) {
    if (waypoints.length <= 1) return '#16a34a'
    if (idx === 0) return '#16a34a'
    if (idx === waypoints.length - 1) return '#dc2626'
    return zoneColor
  }

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <MapContainer
        center={CUSCO_CENTER}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
        zoomAnimation={false}
        fadeAnimation={false}
        markerZoomAnimation={false}
      >
        <MapCapturer onReady={onReady} />
        <FitToRoute routeId={routeOverlay?.routeId ?? null} waypoints={waypoints} />
        <FitToZones
          zones={zones}
          selectedZoneId={selectedZoneId}
          routeId={routeOverlay?.routeId ?? null}
          hasRouteBounds={waypoints.length > 0}
        />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png"
        />

        {/* Zone polygons */}
        {zones.filter((z) => z.isActive).map((zone) => {
          const positions = zone.geometry.coordinates[0].map(
            ([lng, lat]) => [lat, lng] as [number, number],
          )
          return (
            <Polygon
              key={zone.id}
              positions={positions}
              pathOptions={{ color: zone.color, fillOpacity: 0.08, weight: 1.5 }}
            >
              <Tooltip sticky>{zone.name}</Tooltip>
            </Polygon>
          )
        })}

        {/* ── Route overlay ──────────────────────────────────────────────── */}
        {routeOverlay && waypoints.length >= 2 && (
          <>
            <Polyline
              positions={polyline}
              pathOptions={{ color: '#ffffff', weight: 7, opacity: 0.5 }}
            />
            <Polyline
              positions={polyline}
              pathOptions={{
                color: zoneColor,
                weight: 4,
                opacity: 0.85,
                dashArray: isTracking ? undefined : '10 6',
              }}
            />
          </>
        )}

        {/* Waypoint markers */}
        {routeOverlay && waypoints.map((wp, idx) => {
          const visited = visitedIds.has(wp.id)
          const color = wpColor(idx)
          const isFirstUnvisited = !isTracking && idx === 0 && !visited
          const icon = isFirstUnvisited
            ? makeStartIcon(color)
            : makeWaypointIcon(String(idx + 1), color, visited)

          return (
            <Marker
              key={wp.id}
              position={[wp.lat, wp.lng]}
              icon={icon}
              zIndexOffset={isFirstUnvisited ? 100 : 0}
            >
              <Popup>
                <div className="text-xs min-w-[130px]">
                  <p className="font-semibold text-slate-800 leading-tight">
                    {wp.name ?? `Parada ${wp.order}`}
                  </p>
                  {wp.estimatedTime && (
                    <p className="text-slate-500 mt-1">⏱ {wp.estimatedTime}</p>
                  )}
                  <p className={`mt-1 font-medium ${visited ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {visited ? '✓ Visitada' : 'Pendiente'}
                  </p>
                  {idx === 0 && !isTracking && (
                    <p className="mt-1 text-blue-500 font-medium">← Inicio de ruta</p>
                  )}
                </div>
              </Popup>
            </Marker>
          )
        })}

        {/* Active trucks */}
        {trucks.map((truck) => (
          <Marker
            key={truck.socketId}
            position={[truck.lat, truck.lng]}
            icon={makeTruckIcon(truck.socketId === ownSocketId)}
          >
            <Popup>
              <div className="text-xs">
                <p className="font-semibold">{truck.vehicleCode || truck.operatorName}</p>
                {truck.speed !== undefined && (
                  <p className="text-slate-500">{Math.round(truck.speed)} km/h</p>
                )}
                <p className="text-slate-400">
                  Última señal: {new Date(truck.lastSeen).toLocaleTimeString('es-PE')}
                </p>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Live position (during tracking) */}
        {myPosition && (
          <Marker
            position={[myPosition.lat, myPosition.lng]}
            icon={livePositionIcon}
            zIndexOffset={200}
          >
            <Popup>
              <p className="text-xs font-medium">Mi posición actual</p>
            </Popup>
          </Marker>
        )}

        {/* Idle position (before tracking) */}
        {idlePosition && !myPosition && (
          <Marker
            position={[idlePosition.lat, idlePosition.lng]}
            icon={idlePositionIcon}
            zIndexOffset={150}
          >
            <Popup>
              <p className="text-xs text-slate-700 font-medium">Tu ubicación actual</p>
              <p className="text-xs text-slate-400 mt-0.5">GPS activo · sin ruta iniciada</p>
            </Popup>
          </Marker>
        )}
      </MapContainer>

      {/* ── "My location" button — overlaid on the map ─────────────────────── */}
      {currentPos && (
        <button
          onClick={handleLocate}
          title="Ir a mi ubicación"
          style={{ zIndex: 1000 }}
          className="absolute bottom-6 left-3 bg-white hover:bg-blue-50 border border-slate-200
            hover:border-blue-400 rounded-xl shadow-md px-3 py-2.5 flex items-center gap-2
            text-xs font-semibold text-slate-700 hover:text-blue-600 transition-all
            active:scale-95"
        >
          {/* location crosshair SVG */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <line x1="12" y1="2" x2="12" y2="6" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="2" y1="12" x2="6" y2="12" />
            <line x1="18" y1="12" x2="22" y2="12" />
          </svg>
          Mi ubicación
        </button>
      )}
    </div>
  )
}
