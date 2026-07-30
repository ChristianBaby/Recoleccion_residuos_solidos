'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Bell, Send, CheckCircle2, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'

export default function TestPushPage() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)

  async function triggerPush() {
    setLoading(true)
    setResult(null)
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'https://api-sistemarss.ecosdelseo.com/api/v1'
      const res = await fetch(`${apiUrl}/push/test-trigger`)
      const json = await res.json()
      setResult(json)
      if (json.success) {
        toast.success('¡Notificación push de prueba enviada a todos los roles!')
      } else {
        toast.error('Ocurrió un problema al enviar la notificación')
      }
    } catch (err) {
      toast.error('No se pudo conectar con el servidor de producción')
    } finally {
      setLoading(false)
    }
  }

  // Disparar automáticamente al entrar a la página
  useEffect(() => {
    triggerPush()
  }, [])

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-3xl p-6 sm:p-8 shadow-2xl text-center">
        <div className="w-16 h-16 bg-teal-500/20 text-teal-400 border border-teal-500/30 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <Bell className="w-8 h-8 animate-bounce" />
        </div>

        <h1 className="text-xl sm:text-2xl font-black text-white">Disparador de Push de Prueba</h1>
        <p className="text-slate-400 text-xs sm:text-sm mt-2 leading-relaxed">
          Al ingresar a esta página se envía automáticamente una notificación de prueba masiva a todos los usuarios y roles registrados en producción.
        </p>

        <div className="my-6">
          <button
            onClick={triggerPush}
            disabled={loading}
            className="w-full py-3.5 px-6 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-sm rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Send size={18} />
            <span>{loading ? 'Enviando notificación…' : 'Reenviar Notificación Push Masiva'}</span>
          </button>
        </div>

        {result && (
          <div className="p-4 bg-slate-900/80 border border-slate-700 rounded-xl text-left text-xs font-mono">
            <div className="flex items-center gap-2 mb-2 font-sans font-bold text-emerald-400">
              <CheckCircle2 size={16} />
              <span>{result.message}</span>
            </div>
            <pre className="text-[11px] text-slate-300 overflow-x-auto p-2 bg-slate-950 rounded-lg">
              {JSON.stringify(result.data, null, 2)}
            </pre>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-slate-700/60 flex items-center justify-between text-xs text-slate-400">
          <Link href="/dashboard" className="flex items-center gap-1.5 text-teal-400 hover:underline font-semibold">
            <ArrowLeft size={14} />
            <span>Volver al Dashboard</span>
          </Link>
          <span>EcoRutas Poroy</span>
        </div>
      </div>
    </div>
  )
}
