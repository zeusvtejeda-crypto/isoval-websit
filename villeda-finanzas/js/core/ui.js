'use strict';
/*
 * VF.ui — componentes de interfaz (sin dependencias)
 *
 * Convenciones:
 *  - Todos los componentes devuelven STRING HTML (listo para innerHTML). Los textos de usuario que
 *    reciben se escapan aquí con VF.util.esc; el HTML que el módulo ya construyó (p. ej. `render` de
 *    una columna, `cuerpo` de una tarjeta) se inserta tal cual.
 *  - Los callbacks (onFila de tabla, onCambio de segmentos, accion de vacio) se resuelven por
 *    delegación de eventos en `document`, usando ids internos `data-vf-*`. Así el string puede
 *    insertarse en cualquier contenedor y el callback funciona igual.
 *  - modal() y confirmar() crean elementos reales en #modales y devuelven un objeto / promesa.
 *  - Las gráficas son SVG inline accesible con colores por tokens CSS (--viz-1…--viz-6).
 */
window.VF = window.VF || {};
(function (VF) {

  /* ---------- auxiliares privados --------------------------------------- */
  function esc(s) {
    if (VF.util && typeof VF.util.esc === 'function') return VF.util.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtMXN(n) {
    if (VF.util && typeof VF.util.fmtMXN === 'function') return VF.util.fmtMXN(n);
    if (n == null || isNaN(n)) return '—';
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
  }
  function parseMonto(s) {
    if (VF.util && typeof VF.util.parseMonto === 'function') return VF.util.parseMonto(s);
    var t = String(s == null ? '' : s).replace(/[$\s,]/g, '');
    if (t === '' || !/^-?\d*(\.\d+)?$/.test(t)) return NaN;
    return Math.round(parseFloat(t) * 100) / 100;
  }
  function hoyISO() {
    if (VF.util && typeof VF.util.hoy === 'function') return VF.util.hoy();
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  var contadorId = 0;
  function idInterno(prefijo) {
    contadorId += 1;
    return (prefijo || 'vf') + '-' + Date.now().toString(36) + '-' + contadorId;
  }
  function fmtCompacto(n) {
    var abs = Math.abs(n);
    var signo = n < 0 ? '-' : '';
    if (abs >= 1e6) return signo + (abs / 1e6).toFixed(abs % 1e6 === 0 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (abs >= 1e3) return signo + (abs / 1e3).toFixed(abs % 1e3 === 0 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return signo + Math.round(abs);
  }
  /* Escala "bonita": devuelve { max, paso } para 4 divisiones */
  function escalaBonita(maximo) {
    if (!(maximo > 0)) return { max: 4, paso: 1 };
    var bruto = maximo / 4;
    var mag = Math.pow(10, Math.floor(Math.log10(bruto)));
    var residuo = bruto / mag;
    var paso = residuo <= 1 ? 1 : residuo <= 2 ? 2 : residuo <= 2.5 ? 2.5 : residuo <= 5 ? 5 : 10;
    paso = paso * mag;
    return { max: Math.ceil(maximo / paso) * paso, paso: paso };
  }

  /* Registro de callbacks resueltos por delegación.
     Se poda (a) al re-registrar, con un pequeño retardo para que el HTML recién construido ya esté en el
     documento, y (b) en hashchange. Una entrada sólo se elimina si su elemento no está en el DOM y tiene más
     de GRACIA_REGISTRO_MS: así un string construido y mostrado poco después (p. ej. el cuerpo de un modal)
     conserva su callback. */
  var registro = {};
  var GRACIA_REGISTRO_MS = 1500;
  var temporizadorPoda = null;
  function registrar(tipo, fn) {
    var id = idInterno(tipo);
    registro[id] = { tipo: tipo, fn: fn, creado: Date.now() };
    clearTimeout(temporizadorPoda);
    temporizadorPoda = setTimeout(podarRegistro, 250);
    return id;
  }
  function podarRegistro(todo) {
    var ahora = Date.now();
    Object.keys(registro).forEach(function (id) {
      if (!todo && ahora - (registro[id].creado || 0) < GRACIA_REGISTRO_MS) return;
      if (!document.querySelector('[data-vf-id="' + id + '"]')) delete registro[id];
    });
    return Object.keys(registro).length;
  }

  /* ---------- iconos ------------------------------------------------------ */
  var ICONOS = {
    panel: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    empresa: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/>',
    personal: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    facturas: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
    cobros: '<path d="M4 4h16v6H4z"/><path d="M4 10v10h16V10"/><path d="M9 15h6"/>',
    proveedores: '<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    prestamos: '<path d="M3 10h18L12 4z"/><path d="M5 10v8M9 10v8M15 10v8M19 10v8"/><path d="M3 20h18"/>',
    presupuestos: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    reportes: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    asistente: '<path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/><path d="M4 16l.7 1.6L6 18l-1.3.6L4 20l-.7-1.4L2 18l1.3-.4z"/>',
    ajustes: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    mas: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    bloquear: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    desbloquear: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
    cerrar: '<path d="M6 6l12 12M18 6L6 18"/>',
    agregar: '<path d="M12 5v14M5 12h14"/>',
    buscar: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    editar: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/>',
    eliminar: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
    exportar: '<path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>',
    importar: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 20h16"/>',
    alerta: '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><circle cx="12" cy="18" r="0.6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="8" r="0.6"/>',
    exito: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
    flecha: '<path d="M9 6l6 6-6 6"/>',
    'flecha-izq': '<path d="M15 6l-6 6 6 6"/>',
    ojo: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    'ojo-cerrado': '<path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.9 3.9"/><path d="M6.6 6.6C3.7 8.6 2 12 2 12s3.5 7 10 7a9.8 9.8 0 0 0 4.4-1"/>',
    calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    transferencia: '<path d="M4 8h13"/><path d="M14 5l3 3-3 3"/><path d="M20 16H7"/><path d="M10 13l-3 3 3 3"/>',
    ingreso: '<path d="M17 7L7 17"/><path d="M8 7h9v9"/>',
    gasto: '<path d="M7 7l10 10"/><path d="M16 7v9H7"/>',
    imprimir: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
    copiar: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    enviar: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
    luna: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    tema: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>',
    cuenta: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>',
    meta: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    revisar: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><circle cx="12" cy="16" r="0.6"/>',
    filtro: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
    refrescar: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
    ayuda: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7"/><circle cx="12" cy="17" r="0.6"/>',
    archivo: '<path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
    vacio: '<path d="M4 7h16v12H4z"/><path d="M4 11h16"/><path d="M9 15h6"/>',
    descargar: '<path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>',
    guardar: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3"/><rect x="8" y="13" width="8" height="5"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    pago: '<rect x="3" y="7" width="18" height="12" rx="2"/><circle cx="12" cy="13" r="2.5"/><path d="M3 11h2M19 11h2"/>'
  };

  function icono(nombre, etiqueta) {
    var cuerpo = ICONOS[nombre] || ICONOS.info;
    var aria = etiqueta ? ' role="img" aria-label="' + esc(etiqueta) + '"' : ' aria-hidden="true"';
    return '<svg class="icono icono-' + esc(nombre) + '" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" focusable="false"' + aria + '>' + cuerpo + '</svg>';
  }

  /* ---------- básicos ----------------------------------------------------- */
  function el(html) {
    var plantilla = document.createElement('template');
    plantilla.innerHTML = String(html).trim();
    return plantilla.content.firstElementChild;
  }

  function render(contenedor, html) {
    var nodo = typeof contenedor === 'string' ? document.querySelector(contenedor) : contenedor;
    if (!nodo) return null;
    nodo.innerHTML = html == null ? '' : String(html);
    return nodo;
  }

  function badgeAmbito(ambito) {
    var textos = { empresa: 'Empresa', personal: 'Personal', combinado: 'Combinado' };
    var clave = textos[ambito] ? ambito : 'combinado';
    return '<span class="badge badge-' + clave + '">' + textos[clave] + '</span>';
  }

  function kpi(opciones) {
    var o = opciones || {};
    var tono = ['neutro', 'positivo', 'negativo', 'alerta'].indexOf(o.tono) >= 0 ? o.tono : 'neutro';
    return '<div class="kpi kpi-' + tono + '">' +
      '<p class="kpi-titulo">' + esc(o.titulo) + '</p>' +
      '<p class="kpi-valor">' + esc(o.valor == null ? '—' : o.valor) + '</p>' +
      (o.sub ? '<p class="kpi-sub">' + esc(o.sub) + '</p>' : '') +
      '</div>';
  }

  function tarjeta(opciones) {
    var o = opciones || {};
    var cab = '';
    if (o.titulo || o.acciones) {
      cab = '<div class="tarjeta-cabecera">' +
        (o.titulo ? '<h2>' + esc(o.titulo) + '</h2>' : '<span></span>') +
        (o.acciones ? '<div class="tarjeta-acciones">' + o.acciones + '</div>' : '') +
        '</div>';
    }
    return '<section class="tarjeta' + (o.clase ? ' ' + esc(o.clase) : '') + '">' + cab +
      '<div class="tarjeta-cuerpo">' + (o.cuerpo || '') + '</div></section>';
  }

  /**
   * tabla({ columnas, filas, vacio, onFila })
   * En < 720 px cada <td> se vuelve un contenedor flex (etiqueta ::before + contenido). Para que un `render`
   * que devuelve varios nodos (strong + br + small…) no se fragmente en columnas, el contenido de cada celda
   * se envuelve en un único <div class="td-contenido">; en escritorio ese div es un bloque transparente.
   */
  function tabla(opciones) {
    var o = opciones || {};
    var columnas = o.columnas || [];
    var filas = o.filas || [];
    var idTabla = o.onFila ? registrar('tabla', o.onFila) : '';
    var html = '<div class="tabla-envoltura"><table class="tabla tabla-responsiva"' + (idTabla ? ' data-vf-id="' + idTabla + '"' : '') + '>';
    html += '<thead><tr>';
    columnas.forEach(function (c) {
      html += '<th scope="col" class="' + (c.alinear === 'derecha' ? 'num' : c.alinear === 'centro' ? 'centro' : '') + '">' + esc(c.titulo) + '</th>';
    });
    html += '</tr></thead><tbody>';
    if (!filas.length) {
      html += '<tr><td class="tabla-vacio" colspan="' + (columnas.length || 1) + '">' + esc(o.vacio || 'Sin registros') + '</td></tr>';
    } else {
      filas.forEach(function (fila, i) {
        var idFila = fila && fila.id != null ? String(fila.id) : String(i);
        html += '<tr' + (idTabla ? ' data-fila="' + esc(idFila) + '" tabindex="0"' : '') + '>';
        columnas.forEach(function (c) {
          var valor = fila ? fila[c.clave] : '';
          var contenido = typeof c.render === 'function' ? c.render(valor, fila, i) : esc(valor == null ? '' : valor);
          html += '<td data-titulo="' + esc(c.titulo) + '" class="' + (c.alinear === 'derecha' ? 'num' : c.alinear === 'centro' ? 'centro' : '') + '">' +
            '<div class="td-contenido">' + (contenido == null ? '' : contenido) + '</div></td>';
        });
        html += '</tr>';
      });
    }
    html += '</tbody></table></div>';
    return html;
  }

  function lista(items) {
    var arr = items || [];
    if (!arr.length) return '<p class="texto-2">Sin registros</p>';
    var html = '<ul class="lista">';
    arr.forEach(function (it) {
      var tono = it.tono ? ' ' + esc(it.tono) : '';
      var attrs = it.accion ? ' data-accion="' + esc(it.accion) + '"' + (it.id != null ? ' data-id="' + esc(it.id) + '"' : '') + ' class="lista-item clicable" role="button" tabindex="0"' : ' class="lista-item"';
      html += '<li' + attrs + '>' +
        (it.icono ? '<span class="lista-icono">' + icono(it.icono) + '</span>' : '') +
        '<div class="lista-texto"><p class="lista-titulo">' + esc(it.titulo) + '</p>' +
        (it.sub ? '<p class="lista-sub">' + esc(it.sub) + '</p>' : '') + '</div>' +
        (it.valor != null ? '<span class="lista-valor' + tono + '">' + esc(it.valor) + '</span>' : '') +
        '</li>';
    });
    return html + '</ul>';
  }

  function barraProgreso(porcentaje, tono) {
    var p = Math.max(0, Math.min(100, Number(porcentaje) || 0));
    var cl = ['positivo', 'negativo', 'alerta'].indexOf(tono) >= 0 ? ' barra-' + tono : '';
    return '<div class="barra' + cl + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(p) + '">' +
      '<div class="barra-relleno" style="width:' + p.toFixed(1) + '%"></div></div>';
  }

  /* ---------- gráficas (reglas dataviz: marcas finas, 2px de separación, leyenda si ≥2 series,
                 texto en tokens de texto, grid de línea fina, tabla gemela accesible) ----------- */
  var graficas = {};   // id → opciones, para re-dibujar al ancho real del contenedor (el texto SVG no escala)

  function graficaBarras(opciones) {
    var o = opciones || {};
    var series = (o.series || []).slice(0, 6);
    var categorias = o.categorias || [];
    var n = categorias.length;
    var hayDatos = series.some(function (s) { return (s.valores || []).some(function (v) { return Number(v) !== 0 && !isNaN(v); }); });
    if (!n || !series.length || !hayDatos) return vacio('Sin movimientos');
    var id = idInterno('graf');
    graficas[id] = o;
    return '<figure class="grafica grafica-barras" data-vf-grafica="' + id + '" data-ancho="640">' + construirBarras(o, 640) + '</figure>';
  }

  function construirBarras(o, anchoPx) {
    var series = (o.series || []).slice(0, 6);
    var categorias = o.categorias || [];
    var alto = o.alto || 220;
    var n = categorias.length;
    var ancho = Math.max(260, Math.round(anchoPx || 640));
    var mIzq = 46, mDer = 10, mArr = 14, mAbajo = 30;
    var pw = ancho - mIzq - mDer;
    var ph = alto - mArr - mAbajo;

    var maximo = 0, minimo = 0;
    series.forEach(function (s) { (s.valores || []).forEach(function (v) { v = Number(v) || 0; if (v > maximo) maximo = v; if (v < minimo) minimo = v; }); });
    var escPos = escalaBonita(maximo);
    var escNeg = escalaBonita(-minimo);
    var paso = Math.max(escPos.paso, minimo < 0 ? escNeg.paso : 0);
    var topV = Math.ceil(maximo / paso) * paso || paso;
    var bajoV = minimo < 0 ? -Math.ceil(-minimo / paso) * paso : 0;
    var rango = topV - bajoV;
    function y(v) { return mArr + ph - ((v - bajoV) / rango) * ph; }
    var y0 = y(0);

    var titulo = o.titulo || ('Gráfica de barras: ' + series.map(function (s) { return s.etiqueta; }).join(' y '));
    var idTitulo = idInterno('gtitulo');
    var svg = '<svg viewBox="0 0 ' + ancho + ' ' + alto + '" role="img" aria-labelledby="' + idTitulo + '" preserveAspectRatio="xMidYMid meet">' +
      '<title id="' + idTitulo + '">' + esc(titulo) + '</title>';

    // Grid horizontal (líneas finas) y etiquetas del eje Y
    svg += '<g class="viz-grid">';
    for (var v = bajoV; v <= topV + 1e-9; v += paso) {
      var yy = y(v);
      svg += '<line x1="' + mIzq + '" x2="' + (ancho - mDer) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '"/>';
      svg += '<text class="viz-etq viz-etq-y" x="' + (mIzq - 6) + '" y="' + (yy + 4).toFixed(1) + '">' + esc(fmtCompacto(v)) + '</text>';
    }
    svg += '</g>';
    svg += '<line class="viz-eje" x1="' + mIzq + '" x2="' + (ancho - mDer) + '" y1="' + y0.toFixed(1) + '" y2="' + y0.toFixed(1) + '"/>';

    // Barras
    var slot = pw / n;
    var grupo = slot * 0.72;
    var gap = 2;
    var s = series.length;
    var barW = Math.min(24, (grupo - gap * (s - 1)) / s);
    var grupoReal = barW * s + gap * (s - 1);
    var radio = Math.min(4, barW / 2);
    categorias.forEach(function (cat, i) {
      var x0 = mIzq + slot * i + (slot - grupoReal) / 2;
      series.forEach(function (ser, j) {
        var val = Number((ser.valores || [])[i]) || 0;
        var x = x0 + j * (barW + gap);
        var yv = y(val);
        var h = Math.abs(y0 - yv);
        var d;
        if (h < 0.5) {
          d = 'M' + x.toFixed(1) + ' ' + y0.toFixed(1) + ' h' + barW.toFixed(1);
        } else if (val >= 0) {
          var r = Math.min(radio, h);
          d = 'M' + x.toFixed(1) + ' ' + y0.toFixed(1) +
            ' V' + (yv + r).toFixed(1) + ' a' + r + ' ' + r + ' 0 0 1 ' + r + ' -' + r +
            ' h' + (barW - 2 * r).toFixed(1) + ' a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r +
            ' V' + y0.toFixed(1) + ' Z';
        } else {
          var r2 = Math.min(radio, h);
          d = 'M' + x.toFixed(1) + ' ' + y0.toFixed(1) +
            ' V' + (yv - r2).toFixed(1) + ' a' + r2 + ' ' + r2 + ' 0 0 0 ' + r2 + ' ' + r2 +
            ' h' + (barW - 2 * r2).toFixed(1) + ' a' + r2 + ' ' + r2 + ' 0 0 0 ' + r2 + ' -' + r2 +
            ' V' + y0.toFixed(1) + ' Z';
        }
        svg += '<path class="viz-barra viz-serie-' + (j + 1) + '" d="' + d + '">' +
          '<title>' + esc(cat + ' · ' + ser.etiqueta + ': ' + fmtMXN(val)) + '</title></path>';
      });
      svg += '<text class="viz-etq viz-etq-x" x="' + (mIzq + slot * i + slot / 2).toFixed(1) + '" y="' + (alto - 10) + '">' + esc(cat) + '</text>';
    });
    svg += '</svg>';

    var leyenda = '';
    if (s >= 2) {
      leyenda = '<ul class="leyenda" aria-label="Leyenda">';
      series.forEach(function (ser, j) {
        leyenda += '<li><span class="leyenda-muestra viz-serie-' + (j + 1) + '" aria-hidden="true"></span>' + esc(ser.etiqueta) + '</li>';
      });
      leyenda += '</ul>';
    }

    // Tabla gemela (accesibilidad: los valores nunca dependen sólo del color o del hover)
    var tablaHtml = '<details class="grafica-tabla"><summary>Ver datos en tabla</summary><table><thead><tr><th scope="col">Periodo</th>';
    series.forEach(function (ser) { tablaHtml += '<th scope="col">' + esc(ser.etiqueta) + '</th>'; });
    tablaHtml += '</tr></thead><tbody>';
    categorias.forEach(function (cat, i) {
      tablaHtml += '<tr><th scope="row">' + esc(cat) + '</th>';
      series.forEach(function (ser) { tablaHtml += '<td>' + esc(fmtMXN(Number((ser.valores || [])[i]) || 0)) + '</td>'; });
      tablaHtml += '</tr>';
    });
    tablaHtml += '</tbody></table></details>';

    return svg + leyenda + tablaHtml;
  }

  function ajustarGrafica(fig) {
    var id = fig.getAttribute('data-vf-grafica');
    var o = graficas[id];
    if (!o) return;
    var w = fig.clientWidth;
    if (!w) return;
    var previo = Number(fig.getAttribute('data-ancho')) || 0;
    if (Math.abs(w - previo) < 6) return;
    var abierto = fig.querySelector('details') && fig.querySelector('details').open;
    fig.setAttribute('data-ancho', String(w));
    fig.innerHTML = construirBarras(o, w);
    if (abierto && fig.querySelector('details')) fig.querySelector('details').open = true;
  }
  function ajustarGraficasEn(raiz) {
    var nodos = raiz.querySelectorAll ? raiz.querySelectorAll('figure[data-vf-grafica]') : [];
    Array.prototype.forEach.call(nodos, ajustarGrafica);
    if (raiz.matches && raiz.matches('figure[data-vf-grafica]')) ajustarGrafica(raiz);
  }
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(function (cambios) {
      cambios.forEach(function (c) {
        Array.prototype.forEach.call(c.addedNodes, function (n) { if (n.nodeType === 1) ajustarGraficasEn(n); });
      });
      // limpieza de especificaciones huérfanas
      Object.keys(graficas).forEach(function (id) { if (!document.querySelector('[data-vf-grafica="' + id + '"]')) delete graficas[id]; });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  var temporizadorRedibujo = null;
  window.addEventListener('resize', function () {
    clearTimeout(temporizadorRedibujo);
    temporizadorRedibujo = setTimeout(function () { ajustarGraficasEn(document); }, 150);
  });

  function graficaDona(opciones) {
    var o = opciones || {};
    var datos = (o.datos || []).filter(function (d) { return d && Number(d.valor) > 0; })
      .map(function (d) { return { etiqueta: String(d.etiqueta), valor: Number(d.valor) }; })
      .sort(function (a, b) { return b.valor - a.valor; });
    if (!datos.length) return vacio('Sin movimientos');
    // Máximo 6 segmentos: el resto se agrupa en "Otros"
    if (datos.length > 6) {
      var resto = datos.slice(5).reduce(function (acc, d) { return acc + d.valor; }, 0);
      datos = datos.slice(0, 5).concat([{ etiqueta: 'Otros', valor: resto }]);
    }
    var total = datos.reduce(function (acc, d) { return acc + d.valor; }, 0);
    var cx = 100, cy = 100, rExt = 92, rInt = 62;
    var titulo = o.titulo || 'Distribución por categoría';
    var idTitulo = idInterno('gtitulo');
    var svg = '<svg viewBox="0 0 200 200" role="img" aria-labelledby="' + idTitulo + '"><title id="' + idTitulo + '">' + esc(titulo) + '</title>';
    var ang = -Math.PI / 2;
    function punto(r, a) { return (cx + r * Math.cos(a)).toFixed(2) + ' ' + (cy + r * Math.sin(a)).toFixed(2); }
    if (datos.length === 1) {
      svg += '<circle class="viz-dona-seg viz-serie-1" cx="' + cx + '" cy="' + cy + '" r="' + ((rExt + rInt) / 2) + '" fill="none" stroke="var(--viz-1)" stroke-width="' + (rExt - rInt) + '"><title>' + esc(datos[0].etiqueta + ': ' + fmtMXN(datos[0].valor) + ' (100%)') + '</title></circle>';
    } else {
      datos.forEach(function (d, i) {
        var frac = d.valor / total;
        var a1 = ang + frac * Math.PI * 2;
        var grande = frac > 0.5 ? 1 : 0;
        var path = 'M' + punto(rExt, ang) + ' A' + rExt + ' ' + rExt + ' 0 ' + grande + ' 1 ' + punto(rExt, a1) +
          ' L' + punto(rInt, a1) + ' A' + rInt + ' ' + rInt + ' 0 ' + grande + ' 0 ' + punto(rInt, ang) + ' Z';
        svg += '<path class="viz-dona-seg viz-serie-' + (i + 1) + '" d="' + path + '"><title>' + esc(d.etiqueta + ': ' + fmtMXN(d.valor) + ' (' + Math.round(frac * 100) + '%)') + '</title></path>';
        ang = a1;
      });
    }
    svg += '<text class="viz-dona-centro" x="' + cx + '" y="' + (cy + 2) + '">' + esc(fmtCompacto(total)) + '</text>';
    svg += '<text class="viz-dona-centro-sub" x="' + cx + '" y="' + (cy + 18) + '">Total</text>';
    svg += '</svg>';

    var leyenda = '<ul class="leyenda-dona" aria-label="Detalle por categoría">';
    datos.forEach(function (d, i) {
      leyenda += '<li><span class="leyenda-muestra viz-serie-' + (i + 1) + '" aria-hidden="true"></span>' +
        '<span class="leyenda-etq">' + esc(d.etiqueta) + '</span>' +
        '<span class="leyenda-valor">' + esc(fmtMXN(d.valor)) + '</span>' +
        '<span class="leyenda-pct">' + Math.round(d.valor / total * 100) + '%</span></li>';
    });
    leyenda += '</ul>';
    return '<figure class="grafica grafica-dona">' + svg + leyenda + '</figure>';
  }

  /* ---------- modal / confirmar / toast ----------------------------------- */
  var modalesAbiertos = [];

  function modal(opciones) {
    var o = opciones || {};
    var contenedor = document.getElementById('modales') || document.body;
    var idTitulo = idInterno('modal-titulo');
    var fondo = document.createElement('div');
    fondo.className = 'modal-fondo';
    var caja = document.createElement('div');
    caja.className = 'modal' + (o.hoja ? ' modal-hoja' : '');
    caja.setAttribute('role', 'dialog');
    caja.setAttribute('aria-modal', 'true');
    caja.setAttribute('aria-labelledby', idTitulo);
    caja.innerHTML =
      '<div class="modal-cabecera"><h2 id="' + idTitulo + '">' + esc(o.titulo || '') + '</h2>' +
      '<button type="button" class="btn btn-icono" data-modal-cerrar aria-label="Cerrar">' + icono('cerrar') + '</button></div>' +
      '<div class="modal-cuerpo"></div>' +
      (o.botones && o.botones.length ? '<div class="modal-pie"></div>' : '');
    var cuerpo = caja.querySelector('.modal-cuerpo');
    if (o.cuerpo && typeof o.cuerpo !== 'string' && o.cuerpo.nodeType) cuerpo.appendChild(o.cuerpo);
    else cuerpo.innerHTML = o.cuerpo || '';
    fondo.appendChild(caja);

    var cerrado = false;
    var enfoqueAnterior = document.activeElement;
    var api = {
      elemento: caja,
      cerrar: function () {
        if (cerrado) return;
        cerrado = true;
        fondo.remove();
        var idx = modalesAbiertos.indexOf(api);
        if (idx >= 0) modalesAbiertos.splice(idx, 1);
        if (!modalesAbiertos.length) document.body.classList.remove('modal-abierto');
        document.removeEventListener('keydown', alTeclear, true);
        if (typeof o.alCerrar === 'function') { try { o.alCerrar(); } catch (e) { console.error(e); } }
        if (enfoqueAnterior && typeof enfoqueAnterior.focus === 'function' && document.contains(enfoqueAnterior)) enfoqueAnterior.focus();
      }
    };

    (o.botones || []).forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      var tono = b.tono || 'secundario';
      btn.className = 'btn btn-' + tono;
      btn.textContent = b.texto || 'Aceptar';
      btn.addEventListener('click', function () {
        var r;
        try { r = typeof b.accion === 'function' ? b.accion(api) : undefined; } catch (e) { console.error(e); return; }
        if (r && typeof r.then === 'function') {
          r.then(function (res) { if (res !== false) api.cerrar(); });
        } else if (r !== false) {
          api.cerrar();
        }
      });
      caja.querySelector('.modal-pie').appendChild(btn);
    });

    caja.querySelector('[data-modal-cerrar]').addEventListener('click', api.cerrar);
    fondo.addEventListener('click', function (e) { if (e.target === fondo) api.cerrar(); });

    function focables() {
      return Array.prototype.filter.call(
        caja.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
        function (n) { return n.offsetParent !== null || n === document.activeElement; }
      );
    }
    function alTeclear(e) {
      if (modalesAbiertos[modalesAbiertos.length - 1] !== api) return;
      if (e.key === 'Escape') { e.preventDefault(); api.cerrar(); return; }
      if (e.key === 'Tab') {
        var f = focables();
        if (!f.length) { e.preventDefault(); return; }
        var primero = f[0], ultimo = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === primero || !caja.contains(document.activeElement))) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
      }
    }
    document.addEventListener('keydown', alTeclear, true);

    contenedor.appendChild(fondo);
    modalesAbiertos.push(api);
    document.body.classList.add('modal-abierto');
    var primerCampo = caja.querySelector('.modal-cuerpo input:not([type="hidden"]):not([type="checkbox"]), .modal-cuerpo select, .modal-cuerpo textarea');
    var objetivo = primerCampo || caja.querySelector('.modal-pie .btn-primario') || caja.querySelector('[data-modal-cerrar]');
    if (objetivo) setTimeout(function () { objetivo.focus(); }, 20);
    return api;
  }

  function cerrarModales() {
    modalesAbiertos.slice().forEach(function (m) { m.cerrar(); });
  }

  function confirmar(mensaje, opciones) {
    var o = opciones || {};
    return new Promise(function (resolver) {
      var decidido = false;
      modal({
        titulo: o.titulo || (o.peligro ? 'Confirmar acción' : 'Confirmar'),
        cuerpo: '<p>' + esc(mensaje) + '</p>',
        botones: [
          { texto: o.textoCancelar || 'Cancelar', tono: 'secundario', accion: function () { decidido = true; resolver(false); } },
          { texto: o.textoAceptar || (o.peligro ? 'Sí, continuar' : 'Aceptar'), tono: o.peligro ? 'peligro' : 'primario', accion: function () { decidido = true; resolver(true); } }
        ],
        alCerrar: function () { if (!decidido) resolver(false); }
      });
    });
  }

  function toast(mensaje, tipo, ms) {
    var t = ['info', 'exito', 'error', 'alerta'].indexOf(tipo) >= 0 ? tipo : 'info';
    var dur = typeof ms === 'number' ? ms : 3000;
    var cont = document.getElementById('toasts');
    if (!cont) return null;
    var nodo = document.createElement('div');
    nodo.className = 'toast toast-' + t;
    nodo.setAttribute('role', t === 'error' ? 'alert' : 'status');
    nodo.innerHTML = icono(t === 'exito' ? 'exito' : t === 'error' ? 'error' : t === 'alerta' ? 'alerta' : 'info') + '<span></span>';
    nodo.querySelector('span').textContent = String(mensaje == null ? '' : mensaje);
    cont.appendChild(nodo);
    while (cont.children.length > 3) cont.removeChild(cont.firstChild);
    var quitar = function () {
      nodo.classList.add('saliendo');
      setTimeout(function () { nodo.remove(); }, 260);
    };
    nodo.addEventListener('click', quitar);
    if (dur > 0) setTimeout(quitar, dur);
    return nodo;
  }

  /* ---------- formularios ------------------------------------------------- */
  function formulario(campos, valores) {
    var vals = valores || {};
    var html = '<form class="form" novalidate autocomplete="off">';
    (campos || []).forEach(function (c) {
      var id = 'f-' + esc(c.nombre) + '-' + idInterno('c');
      var valor = vals[c.nombre] != null ? vals[c.nombre] : (c.valor != null ? c.valor : '');
      var tipo = c.tipo || 'texto';
      var req = c.requerido ? ' required aria-required="true"' : '';
      var attrs = ' id="' + id + '" name="' + esc(c.nombre) + '" data-campo="' + esc(c.nombre) + '" data-tipo="' + esc(tipo) + '"' + req +
        (c.deshabilitado ? ' disabled' : '') + (c.placeholder ? ' placeholder="' + esc(c.placeholder) + '"' : '') +
        (c.autofoco ? ' autofocus' : '');
      var idAyuda = c.ayuda ? id + '-ayuda' : '';
      if (idAyuda) attrs += ' aria-describedby="' + idAyuda + '"';
      var etiqueta = '<label for="' + id + '"' + (c.requerido ? ' class="campo-requerido"' : '') + '>' + esc(c.etiqueta || c.nombre) + '</label>';
      var control = '';

      if (tipo === 'oculto') {
        html += '<input type="hidden"' + attrs + ' value="' + esc(valor) + '">';
        return;
      }
      if (tipo === 'checkbox') {
        html += '<div class="campo campo-tipo-checkbox" data-campo-cont="' + esc(c.nombre) + '">' +
          '<label class="campo-checkbox" for="' + id + '"><input type="checkbox"' + attrs + (valor ? ' checked' : '') + '>' +
          '<span>' + esc(c.etiqueta || c.nombre) + (c.ayuda ? '<small id="' + idAyuda + '">' + esc(c.ayuda) + '</small>' : '') + '</span></label>' +
          '<p class="campo-error" hidden></p></div>';
        return;
      }
      if (tipo === 'select') {
        control = '<select' + attrs + '>';
        if (c.placeholder) control += '<option value="">' + esc(c.placeholder) + '</option>';
        (c.opciones || []).forEach(function (op) {
          var ov = typeof op === 'object' ? op.valor : op;
          var ot = typeof op === 'object' ? op.texto : op;
          control += '<option value="' + esc(ov) + '"' + (String(ov) === String(valor) ? ' selected' : '') + '>' + esc(ot) + '</option>';
        });
        control += '</select>';
      } else if (tipo === 'textarea') {
        control = '<textarea' + attrs + ' rows="' + (c.filas || 3) + '">' + esc(valor) + '</textarea>';
      } else if (tipo === 'monto') {
        var vm = valor === '' || valor == null ? '' : (typeof valor === 'number' ? valor.toFixed(2) : String(valor));
        control = '<div class="campo-monto"><span class="prefijo" aria-hidden="true">$</span>' +
          '<input type="text" inputmode="decimal"' + attrs + ' value="' + esc(vm) + '"' +
          (c.min != null ? ' data-min="' + esc(c.min) + '"' : '') + (c.max != null ? ' data-max="' + esc(c.max) + '"' : '') + '></div>';
      } else if (tipo === 'numero') {
        control = '<input type="number" inputmode="decimal"' + attrs + ' value="' + esc(valor) + '"' +
          (c.min != null ? ' min="' + esc(c.min) + '"' : '') + (c.max != null ? ' max="' + esc(c.max) + '"' : '') +
          ' step="' + esc(c.paso != null ? c.paso : 'any') + '">';
      } else if (tipo === 'fecha') {
        control = '<input type="date"' + attrs + ' value="' + esc(valor) + '"' +
          (c.min ? ' min="' + esc(c.min) + '"' : '') + (c.max ? ' max="' + esc(c.max) + '"' : '') + '>';
      } else if (tipo === 'contrasena') {
        control = '<input type="password" autocomplete="off"' + attrs + ' value="' + esc(valor) + '">';
      } else {
        control = '<input type="' + (tipo === 'email' ? 'email' : tipo === 'tel' ? 'tel' : tipo === 'url' ? 'url' : 'text') + '"' + attrs + ' value="' + esc(valor) + '"' +
          (c.lista ? ' list="' + esc(c.lista) + '"' : '') + (c.maxlength ? ' maxlength="' + esc(c.maxlength) + '"' : '') + '>';
      }
      html += '<div class="campo" data-campo-cont="' + esc(c.nombre) + '">' + etiqueta + control +
        (c.ayuda ? '<p class="campo-ayuda" id="' + idAyuda + '">' + esc(c.ayuda) + '</p>' : '') +
        '<p class="campo-error" hidden></p></div>';
    });
    html += '</form>';
    return html;
  }

  function leerFormulario(formEl) {
    var form = typeof formEl === 'string' ? document.querySelector(formEl) : formEl;
    var datos = {};
    if (!form) return datos;
    Array.prototype.forEach.call(form.querySelectorAll('[data-campo]'), function (n) {
      var nombre = n.getAttribute('data-campo');
      var tipo = n.getAttribute('data-tipo') || 'texto';
      if (tipo === 'checkbox') datos[nombre] = !!n.checked;
      else if (tipo === 'monto') { var t = String(n.value || '').trim(); datos[nombre] = t === '' ? NaN : parseMonto(t); }
      else if (tipo === 'numero') { var v = String(n.value || '').trim(); datos[nombre] = v === '' ? null : Number(v); }
      else if (tipo === 'fecha') datos[nombre] = String(n.value || '').trim();
      else datos[nombre] = String(n.value == null ? '' : n.value).trim();
    });
    return datos;
  }

  function marcarError(form, nombre, mensaje) {
    var cont = form.querySelector('[data-campo-cont="' + nombre + '"]');
    var control = form.querySelector('[data-campo="' + nombre + '"]');
    if (!cont) return;
    var p = cont.querySelector('.campo-error');
    if (mensaje) {
      cont.classList.add('con-error');
      if (p) { p.textContent = mensaje; p.hidden = false; }
      if (control) control.setAttribute('aria-invalid', 'true');
    } else {
      cont.classList.remove('con-error');
      if (p) { p.textContent = ''; p.hidden = true; }
      if (control) control.removeAttribute('aria-invalid');
    }
  }

  function validar(formEl, reglas) {
    var form = typeof formEl === 'string' ? document.querySelector(formEl) : formEl;
    if (!form) return false;
    var valores = leerFormulario(form);
    var errores = {};
    Array.prototype.forEach.call(form.querySelectorAll('[data-campo]'), function (n) {
      var nombre = n.getAttribute('data-campo');
      var tipo = n.getAttribute('data-tipo') || 'texto';
      marcarError(form, nombre, '');
      var v = valores[nombre];
      var vacioCampo = tipo === 'checkbox' ? false : tipo === 'monto' ? isNaN(v) && String(n.value || '').trim() === '' : tipo === 'numero' ? v == null : v === '';
      if (n.required && vacioCampo) { errores[nombre] = 'Este campo es obligatorio'; return; }
      if (tipo === 'monto' && !vacioCampo) {
        if (isNaN(v)) errores[nombre] = 'Ingresa un monto válido';
        else if (n.getAttribute('data-min') != null && v < Number(n.getAttribute('data-min'))) errores[nombre] = 'El monto mínimo es ' + fmtMXN(Number(n.getAttribute('data-min')));
        else if (n.getAttribute('data-max') != null && v > Number(n.getAttribute('data-max'))) errores[nombre] = 'El monto máximo es ' + fmtMXN(Number(n.getAttribute('data-max')));
      }
      if (tipo === 'numero' && v != null) {
        if (isNaN(v)) errores[nombre] = 'Ingresa un número válido';
        else if (n.min !== '' && v < Number(n.min)) errores[nombre] = 'El valor mínimo es ' + n.min;
        else if (n.max !== '' && v > Number(n.max)) errores[nombre] = 'El valor máximo es ' + n.max;
      }
      if (tipo === 'fecha' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errores[nombre] = 'Fecha inválida';
      if (n.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errores[nombre] = 'Correo inválido';
    });
    if (reglas) {
      var lista = Array.isArray(reglas) ? reglas : Object.keys(reglas).map(function (k) { return { campo: k, fn: reglas[k] }; });
      lista.forEach(function (r) {
        if (errores[r.campo] || typeof r.fn !== 'function') return;
        var res;
        try { res = r.fn(valores[r.campo], valores); } catch (e) { res = 'Valor inválido'; }
        if (typeof res === 'string' && res) errores[r.campo] = res;
        else if (res === false) errores[r.campo] = r.mensaje || 'Valor inválido';
      });
    }
    var nombres = Object.keys(errores);
    nombres.forEach(function (nombre) { marcarError(form, nombre, errores[nombre]); });
    if (nombres.length) {
      var primero = form.querySelector('[data-campo="' + nombres[0] + '"]');
      if (primero && typeof primero.focus === 'function') primero.focus();
      return false;
    }
    return true;
  }

  /* ---------- segmentos, vacío, fecha relativa ----------------------------- */
  function segmentos(opciones, activo, onCambio) {
    var id = registrar('seg', onCambio);
    var html = '<div class="segmentos" role="tablist" data-vf-id="' + id + '">';
    (opciones || []).forEach(function (op) {
      var valor = typeof op === 'object' ? op.valor : op;
      var texto = typeof op === 'object' ? op.texto : op;
      var sel = String(valor) === String(activo);
      html += '<button type="button" class="segmento" role="tab" data-valor="' + esc(valor) + '" aria-selected="' + (sel ? 'true' : 'false') + '"' + (sel ? '' : ' tabindex="-1"') + '>' + esc(texto) + '</button>';
    });
    return html + '</div>';
  }

  function vacio(mensaje, accionTexto, accion) {
    var id = typeof accion === 'function' ? registrar('vacio', accion) : '';
    return '<div class="vacio">' +
      '<span class="vacio-ilustracion" aria-hidden="true">' + icono('vacio') + '</span>' +
      '<p>' + esc(mensaje || 'Sin movimientos') + '</p>' +
      (accionTexto ? '<button type="button" class="btn btn-primario"' + (id ? ' data-vf-id="' + id + '"' : '') + '>' + esc(accionTexto) + '</button>' : '') +
      '</div>';
  }

  function fechaRelativa(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
    var a = iso.slice(0, 10).split('-').map(Number);
    var b = hoyISO().split('-').map(Number);
    var da = Date.UTC(a[0], a[1] - 1, a[2]);
    var db = Date.UTC(b[0], b[1] - 1, b[2]);
    var d = Math.round((da - db) / 86400000);
    if (d === 0) return 'hoy';
    if (d === 1) return 'mañana';
    if (d === -1) return 'ayer';
    if (d > 1 && d < 7) return 'en ' + d + ' días';
    if (d < -1 && d > -7) return 'hace ' + (-d) + ' días';
    if (d >= 7 && d < 30) { var s = Math.round(d / 7); return 'en ' + s + (s === 1 ? ' semana' : ' semanas'); }
    if (d <= -7 && d > -30) { var s2 = Math.round(-d / 7); return 'hace ' + s2 + (s2 === 1 ? ' semana' : ' semanas'); }
    if (d >= 30 && d < 365) { var m = Math.round(d / 30); return 'en ' + m + (m === 1 ? ' mes' : ' meses'); }
    if (d <= -30 && d > -365) { var m2 = Math.round(-d / 30); return 'hace ' + m2 + (m2 === 1 ? ' mes' : ' meses'); }
    var y = Math.round(Math.abs(d) / 365);
    return (d > 0 ? 'en ' : 'hace ') + y + (y === 1 ? ' año' : ' años');
  }

  /* ---------- ámbito activo (cabecera + acento) --------------------------- */
  function ambitoActivo(ambito) {
    var raiz = document.documentElement;
    var badge = document.getElementById('badge-ambito');
    if (ambito === 'empresa' || ambito === 'personal') {
      raiz.setAttribute('data-ambito', ambito);
      if (badge) badge.innerHTML = badgeAmbito(ambito);
    } else if (ambito === 'combinado') {
      raiz.removeAttribute('data-ambito');
      if (badge) badge.innerHTML = badgeAmbito('combinado');
    } else {
      raiz.removeAttribute('data-ambito');
      if (badge) badge.innerHTML = '';
    }
  }

  /* ---------- delegación global ------------------------------------------- */
  document.addEventListener('click', function (e) {
    var objetivo = e.target.closest ? e.target : null;
    if (!objetivo) return;

    // Tabla con onFila
    var fila = objetivo.closest('tr[data-fila]');
    if (fila) {
      var tablaEl = fila.closest('table[data-vf-id]');
      var reg = tablaEl && registro[tablaEl.getAttribute('data-vf-id')];
      if (reg && !objetivo.closest('button, a, input, select, textarea, label')) {
        reg.fn(fila.getAttribute('data-fila'), fila, e);
        return;
      }
    }
    // Segmentos
    var seg = objetivo.closest('.segmento');
    if (seg) {
      var cont = seg.closest('.segmentos[data-vf-id]');
      var regSeg = cont && registro[cont.getAttribute('data-vf-id')];
      Array.prototype.forEach.call(cont ? cont.querySelectorAll('.segmento') : [], function (b) {
        var activo = b === seg;
        b.setAttribute('aria-selected', activo ? 'true' : 'false');
        if (activo) b.removeAttribute('tabindex'); else b.setAttribute('tabindex', '-1');
      });
      if (regSeg && typeof regSeg.fn === 'function') regSeg.fn(seg.getAttribute('data-valor'), seg);
      return;
    }
    // Botón de estado vacío
    var btnVacio = objetivo.closest('.vacio button[data-vf-id]');
    if (btnVacio) {
      var regV = registro[btnVacio.getAttribute('data-vf-id')];
      if (regV) regV.fn(e);
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.matches('tr[data-fila]') || t.matches('.lista-item[role="button"]')) {
      e.preventDefault();
      t.click();
    }
    // Flechas en segmentos
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    var t = e.target;
    if (!t || !t.matches || !t.matches('.segmento')) return;
    var botones = Array.prototype.slice.call(t.parentNode.querySelectorAll('.segmento'));
    var i = botones.indexOf(t);
    var sig = botones[(i + (e.key === 'ArrowRight' ? 1 : botones.length - 1)) % botones.length];
    if (sig) { e.preventDefault(); sig.focus(); sig.click(); }
  });
  window.addEventListener('hashchange', function () { cerrarModales(); setTimeout(function () { podarRegistro(true); }, 100); });

  VF.ui = {
    el: el,
    render: render,
    icono: icono,
    badgeAmbito: badgeAmbito,
    kpi: kpi,
    tarjeta: tarjeta,
    tabla: tabla,
    lista: lista,
    barraProgreso: barraProgreso,
    graficaBarras: graficaBarras,
    graficaDona: graficaDona,
    modal: modal,
    cerrarModales: cerrarModales,
    confirmar: confirmar,
    toast: toast,
    formulario: formulario,
    leerFormulario: leerFormulario,
    validar: validar,
    segmentos: segmentos,
    vacio: vacio,
    fechaRelativa: fechaRelativa,
    ambitoActivo: ambitoActivo,
    podar: podarRegistro       // podar(todo?) → número de callbacks vivos (pruebas / depuración)
  };
})(window.VF);
