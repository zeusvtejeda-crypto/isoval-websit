# isoval.com.mx

Sitio de una sola página de ISOVAL (arquitectura y construcción, Tepic, Nayarit). HTML, CSS y JS sin compilación ni dependencias.

## Ejecutar en local

```bash
python3 -m http.server 8080   # abrir http://localhost:8080
```

Hay que servirlo desde la raíz del repo: las rutas de imágenes son absolutas (`/imgs/...`).

## Estructura

| Archivo | Qué es |
|---|---|
| `index.html` | Todo el sitio: estilos, contenido, datos estructurados (JSON-LD) y scripts |
| `imgs/` | Fotos (`.webp` + `.jpg` de respaldo, `-thumb` para miniaturas) y logos |
| `DESIGN.md` | Sistema de diseño: colores, tipografía, componentes, movimiento |
| `_headers` | Cabeceras de seguridad para Cloudflare Pages (GitHub Pages lo ignora) |
| `CNAME`, `.nojekyll` | Configuración de GitHub Pages |
| `llms.txt`, `robots.txt`, `sitemap.xml` | SEO y lectores automáticos |

Todo lo que está en el repo se publica: no guardar aquí nada privado.

## Integraciones

| Servicio | Uso | Configuración |
|---|---|---|
| Web3Forms | Envío del formulario de contacto a correo | Clave de acceso en `initContactForm()` (`WEB3FORMS_KEY`). Es pública por diseño del servicio; se gestiona en web3forms.com |
| WhatsApp (`wa.me`) | Botones de contacto y respaldo si el formulario falla | Número en los enlaces y en `WA_NUMBER` (formato `521` + 10 dígitos) |
| Google Fonts | Big Shoulders Display, Jost, IBM Plex Mono | Enlaces en el `<head>` |

La CSP vive en dos lugares: el `<meta>` de `index.html` y `_headers`. Si se agrega un servicio externo, actualizar ambas.

## Contenido

- **Proyectos:** cada proyecto es una fila `.proy-row` más su imagen en `.proy-frame`. Los proyectos con galería usan `data-project` en la fila, en la imagen y en su `.proy-thumbs`.
- **Preguntas frecuentes:** si se editan, actualizar también el bloque `FAQPage` del JSON-LD.

## Verificación

No hay suite de pruebas en el repo. Antes de publicar, revisar en 390, 820 y 1440px: menú móvil, lista de proyectos y miniaturas, FAQ y formulario (vacío, teléfono inválido, envío). Para probar el formulario sin mandar correos reales, intercepta `api.web3forms.com` con Playwright (`page.route`).

## Pendiente

- Las cifras del hero (12+ años, 200+ proyectos, 98 % de clientes satisfechos) deben poder respaldarse; si no, conviene cambiarlas o quitarlas.
- Las cabeceras anti-clickjacking y HSTS requieren migrar a Cloudflare (ver `_headers`).
