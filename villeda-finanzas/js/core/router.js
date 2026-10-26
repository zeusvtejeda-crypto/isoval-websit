'use strict';
/*
 * VF.router — rutas por hash (#/ruta?a=b), navegación lateral (≥900px) e inferior (<900px).
 * Tolera módulos ausentes: muestra "Módulo no disponible".
 */
window.VF = window.VF || {};
(function (VF) {

  var rutas = [];          // [{ruta, titulo, icono, nav, render}] en orden de registro
  var mapa = {};           // ruta → definición
  var iniciado = false;
  var rutaPintada = null;

  // Rutas conocidas por el contrato (para que la navegación esté completa aunque falte un módulo)
  var CONOCIDAS = [
    { ruta: 'panel', titulo: 'Panel', icono: 'panel', nav: 'principal' },
    { ruta: 'empresa', titulo: 'Empresa', icono: 'empresa', nav: 'principal' },
    { ruta: 'personal', titulo: 'Personal', icono: 'personal', nav: 'principal' },
    { ruta: 'asistente', titulo: 'Asistente', icono: 'asistente', nav: 'principal' },
    { ruta: 'facturas', titulo: 'Facturas y cobros', icono: 'facturas', nav: 'mas' },
    { ruta: 'cobros', titulo: 'Cobros', icono: 'cobros', nav: false },
    { ruta: 'proveedores', titulo: 'Proveedores', icono: 'proveedores', nav: 'mas' },
    { ruta: 'prestamos', titulo: 'Préstamos', icono: 'prestamos', nav: 'mas' },
    { ruta: 'presupuestos', titulo: 'Presupuestos', icono: 'presupuestos', nav: 'mas' },
    { ruta: 'reportes', titulo: 'Reportes', icono: 'reportes', nav: 'mas' },
    { ruta: 'ajustes', titulo: 'Ajustes', icono: 'ajustes', nav: 'mas' }
  ];
  var INFERIOR = ['panel', 'empresa', 'personal', 'asistente'];
  /* Regla del ámbito en la cabecera (VF.ui.ambitoActivo): al entrar a CUALQUIER ruta el router fija primero el
     ámbito implícito de la ruta (empresa/personal/facturas/cobros/proveedores) o lo limpia (null) para que nunca
     quede el badge de la vista anterior. Los módulos con selector (panel, préstamos, presupuestos, reportes)
     lo sobrescriben dentro de su render() con el segmento activo; asistente y ajustes quedan sin ámbito. */
  var AMBITO_POR_RUTA = { empresa: 'empresa', personal: 'personal', facturas: 'empresa', cobros: 'empresa', proveedores: 'empresa' };

  function esc(s) {
    if (VF.util && typeof VF.util.esc === 'function') return VF.util.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ico(nombre) { return VF.ui && VF.ui.icono ? VF.ui.icono(nombre) : ''; }

  function conocida(ruta) {
    for (var i = 0; i < CONOCIDAS.length; i++) if (CONOCIDAS[i].ruta === ruta) return CONOCIDAS[i];
    return null;
  }

  /* ---------- API ---------------------------------------------------------- */
  function registrar(ruta, def) {
    var base = conocida(ruta) || {};
    var d = def || {};
    var entrada = {
      ruta: ruta,
      titulo: d.titulo || base.titulo || ruta,
      icono: d.icono || base.icono || 'info',
      nav: d.nav !== undefined ? d.nav : (base.nav !== undefined ? base.nav : 'mas'),
      render: typeof d.render === 'function' ? d.render : null
    };
    var existente = mapa[ruta];
    if (existente) {
      rutas[rutas.indexOf(existente)] = entrada;
    } else {
      rutas.push(entrada);
    }
    mapa[ruta] = entrada;
    if (iniciado) pintarNav();
    return entrada;
  }

  function parsearHash(hash) {
    var h = String(hash || '').replace(/^#\/?/, '');
    var partes = h.split('?');
    var ruta = decodeURIComponent(partes[0] || '').replace(/\/+$/, '') || 'panel';
    var params = {};
    if (partes[1]) {
      partes[1].split('&').forEach(function (par) {
        if (!par) return;
        var kv = par.split('=');
        params[decodeURIComponent(kv[0])] = kv.length > 1 ? decodeURIComponent(kv.slice(1).join('=').replace(/\+/g, ' ')) : '';
      });
    }
    return { ruta: ruta, params: params };
  }

  function construirHash(ruta, params) {
    var q = '';
    if (params && typeof params === 'object') {
      var pares = Object.keys(params).filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
        .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])); });
      if (pares.length) q = '?' + pares.join('&');
    }
    return '#/' + ruta + q;
  }

  function ir(ruta, params) {
    var destino = construirHash(ruta, params);
    if (location.hash === destino) renderizar();
    else location.hash = destino;
  }

  function actual() { return parsearHash(location.hash); }

  function listaRutas() {
    return rutas.map(function (r) { return { ruta: r.ruta, titulo: r.titulo, icono: r.icono, nav: r.nav }; });
  }

  /* ---------- navegación --------------------------------------------------- */
  function todasLasRutas() {
    // Rutas conocidas (en su orden) + registradas adicionales, sin duplicar
    var vistas = {};
    var salida = [];
    CONOCIDAS.forEach(function (c) {
      var r = mapa[c.ruta] || { ruta: c.ruta, titulo: c.titulo, icono: c.icono, nav: c.nav, render: null };
      vistas[c.ruta] = true;
      salida.push(r);
    });
    rutas.forEach(function (r) { if (!vistas[r.ruta]) { vistas[r.ruta] = true; salida.push(r); } });
    return salida;
  }

  function enlace(r, activa, clase) {
    return '<a class="' + (clase || 'nav-item') + '" href="#/' + esc(r.ruta) + '"' + (activa ? ' aria-current="page"' : '') + '>' +
      '<span class="icono">' + ico(r.icono) + '</span><span class="nav-texto">' + esc(r.titulo) + '</span></a>';
  }

  function pintarNav() {
    var act = actual().ruta;
    var activaNormalizada = act === 'cobros' ? 'facturas' : act;
    var lateral = document.getElementById('nav-lateral');
    var inferior = document.getElementById('nav-inferior');
    var todas = todasLasRutas().filter(function (r) { return r.nav !== false; });

    if (lateral) {
      var html = '';
      var principales = todas.filter(function (r) { return r.nav === 'principal'; });
      var mas = todas.filter(function (r) { return r.nav !== 'principal'; });
      principales.forEach(function (r) { html += enlace(r, r.ruta === activaNormalizada); });
      if (mas.length) {
        html += '<div class="nav-separador" role="presentation"></div><div class="nav-etiqueta">Gestión</div>';
        mas.forEach(function (r) { html += enlace(r, r.ruta === activaNormalizada); });
      }
      lateral.innerHTML = html;
    }

    if (inferior) {
      var htmlInf = '';
      INFERIOR.forEach(function (ruta) {
        var r = mapa[ruta] || conocida(ruta);
        htmlInf += enlace(r, ruta === activaNormalizada);
      });
      var enMas = INFERIOR.indexOf(activaNormalizada) < 0;
      htmlInf += '<button type="button" class="nav-item' + (enMas ? ' activo' : '') + '" data-nav-mas aria-haspopup="dialog"' + (enMas ? ' aria-current="page"' : '') + '>' +
        '<span class="icono">' + ico('mas') + '</span><span class="nav-texto">Más</span></button>';
      inferior.innerHTML = htmlInf;
    }
  }

  function abrirMas() {
    if (!VF.ui || !VF.ui.modal) return;
    var act = actual().ruta;
    var activaNormalizada = act === 'cobros' ? 'facturas' : act;
    var resto = todasLasRutas().filter(function (r) { return r.nav !== false && INFERIOR.indexOf(r.ruta) < 0; });
    var html = '<div class="hoja-mas">';
    resto.forEach(function (r) { html += enlace(r, r.ruta === activaNormalizada); });
    html += '</div>';
    VF.ui.modal({ titulo: 'Más secciones', cuerpo: html, hoja: true });
  }

  /* ---------- render ------------------------------------------------------- */
  function bloqueado() {
    return !!(VF.store && typeof VF.store.estaDesbloqueado === 'function' && !VF.store.estaDesbloqueado());
  }

  function renderizar() {
    var vista = document.getElementById('vista');
    if (!vista) return;
    if (bloqueado()) return;             // nunca pintar vistas con la bóveda cerrada

    var info = actual();
    if (!location.hash || location.hash === '#' || location.hash === '#/') {
      // Ruta vacía → panel, sin dejar entrada extra en el historial
      try { history.replaceState(null, '', '#/panel'); } catch (e) { /* file:// en algunos navegadores */ }
      info = { ruta: 'panel', params: {} };
    }
    var def = mapa[info.ruta];
    var base = conocida(info.ruta);
    var titulo = def ? def.titulo : (base ? base.titulo : 'Sección');

    if (VF.ui && VF.ui.ambitoActivo) VF.ui.ambitoActivo(AMBITO_POR_RUTA[info.ruta] || null);
    if (VF.ui && VF.ui.cerrarModales) VF.ui.cerrarModales();
    pintarNav();
    document.title = titulo + ' · VILLEDA Finanzas';
    vista.setAttribute('data-ruta', info.ruta);

    if (!def || !def.render) {
      var mensaje = def || base ? 'Módulo no disponible' : 'Página no encontrada';
      vista.innerHTML = '<h1>' + esc(titulo) + '</h1>' +
        (VF.ui && VF.ui.vacio
          ? VF.ui.vacio(mensaje + (def || base ? '. Esta sección aún no está instalada en esta versión.' : ': "' + info.ruta + '".'))
          : '<p>' + esc(mensaje) + '</p>') +
        '<p class="centro"><a class="btn btn-secundario" href="#/panel">Ir al panel</a></p>';
    } else {
      try {
        vista.innerHTML = '';
        def.render(vista, info.params);
      } catch (err) {
        console.error('Error al renderizar la ruta "' + info.ruta + '":', err);
        vista.innerHTML = '<h1>' + esc(titulo) + '</h1>' +
          '<div class="aviso aviso-error" role="alert"><strong>Ocurrió un error al mostrar esta sección.</strong><br>' +
          '<span class="texto-2">' + esc(err && err.message ? err.message : String(err)) + '</span></div>' +
          '<p><a class="btn btn-secundario" href="#/panel">Ir al panel</a></p>';
      }
    }

    rutaPintada = info.ruta;
    window.scrollTo(0, 0);
    var h1 = vista.querySelector('h1');
    if (h1) {
      if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
      try { h1.focus({ preventScroll: true }); } catch (e) { h1.focus(); }
    } else {
      try { vista.focus({ preventScroll: true }); } catch (e2) { /* sin foco */ }
    }
  }

  function iniciar() {
    if (!iniciado) {
      iniciado = true;
      window.addEventListener('hashchange', renderizar);
      document.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('[data-nav-mas]');
        if (btn) { e.preventDefault(); abrirMas(); }
      });
    }
    if (!location.hash || location.hash === '#' || location.hash === '#/') {
      try { history.replaceState(null, '', '#/panel'); } catch (e) { location.hash = '#/panel'; }
    }
    pintarNav();
    renderizar();
  }

  VF.router = {
    registrar: registrar,
    ir: ir,
    actual: actual,
    iniciar: iniciar,
    rutas: listaRutas,
    renderizar: renderizar
  };
})(window.VF);
