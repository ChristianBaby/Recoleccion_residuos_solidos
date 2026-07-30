'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { getSocket } from '@/lib/socket'
import { subscribeToPush, unsubscribeFromPush, getCurrentPushSubscription, isPushSupported, showLocalNotification } from '@/lib/push'
import { ApiError } from '@/lib/api'
import { Bell, BellOff, Truck, X, Clock, CheckCheck, Trash2, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'

export interface ProximityAlert {
  vehicleCode: string
  distance: number
  zoneId: string
  timestamp: string
}

export interface DelayAlert {
  routeName: string
  delayMinutes: number
  reason: string
  zoneId: string
  operatorName: string
  timestamp: string
}

export interface StoredNotification {
  id: string
  type: 'proximity' | 'delay'
  title: string
  body: string
  timestamp: string
  read: boolean
  data?: ProximityAlert | DelayAlert
}

const STORAGE_KEY = 'ecorutas_notifications_history'

function getStoredNotifications(): StoredNotification[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveStoredNotifications(items: StoredNotification[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 50))) // mantener ultimas 50
    window.dispatchEvent(new Event('ecorutas:notifications-updated'))
  } catch {}
}

export default function ProximityAlertListener() {
  const { user, accessToken } = useAuth()
  const [banner, setBanner] = useState<AlertBanner | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  type AlertBanner =
    | { type: 'proximity'; data: ProximityAlert }
    | { type: 'delay'; data: DelayAlert }

  function showBanner(next: AlertBanner) {
    setBanner(next)
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    dismissTimer.current = setTimeout(() => setBanner(null), 30_000)
  }

  function appendNotification(item: StoredNotification) {
    const current = getStoredNotifications()
    saveStoredNotifications([item, ...current])
  }

  useEffect(() => {
    if (user?.role !== 'CITIZEN' || !accessToken) return

    const socket = getSocket(accessToken)

    function onProximityAlert(data: ProximityAlert) {
      showBanner({ type: 'proximity', data })
      const title = '🚛 El camión está cerca'
      const body = `El recolector está a ${data.distance} m de tu domicilio. ¡Prepara tus residuos!`
      showLocalNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        tag: 'proximity-alert',
      })
      appendNotification({
        id: `prox-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'proximity',
        title,
        body,
        timestamp: data.timestamp || new Date().toISOString(),
        read: false,
        data,
      })
    }

    function onDelayAlert(data: DelayAlert) {
      showBanner({ type: 'delay', data })
      const title = '⏰ Retraso en la ruta de recolección'
      const body = `La ruta "${data.routeName}" lleva ${data.delayMinutes} min de retraso.${data.reason ? ` Motivo: ${data.reason}` : ''}`
      showLocalNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        tag: 'delay-alert',
      })
      appendNotification({
        id: `del-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'delay',
        title,
        body,
        timestamp: data.timestamp || new Date().toISOString(),
        read: false,
        data,
      })
    }

    socket.on('proximity:alert', onProximityAlert)
    socket.on('route:delay_alert', onDelayAlert)

    return () => {
      socket.off('proximity:alert', onProximityAlert)
      socket.off('route:delay_alert', onDelayAlert)
    }
  }, [accessToken, user?.role])

  // RF-17: auto-suscripción al cargar dashboard
  useEffect(() => {
    if (user?.role !== 'CITIZEN' || !accessToken) return

    async function handleAutoPush() {
      const token = accessToken
      if (!token) return
      if (!isPushSupported()) return

      try {
        const currentPermission = Notification.permission

        if (currentPermission === 'default') {
          const permissionResult = await Notification.requestPermission()
          if (permissionResult === 'granted') {
            const result = await subscribeToPush(token)
            if (result === 'subscribed') {
              toast.success('Notificaciones activadas: te avisaremos cuando el camión esté cerca, incluso con la app cerrada.')
            }
          }
        } else if (currentPermission === 'granted') {
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
              Vehículo: {banner.data.vehicleCode} ·{' '}
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

/**
 * Componente Centro de Notificaciones (Bandeja / Dropdown flotante)
 * Muestra el historial de notificaciones entrantes, badge de no leídas,
 * estado de lectura y panel de suscripción Web Push VAPID.
 */
export function NotificationCenter() {
  const { accessToken } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [notifications, setNotifications] = useState<StoredNotification[]>([])
  const [permission, setPermission] = useState<NotificationPermission>(() => (
    typeof Notification === 'undefined' ? 'denied' : Notification.permission
  ))
  const [pushActive, setPushActive] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  function reloadNotifications() {
    setNotifications(getStoredNotifications())
  }

  useEffect(() => {
    reloadNotifications()
    function handleUpdate() {
      reloadNotifications()
    }
    window.addEventListener('ecorutas:notifications-updated', handleUpdate)
    return () => window.removeEventListener('ecorutas:notifications-updated', handleUpdate)
  }, [])

  useEffect(() => {
    function refreshPushState() {
      setPermission(typeof Notification === 'undefined' ? 'denied' : Notification.permission)
      getCurrentPushSubscription()
        .then((sub) => setPushActive(Boolean(sub)))
        .catch(() => setPushActive(false))
    }
    refreshPushState()
    window.addEventListener('push:subscription-changed', refreshPushState)
    return () => window.removeEventListener('push:subscription-changed', refreshPushState)
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const unreadCount = notifications.filter((n) => !n.read).length

  function toggleOpen() {
    setIsOpen(!isOpen)
  }

  function markAllAsRead() {
    const updated = notifications.map((n) => ({ ...n, read: true }))
    setNotifications(updated)
    saveStoredNotifications(updated)
  }

  function clearAll() {
    setNotifications([])
    saveStoredNotifications([])
  }

  function markSingleAsRead(id: string) {
    const updated = notifications.map((n) => (n.id === id ? { ...n, read: true } : n))
    setNotifications(updated)
    saveStoredNotifications(updated)
  }

  async function enablePush() {
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
        toast.warning('Notificaciones limitadas a sesión web local.')
      } else {
        toast.error('Las notificaciones push no están disponibles en el servidor.')
      }
    } catch (err) {
      toast.error('No se pudo activar las notificaciones push.')
    } finally {
      setBusy(false)
    }
  }

  async function disablePush() {
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

  function formatTime(isoStr: string) {
    try {
      const date = new Date(isoStr)
      const diffMs = Date.now() - date.getTime()
      const diffMin = Math.floor(diffMs / 60000)
      if (diffMin < 1) return 'Ahora mismo'
      if (diffMin < 60) return `Hace ${diffMin} min`
      const diffHrs = Math.floor(diffMin / 60)
      if (diffHrs < 24) return `Hace ${diffHrs} h`
      return date.toLocaleDateString('es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Botón de Campana con Badge */}
      <button
        onClick={toggleOpen}
        title="Centro de Notificaciones y Alertas"
        className={`relative p-2 rounded-xl border transition-all active:scale-95 flex items-center justify-center ${
          isOpen
            ? 'bg-teal-50 border-teal-200 text-teal-800 shadow-sm'
            : unreadCount > 0
            ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
      >
        <Bell size={18} />

        {/* Badge de No Leídas */}
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-[20px] px-1 bg-red-600 text-white text-[10px] font-extrabold rounded-full flex items-center justify-center border-2 border-white shadow-sm animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown / Bandeja Flotante */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-2xl z-[9999] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Header de la Bandeja */}
          <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell size={16} className="text-teal-400" />
              <span className="text-xs font-bold uppercase tracking-wider">Centro de Notificaciones</span>
              {unreadCount > 0 && (
                <span className="bg-teal-500/20 text-teal-300 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-teal-500/30">
                  {unreadCount} nuevas
                </span>
              )}
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X size={15} />
            </button>
          </div>

          {/* Acciones rápidas de la lista */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <button
                onClick={markAllAsRead}
                className="flex items-center gap-1 font-semibold text-teal-700 hover:text-teal-900 transition-colors"
              >
                <CheckCheck size={14} />
                <span>Marcar leídas</span>
              </button>
              <button
                onClick={clearAll}
                className="flex items-center gap-1 text-slate-400 hover:text-rose-600 transition-colors"
              >
                <Trash2 size={13} />
                <span>Limpiar</span>
              </button>
            </div>
          )}

          {/* Contenido / Lista de Notificaciones */}
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            {notifications.length === 0 ? (
              <div className="p-8 text-center">
                <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-3">
                  <BellOff size={20} />
                </div>
                <p className="text-xs font-bold text-slate-700">Sin notificaciones aún</p>
                <p className="text-[11px] text-slate-400 mt-1 max-w-[220px] mx-auto">
                  Aquí aparecerán las alertas de cercanía del camión recolector y los avisos de retraso en tus rutas.
                </p>
              </div>
            ) : (
              notifications.map((item) => (
                <div
                  key={item.id}
                  onClick={() => markSingleAsRead(item.id)}
                  className={`p-3.5 flex items-start gap-3 transition-colors cursor-pointer ${
                    item.read ? 'bg-white hover:bg-slate-50/80 opacity-75' : 'bg-teal-50/30 hover:bg-teal-50/60'
                  }`}
                >
                  <div
                    className={`shrink-0 p-2 rounded-xl mt-0.5 ${
                      item.type === 'proximity'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {item.type === 'proximity' ? <Truck size={16} /> : <Clock size={16} />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className={`text-xs ${item.read ? 'font-medium text-slate-700' : 'font-bold text-slate-900'}`}>
                        {item.title}
                      </p>
                      {!item.read && (
                        <span className="w-2 h-2 rounded-full bg-teal-600 shrink-0" title="No leída" />
                      )}
                    </div>

                    <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                      {item.body}
                    </p>

                    <p className="text-[10px] text-slate-400 font-medium mt-1">
                      {formatTime(item.timestamp)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer de Estado del Permiso Push VAPID */}
          <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px]">
                <span
                  className={`w-2 h-2 rounded-full ${
                    permission === 'granted' && pushActive
                      ? 'bg-emerald-500'
                      : permission === 'granted'
                      ? 'bg-amber-500'
                      : 'bg-rose-500'
                  }`}
                />
                <span className="font-semibold text-slate-700">
                  {permission === 'granted' && pushActive
                    ? 'Push en segundo plano activo'
                    : permission === 'granted'
                    ? 'Notificaciones del navegador permitidas'
                    : 'Notificaciones bloqueadas'}
                </span>
              </div>

              {permission !== 'denied' && (
                pushActive ? (
                  <button
                    onClick={disablePush}
                    disabled={busy}
                    className="text-[10px] font-bold text-slate-500 hover:text-slate-700 underline"
                  >
                    Desactivar Push
                  </button>
                ) : (
                  <button
                    onClick={enablePush}
                    disabled={busy}
                    className="text-[10px] font-bold text-emerald-700 hover:text-emerald-900 underline"
                  >
                    Activar Push
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

