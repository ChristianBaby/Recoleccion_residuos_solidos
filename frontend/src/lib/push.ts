import { api } from './api'

// RF-17: Suscripción Web Push de la PWA.
// El sistema solicita el permiso automáticamente al ciudadano al entrar al
// dashboard (ProximityAlertListener); el botón del header queda como
// interruptor manual para desactivar o reintentar.

interface PublicKeyResponse {
  success?: boolean
  data?: { enabled: boolean; publicKey: string | null }
}

export type PushSubscribeResult =
  | 'subscribed'      // suscripción activa y registrada en el backend
  | 'no-sw'           // sin service worker (desarrollo o primer load sin SW activo)
  | 'server-disabled' // el backend no tiene claves VAPID configuradas

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i)
  return output
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

// Espera a que el SW esté activo: recién registrado puede seguir en "installing"
// y pushManager.subscribe() falla si no hay worker activo.
async function getActiveRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null
  // El SW solo se registra en producción; en desarrollo no hay registration
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return null
  if (registration.active) return registration
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
  ])
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return null
  return registration.pushManager.getSubscription()
}

function sameApplicationServerKey(sub: PushSubscription, key: Uint8Array): boolean {
  const current = sub.options?.applicationServerKey
  if (!current) return false
  const bytes = new Uint8Array(current)
  return bytes.length === key.length && bytes.every((b, i) => b === key[i])
}

function notifySubscriptionChanged() {
  window.dispatchEvent(new CustomEvent('push:subscription-changed'))
}

export async function subscribeToPush(accessToken: string): Promise<PushSubscribeResult> {
  const registration = await getActiveRegistration()
  if (!registration) return 'no-sw'

  const keyRes = await api.get<PublicKeyResponse>('/push/public-key', accessToken)
  const publicKey = keyRes.data?.publicKey?.trim()
  if (!keyRes.data?.enabled || !publicKey) return 'server-disabled'

  const applicationServerKey = urlBase64ToUint8Array(publicKey)

  // Si hay una suscripción previa creada con otra clave VAPID hay que anularla:
  // subscribe() lanzaría InvalidStateError. Si la clave coincide, se reutiliza
  // y solo se re-registra en el backend (idempotente por endpoint).
  const existing = await registration.pushManager.getSubscription()
  if (existing) {
    if (sameApplicationServerKey(existing, applicationServerKey)) {
      await api.post('/push/subscribe', existing.toJSON(), accessToken)
      notifySubscriptionChanged()
      return 'subscribed'
    }
    await existing.unsubscribe().catch(() => { /* se reintenta con la nueva clave */ })
  }

  const subscribeOptions: PushSubscriptionOptionsInit = {
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey as BufferSource,
  }

  let subscription: PushSubscription
  try {
    subscription = await registration.pushManager.subscribe(subscribeOptions)
  } catch (err) {
    // Algunos navegadores reportan la suscripción vieja recién aquí
    if ((err as DOMException)?.name === 'InvalidStateError') {
      const stale = await registration.pushManager.getSubscription()
      if (stale) await stale.unsubscribe().catch(() => {})
      subscription = await registration.pushManager.subscribe(subscribeOptions)
    } else {
      throw err
    }
  }

  await api.post('/push/subscribe', subscription.toJSON(), accessToken)
  notifySubscriptionChanged()
  return 'subscribed'
}

// Notificación local (app abierta). En Android Chrome `new Notification()`
// lanza "Illegal constructor" cuando hay un SW registrado: ahí se usa
// registration.showNotification.
export async function showLocalNotification(title: string, options?: NotificationOptions): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const registration = 'serviceWorker' in navigator
      ? await navigator.serviceWorker.getRegistration()
      : null
    if (registration) {
      await registration.showNotification(title, options)
    } else {
      new Notification(title, options)
    }
  } catch (err) {
    console.error('[Push] No se pudo mostrar la notificación local:', err)
  }
}

export async function unsubscribeFromPush(accessToken: string): Promise<void> {
  const subscription = await getCurrentPushSubscription()
  if (!subscription) return
  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  await api.post('/push/unsubscribe', { endpoint }, accessToken).catch(() => {
    // si el backend no responde, la suscripción local ya quedó anulada
  })
  notifySubscriptionChanged()
}
