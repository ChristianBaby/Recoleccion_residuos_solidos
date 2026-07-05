import 'dotenv/config'
import { createServer } from 'http'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { env } from './config/env'
import { prisma } from './config/prisma'
import routes from './routes'
import { errorHandler } from './middleware/errorHandler'
import { setupSocketServer } from './socket'
import { startGpsRetentionJob } from './services/gpsRetention.service'

const app = express()

// Necesario para que express-rate-limit funcione correctamente detrás de proxies (Railway, Heroku, etc.)
app.set('trust proxy', 1)

// ─── Seguridad ────────────────────────────────────────────────────────────────
app.use(helmet())

const allowedOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:3000')
  .split(',')
  .map((u) => u.trim().replace(/^['"]|['"]$/g, ''))
  .filter(Boolean)

function isAllowedOrigin(origin: string) {
  return (
    allowedOrigins.includes(origin) ||
    origin.endsWith('.vercel.app') ||
    origin.endsWith('.ecosdelseo.com')
  )
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    if (isAllowedOrigin(origin)) return callback(null, true)
    console.warn(`[CORS] Origen bloqueado: ${origin} | Permitidos: ${allowedOrigins.join(', ')}`)
    callback(null, false)
  },
  credentials: true,
}))

// Rate limiting estricto para auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  skip: (req) => req.method === 'OPTIONS',
  handler: (req, res) => {
    const origin = req.headers.origin as string | undefined
    if (origin && isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Credentials', 'true')
    }
    res.status(429).json({ success: false, message: 'Demasiados intentos de autenticación. Intenta en 15 minutos.' })
  },
})
app.use('/api/v1/auth/login', authLimiter)
app.use('/api/v1/auth/register', authLimiter)
app.use('/api/v1/auth/forgot-password', authLimiter)

// ─── Body Parser ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: 'no-global-ratelimit',
    frontendUrl: process.env.FRONTEND_URL ?? '(no configurado)',
  })
})

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/v1', routes)

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use(errorHandler)

// ─── HTTP Server + Socket.io ──────────────────────────────────────────────────
const httpServer = createServer(app)
setupSocketServer(httpServer, env.frontendUrl)

// ─── Start ────────────────────────────────────────────────────────────────────
async function main() {
  try {
    await prisma.$connect()
    console.log('✅ Conectado a PostgreSQL')

    // RF-08.4: limpieza periódica del historial GPS (retención de 30 días)
    startGpsRetentionJob()

    httpServer.listen(env.port, () => {
      console.log(`🚀 Backend corriendo en http://localhost:${env.port}`)
      console.log(`   WebSocket (Socket.io) activo`)
      console.log(`   Ambiente: ${env.nodeEnv}`)
      console.log(`   Frontend: ${env.frontendUrl}`)
    })
  } catch (error) {
    console.error('❌ Error al iniciar:', error)
    process.exit(1)
  }
}

main()
