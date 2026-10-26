# VILLEDA Finanzas — Modelo de datos (v1)

Este documento explica, con ejemplos, el modelo de datos definido en `ARQUITECTURA.md` §2 y las reglas que
lo mantienen coherente. `ARQUITECTURA.md` es el contrato; si algo difiere, manda el contrato.

## 1. Principios

1. **Un solo objeto `estado`** en memoria, con `version` y varias colecciones (arreglos de registros).
2. **Todo registro de dinero tiene ámbito**: `ambito: 'empresa' | 'personal'`. Facturas, clientes,
   proveedores, cuentas por pagar y comisiones son de empresa por definición (ámbito implícito).
3. **Montos siempre positivos** con dos decimales (`VF.util.round2`). El signo lo da el `tipo` del
   movimiento, no el número. Única excepción: el **saldo** de una cuenta de crédito, que es negativo cuando
   hay deuda.
4. **Fechas** internas en `YYYY-MM-DD` (hora local). `creado` y `actualizado` en ISO 8601 completo.
5. **Identificadores**: `VF.util.uid(prefijo)` → `prefijo_` + 10 caracteres base36 aleatorios
   (`crypto.getRandomValues`), p. ej. `mov_k3f9z1q0ab`. Los datos de ejemplo terminan en `_demo`.
6. **Nada se calcula al guardar.** Saldos, estados de factura, pendientes, amortizaciones y disponibles se
   derivan siempre con `VF.calc` a partir de los registros; no se persisten.
7. **Moneda** única `MXN` en v1 (`ajustes.moneda`).

## 2. Esqueleto del estado

```json
{
  "version": 1,
  "ajustes": {},
  "cuentas": [],
  "movimientos": [],
  "clientes": [],
  "facturas": [],
  "proveedores": [],
  "cuentasPorPagar": [],
  "comisiones": [],
  "prestamos": [],
  "presupuestos": [],
  "metas": [],
  "categorias": { "empresa": { "ingreso": [], "gasto": [] }, "personal": { "ingreso": [], "gasto": [] } }
}
```

## 3. `ajustes`

```json
{
  "nombreUsuario": "Zeus",
  "nombreEmpresa": "VILLEDA Inc",
  "moneda": "MXN",
  "autobloqueoMin": 5,
  "reservaOperativaDias": 30,
  "asistenteEndpoint": "",
  "tema": "auto",
  "datosEjemplo": true
}
```

| Campo | Significado |
|---|---|
| `autobloqueoMin` | Minutos de inactividad (o pestaña oculta) antes de bloquear. `0` = nunca. |
| `reservaOperativaDias` | Horizonte de compromisos que `disponibleEmpresa()` descuenta del líquido de la empresa. |
| `asistenteEndpoint` | URL del servidor de IA opcional (vacío = asistente local). Ver `IA-SERVIDOR.md`. |
| `tema` | `'auto'` (sigue al sistema), `'claro'`, `'oscuro'`. |
| `datosEjemplo` | `true` mientras existan registros `_demo`; controla el banner de ejemplo. |

## 4. `cuentas`

Una cuenta es cualquier lugar donde hay dinero o deuda: banco, billetera digital, efectivo, inversión o
tarjeta de crédito.

```json
{
  "id": "cta_7h2m9x0p1q",
  "ambito": "empresa",
  "nombre": "Mercado Pago Empresa",
  "banco": "Mercado Pago",
  "tipo": "billetera",
  "saldoInicial": 420000,
  "moneda": "MXN",
  "limiteCredito": null,
  "diaCorte": null,
  "diaPago": null,
  "color": "#1D4ED8",
  "activa": true,
  "creado": "2026-06-01T09:00:00.000Z",
  "actualizado": "2026-06-01T09:00:00.000Z"
}
```

Tarjeta de crédito personal (saldo negativo = deuda):

```json
{
  "id": "cta_q1w2e3r4t5",
  "ambito": "personal",
  "nombre": "Tarjeta Nu",
  "banco": "Nu",
  "tipo": "credito",
  "saldoInicial": -12450,
  "moneda": "MXN",
  "limiteCredito": 60000,
  "diaCorte": 12,
  "diaPago": 2,
  "color": "#0F766E",
  "activa": true,
  "creado": "2026-06-01T09:00:00.000Z",
  "actualizado": "2026-06-01T09:00:00.000Z"
}
```

- `tipo`: `'cheques' | 'ahorro' | 'credito' | 'efectivo' | 'inversion' | 'billetera'`.
- `saldoInicial` es el saldo en la fecha en que empezaste a registrar; todo lo demás se deriva:
  **saldo = saldoInicial + ingresos − gastos − transferencias salientes + transferencias entrantes**
  (`VF.calc.saldoCuenta`).
- `diaCorte` y `diaPago` (1-31) sólo aplican a `'credito'`; con ellos `vencimientos()` genera el pago de la
  tarjeta por la deuda completa en el próximo `diaPago`.
- `activa: false` = archivada: no aparece en `saldosPorAmbito()` ni en los formularios, pero conserva su
  historial (no se puede eliminar si tiene movimientos; ver §13).
- El **líquido** de un ámbito es la suma de los saldos de las cuentas activas que no son `'credito'`; el
  **crédito** es la suma (negativa) de las tarjetas; **total = líquido + crédito**.

## 5. `movimientos`

El corazón del modelo. Tres tipos: `'ingreso'`, `'gasto'`, `'transferencia'`.

Gasto de empresa sencillo:

```json
{
  "id": "mov_a1b2c3d4e5",
  "ambito": "empresa",
  "cuentaId": "cta_7h2m9x0p1q",
  "tipo": "gasto",
  "monto": 18500,
  "fecha": "2026-10-20",
  "categoria": "Materiales",
  "descripcion": "Cemento y varilla obra Lomas",
  "contraparte": "Cementos del Bajío",
  "cuentaDestinoId": null,
  "facturaId": null,
  "cxpId": null,
  "prestamoId": null,
  "comisionId": null,
  "estado": "confirmado",
  "etiquetas": [],
  "creado": "2026-10-20T18:12:40.000Z",
  "actualizado": "2026-10-20T18:12:40.000Z"
}
```

Ingreso vinculado al pago de una factura (lo crea "Registrar pago"; no se edita a mano):

```json
{
  "id": "mov_f6g7h8i9j0",
  "ambito": "empresa",
  "cuentaId": "cta_7h2m9x0p1q",
  "tipo": "ingreso",
  "monto": 145000,
  "fecha": "2026-10-15",
  "categoria": "Ventas",
  "descripcion": "Pago factura F-0004",
  "contraparte": "Desarrollos Altavista SA de CV",
  "facturaId": "fac_z9y8x7w6v5",
  "estado": "confirmado",
  "etiquetas": []
}
```

Transferencia entre dos cuentas del **mismo** ámbito:

```json
{
  "id": "mov_k1l2m3n4o5",
  "ambito": "personal",
  "cuentaId": "cta_bbva_personal",
  "cuentaDestinoId": "cta_mp_personal",
  "tipo": "transferencia",
  "monto": 10000,
  "fecha": "2026-10-03",
  "categoria": "Transferencia entre cuentas",
  "descripcion": "Apartar para el viaje",
  "estado": "confirmado",
  "etiquetas": []
}
```

Transferencia **entre ámbitos** (empresa → personal), ver §14:

```json
{
  "id": "mov_p6q7r8s9t0",
  "ambito": "empresa",
  "cuentaId": "cta_7h2m9x0p1q",
  "cuentaDestinoId": "cta_bbva_personal",
  "tipo": "transferencia",
  "monto": 25000,
  "fecha": "2026-10-01",
  "categoria": "Retiro de socio",
  "descripcion": "Retiro mensual",
  "estado": "confirmado",
  "etiquetas": []
}
```

Reglas:

| Regla | Detalle |
|---|---|
| `monto` | Siempre > 0, dos decimales. |
| `ambito` | Debe coincidir con el ámbito de la cuenta origen (`cuentaId`). |
| `tipo` ingreso / gasto | Suman o restan al saldo de `cuentaId`; cuentan en ingresos, gastos, utilidad, presupuestos y categorías del ámbito. |
| `tipo` transferencia | Resta en `cuentaId`, suma en `cuentaDestinoId`. **Nunca** cuenta como ingreso ni gasto en utilidad, balance, presupuestos ni gastos por categoría. Sí altera saldos y disponible. |
| `categoria` | Debe pertenecer a `categorias[ambito][tipo]` para ingreso/gasto. Transferencias: `'Transferencia entre cuentas'` (mismo ámbito), `'Retiro de socio'` o `'Aportación de capital'` (cruzadas). Sin categoría → aparece en `movimientosARevisar().sinCategoria` (salvo transferencias). |
| `estado` | `'confirmado'` o `'revisar'`. Los marcados `'revisar'` siguen contando en saldos, pero el panel y el asistente los listan para revisión. |
| Vínculos | `facturaId`, `cxpId`, `prestamoId`, `comisionId`: a lo sumo uno. Un movimiento vinculado es de sólo lectura desde Panel/Empresa; se modifica o elimina desde su origen (factura, CxP, préstamo, comisión). |
| `etiquetas` | Texto libre. Reservadas para el futuro importador: `importado:<institucion>`, `lote:YYYYMMDD-hhmm`, `mp:<SOURCE_ID>` (ver `CONEXION-BANCOS.md` §7.3). |
| Duplicado | Misma cuenta, fecha, monto y tipo → `movimientosARevisar().duplicados`. |
| Atípico | Gasto > 3 × la mediana de su categoría (mínimo 4 muestras) → `atipicos`. |

## 6. `clientes` y `facturas`

```json
{
  "id": "cli_u1v2w3x4y5",
  "nombre": "Desarrollos Altavista SA de CV",
  "rfc": "DAL180512KJ3",
  "email": "pagos@altavista-ejemplo.mx",
  "telefono": "55 5555 0101",
  "notas": "Pagan a 30 días vía transferencia.",
  "creado": "2026-05-10T15:00:00.000Z",
  "actualizado": "2026-05-10T15:00:00.000Z"
}
```

Factura emitida con un pago parcial:

```json
{
  "id": "fac_z9y8x7w6v5",
  "folio": "F-0004",
  "clienteId": "cli_u1v2w3x4y5",
  "fechaEmision": "2026-09-15",
  "fechaVencimiento": "2026-10-15",
  "concepto": "Estimación 2 — Torre Altavista",
  "subtotal": 250000,
  "iva": 40000,
  "total": 290000,
  "estado": "emitida",
  "pagos": [
    { "id": "pag_1a2b3c4d5e", "fecha": "2026-10-15", "monto": 145000, "cuentaId": "cta_7h2m9x0p1q", "movimientoId": "mov_f6g7h8i9j0" }
  ],
  "uuidCfdi": "3FA85F64-5717-4562-B3FC-2C963F66AFA6",
  "notas": "",
  "creado": "2026-09-15T16:30:00.000Z",
  "actualizado": "2026-10-15T12:00:00.000Z"
}
```

- `iva = round2(subtotal × 0.16)`, `total = subtotal + iva`. Ámbito implícito: empresa.
- `folio` autoincremental `F-0001`, `F-0002`… `uuidCfdi` es informativo (la app no timbra; ver `HOJA-DE-RUTA.md` fase 5).
- `estado` **almacenado**: `'borrador' | 'emitida' | 'cancelada'`. El estado **mostrado** lo deriva
  `VF.calc.estadoFactura(f, hoy)`:

| Derivado | Condición |
|---|---|
| `pagada` | pendiente ≤ 0 |
| `parcial` | 0 < pagado < total (aunque ya esté vencida; su pendiente sí cuenta en `porCobrar().vencido`) |
| `vencida` | pendiente > 0 y `fechaVencimiento` < hoy |
| `emitida` | lo demás |

- Cada pago crea un movimiento `ingreso`, categoría `Ventas`, con `facturaId`, en una cuenta **de empresa**.
  `pagadoFactura(f)` = suma de `pagos[].monto`; `pendienteFactura(f)` = `total − pagado`.
- `antiguedadCxC()` clasifica el pendiente por días desde el vencimiento en `0-30`, `31-60`, `61-90`, `90+`
  (lo que aún no vence cuenta en `0-30`).

## 7. `proveedores` y `cuentasPorPagar`

```json
{
  "id": "prov_h1j2k3l4m5",
  "nombre": "Cementos y Agregados del Bajío SA de CV",
  "rfc": "CAB090415HG8",
  "categoria": "Materiales",
  "contacto": "Ing. Laura Medina",
  "telefono": "477 555 0201",
  "email": "ventas@cementosbajio-ejemplo.mx",
  "notas": "Crédito a 30 días."
}
```

```json
{
  "id": "cxp_n6o7p8q9r0",
  "proveedorId": "prov_h1j2k3l4m5",
  "concepto": "Cemento gris 120 bultos",
  "fecha": "2026-10-05",
  "fechaVencimiento": "2026-11-04",
  "monto": 36400,
  "pagos": [],
  "estado": "pendiente",
  "notas": "",
  "creado": "2026-10-05T10:00:00.000Z",
  "actualizado": "2026-10-05T10:00:00.000Z"
}
```

- Ámbito implícito: empresa. `estado` almacenado `'pendiente' | 'cancelada'`; derivados `pagada`, `parcial`,
  `vencida` con la misma lógica que las facturas (`estadoCxP`).
- Cada pago crea un movimiento `gasto`, categoría `Proveedores`, con `cxpId`.

## 8. `comisiones`

```json
{
  "id": "com_s1t2u3v4w5",
  "beneficiario": "Arq. Daniel Ortega",
  "facturaId": "fac_z9y8x7w6v5",
  "base": 250000,
  "porcentaje": 3,
  "monto": 7500,
  "fecha": "2026-10-30",
  "estado": "pendiente",
  "movimientoId": null,
  "notas": "",
  "creado": "2026-09-15T16:40:00.000Z",
  "actualizado": "2026-09-15T16:40:00.000Z"
}
```

- `monto = round2(base × porcentaje / 100)`; `base` puede venir de la factura (subtotal) o ser manual.
- Al pagarla se crea un movimiento `gasto`, categoría `Comisiones`, con `comisionId`, y `estado` pasa a `'pagada'`.
- Si se elimina la factura vinculada, `facturaId` queda en `null` (la comisión sobrevive).
- Las pendientes aparecen en `vencimientos()` como pagos con su `fecha`.

## 9. `prestamos`

Préstamo recibido por la empresa (amortización francesa):

```json
{
  "id": "pre_x1y2z3a4b5",
  "ambito": "empresa",
  "tipo": "recibido",
  "contraparte": "Banco ejemplo",
  "principal": 300000,
  "tasaAnual": 18,
  "plazoMeses": 24,
  "fechaInicio": "2026-03-10",
  "diaPago": 10,
  "pagos": [
    { "id": "pag_c6d7e8f9g0", "fecha": "2026-04-10", "monto": 14977.65, "capital": 10477.65, "interes": 4500, "movimientoId": "mov_h1i2j3k4l5" }
  ],
  "estado": "activo",
  "notas": "",
  "creado": "2026-03-10T09:00:00.000Z",
  "actualizado": "2026-04-10T09:00:00.000Z"
}
```

- `tipo`: `'recibido'` (debo) o `'otorgado'` (me deben). `estado`: `'activo' | 'liquidado' | 'cancelado'`.
- `pagoMensual = P·r / (1 − (1+r)^−n)` con `r = tasaAnual/100/12`; si `tasaAnual = 0`, `P/n`. En cada paso
  `interés = round2(saldo × r)`, `capital = round2(pago − interés)`; la última cuota cierra el saldo en 0.
- `saldoPrestamo = principal − Σ pagos[].capital`. `proximoPagoPrestamo()` se calcula sobre el saldo real.
- Cada pago crea un movimiento en una cuenta **del mismo ámbito**: `gasto` categoría `Préstamos` si es
  recibido; `ingreso` categoría `Otros ingresos` si es otorgado. Lleva `prestamoId`.

## 10. `presupuestos`

```json
{ "id": "pre_m1n2o3p4q5", "ambito": "personal", "periodo": "2026-10", "categoria": "Supermercado", "monto": 9000 }
```

- Un registro por ámbito + periodo (`YYYY-MM`) + categoría.
- `presupuestoVsReal()` compara contra los gastos reales del mes (las transferencias no cuentan); categorías
  con gasto pero sin presupuesto aparecen con `presupuesto: 0, sinPresupuesto: true`.

## 11. `metas` (sólo personal)

```json
{
  "id": "meta_r6s7t8u9v0",
  "ambito": "personal",
  "nombre": "Fondo de emergencia (6 meses de gastos)",
  "objetivo": 150000,
  "cuentaId": "cta_mp_personal",
  "fechaMeta": "2027-06-30",
  "notas": ""
}
```

- El avance (`metaProgreso`) es el **saldo actual de `cuentaId`** (acotado a ≥ 0) contra `objetivo`; no se
  guarda un "ahorrado" aparte. Si la cuenta no existe, ahorrado = 0.

## 12. `categorias`

```json
{
  "empresa": {
    "ingreso": ["Ventas", "Servicios", "Anticipos", "Otros ingresos", "Aportación de capital"],
    "gasto": ["Nómina", "Renta", "Proveedores", "Materiales", "Comisiones", "Servicios (luz, agua, internet)",
              "Impuestos", "Software", "Transporte", "Publicidad", "Honorarios", "Préstamos", "Retiro de socio", "Otros gastos"]
  },
  "personal": {
    "ingreso": ["Sueldo", "Retiro de socio", "Intereses", "Otros ingresos"],
    "gasto": ["Vivienda", "Supermercado", "Restaurantes", "Transporte", "Gasolina", "Salud", "Educación",
              "Entretenimiento", "Suscripciones", "Ropa", "Tarjeta de crédito", "Préstamos", "Ahorro", "Aportación de capital", "Otros gastos"]
  }
}
```

`'Transferencia entre cuentas'` no está en estas listas a propósito: las transferencias no son ingresos ni
gastos. `'Retiro de socio'` y `'Aportación de capital'` sí aparecen en ambas listas para el caso manual
descrito en §14.3.

## 13. Reglas de integridad (`VF.store`)

### Al crear (`agregar`)
- Asigna `id`, `creado` y `actualizado` si faltan.
- `COLECCION_INVALIDA` si la colección no existe. `REGISTRO_INVALIDO` si no es un objeto.
- `AMBITO_INVALIDO` en `cuentas`, `movimientos`, `prestamos`, `presupuestos` y `metas` si `ambito` no es
  `'empresa'` ni `'personal'` (`metas` asume `'personal'` si falta).
- `ID_DUPLICADO` si ya existe un registro con ese `id`. `BLOQUEADO` si la bóveda está cerrada.

### Al actualizar (`actualizar`)
- Fusión superficial; `actualizado = ahora`. Se ignoran cambios a `id` y `creado`.

### Al eliminar (`eliminar`)

| Colección | Regla |
|---|---|
| `cuentas` | Si algún movimiento la usa como origen **o destino** → `Error('CUENTA_CON_MOVIMIENTOS')`. Alternativa: archivar (`activa: false`). |
| `clientes` | Con facturas → `Error('CLIENTE_CON_FACTURAS')`. |
| `proveedores` | Con cuentas por pagar → `Error('PROVEEDOR_CON_CXP')`. |
| `facturas` | Elimina también sus movimientos vinculados (`facturaId`) y pone `facturaId = null` en comisiones que la referencien. |
| `cuentasPorPagar`, `prestamos`, `comisiones` | Eliminan sus movimientos vinculados (`cxpId`, `prestamoId`, `comisionId`). |
| `movimientos` | Un movimiento vinculado no debe eliminarse directo desde la UI; se quita el pago en su origen. |

### Otras invariantes que los módulos deben respetar
- El `ambito` de un movimiento es el de su cuenta origen; los formularios sólo ofrecen cuentas del ámbito.
- Los pagos de facturas y CxP sólo pueden ir a cuentas de **empresa**; los de préstamos, a cuentas del
  **mismo ámbito** del préstamo.
- Todo cálculo recibe un ámbito o lanza `AMBITO_REQUERIDO` (salvo `combinado()`, `vencimientos()`,
  `porCobrar()`, `porPagar()`, `comisionesPendientes()` y `resumenParaIA()`, que ya separan por dentro).

## 14. Transferencias entre ámbitos

### 14.1 La regla
Una transferencia cuyo origen y destino pertenecen a ámbitos distintos:

1. Lleva `ambito` = ámbito de la cuenta **origen**.
2. Lleva `categoria` **`'Retiro de socio'`** si va de empresa a personal, o **`'Aportación de capital'`** si va de
   personal a empresa. El formulario lo avisa antes de guardar.
3. Afecta los **saldos** de ambas cuentas (y por tanto el líquido, el disponible y la proyección de flujo de
   los dos ámbitos).
4. **No** cuenta como ingreso ni gasto en ningún ámbito: no cambia la utilidad de la empresa, el balance
   personal, los presupuestos ni los gastos por categoría.
5. Aparece en la lista de movimientos de **ambas** cuentas (el filtro por `cuentaId` incluye las
   transferencias recibidas), siempre con el badge del ámbito origen.

### 14.2 Ejemplo numérico
Antes: Mercado Pago Empresa 420,000; BBVA Débito (personal) 48,000. Utilidad del mes empresa: 120,000.

Se registra `transferencia` 25,000 de Mercado Pago Empresa → BBVA Débito (`ambito: 'empresa'`,
`categoria: 'Retiro de socio'`).

| Cifra | Antes | Después |
|---|---|---|
| Saldo Mercado Pago Empresa | 420,000 | 395,000 |
| Saldo BBVA Débito | 48,000 | 73,000 |
| Líquido empresa | … | − 25,000 |
| Líquido personal | … | + 25,000 |
| Utilidad empresa del mes | 120,000 | **120,000** (sin cambio) |
| Ingresos personales del mes | … | **sin cambio** |
| Presupuesto personal | … | **sin cambio** |

### 14.3 Caso manual (no recomendado por defecto)
Si, por indicación del contador, se desea que un retiro se vea como **ingreso personal** (p. ej. un sueldo
que el dueño se asigna), se registran **dos movimientos independientes**: un `gasto` empresa (categoría
`Nómina` o `Retiro de socio`) y un `ingreso` personal (categoría `Sueldo` o `Retiro de socio`). Entonces sí
afectan utilidad y presupuestos. Es una decisión contable, no de la app; por eso ambas categorías existen en
las listas. La transferencia cruzada (§14.1) sigue siendo la forma predeterminada.

### 14.4 Lo que nunca debe pasar
- Un movimiento `ingreso`/`gasto` cuya cuenta sea de otro ámbito que su `ambito`.
- Una transferencia con `cuentaDestinoId` igual a `cuentaId`.
- Sumar `empresa.liquido + personal.liquido` en cualquier KPI que no sea el "Total combinado (solo
  informativo)".

## 15. Persistencia y respaldos

- Bóveda: `localStorage['vf.boveda.v1'] = { version: 1, salt, iv, datos, verificador }`.
  `salt` base64 (16 bytes); clave PBKDF2-SHA256 (310,000 iteraciones) → AES-GCM 256; `datos` = estado
  cifrado; `verificador` = cifrado de `'VF-OK'` con la misma clave, para distinguir contraseña incorrecta de
  datos corruptos (`CONTRASENA_INCORRECTA` vs `DATOS_CORRUPTOS`).
- Las escrituras se encolan y serializan; `guardar()` devuelve `Promise<boolean>` y emite `'cambio'`
  (o `'error'` si falla, p. ej. por cuota de `localStorage`).
- **Exportar cifrado**: el mismo objeto de la bóveda tal cual está persistido. **Exportar plano**: el estado
  en JSON legible (con advertencia).
- **Importar**: detecta el formato; si es cifrado con otro `salt`, pide la contraseña del respaldo
  (`CONTRASENA_REQUERIDA`) y re-cifra con la clave actual. Reemplaza el estado completo.
- `borrarDatosEjemplo()` elimina todo registro (y pago anidado) con `id` terminado en `_demo` y pone
  `ajustes.datosEjemplo = false`.

## 16. Versionado

`version: 1`. Cualquier cambio de forma (campo nuevo obligatorio, colección nueva, cambio de semántica)
debe: (1) subir `version`; (2) añadir una migración en `VF.store` que transforme estados anteriores al
cargar/importar; (3) documentar aquí el cambio y en `ARQUITECTURA.md` → "Extensiones". Los campos previstos
para fases futuras (`etiquetas` de importación, `uuidCfdi`, `asistenteEndpoint`) ya existen para no forzar
una migración temprana.
