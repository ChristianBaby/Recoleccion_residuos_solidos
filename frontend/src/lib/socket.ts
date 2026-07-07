import { io, Socket } from 'socket.io-client'

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:3001'

let socket: Socket | null = null

let currentToken: string | null = null

export function getSocket(token: string): Socket {
  if (socket && currentToken === token) {
    return socket
  }

  if (socket) {
    socket.disconnect()
  }

  currentToken = token
  socket = io(SOCKET_URL, {
    auth: { token },
    autoConnect: true,
    transports: ['polling', 'websocket'],
    reconnectionAttempts: 5,
    reconnectionDelayMax: 10000,
  })

  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
    currentToken = null
  }
}

