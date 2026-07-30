import { Server as HttpServer } from 'http'
import { Server } from 'socket.io'
import { verifyAccessToken } from '../utils/jwt'
import { prisma } from '../config/prisma'
import { setupTrackingHandlers } from './tracking'

let ioInstance: Server | null = null

export function getSocketIO(): Server | null {
  return ioInstance
}

export function setupSocketServer(httpServer: HttpServer, frontendUrl: string): Server {
  const allowedOrigins = frontendUrl
    .split(',')
    .map((u) => u.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
  const io = new Server(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
    pingInterval: 10000, // Envía un ping cada 10 segundos para mantener la conexión activa en redes móviles
    pingTimeout: 5000,   // Espera 5 segundos antes de declarar la conexión como muerta
  })
  ioInstance = io

  // JWT auth middleware para cada conexión WebSocket
  io.use(async (socket, next) => {
    const token = socket.handshake.auth['token'] as string | undefined
    if (!token) {
      console.warn(`[Socket Auth] Intento de conexión rechazado: Token no provisto por socket: ${socket.id}`)
      return next(new Error('Token requerido'))
    }

    try {
      const payload = verifyAccessToken(token)
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, role: true, firstName: true, lastName: true },
      })
      if (!user) {
        console.warn(`[Socket Auth] Intento de conexión rechazado: Usuario con ID ${payload.sub} no encontrado en base de datos.`)
        return next(new Error('Usuario no encontrado'))
      }

      socket.data.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        name: `${user.firstName} ${user.lastName}`,
      }
      next()
    } catch (err) {
      console.error(`[Socket Auth] Error de autenticación en conexión de socket ${socket.id}:`, err)
      next(new Error('Token inválido o expirado'))
    }
  })

  io.on('connection', (socket) => {
    const connectedUser = socket.data.user as { id: string; email: string; role: string; name: string }
    console.log(`[Socket] Cliente conectado: ${connectedUser.name} (${connectedUser.email}) - Rol: ${connectedUser.role} - Socket ID: ${socket.id}`)
    socket.join(`user:${connectedUser.id}`)
    setupTrackingHandlers(io, socket)
  })

  return io
}
