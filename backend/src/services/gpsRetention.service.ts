import { prisma } from '../config/prisma'

// ─── RF-08.4: Retención del historial GPS ─────────────────────────────────────
// El criterio exige que el historial esté disponible al menos 30 días;
// pasado ese plazo los puntos GPS se eliminan para no acumular datos
// de ubicación indefinidamente (minimización de datos).

const RETENTION_DAYS = 30
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000 // cada 24 horas

/**
 * Elimina los puntos GPS con más de 30 días de antigüedad.
 * Devuelve la cantidad de registros eliminados.
 */
export async function cleanupOldGpsTracks(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)

  const { count } = await prisma.gpsTrack.deleteMany({
    where: { timestamp: { lt: cutoff } },
  })

  console.log(`[Retención GPS] Se eliminaron ${count} puntos GPS anteriores a ${cutoff.toISOString()}`)
  return count
}

/**
 * Inicia el job de retención: ejecuta la limpieza al arrancar
 * y luego cada 24 horas. El intervalo usa unref() para no impedir
 * que el proceso termine.
 */
export function startGpsRetentionJob() {
  cleanupOldGpsTracks().catch((err) =>
    console.error('[Retención GPS] Error en la limpieza inicial:', err)
  )

  setInterval(() => {
    cleanupOldGpsTracks().catch((err) =>
      console.error('[Retención GPS] Error en la limpieza periódica:', err)
    )
  }, CLEANUP_INTERVAL_MS).unref()
}
