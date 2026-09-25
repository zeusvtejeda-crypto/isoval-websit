# ISOVAL — Sistema de diseño

Documenta las decisiones reales de `index.html`. Si cambias un valor aquí, cámbialo en el `<style>` (bloque `:root`) y viceversa.

## Dirección visual

Estudio de arquitectura y construcción en Tepic, Nayarit. El lenguaje sale del logo isométrico: **plano técnico**. Fondo papel, tinta casi negra, un solo acento teal, líneas finas de 1px, esquinas rectas (radio 2px) y tipografía condensada para títulos. Debe sentirse preciso y tranquilo, nunca decorado.

- Público: familias y negocios de Nayarit que van a diseñar, construir o remodelar.
- Acción principal: **iniciar un proyecto** (WhatsApp o formulario de contacto).
- Las fotos de obra son el protagonista; la interfaz se hace a un lado.

## Color

| Token | Valor | Uso |
|---|---|---|
| `--paper` | `#F5F3EE` | Fondo base |
| `--paper-2` | `#EBE7DE` | Fondo alterno (franja de confianza, Nosotros) |
| `--white` | `#FFFFFF` | Secciones claras y tarjetas |
| `--ink` | `#1B1E1F` | Texto principal, botón primario, secciones oscuras |
| `--ink-soft` | `#4B4F52` | Texto de párrafo |
| `--gray` | `#5A5C5F` | Metadatos, numeración |
| `--line` / `--line-strong` | `#DBD6C9` / `#C7C1B1` | Divisores y bordes |
| `--teal` | `#2B7D89` | Acento de marca: palabra destacada en títulos (texto grande), iconos, marcos |
| `--teal-a11y` | `#256B75` | Teal para texto pequeño y foco (≥4.5:1 sobre papel) |
| `--teal-soft` | `#DEEAEA` | Fila de proyecto activa |
| `#7FBFC7` | — | Teal claro, solo sobre fondo oscuro (eyebrows, foco, hover) |
| `#E8A15C` / `#F0B47A` | — | Error, solo sobre fondo oscuro (formulario) |
| `#25D366` | — | Exclusivo del botón flotante de WhatsApp |

Reglas: un solo acento por pantalla. Nada de degradados decorativos ni halos de color. `--teal` no se usa para texto menor a 24px.

## Tipografía

| Rol | Fuente | Tamaño |
|---|---|---|
| Títulos h1–h4 | Big Shoulders Display 600 | h1 `clamp(40px,5.4vw,68px)`, h2 `clamp(30px,4vw,46px)`, h3 19–30px |
| Texto | Jost 400–500 | 16–17px (mín. 14px en texto secundario) |
| Etiquetas técnicas | IBM Plex Mono 400–500 | 11.5–13px, mayúsculas solo en etiquetas cortas |

- Big Shoulders se carga con `display=optional` y un respaldo métrico (`BSD fallback`) para evitar saltos de diseño (CLS). No quitar.
- Mínimo 11px para cualquier texto funcional; 12px en etiquetas de formulario.
- Espaciado de letras: ≤0.14em y solo en etiquetas en mayúsculas.

## Espaciado y contenedores

- Contenedor `.wrap`: máx. 1240px, laterales 32px (22px en ≤768px).
- Secciones: 120px vertical (76px en ≤768px); `scroll-margin-top:88px` por la barra fija.
- Escala usada: 4 · 8 · 12 · 16 · 22 · 26 · 36 · 52 · 64px.
- Cortes responsive: 1024px (hero a una columna), 900px (menú móvil, grids a una columna), 600px (ajustes finos de teléfono).

## Componentes

- **Botón** `.btn`: IBM Plex Mono 13px mayúsculas, alto mínimo 48px, radio 2px. Variantes: `solid` (tinta → teal al pasar), `outline`, `teal`. En fondo oscuro el primario es papel sobre tinta. Sin escalas ni brillos.
- **Campos** (contacto): línea inferior, 16px (evita el zoom de iOS), etiqueta visible arriba, `*` para obligatorio, "(opcional)" en lo opcional. El error aparece bajo el campo (`.ct-err`) y marca `aria-invalid`.
- **Mensajes de estado** `.ct-status`: caja con borde izquierdo teal (éxito) o naranja (error). Si el envío falla se ofrece WhatsApp con los datos ya escritos; el formulario no se borra.
- **Tarjetas** `.res-card`: borde 1px, sin sombra; al pasar solo cambia el borde y aparece la línea teal superior.
- **Tabla** `.ubi-zones`: mono 13px, filas con divisor superior, encabezado teal en mayúsculas.
- **Lista de proyectos**: filas `role="button"` con `aria-pressed`; la activa lleva fondo `--teal-soft` y filete izquierdo teal.
- **FAQ**: botón a todo el ancho con `aria-expanded`, icono +/− a la derecha, una sola respuesta abierta.
- **Menú móvil**: panel a pantalla completa, `inert` cuando está cerrado, se cierra con Escape y devuelve el foco al botón.
- **Marcos** `.frame`: esquinas teal tipo visor técnico; solo en fotos principales.

## Iconografía

SVG de línea en el propio HTML: trazo 1.5px, 24×24, `currentColor` o teal. Sin emojis ni librerías de iconos.

## Movimiento

- Permitido: aparición al hacer scroll (`.reveal`, 0.55s), trazo inicial del isométrico del hero, fundido entre fotos de proyectos, transiciones de color de 0.2s.
- Prohibido: animaciones en bucle, brillos, efectos que sigan al cursor, animar `padding` o `width`.
- `prefers-reduced-motion: reduce` desactiva todo movimiento.

## Accesibilidad

- Foco visible: contorno de 2px `--teal-a11y` (o `#7FBFC7` en fondo oscuro) con 3px de separación.
- Enlace "Saltar al contenido principal" como primer elemento enfocable.
- Objetivos táctiles de ≥44px en controles principales, ≥40px en enlaces de listas.
- Contraste AA en todo el texto. `--teal` solo para texto grande.
- Sin desplazamiento horizontal en 390, 820 y 1440px (verificado con Playwright).
