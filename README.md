# Tumoto Store MX

Plataforma web E-Commerce para motocicletas, refacciones y accesorios. El
frontend es una SPA construida con React y Vite; el backend utiliza Firebase
Cloud Functions de segunda generación, refactorizado a TypeScript estricto para
Node.js 20 y operaciones transaccionales en Cloud Firestore.

El proyecto cubre catálogo, búsqueda, filtros, detalle de producto, carrito
persistido y flujo de creación de pedidos. No procesa pagos reales: los pedidos
se crean como solicitudes `pending` y requieren una futura integración de
pasarela de pago con confirmación en servidor.

## Arquitectura general

```text
React/Vite SPA
    │
    ├── Firebase Web SDK ──────── Cloud Firestore (catálogo)
    │
    └── Firebase Callable ─────── Cloud Functions v2
                                      │
                                      ├── createOrder
                                      └── expirePendingOrders
```

### Frontend

- React 19, JSX y Vite 8.
- React Router para navegación SPA.
- React Bootstrap, Bootstrap y Lucide React para la interfaz.
- Context API para el estado global del carrito.
- `localStorage` para persistencia del carrito.
- Firebase Web SDK para Firestore, Functions y App Check.

### Backend serverless

- Firebase Cloud Functions de segunda generación.
- Node.js 20.
- Firebase Admin SDK para operaciones privilegiadas.
- Cloud Firestore como catálogo y persistencia de pedidos.
- Firebase App Check con reCAPTCHA Enterprise.
- Región de ejecución: `us-central1`.
- TypeScript estricto con salida compilada compatible con el runtime de Firebase.

> El código fuente del backend está escrito en TypeScript. La configuración
> actual compila a CommonJS (`functions/lib/src/index.js`) porque es el formato
> de ejecución configurado para Firebase Functions v2. La arquitectura de
> módulos, tipos e interfaces está preparada para una evolución posterior del
> formato de módulos sin cambiar el contrato público de las funciones.

## Arquitectura del backend (`functions/`)

La carpeta `functions/` está organizada por responsabilidades para mantener
separadas las funciones de infraestructura, validación, tipos y lógica de
dominio:

```text
functions/
├── src/
│   ├── index.ts
│   ├── order-calculations.ts
│   ├── schemas.ts
│   └── types.ts
├── tests/
│   └── schemas.test.ts
├── package.json
├── package-lock.json
└── tsconfig.json
```

### TypeScript estricto y tipos de dominio

[`functions/src/types.ts`](functions/src/types.ts) define los contratos internos
del dominio:

- `Buyer`: nombre, teléfono y correo del comprador.
- `Item`: precio, stock y título de un producto consultado en Firestore.
- `RequestedItem`: identificador y cantidad solicitada por el cliente.
- `OrderItem`: producto incorporado al pedido con precio vigente y subtotal.
- `Order`: comprador, artículos, total, estado y marcas de tiempo.
- `CreateOrderRequest` y `CreateOrderResponse`: contrato de la callable function.

[`functions/tsconfig.json`](functions/tsconfig.json) habilita `strict: true`,
verificación consistente de mayúsculas/minúsculas, tipos de Node.js y una salida
compilada en `functions/lib/`. El entry point publicado es
`functions/lib/src/index.js`.

### Validación estricta con Zod

[`functions/src/schemas.ts`](functions/src/schemas.ts) centraliza esquemas Zod
reutilizables para `createOrder`:

- Valida comprador, correo, teléfono y límites de longitud.
- Valida `requestId` con formato UUID.
- Rechaza arrays vacíos, demasiados artículos o cantidades fuera de rango.
- Rechaza identificadores duplicados.
- Normaliza espacios en nombre/teléfono y convierte el correo a minúsculas.
- Convierte los fallos de Zod en `HttpsError("invalid-argument")` con una
  colección estructurada de `path`, `code` y `message`.

El payload sigue siendo compatible con el cliente React:

```json
{
  "buyer": {
    "name": "Ana Pérez",
    "phone": "5551234567",
    "email": "ana@example.com"
  },
  "items": [
    { "id": "moto-1", "quantity": 2 }
  ],
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Cálculos financieros robustos

[`functions/src/order-calculations.ts`](functions/src/order-calculations.ts)
mantiene la lógica monetaria fuera del controlador:

- Convierte el precio unitario a centavos mediante `Math.round(price * 100)`.
- Calcula cada subtotal en centavos.
- Acumula el total sin depender de sumas de números decimales.
- Convierte a unidades monetarias únicamente al construir la respuesta y el
  documento persistido.

Este diseño reduce errores de redondeo durante las transacciones de Firestore y
permite probar los cálculos sin depender de Firebase.

### Lógica de dominio y funciones públicas

[`functions/src/index.ts`](functions/src/index.ts) exporta las funciones
manteniendo los nombres existentes y el contrato del frontend.

#### `createOrder`

Callable function protegida con App Check que:

1. Valida y normaliza el payload con Zod.
2. Usa `requestId` como identificador determinista del pedido.
3. Devuelve el pedido existente si el mismo `requestId` se reintenta.
4. Lee nuevamente precio y stock desde Firestore.
5. Rechaza productos inexistentes o sin stock suficiente.
6. Calcula subtotales y total en centavos.
7. Descuenta stock y crea el pedido dentro de una transacción.
8. Devuelve `{ orderId, total }`.

#### `expirePendingOrders`

Función programada cada 60 minutos que:

- Busca hasta 100 pedidos con estado `pending`.
- Expira los pedidos con más de 24 horas.
- Devuelve las cantidades reservadas al stock cuando el producto sigue
  disponible.
- Actualiza el pedido a `expired`.
- Ejecuta las operaciones por pedido dentro de una transacción.

Las operaciones relevantes generan logs estructurados mediante
`firebase-functions/logger`, incluyendo el inicio del procesamiento, pedidos
idempotentes, creación exitosa y expiración.

## Modelo de datos de Firestore

### Colección `items`

Cada producto debe contener:

| Campo | Tipo | Descripción |
|---|---|---|
| `title` | `string` | Nombre del producto |
| `price` | `number` | Precio en MXN |
| `img` | `string` | URL de imagen |
| `category` | `string` | Categoría |
| `description` | `string` | Descripción |
| `stock` | `integer` | Unidades disponibles |

El cliente puede leer el catálogo, pero no puede modificarlo desde el navegador.

### Colección `orders`

La función de servidor crea documentos con comprador, artículos, precios
vigentes, subtotales, total, estado y timestamps. Los estados contemplados son:

- `pending`
- `expired`

El acceso cliente a esta colección está bloqueado por las reglas actuales de
Firestore.

## Pruebas automatizadas y calidad

La carpeta `functions/` utiliza Vitest para probar la lógica backend sin
acoplarla a una instancia remota de Firebase.

La suite en [`functions/tests/schemas.test.ts`](functions/tests/schemas.test.ts)
verifica:

- Aceptación y normalización del payload compatible con React.
- Rechazo de productos duplicados.
- Rechazo de cantidades inválidas.
- Cálculo correcto de subtotales en centavos.
- Cálculo correcto del total acumulado en centavos.

### Scripts de `functions/`

Ejecutar desde `functions/`:

```bash
npm run build       # Compila TypeScript a lib/
npm run lint        # Verifica tipos con tsc --noEmit
npm test            # Ejecuta Vitest en modo CI
npm run test:watch  # Ejecuta Vitest en modo watch
npm run emulators   # Inicia Functions y Firestore Emulator
```

La verificación explícita de tipos también puede ejecutarse con:

```bash
npx tsc --noEmit
```

En la raíz del proyecto:

```bash
npm run lint
npm test
npm run build
```

La integración continua ejecuta lint, pruebas, auditorías de dependencias,
compilación del backend, build del frontend y verificación de sintaxis del
artefacto compilado.

## Guía de desarrollo y pruebas

### Requisitos

- Node.js 20 para el backend de Firebase Functions.
- npm.
- Firebase CLI para despliegue y emuladores.
- Un proyecto Firebase con Firestore y una aplicación web configurada.

### Instalación

Desde la raíz del repositorio:

```bash
npm install
```

Instalar las dependencias del backend:

```bash
cd functions
npm install
cd ..
```

En Windows PowerShell, si la política de ejecución bloquea `npm.ps1`, utilizar
`npm.cmd`.

### Variables de entorno del frontend

Crear `.env.local` en la raíz:

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_APPCHECK_SITE_KEY=...
```

La clave de App Check debe ser la clave pública del sitio. Las credenciales
secretas de Admin SDK nunca deben incluirse en el cliente, en `.env.local` ni en
el repositorio.

### Desarrollo del frontend

Desde la raíz:

```bash
npm run dev
```

### Pruebas del backend

Desde la raíz:

```bash
cd functions
npm test
npm run lint
npm run build
npx tsc --noEmit
```

### Emuladores locales de Firebase

Con Firebase CLI instalado, desde la raíz:

```bash
firebase emulators:start
```

También puede utilizarse el script específico del backend:

```bash
cd functions
npm run emulators
```

El script específico inicia los emuladores de Functions y Firestore. Para que la
aplicación web consuma emuladores, debe añadirse la configuración de conexión
correspondiente en el entorno local.

## Despliegue

El alias Firebase `default` apunta al proyecto `tumoto-store`. Para desplegar:

```bash
firebase login
firebase use tumoto-store
npm --prefix functions ci
npm --prefix functions run build
firebase deploy --only functions
```

`firebase.json` ejecuta automáticamente `npm --prefix functions run build` como
paso `predeploy`.

Para desplegar las reglas de Firestore:

```bash
firebase deploy --only firestore:rules
```

El despliegue de Cloud Functions requiere el plan Firebase Blaze. Antes de
publicar, confirmar que App Check Enterprise esté registrado para la aplicación
web y que `VITE_FIREBASE_APPCHECK_SITE_KEY` contenga la clave pública correcta.

## Seguridad y alcance

- El cliente nunca es autoridad para fijar precios; el servidor consulta los
  valores vigentes en Firestore.
- `requestId` proporciona idempotencia ante reintentos de checkout.
- App Check reduce solicitudes no verificadas, pero no sustituye autenticación,
  autorización, validación ni controles antiabuso.
- Las reglas permiten lectura pública de `items` y bloquean escrituras de
  clientes.
- Las reglas bloquean el acceso cliente a `orders`.
- No hay registro de usuarios, historial de pedidos, panel administrativo,
  almacenamiento propio de imágenes ni pagos reales.
- Antes de operar en producción comercial se debe integrar una pasarela de pago
  con confirmación server-side, webhooks, idempotencia y pruebas de concurrencia.

## Estado de tecnologías no utilizadas

El backend actual no utiliza Express, BullMQ, Redis, Pino, Docker Compose,
Bull-Board ni un `BillingMockService`. La arquitectura vigente es serverless con
Firebase; cualquier migración a una API Express con workers y Redis sería una
decisión arquitectónica futura independiente de esta refactorización.
