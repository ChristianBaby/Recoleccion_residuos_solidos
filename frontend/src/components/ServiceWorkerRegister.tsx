'use client'

import { useEffect } from 'react'

/**
 * Registra el service worker de la PWA (/public/sw.js).
 * Solo se activa en producción: en desarrollo el caché del SW
 * interfiere con el hot reload de Next.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch((error) => {
        console.error('[PWA] Error al registrar el service worker:', error)
      })
  }, [])

  return null
}
