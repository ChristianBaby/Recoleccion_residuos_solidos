export type Role = 'ADMIN' | 'OPERATOR' | 'CITIZEN'

export interface AuthUser {
  id: string
  email: string
  role: Role
  firstName: string
  lastName: string
  zoneId?: string | null
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface ApiResponse<T = null> {
  success: boolean
  message?: string
  data?: T
}

export interface ApiError {
  success: false
  message: string
  errors?: { field: string; message: string }[]
}

// ─── Zonas (RF-03) ────────────────────────────────────────────────────────────

export interface GeoJsonPolygon {
  type: 'Polygon'
  // GeoJSON: [lng, lat][]
  coordinates: [number, number][][]
}

export interface Zone {
  id: string
  name: string
  description: string | null
  district: string
  color: string
  isActive: boolean
  geometry: GeoJsonPolygon
  createdAt: string
  updatedAt: string
  createdBy?: { firstName: string; lastName: string }
  _count?: { users: number; routes: number }
}

// ─── Vehículos ────────────────────────────────────────────────────────────────

export type VehicleType = 'COMPACTOR' | 'OPEN_TRUCK' | 'MINI_TRUCK'
export type VehicleStatus = 'AVAILABLE' | 'IN_ROUTE' | 'MAINTENANCE' | 'INACTIVE'

export interface Vehicle {
  id: string
  plate: string
  type: VehicleType
  brand: string | null
  model: string | null
  year: number | null
  capacity: number | null
  status: VehicleStatus
  isActive: boolean
}

// ─── Rutas (RF-09) ────────────────────────────────────────────────────────────

export type RouteStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE'

export interface Waypoint {
  id: string
  order: number
  name: string | null
  description: string | null
  lat: number
  lng: number
  estimatedTime: string | null
}

export interface Route {
  id: string
  name: string
  status: RouteStatus
  zoneId: string
  zone?: { id: string; name: string; color: string }
  vehicleId: string | null
  vehicle?: { id: string; plate: string; type: VehicleType } | null
  operatorId: string | null
  operator?: { id: string; firstName: string; lastName: string } | null
  dayOfWeek: number[]
  startTime: string | null
  estimatedDuration: number | null
  createdAt: string
  updatedAt: string
  waypoints?: Waypoint[]
  _count?: { waypoints: number }
}

export interface Operator {
  id: string
  firstName: string
  lastName: string
  email: string
}

// ─── Residuos (RF-05 / RF-06) ─────────────────────────────────────────────────

export type WasteCategory = 'ORGANIC' | 'RECYCLABLE' | 'NON_RECYCLABLE' | 'HAZARDOUS'

export interface WasteType {
  id: string
  name: string
  category: WasteCategory
  description: string | null
  colorCode: string
  examples: string[]
  instructions: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// ─── Incidencias (RF-11) ──────────────────────────────────────────────────────

export type IncidentType =
  | 'WASTE_ACCUMULATION'
  | 'DAMAGED_CONTAINER'
  | 'MISSED_COLLECTION'
  | 'OTHER'

export type IncidentStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED'

export interface Incident {
  id: string
  type: IncidentType
  description: string
  status: IncidentStatus
  imageUrl: string | null
  lat: number | null
  lng: number | null
  address: string | null
  trackingCode: string
  citizenId: string
  citizen?: {
    id: string
    firstName: string
    lastName: string
    email: string
    dni?: string | null
    phone?: string | null
    role?: string
    zone?: { id: string; name: string; district: string } | null
  }
  createdAt: string
  updatedAt: string
}
