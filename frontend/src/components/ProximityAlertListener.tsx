'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { getSocket } from '@/lib/socket'
import { subscribeToPush, unsubscribeFromPush, getCurrentPushSubscription, isPushSupported, showLocalNotification } from '@/lib/push'
import { ApiError } from '@/lib/api'
import { Bell, BellOff, Truck, X, Clock } from 'lucide-react'
import { toast } from 'sonner'

interface ProximityAlert {
  vehicleCode: string
  distance: number
  zoneId: string
  timestamp: string
}

interface DelayAlert {
  routeName: string
  delayMinutes: number
  reason: string
  zoneId: string
  operatorName: string
  timestamp: string
}

type AlertBanner =
  | { type: 'proximity'; data: ProximityAlert }
  | { type: 'delay'; data: DelayAlert }

export default function ProximityAlertListener() {
  const { user, accessToken } = useAuth()
  const [banner, setBanner] = useState<AlertBanner | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showBanner(next: AlertBanner) {
    setBanner(next)
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    dismissTimer.current = setTimeout(() => setBanner(null), 30_000)
  }

  useEffect(() => {
    if (user?.role !== 'CITIZEN' || !accessToken) return

    const socket = getSocket(accessToken)

    function onProximityAlert(data: ProximityAlert) {
      showBanner({ type: 'proximity', data })
      showLocalNotification('🚛 El camión está cerca', {
        body: `El recolector está a ${data.distance} m de tu domicilio. ¡Prepara tus residuos!`,
        icon: '/icons/icon-192.png',
        tag: 'proximity-alert',
      })
    }

    function onDelayAlert(data: DelayAlert) {
      showBanner({ type: 'delay', data })
      showLocalNotification('⏰ Retraso en la ruta de recolección', {
        body: `La ruta "${data.routeName}" lleva ${data.delayMinutes} min de retraso.${data.reason ? ` Motivo: ${data.reason}` : ''}`,
        icon: '/icons/icon-192.png',
        tag: 'delay-alert',
      })
    }

    socket.on('proximity:alert', onProximityAlert)
    socket.on('route:delay_alert', onDelayAlert)

    return () => {
      socket.off('proximity:alert', onProximityAlert)
      socket.off('route:delay_alert', onDelayAlert)
    }
  }, [accessToken, user?.role])

  // RF-17: el sistema solicita el permiso directamente al ciudadano al entrar
  // al dashboard y lo suscribe; no hace falta que pulse ningún botón.
  useEffect(() => {
    if (user?.role !== 'CITIZEN' || !accessToken) return

    async function handleAutoPush() {
      const token = accessToken
      if (!token) return
      if (!isPushSupported()) return

      try {
        const currentPermission = Notification.permission

        if (currentPermission === 'default') {
          // Preguntar directamente al usuario al cargar el dashboard
          const permissionResult = await Notification.requestPermission()
          if (permissionResult === 'granted') {
            const result = await subscribeToPush(token)
            if (result === 'subscribed') {
              toast.success('Notificaciones activadas: te avisaremos cuando el camión esté cerca, incluso con la app cerrada.')
            }
          }
        } else if (currentPermission === 'granted') {
          // Ya tiene permiso: garantizar que la suscripción exista y esté
          // registrada en el backend (repara suscripciones obsoletas).
          await subscribeToPush(token)
        }
      } catch (error) {
        console.error('[Push] Error en la auto-suscripción:', error)
      }
    }

    const timer = setTimeout(handleAutoPush, 2000)
    return () => clearTimeout(timer)
  }, [accessToken, user?.role])

  if (!banner) return null

  return (
    <div
      role="alert"
      className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-[9999] w-full max-w-sm
        text-white rounded-2xl shadow-2xl px-5 py-4
        flex items-start gap-3 animate-in slide-in-from-bottom-4 duration-300
        ${banner.type === 'proximity' ? 'bg-emerald-600' : 'bg-amber-500'}`}
    >
      <div className={`shrink-0 mt-0.5 rounded-full p-1.5
        ${banner.type === 'proximity' ? 'bg-emerald-500' : 'bg-amber-400'}`}>
        {banner.type === 'proximity' ? <Truck size={18} /> : <Clock size={18} />}
      </div>

      <div className="flex-1 min-w-0">
        {banner.type === 'proximity' ? (
          <>
            <p className="font-semibold text-sm leading-snug">
              ¡El camión recolector está cerca!
            </p>
            <p className="text-emerald-100 text-xs mt-0.5 leading-relaxed">
              A solo <strong className="text-white">{banner.data.distance} m</strong> de tu domicilio.
              Prepara tus residuos para entregarlos.
            </p>
            <p className="text-emerald-200 text-xs mt-1">
              Vehiculo: {banner.data.vehicleCode} ·{' '}
              {new Date(banner.data.timestamp).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </>
        ) : (
          <>
            <p className="font-semibold text-sm leading-snug">
              Retraso en tu ruta de recolección
            </p>
            <p className="text-amber-100 text-xs mt-0.5 leading-relaxed">
              <strong className="text-white">{banner.data.routeName}</strong> lleva{' '}
              <strong className="text-white">{banner.data.delayMinutes} min</strong> de retraso.
              {banner.data.reason && <> Motivo: {banner.data.reason}</>}
            </p>
            <p className="text-amber-200 text-xs mt-1">
              Operador: {banner.data.operatorName} ·{' '}
              {new Date(banner.data.timestamp).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </>
        )}
      </div>

      <button
        onClick={() => setBanner(null)}
        className={`shrink-0 p-1 rounded-full transition-colors
          ${banner.type === 'proximity' ? 'hover:bg-emerald-500' : 'hover:bg-amber-400'}`}
        aria-label="Cerrar alerta"
      >
        <X size={16} />
      </button>
    </div>
  )
}

export function NotificationPermissionButton() {
  const { accessToken } = useAuth()
  const [permission, setPermission] = useState<NotificationPermission>(() => (
    typeof Notification === 'undefined' ? 'denied' : Notification.permission
  ))
  // RF-17: estado de la suscripción Web Push (null = aún cargando)
  const [pushActive, setPushActive] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  // Refleja los cambios hechos por la auto-suscripción (o por otra pestaña)
  useEffect(() => {
    function refresh() {
      setPermission(typeof Notification === 'undefined' ? 'denied' : Notification.permission)
      getCurrentPushSubscription()
        .then((sub) => setPushActive(Boolean(sub)))
        .catch(() => setPushActive(false))
    }
    refresh()
    window.addEventListener('push:subscription-changed', refresh)
    return () => window.removeEventListener('push:subscription-changed', refresh)
  }, [])

  if (pushActive === null) return null

  async function enable() {
    if (!accessToken) return
    setBusy(true)
    try {
      const granted = Notification.permission === 'granted'
        ? true
        : (await Notification.requestPermission()) === 'granted'
      setPermission(Notification.permission)
      if (!granted) {
        toast.warning('Sin el permiso del navegador no podemos avisarte. Puedes habilitarlo desde el candado de la barra de direcciones.')
        return
      }
      const result = await subscribeToPush(accessToken)
      setPushActive(result === 'subscribed')
      if (result === 'subscribed') {
        toast.success('Notificaciones push activadas: recibirás alertas aunque cierres la app.')
      } else if (result === 'no-sw') {
        if (process.env.NODE_ENV !== 'production') {
          toast.warning('En desarrollo local las notificaciones no se activan porque el Service Worker está desactivado.')
        } else {
          toast.error('La app aún se está instalando en tu navegador. Recarga la página e inténtalo de nuevo.')
        }
      } else {
        toast.error('Las notificaciones push están desactivadas en el servidor (faltan claves VAPID).')
      }
    } catch (err) {
      console.error('[Push] Error al activar notificaciones:', err)
      const name = (err as DOMException)?.name
      if (name === 'NotAllowedError') {
        toast.error('El navegador bloqueó las notificaciones para este sitio. Habilítalas desde el candado de la barra de direcciones.')
      } else if (name === 'AbortError') {
        toast.error('El servicio de notificaciones del navegador no respondió. Verifica tu conexión e inténtalo de nuevo.')
      } else if (err instanceof ApiError) {
        toast.error(`No se pudo registrar la suscripción en el servidor: ${err.message}`)
      } else {
        toast.error('No se pudo activar las notificaciones push. Revisa tu conexión e inténtalo de nuevo.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    if (!accessToken) return
    setBusy(true)
    try {
      await unsubscribeFromPush(accessToken)
      setPushActive(false)
      toast.success('Notificaciones push desactivadas.')
    } catch {
      toast.error('No se pudo desactivar las notificaciones.')
    } finally {
      setBusy(false)
    }
  }

  if (permission === 'denied') {
    return (
      <button
        onClick={() => toast.info('Las notificaciones están bloqueadas para este sitio. Haz clic en el candado de la barra de direcciones y permite las notificaciones.')}
        title="Notificaciones bloqueadas por el navegador"
        className="flex items-center gap-2 text-xs text-slate-400 bg-slate-50
          border border-slate-200 rounded-lg px-2 py-1.5 sm:px-3 hover:bg-slate-100 transition-colors shrink-0"
      >
        <BellOff size={13} className="shrink-0" />
        <span className="hidden sm:inline">Notificaciones bloqueadas</span>
        <span className="sm:hidden">Bloqueadas</span>
      </button>
    )
  }

  if (pushActive) {
    return (
      <button
        onClick={disable}
        disabled={busy}
        title="Recibes alertas de cercanía y retrasos aunque la app esté cerrada"
        className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50
          border border-slate-200 rounded-lg px-2 py-1.5 sm:px-3 hover:bg-slate-100 transition-colors disabled:opacity-50 shrink-0"
      >
        <BellOff size={13} className="shrink-0" />
        <span className="hidden sm:inline">Desactivar notificaciones push</span>
        <span className="sm:hidden">Desactivar push</span>
      </button>
    )
  }

  return (
    <button
      onClick={enable}
      disabled={busy}
      className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50
        border border-emerald-200 rounded-lg px-2 py-1.5 sm:px-3 hover:bg-emerald-100 transition-colors disabled:opacity-50 shrink-0"
    >
      <Bell size={13} className="shrink-0" />
      {busy ? (
        <span>Activando…</span>
      ) : (
        <>
          <span className="hidden sm:inline">Activar notificaciones de proximidad</span>
          <span className="sm:hidden">Activar alertas</span>
        </>
      )}
    </button>
  )

}
