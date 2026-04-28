# ESPECIFICACIÓN DE REQUISITOS FUNCIONALES

## Diseño e Implementación de un Sistema Inteligente de Recolección de Residuos Sólidos Segregados para la Gestión Ambiental Urbana en la ciudad del Cusco

**Documento académico — Proyecto universitario**
**Metodología:** SCRUM
**Versión:** 1.0

---

## 1. Introducción

El presente documento describe la Especificación de Requisitos Funcionales (ERF) del proyecto "Sistema Inteligente de Recolección de Residuos Sólidos Segregados", orientado a mejorar la gestión ambiental urbana en la ciudad del Cusco. Su objetivo es definir, de manera clara y verificable, las funcionalidades que el sistema debe ofrecer a sus usuarios.

La especificación se ha elaborado tomando como referencia el estándar IEEE 830 y se enmarca dentro de un proceso de desarrollo ágil basado en SCRUM, lo que permite que cada requisito funcional pueda ser convertido en una o varias historias de usuario y planificarse iterativamente.

---

## 2. Alcance del sistema

El sistema permitirá a la municipalidad y a los ciudadanos del Cusco gestionar de manera integral el proceso de recolección de residuos sólidos segregados. Comprende módulos para la administración de usuarios y zonas, gestión de tipos de residuos, monitoreo de rutas en tiempo real, una aplicación móvil para los ciudadanos, un sistema de alertas y un módulo de reportes y analítica para la toma de decisiones.

Quedan fuera del alcance la fabricación o instalación de hardware específico (sensores IoT en contenedores), el desarrollo de pasarelas de pago, así como la integración con sistemas tributarios municipales, los cuales podrán considerarse en fases posteriores.

---

## 3. Actores del sistema

- **Ciudadano:** usuario que reside en una zona del Cusco y utiliza la aplicación móvil para consultar horarios, recibir alertas y reportar incidencias.
- **Operador municipal:** conductor o ayudante del camión recolector que ejecuta las rutas y registra incidencias operativas.
- **Administrador municipal:** personal de la municipalidad encargado de gestionar zonas, rutas, usuarios y de generar reportes.
- **Sistema:** agente automatizado que ejecuta tareas como detección de cercanía, generación de alertas y cálculo de indicadores.

---

## 4. Definiciones, acrónimos y abreviaturas

- **RF:** Requisito Funcional.
- **ERF:** Especificación de Requisitos Funcionales.
- **GPS:** Sistema de Posicionamiento Global.
- **JWT:** JSON Web Token, mecanismo de autenticación basado en tokens firmados.
- **NTP:** Norma Técnica Peruana.
- **SCRUM:** Marco de trabajo ágil para el desarrollo iterativo e incremental de software.

---

## 5. Resumen de requisitos funcionales

| Código | Nombre del requisito | Módulo | Prioridad |
|--------|----------------------|--------|-----------|
| RF-01 | Registro de ciudadanos | Gestión de usuarios y zonas | Alta |
| RF-02 | Autenticación e inicio de sesión | Gestión de usuarios y zonas | Alta |
| RF-03 | Gestión de zonas de recolección | Gestión de usuarios y zonas | Alta |
| RF-04 | Asignación de usuarios a zonas | Gestión de usuarios y zonas | Media |
| RF-05 | Registro de tipos de residuos | Gestión de residuos | Media |
| RF-06 | Clasificación de residuos por categoría | Gestión de residuos | Alta |
| RF-07 | Visualización de rutas de recolección | Monitoreo de rutas | Alta |
| RF-08 | Seguimiento en tiempo real de camiones | Monitoreo de rutas | Alta |
| RF-09 | Gestión de rutas por el administrador | Monitoreo de rutas | Alta |
| RF-10 | Consulta de horarios de recolección | Aplicación móvil | Alta |
| RF-11 | Reporte ciudadano de incidencias | Aplicación móvil | Alta |
| RF-12 | Notificación de cercanía del camión | Sistema de alertas | Alta |
| RF-13 | Alertas de retraso o incidencias en rutas | Sistema de alertas | Media |
| RF-14 | Reporte de residuos recolectados por zona | Reportes y analítica | Alta |
| RF-15 | Reporte de cumplimiento de rutas | Reportes y analítica | Media |
| RF-16 | Reporte de participación ciudadana | Reportes y analítica | Media |

---

## 6. Detalle de los requisitos funcionales

### 6.1 Módulo 1: Gestión de usuarios y zonas

#### RF-01 — Registro de ciudadanos

| Campo | Detalle |
|-------|---------|
| **Módulo** | Módulo 1: Gestión de usuarios y zonas |
| **Descripción** | El sistema debe permitir el registro de ciudadanos mediante la captura de datos personales, validando la información ingresada y creando una cuenta asociada a una zona de recolección dentro de la ciudad del Cusco. |
| **Actor(es)** | Ciudadano, Sistema |
| **Precondiciones** | El ciudadano debe contar con un dispositivo con acceso a Internet y un correo electrónico válido. |
| **Flujo principal** | 1. El ciudadano accede al formulario de registro desde la aplicación móvil o web.<br>2. Ingresa nombres, apellidos, DNI, correo electrónico, contraseña, dirección y selecciona su distrito/zona.<br>3. El sistema valida que el DNI y el correo no estén registrados previamente.<br>4. El sistema envía un código de verificación al correo electrónico del ciudadano.<br>5. El ciudadano confirma su cuenta y el sistema activa el registro. |
| **Flujo alternativo** | 3a. Si el DNI o correo ya están registrados, el sistema muestra un mensaje de error.<br>5a. Si el código de verificación no se confirma en 24 horas, la cuenta se elimina automáticamente. |
| **Postcondiciones** | El ciudadano queda registrado y puede acceder al sistema con sus credenciales. |
| **Criterios de aceptación** | • Validación de campos obligatorios y formato de correo y DNI.<br>• Cifrado de la contraseña en base de datos.<br>• Confirmación obligatoria por correo electrónico.<br>• Cumplimiento de la Ley N.° 29733 de Protección de Datos Personales. |
| **Prioridad** | Alta |

#### RF-02 — Autenticación e inicio de sesión

| Campo | Detalle |
|-------|---------|
| **Módulo** | Módulo 1: Gestión de usuarios y zonas |
| **Descripción** | El sistema debe permitir la autenticación segura de usuarios (ciudadanos, operadores municipales y administradores) mediante credenciales y control de roles. |
| **Actor(es)** | Ciudadano, Operador, Administrador |
| **Precondiciones** | El usuario debe estar registrado y tener su cuenta activa. |
| **Flujo principal** | 1. El usuario ingresa correo electrónico y contraseña.<br>2. El sistema valida las credenciales contra la base de datos.<br>3. El sistema identifica el rol del usuario y genera un token de sesión (JWT).<br>4. El usuario es redirigido al panel correspondiente según su rol. |
| **Flujo alternativo** | 2a. Si las credenciales son incorrectas, se muestra un mensaje de error.<br>2b. Tras 5 intentos fallidos, la cuenta se bloquea por 15 minutos. |
| **Postcondiciones** | El usuario inicia sesión y obtiene acceso a las funcionalidades correspondientes a su rol. |
| **Criterios de aceptación** | • Autenticación basada en JWT con tiempo de expiración.<br>• Recuperación de contraseña por correo electrónico.<br>• Registro de intentos de acceso fallidos. |
| **Prioridad** | Alta |

#### RF-03 — Gestión de zonas de recolección

| Campo | Detalle |
|-------|---------|
| **Módulo** | Módulo 1: Gestión de usuarios y zonas |
| **Descripción** | El administrador municipal debe poder crear, editar, listar y desactivar zonas de recolección, definiendo sus límites geográficos sobre un mapa interactivo. |
| **Actor(es)** | Administrador municipal |
| **Precondiciones** | El administrador debe haber iniciado sesión con su rol correspondiente. |
| **Flujo principal** | 1. El administrador ingresa al módulo de gestión de zonas.<br>2. Selecciona la opción 'Crear nueva zona'.<br>3. Define el nombre, descripción, distrito y traza el polígono geográfico sobre el mapa.<br>4. El sistema valida que el polígono no se superponga con zonas existentes.<br>5. El sistema guarda la zona y la muestra en el listado. |
| **Flujo alternativo** | 4a. Si existe superposición, el sistema notifica el conflicto y solicita corregir. |
| **Postcondiciones** | La zona queda registrada y disponible para asignación de ciudadanos y rutas. |
| **Criterios de aceptación** | • Mapa interactivo basado en OpenStreetMap o Google Maps.<br>• Almacenamiento de coordenadas en formato GeoJSON.<br>• Solo el rol Administrador puede crear o modificar zonas. |
| **Prioridad** | Alta |

#### RF-04 — Asignación de usuarios a zonas

| Campo | Detalle |
|-------|---------|
| **Módulo** | Módulo 1: Gestión de usuarios y zonas |
| **Descripción** | El sistema debe asignar automáticamente al ciudadano a una zona de recolección a partir de la dirección registrada o permitir su asignación manual por el administrador. |
| **Actor(es)** | Sistema, Administrador |
| **Precondiciones** | Las zonas de recolección deben estar previamente registradas. |
| **Flujo principal** | 1. El sistema detecta la dirección y coordenadas del ciudadano al registrarse.<br>2. Se ejecuta una validación geoespacial para identificar la zona contenedora.<br>3. El sistema asocia al ciudadano con la zona correspondiente.<br>4. El administrador puede modificar la asignación si es necesario. |
| **Flujo alternativo** | 2a. Si la dirección no pertenece a ninguna zona, se asigna a una 'zona pendiente' para revisión manual. |
| **Postcondiciones** | El ciudadano queda vinculado a una zona, lo que habilita la recepción de notificaciones específicas. |
| **Criterios de aceptación** | • Algoritmo de detección punto-en-polígono.<br>• Notificación al ciudadano sobre su zona asignada.<br>• Auditoría de cambios manuales de asignación. |
| **Prioridad** | Media |

---

### 6.2 Módulo 2: Gestión de residuos

#### RF-05 — Registro de tipos de residuos

| Campo | Detalle |
|-------|---------|
| **Módulo** | Módulo 2: Gestión de residuos |
| **Descripción** | El sistema debe permitir registrar y mantener el catálogo de tipos de residuos con su descripción, ícono representativo e instrucciones de manejo. |
| **Actor(es)** | Administrador |
| **Precondiciones** | El administrador debe estar autenticado. |
| **Flujo principal** | 1. El administrador accede al módulo 'Tipos de residuos'.<br>2. Crea un nuevo tipo indicando nombre, descripción, categoría y ejemplos.<br>3. Sube un ícono o imagen representativa.<br>4. El sistema almacena el tipo y lo hace visible para los ciudadanos. |
| **Flujo alternativo** | 2a. Si el nombre ya existe, el sistema bloquea el registro y muestra advertencia. |
| **Postcondiciones** | El catálogo de tipos de residuos queda actualizado. |
| **Criterios de aceptación** | • Soporte para imágenes en formato PNG/JPG.<br>• Posibilidad de habilitar/deshabilitar tipos sin eliminarlos.<br>• Información alineada con la Ley N.° 27314 de Gestión Integral de Residuos Sólidos. |
| **Prioridad** | Media |

#### RF-06 — Clasificación de residuos por categoría

| Campo | Detalle |
|-------|---------|
| **Módulo** | Módulo 2: Gestión de residuos |
| **Descripción** | El sistema debe clasificar los residuos en al menos tres categorías: orgánicos, reciclables y no reciclables, y permitir consultar guías visuales sobre cada categoría. |
| **Actor(es)** | Ciudadano, Administrador |
| **Precondiciones** | Los tipos de residuos deben estar registrados. |
| **Flujo principal** | 1. El ciudadano accede a la sección 'Aprende a segregar'.<br>2. Visualiza las categorías y sus ejemplos.<br>3. Puede buscar un residuo específico para conocer su categoría.<br>4. El sistema devuelve la categoría correspondiente con instrucciones. |
| **Flujo alternativo** | 3a. Si el residuo no se encuentra en el catálogo, el ciudadano puede sugerirlo al administrador. |
| **Postcondiciones** | El ciudadano dispone de información clara para realizar la segregación adecuada. |
| **Criterios de aceptación** | • Buscador con autocompletado.<br>• Contenido educativo accesible y multilingüe (español/quechua).<br>• Coherencia con la NTP 900.058 sobre código de colores. |
| **Prioridad** | Alta |

---

### 6.3 Módulo 3: Monitoreo de rutas

#### RF-07 — Visualización de rutas de recolección

| Campo | Detalle |
|-------|---------|
| **Módulo** | Módulo 3: Monitoreo de rutas |
| **Descripción** | El sistema debe permitir visualizar sobre un mapa las rutas planificadas de los camiones recolectores, con sus paradas, horarios y zona asignada. |
| **Actor(es)** | Ciudadano, Operador, Administrador |
| **Precondiciones** | Las rutas deben estar registradas y asociadas a una zona. |
| **Flujo principal** | 1. El usuario ingresa al módulo 'Rutas'.<br>2. Selecciona una zona o ruta.<br>3. El sistema muestra la ruta sobre el mapa con sus puntos de parada y horarios estimados.<br>4. El usuario puede consultar el detalle de cada parada. |
| **Flujo alternativo** | 2a. Si no existen rutas registradas para la zona, se muestra un mensaje informativo. |
| **Postcondiciones** | El usuario obtiene información clara sobre la planificación de rutas. |
| **Criterios de aceptación** | • Visualización en mapa interactivo.<br>• Diferenciación visual entre rutas activas, completadas y pendientes.<br>• Tiempo de respuesta inferior a 3 segundos. |
| **Prioridad** | Alta |

#### RF-08 — Seguimiento en tiempo real de camiones

| Campo | Detalle |
|-------|---------|
| **Módulo** | Módulo 3: Monitoreo de rutas |
| **Descripción** | El sistema debe rastrear la ubicación en tiempo real de los camiones recolectores mediante GPS, y mostrar su posición actual en el mapa para los ciudadanos y operadores. |
| **Actor(es)** | Ciudadano, Operador, Sistema |
| **Precondiciones** | Los camiones deben contar con dispositivo GPS o aplicación móvil del operador activa. |
| **Flujo principal** | 1. El operador inicia su jornada y activa el seguimiento desde su aplicación móvil.<br>2. El dispositivo envía coordenadas al servidor cada 10 segundos.<br>3. El sistema actualiza la posición del camión en el mapa de los ciudadanos.<br>4. Los ciudadanos pueden consultar la cercanía del camión a su domicilio. |
| **Flujo alternativo** | 2a. Si se pierde la señal GPS, el sistema muestra la última ubicación conocida con marca de tiempo. |
| **Postcondiciones** | La trayectoria queda registrada en la base de datos para fines de auditoría y reportes. |
| **Criterios de aceptación** | • Frecuencia de actualización configurable.<br>• Consumo eficiente de datos móviles del operador.<br>• Histórico de ubicaciones almacenado por al menos 30 días. |
| **Prioridad** | Alta |

#### RF-09 — Gestión de rutas por el administrador

| Campo | Detalle |
|-------|---------|
| **Módulo** | Módulo 3: Monitoreo de rutas |
| **Descripción** | El administrador debe poder crear, editar y asignar rutas de recolección, definiendo paradas, horarios, vehículo asignado y operador responsable. |
| **Actor(es)** | Administrador |
| **Precondiciones** | Deben existir zonas, vehículos y operadores registrados. |
| **Flujo principal** | 1. El administrador ingresa al módulo 'Gestión de rutas'.<br>2. Crea una nueva ruta y traza su recorrido sobre el mapa.<br>3. Asigna paradas, horarios estimados, un vehículo y un operador.<br>4. El sistema guarda la ruta y la asocia a la zona correspondiente. |
| **Flujo alternativo** | 3a. Si el operador o vehículo ya están asignados a otra ruta en el mismo horario, el sistema lo advierte. |
| **Postcondiciones** | La ruta queda disponible para ejecución y monitoreo. |
| **Criterios de aceptación** | • Validación de conflictos de horario.<br>• Posibilidad de duplicar rutas previas como plantilla.<br>• Trazabilidad de cambios (auditoría). |
| **Prioridad** | Alta |

---

### 6.4 Módulo 4: Aplicación móvil

#### RF-10 — Consulta de horarios de recolección

| Campo | Detalle |
|-------|---------|
| **Módulo** | Módulo 4: Aplicación móvil |
| **Descripción** | La aplicación móvil debe permitir al ciudadano consultar los horarios de recolección de su zona, diferenciados por tipo de residuo y día de la semana. |
| **Actor(es)** | Ciudadano |
| **Precondiciones** | El ciudadano debe estar registrado y asociado a una zona. |
| **Flujo principal** | 1. El ciudadano abre la aplicación e inicia sesión.<br>2. Accede a la sección 'Mis horarios'.<br>3. El sistema muestra la programación semanal por tipo de residuo.<br>4. El ciudadano puede activar recordatorios para días específicos. |
| **Flujo alternativo** | 3a. Si no hay horarios definidos, el sistema lo informa y sugiere contactar a la municipalidad. |
| **Postcondiciones** | El ciudadano conoce los horarios de recolección y puede planificar su segregación. |
| **Criterios de aceptación** | • Soporte offline para consulta de horarios previamente cargados.<br>• Calendario visual con íconos por categoría.<br>• Tiempo de carga inferior a 2 segundos. |
| **Prioridad** | Alta |

#### RF-11 — Reporte ciudadano de incidencias

| Campo | Detalle |
|-------|---------|
| **Módulo** | Módulo 4: Aplicación móvil |
| **Descripción** | El ciudadano debe poder reportar incidencias relacionadas con la gestión de residuos (acumulación, contenedores dañados, recolección no realizada) adjuntando foto, descripción y geolocalización. |
| **Actor(es)** | Ciudadano, Operador |
| **Precondiciones** | El ciudadano debe estar autenticado y conceder permiso de ubicación y cámara. |
| **Flujo principal** | 1. El ciudadano selecciona 'Reportar incidencia'.<br>2. Elige el tipo de incidencia y describe el problema.<br>3. Captura una fotografía y confirma su ubicación.<br>4. El sistema registra la incidencia y la asigna al área correspondiente.<br>5. El ciudadano recibe un código de seguimiento. |
| **Flujo alternativo** | 3a. Si el ciudadano no puede tomar foto, puede continuar el reporte sin imagen.<br>4a. Si no hay conexión, la incidencia se guarda localmente y se sincroniza al recuperar Internet. |
| **Postcondiciones** | La incidencia queda registrada y visible en el panel de la municipalidad. |
| **Criterios de aceptación** | • Compresión de imágenes para optimizar el uso de datos.<br>• Notificación al ciudadano sobre el estado del reporte.<br>• Almacenamiento responsable de datos personales y de ubicación. |
| **Prioridad** | Alta |

---

### 6.5 Módulo 5: Sistema de alertas

#### RF-12 — Notificación de cercanía del camión

| Campo | Detalle |
|-------|---------|
| **Módulo** | Módulo 5: Sistema de alertas |
| **Descripción** | El sistema debe enviar una notificación push al ciudadano cuando el camión recolector se aproxime a su domicilio dentro de un radio configurable. |
| **Actor(es)** | Ciudadano, Sistema |
| **Precondiciones** | El ciudadano debe tener la aplicación instalada y notificaciones activadas. |
| **Flujo principal** | 1. El sistema monitorea la posición del camión en tiempo real.<br>2. Cuando el camión entra dentro del radio configurado (por defecto 500 m) del domicilio del ciudadano, se dispara una alerta.<br>3. La aplicación muestra la notificación con el tiempo estimado de llegada. |
| **Flujo alternativo** | 2a. Si el ciudadano desactivó las notificaciones, no se envía la alerta. |
| **Postcondiciones** | El ciudadano puede prepararse para entregar sus residuos a tiempo. |
| **Criterios de aceptación** | • Una sola notificación por evento para evitar saturación.<br>• Configuración personalizable del radio de alerta.<br>• Cumplimiento del consentimiento informado de notificaciones. |
| **Prioridad** | Alta |

#### RF-13 — Alertas de retraso o incidencias en rutas

| Campo | Detalle |
|-------|---------|
| **Módulo** | Módulo 5: Sistema de alertas |
| **Descripción** | El sistema debe notificar a los ciudadanos de una zona cuando una ruta presente retrasos o cambios significativos en su horario. |
| **Actor(es)** | Ciudadano, Operador, Sistema |
| **Precondiciones** | El operador debe reportar el retraso o el sistema debe detectarlo automáticamente. |
| **Flujo principal** | 1. El operador registra una incidencia o el sistema detecta retraso superior al umbral configurado.<br>2. El sistema identifica los ciudadanos afectados.<br>3. Se envía una notificación masiva con el motivo y nuevo horario estimado. |
| **Flujo alternativo** | 1a. Si el operador no puede reportar, el administrador puede registrarlo manualmente. |
| **Postcondiciones** | Los ciudadanos están informados oportunamente y pueden ajustar su rutina. |
| **Criterios de aceptación** | • Umbral de retraso configurable (por defecto 20 minutos).<br>• Mensaje claro, breve y en lenguaje sencillo.<br>• Registro histórico de alertas enviadas. |
| **Prioridad** | Media |

---

### 6.6 Módulo 6: Reportes y analítica

#### RF-14 — Reporte de residuos recolectados por zona

| Campo | Detalle |
|-------|---------|
| **Módulo** | Módulo 6: Reportes y analítica |
| **Descripción** | El sistema debe generar reportes consolidados sobre el volumen de residuos recolectados por zona, categoría y periodo, con gráficos y opciones de exportación. |
| **Actor(es)** | Administrador |
| **Precondiciones** | Debe existir información registrada por los operadores sobre las recolecciones. |
| **Flujo principal** | 1. El administrador ingresa al módulo de reportes.<br>2. Selecciona el reporte 'Residuos por zona' y filtra por fechas y categoría.<br>3. El sistema muestra gráficos y tablas con la información.<br>4. El administrador puede exportar a PDF o Excel. |
| **Flujo alternativo** | 3a. Si no hay datos para los filtros seleccionados, el sistema lo informa. |
| **Postcondiciones** | El administrador dispone de información para la toma de decisiones. |
| **Criterios de aceptación** | • Gráficos interactivos (barras, líneas, tortas).<br>• Exportación en PDF y Excel.<br>• Datos anonimizados respecto a los ciudadanos. |
| **Prioridad** | Alta |

#### RF-15 — Reporte de cumplimiento de rutas

| Campo | Detalle |
|-------|---------|
| **Módulo** | Módulo 6: Reportes y analítica |
| **Descripción** | El sistema debe medir y reportar el cumplimiento de las rutas planificadas frente a las ejecutadas, identificando paradas omitidas y desviaciones. |
| **Actor(es)** | Administrador |
| **Precondiciones** | Debe existir histórico de rutas planificadas y ejecutadas con datos GPS. |
| **Flujo principal** | 1. El administrador selecciona el reporte de cumplimiento.<br>2. Elige el periodo y la(s) ruta(s) a evaluar.<br>3. El sistema calcula porcentaje de cumplimiento, paradas omitidas y desviación promedio.<br>4. Se muestran resultados con código de colores (verde, amarillo, rojo). |
| **Flujo alternativo** | 3a. Si una ruta no tiene datos GPS, se excluye del cálculo y se notifica. |
| **Postcondiciones** | El administrador identifica oportunidades de mejora operativa. |
| **Criterios de aceptación** | • Indicadores cuantitativos auditables.<br>• Comparativo entre periodos.<br>• Posibilidad de profundizar (drill-down) por operador o vehículo. |
| **Prioridad** | Media |

#### RF-16 — Reporte de participación ciudadana

| Campo | Detalle |
|-------|---------|
| **Módulo** | Módulo 6: Reportes y analítica |
| **Descripción** | El sistema debe generar un reporte sobre el nivel de participación ciudadana en el sistema, considerando registros, incidencias reportadas y consultas educativas. |
| **Actor(es)** | Administrador |
| **Precondiciones** | Debe existir actividad histórica de ciudadanos en el sistema. |
| **Flujo principal** | 1. El administrador accede al reporte de participación.<br>2. Selecciona el periodo y la zona.<br>3. El sistema muestra indicadores: ciudadanos activos, incidencias reportadas, contenido educativo consultado.<br>4. Se permite exportar el reporte. |
| **Flujo alternativo** | 3a. Si una zona tiene baja participación, el sistema sugiere acciones de difusión. |
| **Postcondiciones** | Se cuenta con métricas para medir el impacto social del sistema. |
| **Criterios de aceptación** | • Indicador de impacto alineado con AG-C01.1.<br>• Datos agregados sin exponer información personal.<br>• Comparación entre zonas. |
| **Prioridad** | Media |

---

## 7. Trazabilidad con indicadores de desempeño

La siguiente sección establece la relación entre los requisitos funcionales propuestos y los indicadores de desempeño definidos en el silabo del curso, garantizando la alineación entre la solución técnica y los resultados de aprendizaje esperados.

| Indicador | Descripción | Requisitos asociados |
|-----------|-------------|----------------------|
| **AG-C01.1** | Analiza el impacto de las soluciones a problemas complejos de computación en el desarrollo sostenible. | RF-06, RF-11, RF-14, RF-16 |
| **AG-C01.2** | Asume responsabilidades éticas, legales y sociales en la práctica profesional. | RF-01, RF-02, RF-04, RF-11, RF-14 |
| **AG-C01.3** | Comunica de manera eficiente los resultados de su trabajo en el contexto de la computación y la sociedad. | RF-12, RF-13, RF-14, RF-15, RF-16 |

---

## 8. Conclusiones

La presente especificación define dieciséis requisitos funcionales agrupados en seis módulos, los cuales abordan integralmente la problemática descrita: recolección no optimizada, falta de comunicación con la ciudadanía, baja cultura de segregación, ausencia de reportes para la toma de decisiones y gestión reactiva.

Su implementación, mediante SCRUM y entregas iterativas, permitirá generar valor temprano para la municipalidad y los ciudadanos, contribuyendo al desarrollo sostenible de la ciudad del Cusco mediante una gestión ambiental urbana más eficiente, transparente y participativa.
