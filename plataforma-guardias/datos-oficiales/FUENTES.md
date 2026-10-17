# Instalaciones de salud de Nayarit — fuentes oficiales

Catálogo de instalaciones para `plataforma-guardias`, construido solo con fuentes oficiales y reproducible con `construir_instalaciones.py` (Python 3, sin dependencias).

## Archivos

| Archivo | Qué es |
|---|---|
| `instalaciones_nayarit_imss_plantilla.csv` | **Para el importador de la plataforma.** Las 396 unidades IMSS + IMSS-Bienestar en el formato de `public/plantillas/instalaciones.csv` (21 columnas). |
| `instalaciones_nayarit_imss.csv` | Mismas 396 unidades con todas las columnas de origen. |
| `instalaciones_nayarit.csv` | Catálogo completo: 646 establecimientos en operación de todas las instituciones (incluye privados, SSA, ISSSTE, DIF, Cruz Roja…). Mismas columnas. |
| `fuentes/clues_nayarit_202608_completo.csv` | Extracto íntegro de CLUES para Nayarit (1,149 filas: 646 en operación, 502 fuera de operación, 1 pendiente), 68 columnas originales. |
| `fuentes/imss_directorio_nayarit_2026-10-17.csv` | Directorio público de instalaciones IMSS en Nayarit (135 entradas: 42 clínicas, 11 hospitales, 82 IMSS-Bienestar). |
| `fuentes/inegi_municipios_nayarit_2026-10-17.json` | Nombres oficiales INEGI de los 20 municipios (para la columna `municipio` de la plantilla). |
| `fuentes/inegi_localidades_nayarit_2026-10-17.csv` | Catálogo INEGI de localidades de Nayarit con coordenadas (4,800 localidades, 20 municipios). |
| `imss_directorio_sin_clues.csv` | Unidades del directorio IMSS sin equivalente en CLUES. Hoy: 0. |

## Fuentes

### 1. CLUES — Secretaría de Salud / DGIS (fuente principal)
- Página: http://www.dgis.salud.gob.mx/contenidos/intercambio/clues_gobmx.html
- Archivo: `ESTABLECIMIENTO_SALUD_202608.xlsx` (publicado 2026-09-23), hoja `CLUES_202608`. 64,450 establecimientos nacionales.
- Filtro: `CLAVE DE LA ENTIDAD = 18` (Nayarit).
- Aporta: clave CLUES, institución, tipología, nivel de atención, municipio y localidad INEGI, domicilio, CP, teléfono, lat/lng, estatus.

### 2. Directorio de instalaciones IMSS (validación cruzada)
- https://www.imss.gob.mx/directorio?dom_estado=Nayarit&catalogada_como=Clínica|Hospital|IMSS%20Bienestar
- Solo HTML paginado con botón «Descargar PDF»; no ofrece CSV. Se extrajeron nombre, tipo, dirección, horario y la coordenada del enlace a Google Maps.
- Repite unidades (una entrada por servicio) y a veces con coordenadas distintas entre sí.

### 3. Catálogo de localidades INEGI (validación geográfica)
- API: `https://gaia.inegi.org.mx/wscatgeo/v2/localidades/18/<municipio>` (20 llamadas, una por municipio).
- Aporta la coordenada oficial del centro de cada localidad. Se usa para detectar coordenadas CLUES fuera de su localidad o fuera del estado.

### 4. datos.gob.mx (revisado; no aporta Nayarit)
- API: `https://www.datos.gob.mx/api/3/action/package_search?q=...` (sin `www` y la ruta antigua `/busca/` devuelven 403/404).
- Búsquedas: `imss`, `unidades medicas`, `clues`, `establecimientos de salud`, `nayarit salud`.
- Único directorio: **«Directorio de Unidades Médicas de IMSS-BIENESTAR»** (`/dataset/directorio_unidades_medicas_imss_bienestar`, 2026-04-02). Solo publica Campeche, CDMX y Chiapas (1er trim. 2025); no existe archivo de Nayarit.
- El IMSS ordinario no publica directorio de unidades en datos.gob.mx. `datos.imss.gob.mx` respondía 503 el 2026-10-17.
- Verificación puntual con OpenStreetMap (Nominatim) para UMAA 28 Tepic: confirma la coordenada del directorio IMSS (Blvd. Colosio esq. Paseo del Lago).

## Validación realizada

| Comprobación | Resultado |
|---|---|
| Coordenadas vacías en CLUES (en operación) | 0 |
| Unidades IMSS/IMSS-Bienestar con entrada en el directorio IMSS | 116 de 396 |
| · coinciden (≤ 1 km) | 109 |
| · coordenada CLUES errónea, corregida con el directorio IMSS | 7 (UMF 5, 20, 24, 25 Tepic con coordenada copiada; UMAA 28 Tepic; UMF 19 Mezcales ubicada en Compostela; UMF 14 Compostela) |
| Coordenada CLUES fuera de Nayarit, sustituida por el centro de la localidad INEGI | 7 (todas Farmacias Similares; CLUES las ubica en Tamaulipas) |
| Marcadas `revisar` (se conserva CLUES) | 17: 10 con coordenada compartida entre unidades co-ubicadas (p. ej. centro de salud mental + centro comunitario) y 7 cuya localidad registrada no coincide con la coordenada (caravanas móviles, IST Huajicori registrado en Acaponeta, Clinavchila, farmacias) |
| Unidades del directorio IMSS que no están en CLUES | 0 |

Reglas del script:
- Solo `ESTATUS DE OPERACION = EN OPERACION`.
- Una coordenada CLUES es *dudosa* si está repetida en otra unidad con domicilio distinto, a > 10 km de su localidad registrada, o a > 10 km de cualquier localidad de Nayarit.
- Si es dudosa y el directorio IMSS tiene otra coordenada cerca de la localidad → se usa la del IMSS (`coord_origen = Directorio IMSS`).
- Si está fuera de Nayarit y no hay directorio → centro de la localidad INEGI (`coord_origen = Localidad INEGI (aprox.)`).
- En cualquier otro caso se conserva CLUES y se anota `revisar`. La coordenada original siempre queda en `validacion`.
- Nombres repetidos en CLUES (p. ej. «La Presa») solo se emparejan con el directorio si hay coincidencia a ≤ 1 km.

## Columnas

`clues, nombre, nombre_corto, clave_institucion, institucion, tipo_establecimiento, tipologia, nivel_atencion, cve_municipio (INEGI 18XXX), municipio, cve_localidad (INEGI 18XXXYYYY), localidad, direccion, codigo_postal, telefono, lat, lng, coord_origen, estatus, fuente, fuente_fecha, validacion`

Instituciones (`clave_institucion`): IMB IMSS-Bienestar 273 · SMP privados 158 · IMS IMSS 123 · SSA 29 · IST ISSSTE 23 · DIF 20 · CRO Cruz Roja 6 · otras 14.

## Plantilla del importador (`instalaciones_nayarit_imss_plantilla.csv`)

Columnas, en este orden: `identificador_interno, nombre_oficial, clave_unidad, categoria, descripcion, estado, municipio, direccion, latitud, longitud, telefono, horario, servicios, servicios_verificados, fuente, url_fuente, fecha_verificacion, estado_verificacion, observaciones, zona_horaria, tolerancia_minutos`.

| Columna | Regla aplicada |
|---|---|
| `identificador_interno` | Vacío (lo genera la BD). |
| `clave_unidad` | CLUES (única por fila). |
| `categoria` | **hospitales**: tipo de establecimiento «DE HOSPITALIZACIÓN» (todos son 2.º o 3.er nivel). **umf**: IMSS con tipología «Unidad de Medicina Familiar». **delegaciones**: OOAD de Nayarit. **oficinas-administrativas**: otras oficinas (hoy ninguna). **otras-instalaciones**: tipo «DE APOYO» (almacenes) y «DE ASISTENCIA SOCIAL» (Centros de Seguridad Social). **otras-unidades-medicas**: el resto (UMR, rurales de IMSS-Bienestar, UNEMES, unidades móviles, caravanas, brigadas, CARO, UMAA). |
| `descripcion` | Tipología · nivel de atención · institución. |
| `municipio` | Nombre oficial INEGI (`mgem/18`), p. ej. «Bahía de Banderas», «Del Nayar», «Ruiz» (INEGI lo escribe sin acento). |
| `horario` | Del directorio IMSS cuando existe (114 filas); vacío en el resto. |
| `servicios` / `servicios_verificados` | Vacío / «no». |
| `fuente` / `url_fuente` | «CLUES DGIS (corte 2026-08)» más directorio IMSS o INEGI cuando intervinieron; URLs de descarga separadas por « \| ». |
| `estado_verificacion` | «verificado» con `fecha_verificacion = 2026-10-17` en las 116 filas cruzadas con el directorio IMSS (coinciden a ≤ 1 km o corregidas con él); «pendiente» en las demás. |
| `observaciones` | `coord_origen`, institución, tipología, nivel, localidad y el texto de `validacion`. |
| `zona_horaria` | America/Mazatlan; Bahía de Banderas → America/Bahia_Banderas. |
| `tolerancia_minutos` | 10. |

Resumen: 396 filas · hospitales 21 · umf 21 · otras-unidades-medicas 349 · otras-instalaciones 4 · delegaciones 1 · verificadas 116.

## Decisiones
- **Conjunto de carga:** IMSS + IMSS-Bienestar (`CARGA_INSTITUCIONES` en el script). El catálogo completo queda disponible para ampliar a SSA/ISSSTE cambiando esa tupla.
- La plantilla `public/plantillas/instalaciones.csv` de la rama `claude/plataforma-guardias` no estaba publicada al generar esto. Si sus columnas difieren, ajustar el diccionario `salida.append({...})`; todos los campos de origen están en `fuentes/`.

## Mantenimiento
- CLUES se publica mensualmente: cambiar `CLUES_VERSION`, reemplazar el extracto en `fuentes/` y reejecutar.
- Las 17 filas `revisar` no bloquean la carga; solo 10 pertenecen al conjunto IMSS y son unidades co-ubicadas o móviles.

## Variante solo IMSS (`instalaciones_nayarit_solo_imss_plantilla.csv`)

Mismas columnas que `instalaciones_nayarit_imss_plantilla.csv`, filtrada a las unidades con `clave_institucion = IMS` (Instituto Mexicano del Seguro Social). Excluye las 273 unidades de Servicios de Salud IMSS-Bienestar, que son otra institución. Úsala si el alcance del directorio es solo el IMSS ordinario. Se generó a partir de los dos CSV anteriores (cruce por CLUES); no requiere volver a consultar las fuentes.
