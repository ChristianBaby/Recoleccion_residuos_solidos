# Sistema Inteligente de Recolección de Residuos Sólidos — Cusco

**Proyecto universitario · Desarrollo de Software I · SCRUM**

Sistema web completo para la gestión de la recolección de residuos sólidos segregados en la ciudad del Cusco, con rastreo GPS en tiempo real, gestión de zonas geográficas, rutas con editor de mapa, reportes y módulos educativos para ciudadanos.

---

## Despliegue

| Componente | Plataforma | URL |
|---|---|---|
| Frontend (Next.js) | Vercel | [recoleccion-residuos.vercel.app](https://recoleccion-residuos.vercel.app) |
| Backend (Express) | Railway | API REST + WebSocket |
| Base de datos (PostgreSQL) | Railway | Gestionada vía Prisma ORM |

---

## Stack tecnológico

**Frontend**
- Next.js 14+ (App Router) con TypeScript
- Tailwind CSS v4
- Leaflet + react-leaflet — mapas interactivos con polígonos GeoJSON, rutas y marcadores GPS
- Socket.IO client — rastreo en tiempo real
- Sonner — notificaciones toast
- Lucide React — iconografía

**Backend**
- Express.js con TypeScript
- Prisma ORM + PostgreSQL
- Socket.IO — servidor de eventos en tiempo real
- JWT + bcrypt — autenticación y hash de contraseñas
- Agregaciones Prisma para reportes (la exportación CSV/Excel/PDF se genera en el cliente)

**Infraestructura**
- Vercel (frontend con CI/CD automático desde `main`)
- Railway (backend + base de datos PostgreSQL, nixpacks)

---

## Arquitectura general

```
┌─────────────────────────────────┐     HTTPS / WS
│  Next.js (Vercel)               │ ◄──────────────► Express + Socket.IO (Railway)
│  - App Router (RSC + Client)    │                   │
│  - Leaflet (SSR desactivado)    │                   ├─ REST API  /api/v1/...
│  - Socket.IO client             │                   └─ Prisma ──► PostgreSQL
└─────────────────────────────────┘
```

Tres roles de usuario con paneles diferenciados:
- **ADMIN** — gestión completa del sistema
- **OPERATOR** — panel de turno con ruta del día y GPS
- **CITIZEN** — rastreo de camiones, horarios, incidencias y aprendizaje

---

## Funcionalidades implementadas

### RF-08 · Rastreo GPS en tiempo real

El módulo central del sistema. Los operadores emiten su posición al servidor vía Socket.IO y los ciudadanos la reciben instantáneamente en el mapa.

- El operador activa el GPS desde el panel de turno pulsando **Iniciar ruta**
- El navegador llama a `navigator.geolocation.watchPosition` y emite eventos `tracking:position` cada actualización
- El servidor distribuye la posición por salas Socket.IO: `zone:{id}` para ciudadanos de esa zona y `admin_room` para administradores
- Los ciudadanos ven los camiones activos con su velocidad y hora de última señal
- Al detener la ruta, el camión desaparece del mapa de todos los usuarios
- **Punto azul pulsante** para la posición propia del operador (idle antes de iniciar y sólido durante el tracking)
- **Botón "Mi ubicación"** superpuesto al mapa que hace `flyTo` a la posición actual

**Verificación de proximidad al inicio:** si el operador está a más de 500 m del primer waypoint al pulsar Iniciar, el sistema muestra una advertencia con la distancia exacta y le da la opción de confirmar o cancelar.

---

### RF-09 · Gestión de rutas con editor de mapa

El administrador crea y edita rutas directamente sobre el mapa interactivo.

- Formulario completo: nombre, zona, vehículo, operador, días de la semana, hora de inicio, duración estimada
- **Editor de waypoints en mapa**: clic para añadir paradas, arrastrar para reposicionar, lista lateral con nombres editables y orden numérico
- Estados de ruta: `DRAFT`, `ACTIVE`, `INACTIVE` con filtros por pestaña
- Cada waypoint guarda: orden, nombre, coordenadas y tiempo estimado de llegada
- La ruta se visualiza en el mapa del operador durante su turno: línea discontinua antes de iniciar, sólida durante el recorrido
- Los waypoints visitados (radio de 50 m) se marcan automáticamente con ✓ en tiempo real

---

### RF-03 · Gestión de zonas geográficas

- Creación de zonas mediante polígonos GeoJSON dibujados sobre el mapa (Leaflet Draw)
- Atributos: nombre, descripción, distrito, color personalizable, estado activo/inactivo
- Las zonas se muestran como capas semitransparentes en todos los mapas del sistema
- El administrador puede editar o desactivar zonas existentes

---

### RF-01 / RF-02 · Registro y autenticación

- Registro de ciudadanos con nombre, DNI, correo, contraseña, dirección y selección de zona
- Autenticación JWT con access token (corta duración) + refresh token (persistente)
- Roles: `ADMIN`, `OPERATOR`, `CITIZEN` con rutas protegidas
- Bloqueo de cuenta tras 5 intentos fallidos
- Perfil editable: datos personales, foto de avatar, cambio de zona (ciudadano)
- El administrador puede crear cuentas de OPERATOR y ADMIN directamente con contraseña

---

### RF-04 · Asignación de usuarios a zonas

- El administrador asigna zona tanto a ciudadanos como a operadores desde el panel de gestión de usuarios
- Validación `ZoneGuard`: ciudadanos sin zona ven mensaje orientativo; operadores y admins acceden sin restricción
- El ciudadano puede cambiar su propia zona desde su perfil

---

### RF-11 · Reporte de incidencias con imagen y geolocalización

- El ciudadano reporta desde el dashboard con tipo de incidencia, descripción, foto y coordenadas GPS
- Tipos: acumulación de residuos, contenedor dañado, recolección no realizada, otro
- Estados de gestión: `OPEN` → `IN_REVIEW` → `RESOLVED` → `CLOSED`
- El administrador gestiona el estado de cada incidencia desde su panel
- Código de seguimiento único generado automáticamente por registro
- Las imágenes se cargan mediante URL (almacenamiento externo configurable)

---

### RF-13 · Alertas de retraso en tiempo real

- El operador reporta un retraso desde el panel de turno indicando minutos y motivo
- El servidor emite el evento `tracking:delay_reported` a todos los ciudadanos de la zona activa
- Los ciudadanos reciben un toast de notificación inmediato con la información del retraso
- Se registra historial de retrasos asociado a la ejecución de la ruta

---

### RF-09 (complemento) · Gestión de vehículos

- CRUD completo de la flota: placa, tipo (COMPACTOR / OPEN\_TRUCK / MINI\_TRUCK), marca, modelo, año, capacidad
- Estados: `AVAILABLE`, `IN_ROUTE`, `MAINTENANCE`, `INACTIVE` con badges visuales de color
- Activar / desactivar vehículo sin eliminarlo del sistema
- Prerrequisito para asignar a rutas

---

### RF-12 · Seguimiento ciudadano por zona

- El ciudadano selecciona su zona en el panel de rastreo y se suscribe a la sala Socket.IO correspondiente
- Ve en el mapa todos los camiones activos en esa zona con nombre del operador, velocidad y última señal
- Panel lateral con listado de camiones activos en tiempo real

---

### RF-14 / RF-15 / RF-16 · Reportes con exportación PDF y Excel

- Panel de reportes accesible para el administrador
- Filtros por zona, rango de fechas y tipo de reporte
- **Exportación PDF** con jsPDF: portada, tablas y gráficos
- **Exportación Excel** con ExcelJS: hojas con formato, colores y anchos de columna
- Reportes disponibles:
  - Residuos recolectados por zona y categoría
  - Cumplimiento de rutas planificadas vs. ejecutadas
  - Participación ciudadana (incidencias, visitas educativas, registros)

---

### RF-10 · Consulta de horarios de recolección

- Los ciudadanos consultan los horarios organizados por zona y día de la semana
- Filtros por zona y día
- Muestra hora de inicio, duración estimada, vehículo asignado y tipos de residuos que se recolectan ese día

---

### RF-17 · Notificaciones push PWA con app cerrada

Complementa RF-12 y RF-13: las alertas llegan al ciudadano aunque la aplicación esté cerrada.

- Suscripción **Web Push con claves VAPID**: el navegador se suscribe vía `PushManager` y la suscripción se persiste en `PushSubscription` asociada al usuario
- Opt-in explícito desde el panel del ciudadano (botón "Activar notificaciones"), con opción de desuscribirse en cualquier momento
- El servidor envía push en los eventos de **cercanía del camión** (< radio configurado, RF-12) y **retraso reportado** (RF-13), reutilizando el debounce de 5 minutos
- Las suscripciones muertas (404/410 del push service) se depuran automáticamente
- El service worker muestra la notificación y al tocarla abre la vista de rastreo
- Payload sin datos personales: solo código de vehículo, distancia y mensaje del evento
- Sin claves VAPID configuradas el módulo queda desactivado de forma segura (Socket.IO y correos siguen operando)

---

### RF-18 · Registro de cantidades recolectadas al cierre de ruta

Alimenta el reporte RF-14 con datos reales de recolección.

- Al pulsar **Finalizar ruta**, el operador registra los kg aproximados por categoría (orgánico, reciclable, no reciclable, peligroso — NTP 900.058)
- Registro vinculado a la ejecución (`CollectionRecord`), con upsert por categoría (los reintentos corrigen, no duplican) y trazabilidad de quién declaró
- El operador puede **omitir** el registro: la ruta cierra igual y la ejecución queda marcada "sin datos de pesaje"
- El reporte RF-14 agrega los kg reales por zona y categoría (`totalKg`, `weighedExecutions`) manteniendo compatibilidad con ejecuciones históricas
- Las exportaciones CSV/Excel/PDF incluyen la nueva columna de kg

---

### RF-05 / RF-06 · Tipos de residuos y "Aprende a segregar"

- Catálogo de tipos de residuos con nombre, categoría (ORGANIC / RECYCLABLE / NON\_RECYCLABLE / HAZARDOUS), código de color, ejemplos e instrucciones de manejo
- El administrador crea, edita, activa y desactiva tipos desde el panel
- Módulo educativo **"Aprende a segregar"** para ciudadanos: guías visuales por categoría, color de contenedor, ejemplos cotidianos e instrucciones
- Cada visita a la sección educativa se registra en `LearnVisit` para el reporte de participación ciudadana (RF-16)

---

## Roles y acceso por módulo

| Módulo | ADMIN | OPERATOR | CITIZEN |
|---|:---:|:---:|:---:|
| Rastreo GPS (transmitir posición) | — | ✓ | — |
| Rastreo GPS (ver mapa en vivo) | ✓ | ✓ | ✓ |
| Gestión de rutas (crear/editar) | ✓ | — | — |
| Panel de turno (ruta del día) | — | ✓ | — |
| Gestión de zonas | ✓ | — | — |
| Gestión de usuarios | ✓ | — | — |
| Gestión de vehículos | ✓ | — | — |
| Incidencias (reportar) | — | — | ✓ |
| Incidencias (gestionar estado) | ✓ | — | — |
| Horarios de recolección | ✓ | ✓ | ✓ |
| Tipos de residuos (administrar) | ✓ | — | — |
| Aprende a segregar | — | — | ✓ |
| Reportes PDF / Excel | ✓ | — | — |
| Perfil editable | ✓ | ✓ | ✓ |

---

## Modelo de datos (resumen)

```
User ──── Zone ──── Route ──── Waypoint
           │          │
           │        Vehicle
           │          │
           │      RouteExecution ── GpsTrack
           │
         Incident
         LearnVisit

WasteType ──── RouteWasteType ──── Route
```

Entidades principales: `User`, `Zone`, `Route`, `Waypoint`, `Vehicle`, `RouteExecution`, `GpsTrack`, `CollectionRecord`, `WasteType`, `Incident`, `LearnVisit`, `RefreshToken`, `PushSubscription`, `AuditLog`.

---

## Ejecución local

### Prerrequisitos

- Node.js 18+
- PostgreSQL 15+ (local o instancia en la nube)
- npm

### Backend

```bash
cd backend
cp .env.example .env        # configurar variables de entorno
npm install
npx prisma db push          # crear tablas en la base de datos
npm run dev                 # http://localhost:4000
```

### Frontend

```bash
cd frontend
cp .env.example .env.local  # configurar variables de entorno
npm install
npm run dev                 # http://localhost:3000
```

---

## Variables de entorno

### Backend — `.env`

```env
DATABASE_URL=postgresql://usuario:contraseña@host:5432/residuos_db
JWT_SECRET=tu_secreto_jwt
JWT_REFRESH_SECRET=tu_secreto_refresh
PORT=4000
FRONTEND_URL=http://localhost:3000

# RF-17: Web Push (generar con: npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=clave_publica_vapid
VAPID_PRIVATE_KEY=clave_privada_vapid
VAPID_SUBJECT=mailto:soporte@tudominio.pe
```

### Frontend — `.env.local`

```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
```

---

## Estructura del proyecto

```
/
├── frontend/                   # Next.js 14 (App Router)
│   └── src/
│       ├── app/
│       │   ├── (auth)/         # Login / Registro
│       │   └── dashboard/
│       │       ├── page.tsx            # Panel principal
│       │       ├── tracking/           # RF-08: Rastreo GPS
│       │       ├── routes/             # RF-09: Gestión de rutas
│       │       ├── zones/              # RF-03: Zonas
│       │       ├── users/              # Gestión de usuarios
│       │       ├── vehicles/           # Gestión de flota
│       │       ├── incidents/          # RF-11: Incidencias
│       │       ├── schedules/          # RF-10: Horarios
│       │       ├── waste-types/        # RF-05: Tipos de residuos
│       │       ├── learn/              # RF-06: Aprende a segregar
│       │       ├── reports/            # RF-14/15/16: Reportes
│       │       └── profile/            # Perfil editable
│       ├── components/
│       │   ├── LeafletTrackingMap.tsx  # Mapa de rastreo GPS
│       │   ├── LeafletWaypointEditor.tsx # Editor de rutas en mapa
│       │   └── ZoneGuard.tsx           # Guardia de zona por rol
│       ├── context/AuthContext.tsx
│       └── lib/
│           ├── api.ts                  # Cliente HTTP
│           └── socket.ts               # Cliente Socket.IO
│
└── backend/                    # Express + Prisma
    ├── prisma/
    │   └── schema.prisma
    └── src/
        ├── routes/             # Enrutadores REST por módulo
        ├── controllers/        # Lógica de controladores
        ├── services/           # Lógica de negocio
        ├── middleware/         # Auth JWT, manejo de errores
        └── socket/             # Eventos Socket.IO (tracking)
```

---

## Especificación de Requisitos Funcionales

### Resumen de RF

| Código | Requisito | Módulo | Prioridad | Estado |
|--------|-----------|--------|-----------|--------|
| RF-01 | Registro de ciudadanos | Usuarios y zonas | Alta | ✓ |
| RF-02 | Autenticación JWT con roles | Usuarios y zonas | Alta | ✓ |
| RF-03 | Gestión de zonas geográficas (GeoJSON) | Usuarios y zonas | Alta | ✓ |
| RF-04 | Asignación de usuarios a zonas | Usuarios y zonas | Media | ✓ |
| RF-08 | Rastreo GPS en tiempo real (Socket.IO) | Monitoreo de rutas | Alta | ✓ |
| RF-09 | Gestión de rutas con editor en mapa | Monitoreo de rutas | Alta | ✓ |
| RF-07 | Visualización de ruta planificada en mapa | Monitoreo de rutas | Alta | ✓ |
| RF-11 | Reporte de incidencias con foto y GPS | Aplicación ciudadana | Alta | ✓ |
| RF-12 | Seguimiento de camiones por zona | Sistema de alertas | Alta | ✓ |
| RF-13 | Alerta de retraso en tiempo real | Sistema de alertas | Media | ✓ |
| RF-14 | Reportes con exportación PDF y Excel | Reportes | Alta | ✓ |
| RF-15 | Reporte de cumplimiento de rutas | Reportes | Media | ✓ |
| RF-16 | Reporte de participación ciudadana | Reportes | Media | ✓ |
| RF-10 | Consulta de horarios de recolección | Horarios | Alta | ✓ |
| RF-05 | Catálogo de tipos de residuos | Gestión de residuos | Media | ✓ |
| RF-06 | Clasificación y guías educativas | Gestión de residuos | Alta | ✓ |
| RF-17 | Notificaciones push PWA con app cerrada | Sistema de alertas | Alta | ✓ |
| RF-18 | Registro de cantidades recolectadas al cierre de ruta | Reportes | Alta | ✓ |

---

## Gestión del proyecto en Jira

El proyecto se gestiona en Jira Cloud: **[ing-sofware.atlassian.net](https://ing-sofware.atlassian.net)** — proyecto **"Ingeniería de Software"** (clave `SCRUM`, tablero Scrum next-gen).

**Resumen del backlog** *(al 07/07/2026)*:

| Métrica | Valor |
|---|---|
| Issues totales | 180 |
| Finalizadas | 180 (100 %) |
| En curso | 0 |
| Por hacer | 0 |

### Épicas (módulos del sistema)

| Clave | Épica | Módulo |
|---|---|---|
| SCRUM-5 | E1 — Gestión de Usuarios y Zonas | M1 |
| SCRUM-6 | E2 — Gestión de Residuos | M2 |
| SCRUM-7 | E3 — Monitoreo de Rutas | M3 |
| SCRUM-8 | E4 — Aplicación Móvil Ciudadana | M4 |
| SCRUM-9 | E5 — Sistema de Alertas | M5 |
| SCRUM-10 | E6 — Reportes y Analítica | M6 |
| SCRUM-11 | E7 — Requisitos No Funcionales y Arquitectura | Transversal |

### Backlog de requisitos funcionales (historias de usuario)

Cada RF se descompone en **5 subtareas estándar**: `[1/5] Plan` → `[2/5] Diseño UI/UX` → `[3/5] Frontend` → `[4/5] Backend` → `[5/5] Test`.

| Clave | Requisito (HU) | Épica | Responsable | Estado en Jira |
|---|---|---|---|---|
| SCRUM-12 | RF-01: Registro de ciudadanos (HU-01) | E1 | Edmil Saire | ✅ Finalizado |
| SCRUM-13 | RF-02: Autenticación JWT con roles (HU-02) | E1 | Celia Quispe | ✅ Finalizado |
| SCRUM-14 | RF-03: Gestión de zonas geográficas GeoJSON (HU-03) | E1 | Christian Pumaccahua | ✅ Finalizado |
| SCRUM-15 | RF-04: Asignación de usuarios a zonas (HU-04) | E1 | Medaly Lozano | ✅ Finalizado |
| SCRUM-16 | RF-05: Registro de tipos de residuos (HU-05) | E2 | Celia Quispe | ✅ Finalizado |
| SCRUM-17 | RF-06: Clasificación de residuos por categoría (HU-06) | E2 | Edmil Saire | ✅ Finalizado |
| SCRUM-18 | RF-07: Visualización de ruta planificada en mapa (HU-07) | E3 | Christian Pumaccahua | ✅ Finalizado |
| SCRUM-19 | RF-08: Rastreo GPS en tiempo real — Socket.IO (HU-08) | E3 | Edmil Saire | ✅ Finalizado |
| SCRUM-20 | RF-09: Gestión de rutas con editor en mapa (HU-09) | E3 | Medaly Lozano | ✅ Finalizado |
| SCRUM-21 | RF-10: Consulta de horarios de recolección (HU-10) | E4 | Edmil Saire | ✅ Finalizado |
| SCRUM-22 | RF-11: Reporte ciudadano de incidencias (HU-11) | E4 | Celia Quispe | ✅ Finalizado |
| SCRUM-23 | RF-12: Notificación de cercanía del camión (HU-12) | E5 | Christian Pumaccahua | ✅ Finalizado |
| SCRUM-24 | RF-13: Alertas de retraso o incidencias en rutas (HU-13) | E5 | Medaly Lozano | ✅ Finalizado |
| SCRUM-25 | RF-14: Reporte de residuos recolectados por zona (HU-14) | E6 | Edmil Saire | ✅ Finalizado |
| SCRUM-26 | RF-15: Reporte de cumplimiento de rutas (HU-15) | E6 | Medaly Lozano | ✅ Finalizado |
| SCRUM-27 | RF-16: Reporte de participación ciudadana (HU-16) | E6 | Celia Quispe | ✅ Finalizado |
| SCRUM-176 | RF-17: Notificaciones push PWA con app cerrada (HU-17) | E5 | Edmil Saire | ✅ Finalizado |
| SCRUM-177 | RF-18: Registro de cantidades recolectadas al cierre de ruta (HU-18) | E6 | Edmil Saire | ✅ Finalizado |

### Criterios de aceptación por historia de usuario

Criterios extraídos de las descripciones de las issues en Jira. Cada historia incluye además una ficha de pruebas (unidad/integración/E2E con Jest) y su Definition of Done.

<details>
<summary><strong>RF-01 · Registro de ciudadanos (SCRUM-12)</strong></summary>

> *Como ciudadano de Poroy, quiero registrarme ingresando mis datos personales y ubicando mi domicilio en el mapa, para acceder a los horarios de mi sector y recibir alertas en tiempo real.*

**Funcionales:**

1. El formulario debe solicitar nombres, apellidos, DNI, correo, contraseña, dirección y teléfono (opcional).
2. El campo Distrito no se muestra en el formulario; se ingresa automáticamente como «Poroy».
3. Validar DNI de exactamente 8 dígitos numéricos y contraseña con complejidad mínima (8 caracteres, una mayúscula y un número).
4. Registro en dos pasos: Paso 1 datos personales y consentimiento; Paso 2 ubicación de la vivienda en mapa Leaflet.
5. Georreferenciar la posición y validar contra las 9 zonas oficiales de Poroy; fuera de cobertura muestra banner de advertencia y asigna el fallback general del distrito.
6. Tras el registro, enviar correo de confirmación con token de activación válido por 24 horas.

**Éticos / legales:**

- Consentimiento expreso (Ley N.º 29733): checkbox no marcado por defecto + enlace a la Política de Privacidad.
- Contraseñas con hashing robusto (bcrypt, factor de costo 12).
- Minimización y confidencialidad: las coordenadas del domicilio se usan solo para asignar zona y servicio, sin exponerse a otros usuarios.

**DoD:** compila sin errores (`npx tsc --noEmit`), 100 % de la suite Jest en verde y verificación visual del checkbox de consentimiento.

</details>

<details>
<summary><strong>RF-02 · Autenticación JWT con roles (SCRUM-13)</strong></summary>

> *Como usuario registrado (ciudadano, operador o administrador), quiero autenticarme de forma segura con email y contraseña, para acceder a las funcionalidades de mi rol.*

**Funcionales:**

1. Inicio de sesión validando credenciales con contraseñas cifradas.
2. Generar token JWT firmado con expiración configurable y rol, redirigiendo al panel correspondiente.
3. Bloqueo temporal de 15 minutos tras 5 intentos fallidos consecutivos, con mensaje claro.
4. Recuperación de contraseña con enlace de un solo uso, validez máxima de 1 hora.

**Éticos / legales:**

- Confidencialidad de credenciales con encriptación fuerte (Ley N.º 29733).
- Mensajes de error genéricos para evitar enumeración de usuarios.
- Control de acceso estricto basado en roles (RBAC).

**DoD:** código compila sin advertencias, pruebas de cifrado y firmado de tokens en verde, verificación visual del bloqueo de cuenta y de la restricción de rutas de administración.

</details>

<details>
<summary><strong>RF-03 · Gestión de zonas geográficas GeoJSON (SCRUM-14)</strong></summary>

> *Como administrador municipal, quiero crear, editar y eliminar zonas de recolección dibujándolas en un mapa interactivo, para optimizar la cobertura operativa del servicio.*

**Funcionales:**

1. Dibujar polígonos en mapa interactivo con nombre, código, color y descripción.
2. Validar automáticamente que el polígono no se solape con zonas existentes; en conflicto, rechazar y resaltar el área solapada.
3. Persistir los datos geográficos en formato GeoJSON.
4. Al crear/modificar una zona, recalcular automáticamente la asignación de los ciudadanos contenidos en el polígono.
5. Edición de vértices y eliminación lógica (inactiva) para preservar el historial.

**Éticos / legales:**

- Registro de auditoría estricto (quién, cuándo, qué) de los cambios territoriales.
- Procesamiento confidencial de coordenadas en la reasignación (Ley N.º 29733).
- Notificación clara al ciudadano cuando su zona cambie.

**DoD:** CRUD de zonas y mapa compilan sin errores, pruebas GeoJSON de Jest en verde y verificación visual de la reasignación automática.

</details>

<details>
<summary><strong>RF-04 · Asignación de usuarios a zonas (SCRUM-15)</strong></summary>

> *Como administrador, quiero que cada ciudadano sea asignado automáticamente a una zona según su dirección domiciliaria, para que reciba las notificaciones y horarios exactos de su área.*

**Funcionales:**

1. Geocodificar la dirección al registrarse o actualizarla.
2. Aplicar algoritmo punto-en-polígono contra los GeoJSON de zonas activas.
3. Si cae dentro de un polígono: asignar zona y notificar la confirmación.
4. Si no pertenece a ninguna zona: asignar zona «pendiente» y alertar al administrador para revisión manual.
5. Permitir reasignación manual (override) con registro de auditoría.
6. Si se modifica una zona y un ciudadano queda fuera, reasignarlo automáticamente.

**Éticos / legales:**

- Tratamiento confidencial de la ubicación con consentimiento (Ley N.º 29733).
- Minimización de datos: la ubicación solo se usa para el servicio de recolección.
- Bitácora de auditoría inalterable para cambios manuales, con notificación al ciudadano.

**DoD:** código compila sin advertencias, pruebas de asignación y fallback en verde, verificación visual de zona pendiente y fallback del distrito en el registro.

</details>

<details>
<summary><strong>RF-05 · Registro de tipos de residuos (SCRUM-16)</strong></summary>

> *Como administrador municipal, quiero registrar y mantener un catálogo de tipos de residuos, para estandarizar la clasificación de desechos.*

**Funcionales:**

1. Crear, modificar y listar tipos de residuos.
2. Cada tipo registra nombre, categoría, descripción, color hexadecimal, ejemplos e instrucciones de segregación.
3. Validar unicidad del nombre; rechazar duplicados con error HTTP 409.
4. Activación/desactivación lógica (`isActive`) sin borrado físico.

**Éticos / legales:**

- Cumplimiento de la Ley N.º 27314 (Gestión Integral de Residuos Sólidos).
- Transparencia ambiental: clasificación clara y verídica.

**DoD:** compila sin advertencias TypeScript, pruebas del servicio de residuos en verde y verificación visual del CRUD y del cambio de estado lógico.

</details>

<details>
<summary><strong>RF-06 · Clasificación de residuos por categoría (SCRUM-17)</strong></summary>

> *Como ciudadano, quiero consultar guías visuales educativas bilingües para aprender a clasificar correctamente mis desechos.*

**Funcionales:**

1. Guía visual de segregación por categorías (orgánicos, reciclables, no reciclables, peligrosos) alineada con la NTP 900.058.
2. Buscador interactivo con autocompletado en tiempo real sobre los tipos registrados.
3. Información y guías en formato bilingüe (español y quechua).
4. Acceso restringido a ciudadanos, listando solo tipos de residuos activos.

**Éticos / legales:**

- Inclusión cultural: soporte en quechua para acceso equitativo a la educación ambiental.
- Códigos de colores conforme a la Norma Técnica Peruana NTP 900.058.

**DoD:** frontend del catálogo y buscador compilan, pruebas de endpoints públicos al 100 % y verificación en navegador del autocompletado y el contenido español/quechua.

</details>

<details>
<summary><strong>RF-07 · Visualización de ruta planificada en mapa (SCRUM-18)</strong></summary>

> *Como ciudadano, quiero visualizar la ruta planificada del camión recolector de mi zona en el mapa, para conocer las paradas y el recorrido exacto.*

**Funcionales:**

1. Visualizar en mapa interactivo la ruta planificada asignada a la zona.
2. Ruta continua conectando los waypoints según su orden ascendente.
3. Cada parada muestra información descriptiva al hacer clic (dirección y orden).
4. Sin ruta activa en la zona: mostrar mensaje de ausencia temporal de rutas.
5. Mapa responsivo con controles básicos (zoom, paneo).

**Éticos / legales:**

- No exponer localizaciones exactas de otros ciudadanos; solo paradas públicas autorizadas (Ley N.º 29733).
- Información verídica que refleje fielmente la planificación municipal.

**DoD:** lógica de consulta de rutas compila sin errores, pruebas del servicio de rutas en verde y verificación visual del renderizado ordenado de waypoints.

</details>

<details>
<summary><strong>RF-08 · Rastreo GPS en tiempo real (SCRUM-19)</strong></summary>

> *Como ciudadano de una zona de recolección, quiero ver la ubicación en tiempo real del camión recolector, para sacar mis residuos en el momento adecuado.*

**Funcionales:**

1. Capturar la ubicación GPS del operador cada 10 segundos y transmitirla vía WebSocket.
2. Mostrar el marcador del camión en movimiento en tiempo real.
3. Ante pérdida de señal GPS: mantener la última ubicación conocida con indicador «sin señal».
4. Archivar el historial de trayectorias durante al menos 30 días (con una política de purga automática cada 24 horas para cumplir con el principio de minimización de datos).
5. Al finalizar la ruta, detener la transmisión y retirar el camión del mapa público.

**Éticos / legales:**

- Privacidad del operador (Ley N.º 29733): los ciudadanos ven el alias «Operador Autorizado», sin datos personales.
- Consentimiento explícito del operador para compartir su ubicación durante el turno.
- Transmisión solo con ruta en estado «Activa»; prohibido el rastreo fuera de la jornada.

**DoD:** lógica de tracking compila sin errores, pruebas de Socket.IO en verde y verificación visual de la transmisión anonimizada.

</details>

<details>
<summary><strong>RF-09 · Gestión de rutas con editor en mapa (SCRUM-20)</strong></summary>

> *Como administrador municipal, quiero crear, editar, duplicar y eliminar rutas con sus paradas, horarios, vehículos y operarios, para planificar la operación diaria.*

**Funcionales:**

1. Crear rutas dibujando waypoints en el mapa o duplicando una plantilla existente.
2. Definir horario de inicio/fin y asignar vehículo y operario en estado disponible.
3. Validar conflictos de horario (mismo operario o vehículo en rutas simultáneas); en conflicto, bloquear el guardado y detallar el cruce.
4. Al guardar, persistir con estado «planificada» y notificar automáticamente al operario.
5. Confirmación adicional para editar rutas activas; eliminación lógica preservando el histórico.

**Éticos / legales:**

- Registro de auditoría inmutable de modificaciones y eliminaciones.
- Salud ocupacional: validación de tiempos que respeten jornada y descansos.
- Confidencialidad de los datos del operario en paneles administrativos (Ley N.º 29733).

**DoD:** validación de conflictos y CRUD compilan al 100 %, pruebas de rutas en verde (listado, detalle, conflictos) y validación visual de la alerta de cruce horario.

</details>

<details>
<summary><strong>RF-10 · Consulta de horarios de recolección (SCRUM-21)</strong></summary>

> *Como ciudadano de Poroy, quiero consultar los horarios y días de recolección de mi zona, para sacar mis residuos a tiempo.*

**Funcionales:**

1. Mostrar horarios (días y horas) de la zona asignada del ciudadano.
2. Visualización clara: días de la semana con horas de inicio/fin.
3. Sin zona asignada (zona «pendiente»): indicar que está en revisión y sugerir la zona activa del distrito como referencia.
4. Funcionamiento offline si los datos ya fueron cargados (almacenamiento local o caché).

**Éticos / legales:**

- Minimización de datos: la consulta no expone datos personales de otros ciudadanos de la zona.

**DoD:** compila sin errores en cliente y servidor, y pasan las pruebas del servicio de rutas y zonas.

</details>

<details>
<summary><strong>RF-11 · Reporte ciudadano de incidencias (SCRUM-22)</strong></summary>

> *Como ciudadano, quiero reportar incidencias (acumulación de basura, contenedor dañado, recolección no realizada) con foto y ubicación, para que la municipalidad las atienda oportunamente.*

**Funcionales:**

1. Formulario con tipo de incidencia (acumulación, contenedor dañado, no se recolectó, otro) y descripción libre.
2. Foto opcional comprimida automáticamente en el cliente a menos de 500 KB.
3. Captura automática de GPS; si el usuario deniega permisos, permitir ingreso manual de la dirección.
4. Generar código de seguimiento único con formato `INC-YYYY-XXXXX` (ej.: INC-2026-00451).
5. Modo offline: sin conexión, guardar en IndexedDB y sincronizar automáticamente al recuperar la red.

**Éticos / legales:**

- Aviso de privacidad y consentimiento explícito para cámara y ubicación (Ley N.º 29733).
- Confidencialidad del denunciante frente a terceros y operarios.
- Recomendaciones para evitar capturar rostros o placas de terceros en las fotos.

**DoD:** validador y servicio compilan limpios, pruebas de persistencia/permisos/formato en verde, verificación visual de la compresión < 500 KB y comprobación del flujo offline.

</details>

<details>
<summary><strong>RF-12 · Notificación de cercanía del camión (SCRUM-23)</strong></summary>

> *Como ciudadano de Poroy, quiero recibir una notificación en tiempo real cuando el camión esté a menos de 500 metros de mi domicilio, para sacar mis residuos a tiempo.*

**Funcionales:**

1. Monitorear la posición GPS en tiempo real del vehículo asignado a la zona.
2. Disparar alerta cuando la distancia al domicilio sea inferior a 500 metros.
3. Transmitir la notificación por WebSockets (Socket.IO) al canal del ciudadano.
4. Debounce: máximo una notificación por evento del camión cada 5 minutos.

**Éticos / legales:**

- Consentimiento del ciudadano para notificaciones en navegador/dispositivo.
- Coordenadas de vehículos anónimas, asociadas solo al código del vehículo.

**DoD:** el servicio WebSocket corre estable tras proxies y las alertas se despachan de forma única (debounce verificado).

</details>

<details>
<summary><strong>RF-13 · Alertas de retraso o incidencias en rutas (SCRUM-24)</strong></summary>

> *Como ciudadano de Poroy, quiero recibir alertas inmediatas sobre retrasos o problemas en la ruta de mi zona, para no sacar la basura innecesariamente.*

**Funcionales:**

1. El operario puede declarar retraso o incidencia (desperfecto mecánico, congestión) con minutos estimados y motivo.
2. Persistir el retraso en el historial de la ejecución y notificar de inmediato a los ciudadanos de la zona.
3. Enviar correo formal de notificación y banner Toast en tiempo real por WebSockets.

**Éticos / legales:**

- Transparencia: información clara al ciudadano sobre las demoras del servicio.

**DoD:** compilación limpia de frontend y backend, y verificación de recepción del correo y el banner de retraso.

</details>

<details>
<summary><strong>RF-14 · Reporte de residuos recolectados por zona (SCRUM-25)</strong></summary>

> *Como administrador municipal, quiero visualizar reportes estadísticos de tipos y cantidades de residuos recolectados por zona, para optimizar rutas y evaluar metas ambientales.*

**Funcionales:**

1. Consultar reportes consolidados por zona en un período de tiempo.
2. Desglosar cantidades acumuladas: orgánicos, inorgánicos, peligrosos y no aprovechables.
3. Representaciones visuales (gráficos de barras y pastel) del volumen por zona.

**Éticos / legales:**

- Sostenibilidad: apoyo a decisiones ecológicas informadas.

**DoD:** gráficos renderizan sin errores y las cantidades coinciden al 100 % con los datos agregados en base de datos.

</details>

<details>
<summary><strong>RF-15 · Reporte de cumplimiento de rutas (SCRUM-26)</strong></summary>

> *Como administrador municipal, quiero evaluar el cumplimiento de las rutas programadas (completadas, a medias, no iniciadas, tiempos promedio), para fiscalizar el trabajo de los operarios.*

**Funcionales:**

1. Registrar automáticamente horas de inicio y fin reales de cada ejecución de ruta.
2. Consolidar reportes de eficiencia: horas planificadas vs. horas reales por ruta activa.
3. Indicadores clave: porcentaje de cumplimiento y tiempo total de recorrido.

**Éticos / legales:**

- Fiscalización objetiva basada en datos de seguimiento, no en valoraciones subjetivas.

**DoD:** acceso restringido a administradores y cálculo correcto del porcentaje de cumplimiento según waypoints visitados.

</details>

<details>
<summary><strong>RF-16 · Reporte de participación ciudadana (SCRUM-27)</strong></summary>

> *Como administrador municipal, quiero ver estadísticas de participación ciudadana (incidencias, visitas educativas, uso de alertas), para identificar zonas con baja adopción y planificar campañas.*

**Funcionales:**

1. Acumular estadísticas agregadas y anónimas: ciudadanos activos, incidencias enviadas, visitas educativas por zona.
2. Mapa de calor o tabla comparativa por zonas.
3. Recomendaciones automáticas de concientización y talleres para zonas con baja participación (calculadas comparando el índice individual `ciudadanos + incidencias + visitas` contra el promedio general de participación de todas las zonas).

**Éticos / legales:**

- Anonimización (Ley N.º 29733): sin DNI, nombres ni direcciones; datos puramente agregados por zona.

**DoD:** datos consolidados correctos en base de datos y verificación de no exposición de identidad en los payloads REST.

</details>

<details>
<summary><strong>RF-17 · Notificaciones push PWA con app cerrada (SCRUM-176)</strong></summary>

> *Como ciudadano de Poroy, quiero recibir notificaciones de cercanía del camión y de retrasos en mi zona aunque tenga la aplicación cerrada, para sacar mis residuos a tiempo sin depender de estar mirando la pantalla.*

**Contexto técnico:** RF-12 y RF-13 hoy notifican solo con la app abierta (Socket.IO + API `Notification` del navegador). El service worker (`sw.js`) ya tiene los listeners `push` y `notificationclick` preparados; falta el circuito servidor: claves VAPID, persistencia de suscripciones y envío Web Push desde los eventos existentes.

**Funcionales:**

1. Suscripción Web Push desde el navegador usando claves VAPID; persistir la suscripción (modelo `PushSubscription`) asociada al usuario y su zona.
2. Activación opt-in desde el panel del ciudadano con opción de desuscribirse en cualquier momento; estado del permiso visible.
3. Enviar push a los ciudadanos suscritos de la zona en los eventos de cercanía del camión (< 500 m, RF-12) y de retraso reportado (RF-13), con la app cerrada.
4. Reutilizar el debounce de RF-12 (máximo una notificación por camión cada 5 minutos) y depurar suscripciones inválidas (respuesta 404/410 del push service).
5. Al tocar la notificación, abrir la vista de rastreo de la zona correspondiente.

**Éticos / legales:**

- Consentimiento explícito del ciudadano para notificaciones (Ley N.º 29733); opt-in nunca activado por defecto.
- Payload del push sin datos personales: solo código de vehículo, zona y mensaje del evento.

**DoD:** pruebas unitarias del servicio de push (suscripción, debounce, depuración de suscripciones muertas) en verde, compilación limpia, y verificación E2E de recepción con la app cerrada en un dispositivo móvil.

</details>

<details>
<summary><strong>RF-18 · Registro de cantidades recolectadas al cierre de ruta (SCRUM-177)</strong></summary>

> *Como operador, quiero registrar las cantidades aproximadas recolectadas por categoría al finalizar mi ruta, para que los reportes municipales de residuos reflejen datos reales y no estimaciones.*

**Contexto técnico:** el reporte RF-14 ("residuos recolectados por zona") hoy no agrega cantidades reales — cuenta ejecuciones × tipos de residuo asignados a la ruta (`report.service.ts`). Ningún punto del sistema registra kilogramos.

**Funcionales:**

1. Al pulsar "Finalizar ruta", mostrar al operador un formulario breve para registrar los kilogramos aproximados recolectados por categoría (orgánico, reciclable, no reciclable, peligroso — NTP 900.058).
2. Persistir el registro vinculado a la ejecución de ruta (`RouteExecution`), con categoría, cantidad en kg y marca de tiempo.
3. Validaciones: cantidades numéricas ≥ 0; permitir omitir categorías que no apliquen a la ruta; el registro no bloquea el cierre de la ruta si el operador lo omite (registro con valores en cero y advertencia).
4. El reporte RF-14 agrega sobre los kilogramos reales registrados; las ejecuciones históricas sin registro se muestran diferenciadas ("sin datos de pesaje") manteniendo compatibilidad.
5. Las exportaciones PDF/Excel existentes reflejan las nuevas cantidades sin cambios de formato mayores.

**Éticos / legales:**

- Veracidad de la información pública: los reportes municipales se basan en datos declarados por el operador responsable, con trazabilidad de quién registró cada cantidad.
- Sostenibilidad: datos reales para evaluar metas ambientales y optimizar rutas.

**DoD:** pruebas unitarias del servicio de registro y de la nueva agregación de RF-14 en verde, compilación limpia, y verificación visual de que los gráficos y exportaciones muestran los kg registrados.

</details>

### Requisitos no funcionales y arquitectura (E7)

| Clave | Requisito | Estado |
|---|---|---|
| SCRUM-108 | RNF-001: Rendimiento (latencias) | ✅ Finalizado |
| SCRUM-109 | RNF-002: Disponibilidad y persistencia | ✅ Finalizado |
| SCRUM-110 | RNF-003: Seguridad | ✅ Finalizado |
| SCRUM-111 | RNF-004: Escalabilidad y distribución | ✅ Finalizado |
| SCRUM-112 | RNF-005: Usabilidad | ✅ Finalizado |
| SCRUM-113 | RNF-006: Interoperabilidad | ✅ Finalizado |
| SCRUM-114 | RNF-007: Soporte offline | ✅ Finalizado |
| SCRUM-115 | RNF-008: Cumplimiento normativo | ✅ Finalizado |
| SCRUM-116 | ARCH-01: Implementar arquitectura ADR-001 | ✅ Finalizado |

### Historias técnicas del sprint fundacional

Serie de historias técnicas ya completadas que sentaron la base del sistema (todas con el mismo ciclo de 5 subtareas):

| Clave | Historia técnica | Estado |
|---|---|---|
| SCRUM-118 | HU-01: Autenticación y JWT | ✅ Finalizado |
| SCRUM-124 | HU-02: Visualización del mapa base | ✅ Finalizado |
| SCRUM-130 | HU-03: Catálogo de residuos sólidos | ✅ Finalizado |
| SCRUM-136 | HU-04: Reporte de incidencias básico | ✅ Finalizado |
| SCRUM-142 | HU-05: Calendario visual de recolección | ✅ Finalizado |
| SCRUM-148 | HU-06: Tracking GPS con WebSockets | ✅ Finalizado |
| SCRUM-154 | HU-07: Soporte Offline para reportes | ✅ Finalizado |
| SCRUM-160 | HU-08: Base de datos Geoespacial (PostGIS) | ✅ Finalizado |

### Equipo Scrum

| Integrante | RF asignados |
|---|---|
| Edmil Jampier Saire Bustamante | RF-01, RF-06, RF-08, RF-10 + historias técnicas HU-01…HU-08 |
| Celia Quispe Quispe | RF-02, RF-05, RF-11 |
| Christian Pumaccahua Cusihuamán | RF-03, RF-07, RF-12 |
| Medaly Lozano Llacctahuamán | RF-04, RF-09, RF-13 |

---

## Metodología

Desarrollo iterativo con **SCRUM**. El product backlog se organizó en 4 sprints priorizando los módulos de mayor impacto operativo (rastreo GPS, rutas, zonas) antes que los módulos informativos y educativos.

**Indicadores de desempeño académico cubiertos:**

| Indicador | Descripción | RF asociados |
|-----------|-------------|--------------|
| AG-C01.1 | Impacto en desarrollo sostenible | RF-06, RF-11, RF-14, RF-16 |
| AG-C01.2 | Responsabilidades éticas, legales y sociales | RF-01, RF-02, RF-04, RF-11, RF-14 |
| AG-C01.3 | Comunicación eficiente de resultados | RF-12, RF-13, RF-14, RF-15, RF-16 |

---

*Proyecto desarrollado para el curso de Desarrollo de Software I — Universidad, Cusco 2025.*
