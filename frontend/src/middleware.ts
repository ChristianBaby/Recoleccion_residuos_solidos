import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/register', '/verify-email', '/forgot-password', '/reset-password', '/privacy', '/test-push']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get('ecorutas_access')?.value

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  if (!isPublic && !token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (isPublic && token && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  // Excluye API, estáticos de Next y recursos de la PWA (service worker,
  // manifest, página offline e íconos): deben servirse sin autenticación.
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|icon.svg|sw.js|manifest.webmanifest|offline.html|icons/).*)',
  ],
}
