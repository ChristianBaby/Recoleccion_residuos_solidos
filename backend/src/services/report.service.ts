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

