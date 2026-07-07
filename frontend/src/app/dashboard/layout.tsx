'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import ProximityAlertListener, { NotificationPermissionButton } from '@/components/ProximityAlertListener'
import { Menu, X, Settings, User, LogOut } from 'lucide-react'

interface NavItem {
  href: string
  label: string
  roles: string[]
}

const navItems: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Inicio',
    roles: ['ADMIN', 'OPERATOR', 'CITIZEN'],
  },
  {
    href: '/dashboard/zones',
    label: 'Zonas',
    roles: ['ADMIN', 'OPERATOR'],
  },
  {
    href: '/dashboard/routes',
    label: 'Rutas',
    roles: ['ADMIN', 'OPERATOR'],
  },
  {
    href: '/dashboard/vehicles',
    label: 'Vehículos',
    roles: ['ADMIN'],
  },
  {
    href: '/dashboard/waste-types',
    label: 'Residuos',
    roles: ['ADMIN', 'CITIZEN', 'OPERATOR'],
  },
  {
    href: '/dashboard/learn',
    label: 'Aprende a segregar',
    roles: ['ADMIN', 'CITIZEN', 'OPERATOR'],
  },
  {
    href: '/dashboard/incidents',
    label: 'Incidencias',
    roles: ['ADMIN', 'CITIZEN', 'OPERATOR'],
  },
  {
    href: '/dashboard/tracking',
    label: 'Rastreo',
    roles: ['ADMIN', 'OPERATOR', 'CITIZEN'],
  },
  {
    href: '/dashboard/schedules',
    label: 'Horarios',
    roles: ['ADMIN', 'OPERATOR', 'CITIZEN'],
  },
  {
    href: '/dashboard/users',
    label: 'Usuarios',
    roles: ['ADMIN'],
  },
  {
    href: '/dashboard/reports',
    label: 'Reportes',
    roles: ['ADMIN'],
  },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsSidebarOpen(false)
      setIsUserMenuOpen(false)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [pathname])

  useEffect(() => {
    if (!isUserMenuOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      const container = document.getElementById('user-menu-container')
      if (container && !container.contains(event.target as Node)) {
        setIsUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isUserMenuOpen])

  const visibleItems = navItems.filter(
    (item) => user && item.roles.includes(user.role),
  )

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          onClick={() => setIsSidebarOpen(false)}
          className="fixed inset-0 z-[9998] bg-slate-900/40 backdrop-blur-xs transition-opacity md:hidden"
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed md:static inset-y-0 left-0 z-[9999] w-60 bg-white border-r border-slate-200 flex flex-col shrink-0 transition-transform duration-300 ease-in-out md:translate-x-0 ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        {/* Logo */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-slate-100">
          <div className="flex flex-col">
            <span className="text-[10px] tracking-widest text-slate-400 font-bold block leading-none mb-1">
              SISTEMA DE
            </span>
            <span className="text-sm font-black text-slate-900 tracking-wide block leading-none">
              RECOLECCIÓN
            </span>
          </div>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="md:hidden p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 space-y-1 overflow-y-auto">
          {visibleItems.map((item) => {
            const isActive =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(item.href)

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center justify-between py-2.5 transition-all relative ${
                  isActive
                    ? 'text-teal-900 font-bold px-5'
                    : 'text-slate-500 hover:text-slate-900 px-5 font-normal'
                }`}
              >
                {/* Indicador de barra izquierda para elemento activo */}
                {isActive && (
                  <span className="absolute left-0 top-0 bottom-0 w-1 bg-teal-700" />
                )}
                <span className="text-xs uppercase tracking-wider">{item.label}</span>
                {isActive && (
                  <span className="text-[10px] text-teal-600 font-semibold tracking-normal lowercase">activo</span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* User footer */}
        <div className="border-t border-slate-100 p-4 flex flex-col gap-2 shrink-0">
          <button
            onClick={logout}
            className="w-full text-left py-2 px-1.5 text-xs font-bold tracking-widest text-slate-400
              hover:text-red-650 active:scale-95 transition-all uppercase flex items-center gap-2 group/logout"
          >
            <LogOut size={14} className="text-slate-400 group-hover/logout:text-red-500 transition-colors" />
            <span>Cerrar sesión</span>
          </button>
          <p className="text-[9px] text-center font-bold text-slate-350 tracking-widest uppercase mt-1">
            Sistema RSS
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto flex flex-col justify-between bg-slate-50">
        <div className="flex-1 flex flex-col">
          {/* Header Superior */}
          <header className="bg-white border-b border-slate-200 px-4 md:px-8 py-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="md:hidden p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 active:scale-95 transition-all"
              >
                <Menu size={18} />
              </button>
              <div className="text-xs text-slate-400 font-medium capitalize hidden sm:block">
                {new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {user?.role === 'CITIZEN' && <NotificationPermissionButton />}
              
              <span className="hidden sm:inline-block text-[9px] font-extrabold tracking-wider px-2 py-1 bg-slate-100 text-slate-600 rounded uppercase border border-slate-200">
                {user?.role === 'CITIZEN' ? 'Ciudadano' : user?.role === 'OPERATOR' ? 'Operador' : 'Administrador'}
              </span>

              <div className="relative" id="user-menu-container">
                <button 
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-slate-350 bg-white hover:bg-slate-50 transition-all active:scale-95 group shadow-xs"
                  title="Opciones de usuario"
                >
                  <div className="w-6 h-6 rounded-full bg-teal-50 border border-teal-150 flex items-center justify-center text-teal-800 font-bold text-[10px] shrink-0 group-hover:bg-teal-100 transition-colors">
                    {user?.firstName?.[0]?.toUpperCase()}{user?.lastName?.[0]?.toUpperCase()}
                  </div>
                  <span className="hidden md:inline-block text-xs font-semibold text-slate-700 group-hover:text-slate-900 transition-colors">
                    {user?.firstName}
                  </span>
                  <Settings className={`w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-all ${isUserMenuOpen ? 'rotate-90 text-slate-650' : 'group-hover:rotate-45'}`} />
                </button>

                {isUserMenuOpen && (
                  <div className="absolute right-0 mt-2 w-60 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 z-[100] animate-in fade-in slide-in-from-top-2 duration-150">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-800 font-bold text-xs shrink-0">
                        {user?.firstName?.[0]?.toUpperCase()}{user?.lastName?.[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-950 truncate">
                          {user?.firstName} {user?.lastName}
                        </p>
                        <p className="text-[9px] font-extrabold text-slate-400 tracking-wider uppercase truncate mt-0.5">
                          {user?.role === 'CITIZEN' ? 'Ciudadano' : user?.role === 'OPERATOR' ? 'Operador' : 'Administrador'}
                        </p>
                      </div>
                    </div>
                    
                    <div className="py-1 px-1.5 space-y-0.5">
                      <Link 
                        href="/dashboard/profile"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-950 hover:bg-slate-50 rounded-lg transition-colors group"
                      >
                        <User className="w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
                        <span>Mi Perfil</span>
                      </Link>
                      
                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false)
                          logout()
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-red-500 hover:text-red-700 hover:bg-red-50/50 rounded-lg transition-colors group text-left"
                      >
                        <LogOut className="w-4 h-4 text-red-400 group-hover:text-red-650 transition-colors" />
                        <span>Cerrar sesión</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="flex-1">
            {children}
          </div>
        </div>

        {/* Footer Inferior */}
        <footer className="border-t border-slate-200 bg-white px-8 py-4 text-center text-[10px] text-slate-400 font-semibold tracking-wider uppercase shrink-0">
          <span>Gobierno Municipal — Sistema de Recolección — © {new Date().getFullYear()}</span>
        </footer>
      </main>

      {/* RF-12: Alerta de proximidad del camión (solo ciudadanos) */}
      {user?.role === 'CITIZEN' && <ProximityAlertListener />}
    </div>
  )
}
