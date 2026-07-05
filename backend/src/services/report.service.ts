import { prisma } from '../config/prisma'
import { RouteStatus } from '@prisma/client'
import { haversineDistance } from '../utils/geoUtils'

const WAYPOINT_VISIT_RADIUS_METERS = 50

function buildDateFilter(from?: string, to?: string) {
  if (!from && !to) return undefined
  const f: { gte?: Date; lte?: Date } = {}
  if (from) f.gte = new Date(from)
  if (to) {
    const d = new Date(to)
    d.setHours(23, 59, 59, 999)
    f.lte = d
  }
  return f
}

// RF-14: Residuos recolectados por zona
export async function getWasteByZone(filters: { from?: string; to?: string; zoneId?: string }) {
  const dateFilter = buildDateFilter(filters.from, filters.to)

  const executions = await prisma.routeExecution.findMany({
    where: {
      ...(dateFilter && { date: dateFilter }),
      ...(filters.zoneId && { route: { zoneId: filters.zoneId } }),
    },
    include: {
      route: {
        include: {
          zone: { select: { id: true, name: true, district: true, color: true } },
          routeWasteTypes: {
            include: {
              wasteType: { select: { id: true, name: true, category: true, colorCode: true } },
            },
          },
        },
      },
    },
  })

  type CatEntry = { category: string; name: string; colorCode: string; count: number }
  type ZoneEntry = {
    zoneId: string
    zoneName: string
    district: string
    color: string
    executions: number
    categories: Map<string, CatEntry>
  }

  const byZone = new Map<string, ZoneEntry>()

  for (const ex of executions) {
    const z = ex.route.zone
    if (!byZone.has(z.id)) {
      byZone.set(z.id, {
        zoneId: z.id,
        zoneName: z.name,
        district: z.district,
        color: z.color,
        executions: 0,
        categories: new Map(),
      })
    }
    const entry = byZone.get(z.id)!
    entry.executions++
    for (const rwt of ex.route.routeWasteTypes) {
      const wt = rwt.wasteType
      if (!entry.categories.has(wt.category)) {
        entry.categories.set(wt.category, {
          category: wt.category,
          name: wt.name,
          colorCode: wt.colorCode,
          count: 0,
        })
      }
      entry.categories.get(wt.category)!.count++
    }
  }

  // Always include all active zones (zeroed if no executions)
  const zoneWhere = filters.zoneId
    ? { isActive: true, id: filters.zoneId }
    : { isActive: true }

  const zones = await prisma.zone.findMany({
    where: zoneWhere,
    select: { id: true, name: true, district: true, color: true },
  })

  return zones.map((z) => {
    const entry = byZone.get(z.id)
    return {
      zoneId: z.id,
      zoneName: z.name,
      district: z.district,
      color: z.color,
      executions: entry?.executions ?? 0,
      categories: entry ? Array.from(entry.categories.values()) : [],
    }
  })
}

// RF-15: Cumplimiento de rutas
export async function getRouteCompliance(filters: { from?: string; to?: string; zoneId?: string }) {
  const dateFilter = buildDateFilter(filters.from, filters.to)

  const routeWhere = filters.zoneId
    ? { status: RouteStatus.ACTIVE, zoneId: filters.zoneId }
    : { status: RouteStatus.ACTIVE }

  const routes = await prisma.route.findMany({
    where: routeWhere,
    include: {
      zone: { select: { id: true, name: true, district: true, color: true } },
      operator: { select: { id: true, firstName: true, lastName: true } },
      vehicle: { select: { id: true, plate: true, type: true } },
      waypoints: { select: { id: true, lat: true, lng: true, name: true }, orderBy: { order: 'asc' } },
      executions: {
        where: dateFilter ? { date: dateFilter } : undefined,
        select: {
          id: true,
          status: true,
          startedAt: true,
          endedAt: true,
          delayMinutes: true,
          date: true,
        },
      },
    },
    orderBy: [{ zone: { name: 'asc' } }, { name: 'asc' }],
  })

  // Batch-query GPS tracks para todas las ejecuciones (evita N+1)
  const allExecIds = routes.flatMap((r) => r.executions.map((e) => e.id))
  const gpsTracksByExec = new Map<string, { lat: number; lng: number }[]>()

  if (allExecIds.length > 0) {
    const tracks = await prisma.gpsTrack.findMany({
      where: { routeExecutionId: { in: allExecIds } },
      select: { routeExecutionId: true, lat: true, lng: true },
    })
    for (const t of tracks) {
      if (!gpsTracksByExec.has(t.routeExecutionId)) {
        gpsTracksByExec.set(t.routeExecutionId, [])
      }
      gpsTracksByExec.get(t.routeExecutionId)!.push({ lat: t.lat, lng: t.lng })
    }
  }

  return routes.map((r) => {
    const execs = r.executions
    const total = execs.length
    const completed = execs.filter((e) => e.status === 'COMPLETED').length
    const delayed = execs.filter((e) => e.status === 'DELAYED').length
    const cancelled = execs.filter((e) => e.status === 'CANCELLED').length
    const inProgress = execs.filter((e) => e.status === 'IN_PROGRESS').length
    const totalDelay = execs.reduce((s, e) => s + (e.delayMinutes ?? 0), 0)
    const avgDelay = total > 0 ? Math.round(totalDelay / total) : 0
    const compliancePct = total > 0 ? Math.round((completed / total) * 100) : 0

    // RF-15: Detección de paradas omitidas
    const waypoints = r.waypoints
    let visitedWaypointSlots = 0
    const totalWaypointSlots = waypoints.length * execs.length

    for (const exec of execs) {
      const tracks = gpsTracksByExec.get(exec.id) ?? []
      for (const wp of waypoints) {
        const visited = tracks.some(
          (t) => haversineDistance(t.lat, t.lng, wp.lat, wp.lng) <= WAYPOINT_VISIT_RADIUS_METERS,
        )
        if (visited) visitedWaypointSlots++
      }
    }

    const missedStopsTotal = totalWaypointSlots - visitedWaypointSlots
    const missedStopsPct =
      totalWaypointSlots > 0
        ? Math.round((missedStopsTotal / totalWaypointSlots) * 100)
        : 0

    return {
      routeId: r.id,
      routeName: r.name,
      zone: r.zone,
      operator: r.operator,
      vehicle: r.vehicle,
      dayOfWeek: r.dayOfWeek,
      totalExecutions: total,
      completed,
      delayed,
      cancelled,
      inProgress,
      compliancePct,
      avgDelayMinutes: avgDelay,
      totalWaypoints: waypoints.length,
      missedStopsTotal,
      missedStopsPct,
    }
  })
}

// RF-16: Participación ciudadana
export async function getCitizenParticipation(filters: { from?: string; to?: string; zoneId?: string }) {
  const dateFilter = buildDateFilter(filters.from, filters.to)


  const zoneWhere = filters.zoneId
    ? { isActive: true, id: filters.zoneId }
    : { isActive: true }

  const zones = await prisma.zone.findMany({
    where: zoneWhere,
    select: { id: true, name: true, district: true, color: true },
  })

  // Citizens registered per zone
  const citizenWhere = {
    role: 'CITIZEN' as const,
    isActive: true,
    zoneId: filters.zoneId ? filters.zoneId : { not: null as null },
    ...(dateFilter && { createdAt: dateFilter }),
  }

  const citizens = await prisma.user.findMany({
    where: citizenWhere,
    select: { zoneId: true },
  })

  const citizensByZone = new Map<string, number>()
  for (const c of citizens) {
    if (c.zoneId) {
      citizensByZone.set(c.zoneId, (citizensByZone.get(c.zoneId) ?? 0) + 1)
    }
  }

  // Incidents per zone via citizen
  const incidents = await prisma.incident.findMany({
    where: dateFilter ? { createdAt: dateFilter } : undefined,
    include: { citizen: { select: { zoneId: true } } },
  })

  type IncEntry = { total: number; open: number; resolved: number; byType: Map<string, number> }
  const incidentsByZone = new Map<string, IncEntry>()

  for (const inc of incidents) {
    const zId = inc.citizen.zoneId
    if (!zId) continue
    if (filters.zoneId && zId !== filters.zoneId) continue
    if (!incidentsByZone.has(zId)) {
      incidentsByZone.set(zId, { total: 0, open: 0, resolved: 0, byType: new Map() })
    }
    const e = incidentsByZone.get(zId)!
    e.total++
    if (inc.status === 'OPEN' || inc.status === 'IN_REVIEW') e.open++
    if (inc.status === 'RESOLVED' || inc.status === 'CLOSED') e.resolved++
    e.byType.set(inc.type, (e.byType.get(inc.type) ?? 0) + 1)
  }

  const totalCitizens = await prisma.user.count({
    where: {
      role: 'CITIZEN',
      isActive: true,
      ...(filters.zoneId && { zoneId: filters.zoneId }),
      ...(dateFilter && { createdAt: dateFilter }),
    },
  })

  const totalIncidents = await prisma.incident.count({
    where: {
      ...(dateFilter && { createdAt: dateFilter }),
      ...(filters.zoneId && { citizen: { zoneId: filters.zoneId } }),
    },
  })

  // RF-16: Consultas educativas — visitas a la página "Aprende a segregar"
  const learnVisitWhere = {
    ...(dateFilter && { createdAt: dateFilter }),
    ...(filters.zoneId && { zoneId: filters.zoneId }),
  }

  const learnVisits = await prisma.learnVisit.findMany({
    where: learnVisitWhere,
    select: { zoneId: true, userId: true },
  })

  // Contar visitas y visitantes únicos por zona
  const learnByZone = new Map<string, { visits: number; uniqueUsers: Set<string> }>()
  for (const v of learnVisits) {
    const zId = v.zoneId ?? '__unknown__'
    if (!learnByZone.has(zId)) learnByZone.set(zId, { visits: 0, uniqueUsers: new Set() })
    const e = learnByZone.get(zId)!
    e.visits++
    e.uniqueUsers.add(v.userId)
  }

  const totalLearnVisits = learnVisits.length

  const byZone = zones.map((z) => {
    const inc = incidentsByZone.get(z.id)
    const lv = learnByZone.get(z.id)
    return {
      zoneId: z.id,
      zoneName: z.name,
      district: z.district,
      color: z.color,
      citizenCount: citizensByZone.get(z.id) ?? 0,
      incidents: {
        total: inc?.total ?? 0,
        open: inc?.open ?? 0,
        resolved: inc?.resolved ?? 0,
        byType: inc ? Object.fromEntries(inc.byType) : {} as Record<string, number>,
      },
      learnVisits: lv?.visits ?? 0,
      learnUniqueUsers: lv ? lv.uniqueUsers.size : 0,
    }
  })

  // RF-16.3: Recomendaciones automáticas de campañas de concientización.
  // El índice de participación combina incidencias reportadas, consultas
  // educativas y ciudadanos activos; las zonas por debajo del promedio
  // reciben una recomendación de campaña/taller.
  const participationIndexOf = (z: (typeof byZone)[number]) =>
    z.citizenCount + z.incidents.total + z.learnVisits

  const averageParticipation =
    byZone.length > 0
      ? byZone.reduce((sum, z) => sum + participationIndexOf(z), 0) / byZone.length
      : 0

  const recommendations = byZone
    .filter((z) => participationIndexOf(z) < averageParticipation)
    .map((z) => ({
      zoneId: z.zoneId,
      zoneName: z.zoneName,
      district: z.district,
      participationIndex: participationIndexOf(z),
      averageIndex: Math.round(averageParticipation * 100) / 100,
      message: `Zona ${z.zoneName} (${z.district}) presenta baja participación ciudadana: se recomienda una campaña de sensibilización y talleres de segregación de residuos dirigidos a sus vecinos.`,
    }))

  return {
    summary: { totalCitizens, totalIncidents, totalLearnVisits },
    byZone,
    recommendations,
  }
}
