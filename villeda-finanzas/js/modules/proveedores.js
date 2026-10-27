'use strict';
/*
 * js/modules/proveedores.js — Vista Proveedores (#/proveedores) de VILLEDA Finanzas (docs/ARQUITECTURA.md §4).
 *
 *  Pestañas Proveedores | Cuentas por pagar | Comisiones (la elegida se recuerda en sessionStorage
 *  'vf.proveedores.pestana'; #/proveedores?pestana=proveedores|cxp|comisiones la fija y ?id=<id> abre el
 *  detalle del registro de esa pestaña, como lo envía el Panel).
 *   - Proveedores: búsqueda, tabla con lo pendiente por proveedor (VF.calc.porPagar), alta / edición /
 *     eliminación (la integridad PROVEEDOR_CON_CXP del store se explica de forma amable).
 *   - Cuentas por pagar: KPIs Por pagar / Vencido (VF.calc.porPagar), filtros Todas / Pendientes / Vencidas /
 *     Pagadas, agrupación por proveedor, estado derivado (VF.calc.estadoCxP), alta / edición / eliminación,
 *     "Registrar pago" (monto ≤ pendiente, fecha, cuenta EMPRESA → movimiento gasto 'Proveedores' con cxpId;
 *     el pago guarda movimientoId) y eliminar pago (revierte el movimiento).
 *   - Comisiones: resumen de pendientes (VF.calc.comisionesPendientes), alta con beneficiario, base tomada del
 *     subtotal de una factura o manual, porcentaje → monto calculado en vivo; "Pagar" crea un movimiento gasto
 *     'Comisiones' con comisionId en una cuenta EMPRESA; "Revertir pago" lo elimina.
 *  Ámbito implícito: empresa (todo movimiento generado lleva ambito 'empresa' y una cuenta de empresa).
 *  Toda cifra sale de VF.calc o de los registros reales; sin datos se muestran estados vacíos.
 *  Se vuelve a pintar al recibir VF.store 'cambio' únicamente si la ruta activa sigue siendo proveedores.
 *
 * Convenciones: JavaScript clásico, textos en español, todo texto de usuario pasa por VF.util.esc,
 * eventos por delegación con data-accion="prov-…" (sin handlers inline).
 */
window.VF = window.VF || {};
(function (VF) {
  if (!VF.util || !VF.calc || !VF.ui || !VF.store || !VF.router) {
    console.error('[VF.proveedores] faltan módulos del núcleo (util, calc, ui, store, router).');
    return;
  }

  var U = VF.util;
  var esc = U.esc;
  var fmt = U.fmtMXN;

  var CLAVE_PESTANA = 'vf.proveedores.pestana';
  var PESTANAS = [
    { valor: 'proveedores', texto: 'Proveedores' },
    { valor: 'cxp', texto: 'Cuentas por pagar', corto: 'Por pagar' },
    { valor: 'comisiones', texto: 'Comisiones' }
  ];
  var NOMBRE_PESTANA = { proveedores: 'Proveedores', cxp: 'Cuentas por pagar', comisiones: 'Comisiones' };
  var FILTROS_CXP = [
    { valor: 'todas', texto: 'Todas' }, { valor: 'pendientes', texto: 'Pendientes' },
    { valor: 'vencidas', texto: 'Vencidas' }, { valor: 'pagadas', texto: 'Pagadas' }
  ];
  var FILTROS_COMISION = [
    { valor: 'todas', texto: 'Todas' }, { valor: 'pendientes', texto: 'Pendientes' }, { valor: 'pagadas', texto: 'Pagadas' }
  ];
  var ESTADO_CXP = { pendiente: 'Pendiente', parcial: 'Parcial', vencida: 'Vencida', pagada: 'Pagada', cancelada: 'Cancelada' };
  var TONO_CXP = { pendiente: 'info', parcial: 'alerta', vencida: 'negativo', pagada: 'positivo', cancelada: 'neutro' };
  var CATEGORIAS_PROVEEDOR = ['Materiales', 'Honorarios', 'Servicios', 'Renta', 'Software', 'Publicidad', 'Transporte', 'Nómina', 'Otros'];
  var CATEGORIA_PAGO_CXP = 'Proveedores';
  var CATEGORIA_PAGO_COMISION = 'Comisiones';
  var DIAS_VENCIMIENTO = 30;
  var ERRORES = {
    PROVEEDOR_CON_CXP: 'Este proveedor tiene cuentas por pagar registradas. Elimina o reasigna esas cuentas antes de borrarlo.',
    CUENTA_CON_MOVIMIENTOS: 'La cuenta tiene movimientos y no puede eliminarse.',
    BLOQUEADO: 'La aplicación está bloqueada. Desbloquéala para continuar.',
    AMBITO_INVALIDO: 'El registro no tiene un ámbito válido.',
    REGISTRO_INVALIDO: 'El registro no es válido.',
    ID_DUPLICADO: 'Ya existe un registro con ese identificador.'
  };

  var pestanaActual = leerPestana();
  var filtroCxP = 'pendientes';
  var agruparCxP = false;
  var filtroComision = 'todas';
  var busquedaProveedores = '';
  var temporizadorCambio = null;

  /* ---------- auxiliares privados ------------------------------------------ */
  function estado() { return VF.store.estaDesbloqueado() ? VF.store.estado() : null; }
  function hoy() { return VF.calc.hoy(); }
  function toast(mensaje, tipo) { if (VF.ui.toast) VF.ui.toast(mensaje, tipo); }
  function esPestana(p) { return !!NOMBRE_PESTANA[p]; }

  function leerPestana() {
    try {
      var v = sessionStorage.getItem(CLAVE_PESTANA);
      if (NOMBRE_PESTANA[v]) return v;
    } catch (e) { /* sessionStorage no disponible */ }
    return 'proveedores';
  }
  function guardarPestana(p) {
    try { sessionStorage.setItem(CLAVE_PESTANA, p); } catch (e) { /* sin almacenamiento de sesión */ }
  }
  function capitalizar(s) {
    s = String(s == null ? '' : s);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function plural(n, singular, pluralTexto) {
    return n + ' ' + (n === 1 ? singular : (pluralTexto || singular + 's'));
  }
  function buscar(arr, id) {
    arr = arr || [];
    for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) return arr[i];
    return null;
  }
  function mensajeError(e) {
    var codigo = e && e.message ? e.message : String(e);
    return ERRORES[codigo] || ('No se pudo completar la operación (' + codigo + ').');
  }
  function proveedorDe(est, id) { return buscar(est.proveedores, id); }
  function nombreProveedor(est, id) {
    var p = proveedorDe(est, id);
    return p ? p.nombre : 'Proveedor eliminado';
  }
  function nombreCuenta(est, id) {
    var c = buscar(est.cuentas, id);
    return c ? c.nombre : 'Cuenta eliminada';
  }
  /** Cuentas de EMPRESA activas (los pagos a proveedores y comisiones nunca salen de cuentas personales). */
  function cuentasEmpresa(est) {
    return (est.cuentas || []).filter(function (c) { return c && c.ambito === 'empresa' && c.activa !== false; });
  }
  function opcionesCuentas(est) {
    return cuentasEmpresa(est).map(function (c) {
      return { valor: c.id, texto: c.nombre + (c.banco ? ' · ' + c.banco : '') + ' · ' + fmt(VF.calc.saldoCuenta(est, c.id)) };
    });
  }
  function pagadoCxP(c) {
    return U.suma(c && c.pagos ? c.pagos : [], function (p) { return p.monto; });
  }
  function badgeEstadoCxP(estadoDerivado) {
    var tono = TONO_CXP[estadoDerivado] || 'neutro';
    return '<span class="badge badge-' + tono + '">' + esc(ESTADO_CXP[estadoDerivado] || capitalizar(estadoDerivado)) + '</span>';
  }
  function badgeEstadoComision(c) {
    return c.estado === 'pagada'
      ? '<span class="badge badge-positivo">Pagada</span>'
      : '<span class="badge badge-alerta">Pendiente</span>';
  }
  function filaCifra(etiqueta, valor, clase) {
    return '<div class="fila-entre mb-1"><span class="texto-2">' + esc(etiqueta) + '</span>' +
      '<span class="derecha ' + esc(clase || '') + '">' + valor + '</span></div>';
  }
  function filaTexto(etiqueta, texto, clase) { return filaCifra(etiqueta, esc(texto), clase); }
  function btnIcono(accion, icono, id, etiqueta, extra) {
    return '<button type="button" class="btn btn-icono" data-accion="' + esc(accion) + '"' + (id != null ? ' data-id="' + esc(id) + '"' : '') +
      (extra || '') + ' aria-label="' + esc(etiqueta) + '" title="' + esc(etiqueta) + '">' + VF.ui.icono(icono) + '</button>';
  }
  function fechaConRelativa(iso, tonoVencido) {
    if (!iso) return '<span class="texto-3">—</span>';
    var rel = capitalizar(VF.ui.fechaRelativa(iso));
    return '<span class="celda-2l"><span class="truncar">' + esc(U.fmtFecha(iso)) + '</span><br><small class="truncar ' + esc(tonoVencido || 'texto-2') + '">' + esc(rel) + '</small></span>';
  }
  function fechaVencimientoPorDefecto() { return U.sumarDias(hoy(), DIAS_VENCIMIENTO); }
  function montoComision(base, porcentaje) {
    var b = Number(base), p = Number(porcentaje);
    if (!isFinite(b) || !isFinite(p)) return NaN;
    return U.round2(b * p / 100);
  }
  function folioFactura(est, id) {
    var f = buscar(est.facturas, id);
    return f ? (f.folio || 'Factura') : '';
  }
  function nombreCliente(est, id) {
    var c = buscar(est.clientes, id);
    return c ? c.nombre : '';
  }
  function abrirTrasCerrar(fn) {
    VF.ui.cerrarModales();
    setTimeout(fn, 60);
  }
  function agruparCampos(form, nombres) {
    var conts = nombres.map(function (n) { return form.querySelector('[data-campo-cont="' + n + '"]'); }).filter(Boolean);
    if (conts.length < 2) return;
    var fila = document.createElement('div');
    fila.className = 'form-fila';
    conts[0].parentNode.insertBefore(fila, conts[0]);
    conts.forEach(function (c) { fila.appendChild(c); });
  }
  function enviarConEnter(form, api, guardar) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (guardar() !== false) api.cerrar();
    });
  }

  /* ---------- render de la ruta -------------------------------------------- */
  function render(contenedor, params) {
    var p = params || {};
    if (esPestana(p.pestana)) {
      pestanaActual = p.pestana;
      guardarPestana(pestanaActual);
    }
    VF.ui.ambitoActivo('empresa');
    contenedor.innerHTML = cabecera() + pestanas() + '<div id="prov-cuerpo"></div>';
    pintarCuerpo();
    if (p.id) {
      var id = p.id;
      var pestana = pestanaActual;
      try { history.replaceState(null, '', '#/proveedores'); } catch (e) { /* file:// en algunos navegadores */ }
      setTimeout(function () {
        if (VF.router.actual().ruta !== 'proveedores') return;
        if (pestana === 'cxp') abrirDetalleCxP(id);
        else if (pestana === 'comisiones') abrirDetalleComision(id);
        else abrirDetalleProveedor(id);
      }, 0);
    } else if (/^#\/proveedores\?/.test(location.hash)) {
      try { history.replaceState(null, '', '#/proveedores'); } catch (e2) { /* sin historial */ }
    }
  }

  function textoBotonNuevo() {
    return pestanaActual === 'cxp' ? 'Cuenta por pagar' : pestanaActual === 'comisiones' ? 'Comisión' : 'Proveedor';
  }

  function cabecera() {
    return '<div class="vista-cabecera">' +
      '<div><h1>Proveedores</h1><p class="texto-2 mb-0">Proveedores, cuentas por pagar y comisiones de la empresa.</p></div>' +
      '<div class="vista-acciones">' +
      '<button type="button" class="btn btn-primario" data-accion="prov-nuevo" id="prov-btn-nuevo">' +
      VF.ui.icono('agregar') + '<span>' + esc(textoBotonNuevo()) + '</span></button>' +
      '</div></div>';
  }

  function pestanas() {
    var html = '<div class="pestanas" role="tablist" aria-label="Secciones de proveedores" id="prov-pestanas">';
    PESTANAS.forEach(function (p) {
      var sel = p.valor === pestanaActual;
      html += '<button type="button" class="pestana" role="tab" data-accion="prov-pestana" data-valor="' + esc(p.valor) + '"' +
        ' aria-selected="' + (sel ? 'true' : 'false') + '"' + (sel ? '' : ' tabindex="-1"') + ' id="prov-pestana-' + esc(p.valor) + '"' +
        (p.corto ? ' aria-label="' + esc(p.texto) + '"' : '') + '>' +
        (p.corto ? '<span class="oculto-movil">' + esc(p.texto) + '</span><span class="oculto-escritorio">' + esc(p.corto) + '</span>' : esc(p.texto)) + '</button>';
    });
    return html + '</div>';
  }

  /** Cambia la pestaña activa (aria-selected + botón "nuevo") y vuelve a pintar el cuerpo. */
  function fijarPestana(valor) {
    if (!esPestana(valor)) return;
    pestanaActual = valor;
    guardarPestana(valor);
    var botones = document.querySelectorAll('#prov-pestanas .pestana');
    Array.prototype.forEach.call(botones, function (b) {
      var activo = b.getAttribute('data-valor') === valor;
      b.setAttribute('aria-selected', activo ? 'true' : 'false');
      if (activo) b.removeAttribute('tabindex'); else b.setAttribute('tabindex', '-1');
    });
    var btn = document.querySelector('#prov-btn-nuevo span');
    if (btn) btn.textContent = textoBotonNuevo();
    pintarCuerpo();
  }

  function pintarCuerpo() {
    var cuerpo = document.getElementById('prov-cuerpo');
    var est = estado();
    if (!cuerpo || !est) return;
    cuerpo.setAttribute('data-pestana', pestanaActual);
    cuerpo.setAttribute('role', 'tabpanel');
    cuerpo.setAttribute('aria-labelledby', 'prov-pestana-' + pestanaActual);
    if (pestanaActual === 'cxp') cuerpo.innerHTML = cuerpoCxP(est);
    else if (pestanaActual === 'comisiones') cuerpo.innerHTML = cuerpoComisiones(est);
    else cuerpo.innerHTML = cuerpoProveedores(est);
  }

  /* ======================================================================== */
  /* PROVEEDORES                                                              */
  /* ======================================================================== */
  function proveedoresFiltrados(est) {
    var q = U.normalizar(busquedaProveedores);
    var lista = (est.proveedores || []).filter(Boolean);
    if (q) {
      lista = lista.filter(function (p) {
        return U.normalizar([p.nombre, p.rfc, p.categoria, p.contacto, p.email, p.telefono].join(' ')).indexOf(q) >= 0;
      });
    }
    return U.ordenar(lista, 'nombre');
  }

  function cuerpoProveedores(est) {
    if (!(est.proveedores || []).length) {
      return '<div class="tarjeta">' + VF.ui.vacio('Sin proveedores registrados. Da de alta a quienes te venden materiales o servicios para llevar sus cuentas por pagar.', 'Agregar proveedor', function () {
        abrirFormularioProveedor({});
      }) + '</div>';
    }
    var html = '<div class="filtros">' +
      '<div class="campo"><label for="prov-busqueda" class="sr-solo">Buscar proveedor</label>' +
      '<input type="search" id="prov-busqueda" data-prov-busqueda placeholder="Buscar por nombre, RFC, categoría o contacto" value="' + esc(busquedaProveedores) + '" autocomplete="off"></div>' +
      '</div>';
    html += '<div id="prov-tabla-proveedores">' + tablaProveedores(est) + '</div>';
    return html;
  }

  function tablaProveedores(est) {
    var pp = VF.calc.porPagar(est);
    var saldos = {};
    pp.porProveedor.forEach(function (g) { saldos[g.proveedorId] = g; });
    var lista = proveedoresFiltrados(est);
    var filas = lista.map(function (p) {
      var s = saldos[p.id];
      return {
        id: p.id, nombre: p.nombre, rfc: p.rfc || '', categoria: p.categoria || '',
        contacto: p.contacto || '', telefono: p.telefono || '', email: p.email || '',
        porPagar: s ? s.total : 0, vencido: s ? s.vencido : 0, cuentas: s ? s.cuentas.length : 0
      };
    });
    var columnas = [
      { clave: 'nombre', titulo: 'Proveedor', render: function (v, f) {
        return '<span><strong>' + esc(v) + '</strong>' + (f.rfc ? '<br><small class="texto-3">' + esc(f.rfc) + '</small>' : '') + '</span>';
      } },
      { clave: 'categoria', titulo: 'Categoría', render: function (v) { return v ? esc(v) : '<span class="texto-3">—</span>'; } },
      { clave: 'contacto', titulo: 'Contacto', render: function (v, f) {
        var partes = [f.contacto, f.telefono, f.email].filter(Boolean);
        return partes.length ? esc(partes.join(' · ')) : '<span class="texto-3">—</span>';
      } },
      { clave: 'porPagar', titulo: 'Por pagar', alinear: 'derecha', render: function (v, f) {
        if (!f.cuentas) return '<span class="texto-3">Sin pendientes</span>';
        return '<span><strong class="cifra">' + esc(fmt(v)) + '</strong>' +
          (f.vencido > 0 ? '<br><span class="badge badge-negativo">Vencido ' + esc(fmt(f.vencido)) + '</span>' : '<br><small class="texto-3">' + esc(plural(f.cuentas, 'cuenta')) + '</small>') + '</span>';
      } },
      { clave: 'id', titulo: 'Acciones', alinear: 'derecha', render: function (id) {
        return '<span class="celda-acciones">' +
          btnIcono('prov-nueva-cxp', 'pago', null, 'Nueva cuenta por pagar', ' data-proveedor="' + esc(id) + '"') +
          btnIcono('prov-editar-proveedor', 'editar', id, 'Editar proveedor') +
          btnIcono('prov-eliminar-proveedor', 'eliminar', id, 'Eliminar proveedor') + '</span>';
      } }
    ];
    var resumen = '<p class="texto-2 mb-1">' + esc(plural(lista.length, 'proveedor', 'proveedores')) +
      (busquedaProveedores ? ' que coinciden con la búsqueda' : '') +
      (pp.total > 0 ? ' · por pagar en total <strong class="cifra">' + esc(fmt(pp.total)) + '</strong>' : '') + '</p>';
    return resumen + VF.ui.tabla({
      columnas: columnas, filas: filas, vacio: 'Ningún proveedor coincide con la búsqueda',
      onFila: function (id) { abrirDetalleProveedor(id); }
    });
  }

  function pintarTablaProveedores() {
    var el = document.getElementById('prov-tabla-proveedores');
    var est = estado();
    if (el && est) el.innerHTML = tablaProveedores(est);
  }

  /* ---------- modal: detalle de proveedor ---------------------------------- */
  function abrirDetalleProveedor(id) {
    var est = estado();
    if (!est) return null;
    var p = proveedorDe(est, id);
    if (!p) { toast('El proveedor ya no existe.', 'alerta'); return null; }
    var pp = VF.calc.porPagar(est);
    var grupo = null;
    pp.porProveedor.forEach(function (g) { if (g.proveedorId === p.id) grupo = g; });
    var todas = (est.cuentasPorPagar || []).filter(function (c) { return c && c.proveedorId === p.id; });
    var cuerpo = '<p class="fila mb-2">' + (p.categoria ? '<span class="badge badge-info">' + esc(p.categoria) + '</span>' : '') + VF.ui.badgeAmbito('empresa') + '</p>' +
      filaTexto('RFC', p.rfc || '—') +
      filaTexto('Contacto', p.contacto || '—') +
      filaCifra('Teléfono', p.telefono ? '<a href="tel:' + esc(String(p.telefono).replace(/\s+/g, '')) + '">' + esc(p.telefono) + '</a>' : '—') +
      filaCifra('Correo', p.email ? '<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>' : '—') +
      (p.notas ? '<p class="texto-2 mt-1">' + esc(p.notas) + '</p>' : '') +
      '<hr><div class="fila-entre mb-1"><h3 class="mb-0">Cuentas por pagar</h3>' +
      '<button type="button" class="btn btn-secundario btn-chico" data-accion="prov-nueva-cxp" data-proveedor="' + esc(p.id) + '">' + VF.ui.icono('agregar') + 'Nueva</button></div>';
    if (!todas.length) {
      cuerpo += '<p class="texto-2 mb-0">Sin cuentas por pagar con este proveedor.</p>';
    } else {
      cuerpo += '<div class="fila-entre mb-1"><span class="texto-2">Pendiente <strong class="cifra">' + esc(fmt(grupo ? grupo.total : 0)) + '</strong></span>' +
        (grupo && grupo.vencido > 0 ? '<span class="badge badge-negativo">Vencido ' + esc(fmt(grupo.vencido)) + '</span>' : '<span class="badge badge-positivo">Sin vencidos</span>') + '</div>';
      var h = hoy();
      cuerpo += VF.ui.lista(U.ordenar(todas, 'fechaVencimiento', 'desc').slice(0, 8).map(function (c) {
        var ed = VF.calc.estadoCxP(c, h);
        var pend = VF.calc.pendienteCxP(c);
        return {
          icono: 'pago', titulo: c.concepto || 'Cuenta por pagar',
          sub: ESTADO_CXP[ed] + ' · vence ' + U.fmtFecha(c.fechaVencimiento) + (pend > 0 && ed !== 'cancelada' ? ' · pendiente ' + fmt(pend) : ''),
          valor: fmt(c.monto), tono: ed === 'vencida' ? 'negativo' : undefined,
          accion: 'prov-ver-cxp', id: c.id
        };
      }));
      if (todas.length > 8) cuerpo += '<p class="texto-3 mt-1 mb-0">' + esc(plural(todas.length - 8, 'cuenta más', 'cuentas más')) + ' en la pestaña Cuentas por pagar.</p>';
    }
    return VF.ui.modal({
      titulo: p.nombre,
      cuerpo: cuerpo,
      botones: [
        { texto: 'Eliminar', tono: 'peligro', accion: function () { return eliminarProveedor(p.id); } },
        { texto: 'Editar', tono: 'secundario', accion: function () { setTimeout(function () { abrirFormularioProveedor({ id: p.id }); }, 60); } },
        { texto: 'Cerrar', tono: 'primario' }
      ]
    });
  }

  /* ---------- modal: alta / edición de proveedor --------------------------- */
  function abrirFormularioProveedor(opciones) {
    var o = opciones || {};
    var est = estado();
    if (!est) return null;
    var existente = o.id ? proveedorDe(est, o.id) : null;
    if (o.id && !existente) { toast('El proveedor ya no existe.', 'alerta'); return null; }
    var valores = existente ? {
      nombre: existente.nombre || '', rfc: existente.rfc || '', categoria: existente.categoria || '', contacto: existente.contacto || '',
      telefono: existente.telefono || '', email: existente.email || '', notas: existente.notas || ''
    } : { nombre: '', rfc: '', categoria: '', contacto: '', telefono: '', email: '', notas: '' };
    var idLista = 'prov-categorias-' + Date.now().toString(36);
    var campos = [
      { nombre: 'nombre', etiqueta: 'Nombre o razón social', tipo: 'texto', requerido: true, placeholder: 'Ferretería Industrial SA de CV', maxlength: 120, autofoco: true },
      { nombre: 'rfc', etiqueta: 'RFC', tipo: 'texto', placeholder: 'XAXX010101000', maxlength: 13 },
      { nombre: 'categoria', etiqueta: 'Categoría', tipo: 'texto', placeholder: 'Materiales, Honorarios, Servicios…', lista: idLista, maxlength: 40 },
      { nombre: 'contacto', etiqueta: 'Persona de contacto', tipo: 'texto', placeholder: 'Nombre', maxlength: 80 },
      { nombre: 'telefono', etiqueta: 'Teléfono', tipo: 'tel', placeholder: '55 5555 0000', maxlength: 25 },
      { nombre: 'email', etiqueta: 'Correo', tipo: 'email', placeholder: 'contacto@proveedor.mx', maxlength: 100 },
      { nombre: 'notas', etiqueta: 'Notas', tipo: 'textarea', placeholder: 'Condiciones de crédito, horarios, referencias…', filas: 2 }
    ];
    var envoltura = VF.ui.el('<div>' + VF.ui.formulario(campos, valores) +
      '<datalist id="' + esc(idLista) + '">' + CATEGORIAS_PROVEEDOR.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></div>');
    var form = envoltura.querySelector('form');
    agruparCampos(form, ['rfc', 'categoria']);
    agruparCampos(form, ['telefono', 'email']);
    var reglas = {
      rfc: function (x) { return !x || /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(x) ? null : 'El RFC debe tener 12 o 13 caracteres (ej. XAXX010101000)'; }
    };
    function guardar() {
      if (!VF.ui.validar(form, reglas)) return false;
      var v = VF.ui.leerFormulario(form);
      var registro = {
        nombre: v.nombre, rfc: String(v.rfc || '').toUpperCase(), categoria: v.categoria, contacto: v.contacto,
        telefono: v.telefono, email: v.email, notas: v.notas
      };
      try {
        if (existente) {
          VF.store.actualizar('proveedores', existente.id, registro);
          toast('Proveedor actualizado', 'exito');
        } else {
          var nuevo = VF.store.agregar('proveedores', registro);
          toast('Proveedor guardado', 'exito');
          if (typeof o.alGuardar === 'function') o.alGuardar(nuevo);
        }
      } catch (e) {
        toast(mensajeError(e), 'error');
        return false;
      }
      return true;
    }
    var api = VF.ui.modal({
      titulo: existente ? 'Editar proveedor' : 'Nuevo proveedor',
      cuerpo: envoltura,
      botones: [
        { texto: 'Cancelar', tono: 'secundario' },
        { texto: existente ? 'Guardar cambios' : 'Guardar', tono: 'primario', accion: guardar }
      ]
    });
    enviarConEnter(form, api, guardar);
    return api;
  }

  /** Confirma y elimina; el error de integridad del store se muestra de forma amable. → Promise<bool> */
  function eliminarProveedor(id) {
    var est = estado();
    var p = est ? proveedorDe(est, id) : null;
    if (!p) { toast('El proveedor ya no existe.', 'alerta'); return Promise.resolve(true); }
    var nCxP = (est.cuentasPorPagar || []).filter(function (c) { return c && c.proveedorId === id; }).length;
    if (nCxP) {
      toast('No se puede eliminar: ' + p.nombre + ' tiene ' + plural(nCxP, 'cuenta por pagar', 'cuentas por pagar') + '. Elimínalas o reasígnalas primero.', 'alerta');
      return Promise.resolve(false);
    }
    return VF.ui.confirmar('¿Eliminar al proveedor «' + p.nombre + '»? Esta acción no se puede deshacer.', { peligro: true, textoAceptar: 'Eliminar' })
      .then(function (ok) {
        if (!ok) return false;
        try {
          VF.store.eliminar('proveedores', id);
          toast('Proveedor eliminado', 'exito');
          return true;
        } catch (e) {
          toast(mensajeError(e), 'error');
          return false;
        }
      });
  }

  /* ======================================================================== */
  /* CUENTAS POR PAGAR                                                        */
  /* ======================================================================== */
  /** Lista de CxP con sus derivados { cxp, proveedor, estado, pendiente, pagado, vencida, fecha }. */
  function cxpConDerivados(est) {
    var h = hoy();
    return (est.cuentasPorPagar || []).filter(Boolean).map(function (c) {
      var venc = c.fechaVencimiento || c.fecha || '';
      var pend = VF.calc.pendienteCxP(c);
      return {
        cxp: c, proveedor: proveedorDe(est, c.proveedorId), estado: VF.calc.estadoCxP(c, h),
        pendiente: pend, pagado: pagadoCxP(c), fecha: venc,
        vencida: !!venc && venc < h && pend > 0 && c.estado !== 'cancelada'
      };
    });
  }

  function cxpFiltradas(est) {
    var lista = cxpConDerivados(est);
    if (filtroCxP === 'pendientes') lista = lista.filter(function (x) { return x.estado === 'pendiente' || x.estado === 'parcial' || x.estado === 'vencida'; });
    else if (filtroCxP === 'vencidas') lista = lista.filter(function (x) { return x.vencida; });
    else if (filtroCxP === 'pagadas') lista = lista.filter(function (x) { return x.estado === 'pagada'; });
    lista.sort(function (a, b) {
      if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
      return (b.cxp.creado || '') < (a.cxp.creado || '') ? -1 : 1;
    });
    return lista;
  }

  function segmentosFiltro(opciones, activo, accion) {
    var html = '<div class="segmentos" role="tablist" aria-label="Filtro">';
    opciones.forEach(function (op) {
      var sel = op.valor === activo;
      html += '<button type="button" class="segmento" role="tab" data-accion="' + esc(accion) + '" data-valor="' + esc(op.valor) + '"' +
        ' aria-selected="' + (sel ? 'true' : 'false') + '"' + (sel ? '' : ' tabindex="-1"') + '>' + esc(op.texto) + '</button>';
    });
    return html + '</div>';
  }

  function cuerpoCxP(est) {
    if (!(est.cuentasPorPagar || []).length) {
      var sinProv = !(est.proveedores || []).length;
      return '<div class="tarjeta">' + VF.ui.vacio(
        sinProv ? 'Sin cuentas por pagar. Primero registra un proveedor y después sus facturas o adeudos.' : 'Sin cuentas por pagar. Registra lo que debes a tus proveedores para ver vencimientos y pagar desde aquí.',
        sinProv ? 'Agregar proveedor' : 'Agregar cuenta por pagar',
        function () { if (sinProv) abrirFormularioProveedor({}); else abrirFormularioCxP({}); }) + '</div>';
    }
    var pp = VF.calc.porPagar(est);
    var h = hoy();
    var proximas = pp.cuentas.filter(function (x) { return !x.vencida && x.fecha && U.diasEntre(h, x.fecha) <= 7; });
    var html = '<div class="kpis" id="prov-kpis-cxp">' +
      VF.ui.kpi({ titulo: 'Por pagar', valor: pp.cuentas.length ? fmt(pp.total) : '—',
        sub: pp.cuentas.length ? plural(pp.cuentas.length, 'cuenta pendiente', 'cuentas pendientes') + ' · ' + plural(pp.porProveedor.length, 'proveedor', 'proveedores') : 'Sin cuentas pendientes', tono: 'neutro' }) +
      VF.ui.kpi({ titulo: 'Vencido', valor: pp.cuentas.length ? fmt(pp.vencido) : '—',
        sub: pp.vencido > 0 ? plural(pp.cuentas.filter(function (x) { return x.vencida; }).length, 'cuenta vencida', 'cuentas vencidas') : 'Nada vencido',
        tono: pp.vencido > 0 ? 'negativo' : (pp.cuentas.length ? 'positivo' : 'neutro') }) +
      VF.ui.kpi({ titulo: 'Vence en 7 días', valor: proximas.length ? fmt(U.suma(proximas, function (x) { return x.pendiente; })) : '—',
        sub: proximas.length ? plural(proximas.length, 'cuenta') : 'Sin vencimientos próximos', tono: proximas.length ? 'alerta' : 'neutro' }) +
      '</div>';
    html += '<div class="fila-entre mb-2">' + segmentosFiltro(FILTROS_CXP, filtroCxP, 'prov-filtro-cxp') +
      '<button type="button" class="btn btn-secundario btn-chico" data-accion="prov-cxp-agrupar" aria-pressed="' + (agruparCxP ? 'true' : 'false') + '">' +
      VF.ui.icono('filtro') + (agruparCxP ? 'Agrupado por proveedor' : 'Agrupar por proveedor') + '</button></div>';
    html += '<div id="prov-lista-cxp">' + listaCxP(est) + '</div>';
    return html;
  }

  function columnasCxP(conProveedor) {
    var cols = [
      { clave: 'fecha', titulo: 'Vencimiento', render: function (f, fila) { return fechaConRelativa(f, fila.vencida ? 'negativo' : 'texto-2'); } }
    ];
    if (conProveedor) cols.push({ clave: 'proveedor', titulo: 'Proveedor', render: function (v) { return '<strong>' + esc(v) + '</strong>'; } });
    cols.push(
      { clave: 'concepto', titulo: 'Concepto', render: function (v, fila) {
        return '<span>' + esc(v || 'Cuenta por pagar') + '<br><small class="texto-3">Registrada ' + esc(U.fmtFecha(fila.registro)) + '</small></span>';
      } },
      { clave: 'monto', titulo: 'Monto', alinear: 'derecha', render: function (v) { return '<span class="cifra">' + esc(fmt(v)) + '</span>'; } },
      { clave: 'pendiente', titulo: 'Pendiente', alinear: 'derecha', render: function (v, fila) {
        if (fila.estado === 'cancelada') return '<span class="texto-3">—</span>';
        return '<span><strong class="cifra ' + (v > 0 ? (fila.vencida ? 'negativo' : '') : 'positivo') + '">' + esc(fmt(v)) + '</strong>' +
          (fila.pagado > 0 && v > 0 ? '<br><small class="texto-3">pagado ' + esc(fmt(fila.pagado)) + '</small>' : '') + '</span>';
      } },
      { clave: 'estado', titulo: 'Estado', render: function (v) { return badgeEstadoCxP(v); } },
      { clave: 'id', titulo: 'Acciones', alinear: 'derecha', render: function (id, fila) {
        var puedePagar = fila.pendiente > 0 && fila.estado !== 'cancelada';
        return '<span class="celda-acciones">' +
          (puedePagar ? '<button type="button" class="btn btn-secundario btn-chico" data-accion="prov-pagar-cxp" data-id="' + esc(id) + '">' + VF.ui.icono('pago') + 'Pagar</button>' : '') +
          btnIcono('prov-editar-cxp', 'editar', id, 'Editar cuenta por pagar') +
          btnIcono('prov-eliminar-cxp', 'eliminar', id, 'Eliminar cuenta por pagar') + '</span>';
      } }
    );
    return cols;
  }

  function filaCxP(x) {
    return {
      id: x.cxp.id, fecha: x.fecha, proveedor: x.proveedor ? x.proveedor.nombre : 'Proveedor eliminado', concepto: x.cxp.concepto,
      registro: x.cxp.fecha, monto: x.cxp.monto, pendiente: x.pendiente, pagado: x.pagado, estado: x.estado, vencida: x.vencida
    };
  }

  function listaCxP(est) {
    var lista = cxpFiltradas(est);
    var vacioTexto = { todas: 'Sin cuentas por pagar', pendientes: 'Sin cuentas pendientes de pago', vencidas: 'Sin cuentas vencidas', pagadas: 'Aún no hay cuentas pagadas' }[filtroCxP];
    if (!lista.length) return '<div class="tarjeta">' + VF.ui.vacio(vacioTexto) + '</div>';
    var totalPend = U.suma(lista.filter(function (x) { return x.estado !== 'cancelada'; }), function (x) { return x.pendiente; });
    var resumen = '<p class="texto-2 mb-1">' + esc(plural(lista.length, 'cuenta')) + (totalPend > 0 ? ' · pendiente <strong class="cifra">' + esc(fmt(totalPend)) + '</strong>' : '') + '</p>';
    if (!agruparCxP) {
      return resumen + VF.ui.tabla({ columnas: columnasCxP(true), filas: lista.map(filaCxP), vacio: vacioTexto, onFila: function (id) { abrirDetalleCxP(id); } });
    }
    var grupos = U.agrupar(lista, function (x) { return x.cxp.proveedorId; });
    var claves = Object.keys(grupos).sort(function (a, b) {
      var ta = U.suma(grupos[a], function (x) { return x.pendiente; }), tb = U.suma(grupos[b], function (x) { return x.pendiente; });
      if (tb !== ta) return tb - ta;
      return grupos[a][0].fecha < grupos[b][0].fecha ? -1 : 1;
    });
    var html = resumen;
    claves.forEach(function (provId) {
      var g = grupos[provId];
      var pend = U.suma(g.filter(function (x) { return x.estado !== 'cancelada'; }), function (x) { return x.pendiente; });
      var venc = U.suma(g.filter(function (x) { return x.vencida; }), function (x) { return x.pendiente; });
      var acciones = '<span class="fila">' +
        (venc > 0 ? '<span class="badge badge-negativo">Vencido ' + esc(fmt(venc)) + '</span>' : '') +
        '<span class="badge badge-info">Pendiente ' + esc(fmt(pend)) + '</span>' +
        '<button type="button" class="btn btn-fantasma btn-chico" data-accion="prov-ver-proveedor" data-id="' + esc(provId) + '">Ver proveedor</button></span>';
      html += VF.ui.tarjeta({
        titulo: nombreProveedor(est, provId) + ' · ' + plural(g.length, 'cuenta'),
        acciones: acciones,
        cuerpo: VF.ui.tabla({ columnas: columnasCxP(false), filas: g.map(filaCxP), vacio: 'Sin cuentas', onFila: function (id) { abrirDetalleCxP(id); } })
      });
    });
    return html;
  }

  function pintarListaCxP() {
    var el = document.getElementById('prov-lista-cxp');
    var est = estado();
    if (el && est) el.innerHTML = listaCxP(est);
  }

  /* ---------- modal: detalle de una cuenta por pagar ----------------------- */
  function abrirDetalleCxP(id) {
    var est = estado();
    if (!est) return null;
    var c = buscar(est.cuentasPorPagar, id);
    if (!c) { toast('La cuenta por pagar ya no existe.', 'alerta'); return null; }
    var h = hoy();
    var ed = VF.calc.estadoCxP(c, h);
    var pend = VF.calc.pendienteCxP(c);
    var pagado = pagadoCxP(c);
    var vencida = !!c.fechaVencimiento && c.fechaVencimiento < h && pend > 0 && ed !== 'cancelada';
    var cuerpo = '<p class="hero-cifra cifra mb-0 ' + (ed === 'cancelada' ? 'texto-3' : pend > 0 ? (vencida ? 'negativo' : '') : 'positivo') + '">' + esc(fmt(ed === 'cancelada' ? c.monto : pend)) + '</p>' +
      '<p class="texto-2 mb-1">' + (ed === 'cancelada' ? 'Monto de la cuenta cancelada' : pend > 0 ? 'Pendiente de pagar' : 'Totalmente pagada') + '</p>' +
      '<p class="fila mb-2">' + badgeEstadoCxP(ed) + VF.ui.badgeAmbito('empresa') + '</p>' +
      filaCifra('Proveedor', '<a href="#" data-accion="prov-ver-proveedor" data-id="' + esc(c.proveedorId) + '">' + esc(nombreProveedor(est, c.proveedorId)) + '</a>') +
      filaTexto('Concepto', c.concepto || '—') +
      filaTexto('Fecha', U.fmtFecha(c.fecha)) +
      filaCifra('Vencimiento', esc(U.fmtFecha(c.fechaVencimiento)) + ' <small class="' + (vencida ? 'negativo' : 'texto-3') + '">' + esc(capitalizar(VF.ui.fechaRelativa(c.fechaVencimiento))) + '</small>') +
      filaCifra('Monto', '<strong class="cifra">' + esc(fmt(c.monto)) + '</strong>') +
      filaCifra('Pagado', '<span class="cifra positivo">' + esc(fmt(pagado)) + '</span>') +
      filaCifra('Pendiente', '<strong class="cifra ' + (pend > 0 ? (vencida ? 'negativo' : '') : 'positivo') + '">' + esc(fmt(pend)) + '</strong>') +
      (c.notas ? '<p class="aviso mt-1">' + esc(c.notas) + '</p>' : '');
    cuerpo += '<hr><h3>Pagos registrados</h3>';
    var pagos = U.ordenar(c.pagos || [], 'fecha', 'desc');
    if (!pagos.length) {
      cuerpo += '<p class="texto-2 mb-0">Sin pagos todavía.</p>';
    } else {
      cuerpo += '<ul class="lista">' + pagos.map(function (p) {
        return '<li class="lista-item"><span class="lista-icono">' + VF.ui.icono('gasto') + '</span>' +
          '<div class="lista-texto"><p class="lista-titulo">' + esc(fmt(p.monto)) + '</p>' +
          '<p class="lista-sub">' + esc(U.fmtFecha(p.fecha)) + ' · ' + esc(nombreCuenta(est, p.cuentaId)) +
          (p.movimientoId ? ' · <a href="#" data-accion="prov-ver-movimiento" data-id="' + esc(p.movimientoId) + '">ver movimiento</a>' : '') + '</p></div>' +
          btnIcono('prov-eliminar-pago', 'eliminar', c.id, 'Eliminar pago', ' data-pago="' + esc(p.id) + '"') + '</li>';
      }).join('') + '</ul>';
    }
    var botones = [
      { texto: 'Eliminar', tono: 'peligro', accion: function () { return eliminarCxP(c.id); } },
      { texto: 'Editar', tono: 'secundario', accion: function () { setTimeout(function () { abrirFormularioCxP({ id: c.id }); }, 60); } }
    ];
    if (pend > 0 && ed !== 'cancelada') {
      botones.push({ texto: 'Registrar pago', tono: 'primario', accion: function () { setTimeout(function () { abrirPagoCxP(c.id); }, 60); } });
    } else {
      botones.push({ texto: 'Cerrar', tono: 'primario' });
    }
    return VF.ui.modal({ titulo: 'Cuenta por pagar', cuerpo: cuerpo, botones: botones });
  }

  /* ---------- modal: alta / edición de cuenta por pagar -------------------- */
  function abrirFormularioCxP(opciones) {
    var o = opciones || {};
    var est = estado();
    if (!est) return null;
    var existente = o.id ? buscar(est.cuentasPorPagar, o.id) : null;
    if (o.id && !existente) { toast('La cuenta por pagar ya no existe.', 'alerta'); return null; }
    var proveedores = U.ordenar((est.proveedores || []).filter(Boolean), 'nombre');
    if (!proveedores.length) {
      toast('Primero registra un proveedor.', 'alerta');
      return abrirFormularioProveedor({ alGuardar: function (p) { setTimeout(function () { abrirFormularioCxP({ proveedorId: p.id }); }, 60); } });
    }
    var pagado = existente ? pagadoCxP(existente) : 0;
    var valores = existente ? {
      proveedorId: existente.proveedorId, concepto: existente.concepto || '', monto: existente.monto, fecha: existente.fecha || hoy(),
      fechaVencimiento: existente.fechaVencimiento || '', notas: existente.notas || '', estado: existente.estado === 'cancelada' ? 'cancelada' : 'pendiente'
    } : {
      proveedorId: o.proveedorId || (proveedores.length === 1 ? proveedores[0].id : ''), concepto: '', monto: '', fecha: hoy(),
      fechaVencimiento: fechaVencimientoPorDefecto(), notas: '', estado: 'pendiente'
    };
    var campos = [
      { nombre: 'proveedorId', etiqueta: 'Proveedor', tipo: 'select', requerido: true, placeholder: 'Elige un proveedor',
        opciones: proveedores.map(function (p) { return { valor: p.id, texto: p.nombre }; }) },
      { nombre: 'concepto', etiqueta: 'Concepto', tipo: 'texto', requerido: true, placeholder: 'Factura, material, servicio…', maxlength: 140 },
      { nombre: 'monto', etiqueta: 'Monto (MXN)', tipo: 'monto', requerido: true, min: 0.01, placeholder: '0.00',
        ayuda: pagado > 0 ? 'Ya se pagaron ' + fmt(pagado) + '; el monto no puede ser menor.' : '' },
      { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'fecha', requerido: true },
      { nombre: 'fechaVencimiento', etiqueta: 'Vence el', tipo: 'fecha', requerido: true, ayuda: 'Por defecto, ' + DIAS_VENCIMIENTO + ' días después de la fecha.' },
      { nombre: 'notas', etiqueta: 'Notas', tipo: 'textarea', filas: 2, placeholder: 'Acuerdos de pago, referencia de factura…' }
    ];
    if (existente) {
      campos.push({ nombre: 'estado', etiqueta: 'Estado', tipo: 'select',
        opciones: [{ valor: 'pendiente', texto: 'Pendiente (vigente)' }, { valor: 'cancelada', texto: 'Cancelada' }],
        ayuda: 'Una cuenta cancelada deja de contar en lo por pagar.' });
    }
    var envoltura = VF.ui.el('<div>' + VF.ui.formulario(campos, valores) + '</div>');
    var form = envoltura.querySelector('form');
    agruparCampos(form, ['monto', 'fecha']);
    var reglas = {
      monto: function (x) {
        if (!(x > 0)) return 'Ingresa un monto mayor a cero';
        if (pagado > 0 && x < pagado) return 'El monto no puede ser menor a lo ya pagado (' + fmt(pagado) + ')';
        return null;
      },
      proveedorId: function (x) { return x ? null : 'Elige un proveedor'; },
      fechaVencimiento: function (x, vals) { return x && vals.fecha && x < vals.fecha ? 'El vencimiento no puede ser anterior a la fecha' : null; }
    };
    var campoFecha = form.querySelector('[data-campo="fecha"]');
    var campoVence = form.querySelector('[data-campo="fechaVencimiento"]');
    if (campoFecha && campoVence && !existente) {
      campoFecha.addEventListener('change', function () {
        if (/^\d{4}-\d{2}-\d{2}$/.test(campoFecha.value)) campoVence.value = U.sumarDias(campoFecha.value, DIAS_VENCIMIENTO);
      });
    }
    function guardar() {
      if (!VF.ui.validar(form, reglas)) return false;
      var v = VF.ui.leerFormulario(form);
      var registro = {
        proveedorId: v.proveedorId, concepto: v.concepto, monto: U.round2(v.monto), fecha: v.fecha,
        fechaVencimiento: v.fechaVencimiento, notas: v.notas
      };
      try {
        if (existente) {
          registro.estado = v.estado === 'cancelada' ? 'cancelada' : 'pendiente';
          VF.store.actualizar('cuentasPorPagar', existente.id, registro);
          toast('Cuenta por pagar actualizada', 'exito');
        } else {
          VF.store.agregar('cuentasPorPagar', Object.assign({ pagos: [], estado: 'pendiente' }, registro));
          toast('Cuenta por pagar guardada', 'exito');
          if (pestanaActual !== 'cxp' && document.getElementById('prov-cuerpo')) fijarPestana('cxp');
        }
      } catch (e) {
        toast(mensajeError(e), 'error');
        return false;
      }
      return true;
    }
    var api = VF.ui.modal({
      titulo: existente ? 'Editar cuenta por pagar' : 'Nueva cuenta por pagar',
      cuerpo: envoltura,
      botones: [
        { texto: 'Cancelar', tono: 'secundario' },
        { texto: existente ? 'Guardar cambios' : 'Guardar', tono: 'primario', accion: guardar }
      ]
    });
    enviarConEnter(form, api, guardar);
    return api;
  }

  /* ---------- modal: registrar pago de CxP --------------------------------- */
  function abrirPagoCxP(id) {
    var est = estado();
    if (!est) return null;
    var c = buscar(est.cuentasPorPagar, id);
    if (!c) { toast('La cuenta por pagar ya no existe.', 'alerta'); return null; }
    var pend = VF.calc.pendienteCxP(c);
    if (c.estado === 'cancelada' || pend <= 0) { toast('Esta cuenta no tiene saldo pendiente.', 'alerta'); return null; }
    var cuentas = opcionesCuentas(est);
    if (!cuentas.length) {
      toast('No hay cuentas de empresa activas. Crea una en Empresa para registrar pagos.', 'alerta');
      return null;
    }
    var campos = [
      { nombre: 'monto', etiqueta: 'Monto a pagar (MXN)', tipo: 'monto', requerido: true, min: 0.01, max: pend, valor: pend,
        ayuda: 'Pendiente: ' + fmt(pend) + '. Puedes registrar un pago parcial.' },
      { nombre: 'fecha', etiqueta: 'Fecha del pago', tipo: 'fecha', requerido: true, valor: hoy() },
      { nombre: 'cuentaId', etiqueta: 'Cuenta de empresa', tipo: 'select', requerido: true, placeholder: 'Elige la cuenta', opciones: cuentas,
        valor: cuentas.length === 1 ? cuentas[0].valor : '', ayuda: 'Se registrará un gasto en la categoría «' + CATEGORIA_PAGO_CXP + '» vinculado a esta cuenta por pagar.' }
    ];
    var envoltura = VF.ui.el('<div><p class="mb-2"><strong>' + esc(c.concepto || 'Cuenta por pagar') + '</strong><br><span class="texto-2">' + esc(nombreProveedor(est, c.proveedorId)) + '</span></p>' +
      VF.ui.formulario(campos) + '</div>');
    var form = envoltura.querySelector('form');
    agruparCampos(form, ['monto', 'fecha']);
    var reglas = {
      monto: function (x) { return x > 0 ? (x > pend + 1e-9 ? 'El pago no puede superar el pendiente (' + fmt(pend) + ')' : null) : 'Ingresa un monto mayor a cero'; },
      cuentaId: function (x) { return x ? null : 'Elige una cuenta'; }
    };
    function guardar() {
      if (!VF.ui.validar(form, reglas)) return false;
      var v = VF.ui.leerFormulario(form);
      var ok = registrarPagoCxP(c.id, { monto: v.monto, fecha: v.fecha, cuentaId: v.cuentaId });
      if (ok) setTimeout(function () { abrirDetalleCxP(c.id); }, 80);
      return ok;
    }
    var api = VF.ui.modal({
      titulo: 'Registrar pago',
      cuerpo: envoltura,
      botones: [{ texto: 'Cancelar', tono: 'secundario' }, { texto: 'Registrar pago', tono: 'primario', accion: guardar }]
    });
    enviarConEnter(form, api, guardar);
    return api;
  }

  /**
   * Registra un pago en la CxP: crea el movimiento gasto (ámbito empresa, categoría Proveedores, cxpId) y
   * guarda el pago con su movimientoId. → true | false (muestra toast).
   */
  function registrarPagoCxP(id, pago) {
    var est = estado();
    var c = est ? buscar(est.cuentasPorPagar, id) : null;
    if (!c) { toast('La cuenta por pagar ya no existe.', 'alerta'); return false; }
    var pend = VF.calc.pendienteCxP(c);
    var monto = U.round2(Number(pago.monto));
    if (!(monto > 0) || monto > pend + 1e-9) { toast('El monto debe ser mayor a cero y no superar el pendiente (' + fmt(pend) + ').', 'error'); return false; }
    var cuenta = buscar(est.cuentas, pago.cuentaId);
    if (!cuenta || cuenta.ambito !== 'empresa') { toast('Elige una cuenta de empresa.', 'error'); return false; }
    try {
      var m = VF.store.agregar('movimientos', {
        ambito: 'empresa', cuentaId: cuenta.id, tipo: 'gasto', monto: monto, fecha: pago.fecha,
        categoria: CATEGORIA_PAGO_CXP, descripcion: 'Pago a proveedor — ' + (c.concepto || 'cuenta por pagar'),
        contraparte: nombreProveedor(est, c.proveedorId), cuentaDestinoId: null,
        facturaId: null, cxpId: c.id, prestamoId: null, comisionId: null, estado: 'confirmado', etiquetas: []
      });
      var pagos = (c.pagos || []).slice();
      pagos.push({ id: U.uid('pago'), fecha: pago.fecha, monto: monto, cuentaId: cuenta.id, movimientoId: m.id });
      VF.store.actualizar('cuentasPorPagar', c.id, { pagos: pagos });
      toast(monto >= pend - 1e-9 ? 'Pago registrado: la cuenta quedó pagada' : 'Pago parcial registrado', 'exito');
      return true;
    } catch (e) {
      toast(mensajeError(e), 'error');
      return false;
    }
  }

  /** Elimina un pago y su movimiento vinculado (revierte el saldo de la cuenta). → Promise<bool> */
  function eliminarPagoCxP(id, pagoId) {
    var est = estado();
    var c = est ? buscar(est.cuentasPorPagar, id) : null;
    var pago = c ? buscar(c.pagos, pagoId) : null;
    if (!pago) { toast('El pago ya no existe.', 'alerta'); return Promise.resolve(false); }
    return VF.ui.confirmar('¿Eliminar el pago de ' + fmt(pago.monto) + ' del ' + U.fmtFecha(pago.fecha) + '? También se eliminará el movimiento de gasto y el saldo de la cuenta se recalculará.', { peligro: true, textoAceptar: 'Eliminar pago' })
      .then(function (ok) {
        if (!ok) return false;
        try {
          if (pago.movimientoId && VF.store.obtener('movimientos', pago.movimientoId)) VF.store.eliminar('movimientos', pago.movimientoId);
          VF.store.actualizar('cuentasPorPagar', c.id, { pagos: (c.pagos || []).filter(function (p) { return p.id !== pagoId; }) });
          toast('Pago eliminado', 'exito');
          return true;
        } catch (e) {
          toast(mensajeError(e), 'error');
          return false;
        }
      });
  }

  function eliminarCxP(id) {
    var est = estado();
    var c = est ? buscar(est.cuentasPorPagar, id) : null;
    if (!c) { toast('La cuenta por pagar ya no existe.', 'alerta'); return Promise.resolve(true); }
    var nPagos = (c.pagos || []).length;
    var msg = '¿Eliminar la cuenta por pagar «' + (c.concepto || 'sin concepto') + '» de ' + nombreProveedor(est, c.proveedorId) + '?' +
      (nPagos ? ' También se eliminarán sus ' + plural(nPagos, 'pago') + ' y los movimientos vinculados.' : '');
    return VF.ui.confirmar(msg, { peligro: true, textoAceptar: 'Eliminar' }).then(function (ok) {
      if (!ok) return false;
      try {
        VF.store.eliminar('cuentasPorPagar', id);
        toast('Cuenta por pagar eliminada', 'exito');
        return true;
      } catch (e) {
        toast(mensajeError(e), 'error');
        return false;
      }
    });
  }

  /* ======================================================================== */
  /* COMISIONES                                                               */
  /* ======================================================================== */
  function comisionesFiltradas(est) {
    var lista = (est.comisiones || []).filter(Boolean);
    if (filtroComision === 'pendientes') lista = lista.filter(function (c) { return c.estado === 'pendiente'; });
    else if (filtroComision === 'pagadas') lista = lista.filter(function (c) { return c.estado === 'pagada'; });
    lista = lista.slice().sort(function (a, b) {
      var pa = a.estado === 'pendiente' ? 0 : 1, pb = b.estado === 'pendiente' ? 0 : 1;
      if (pa !== pb) return pa - pb;
      if ((a.fecha || '') !== (b.fecha || '')) return (a.fecha || '') < (b.fecha || '') ? 1 : -1;
      return (a.creado || '') < (b.creado || '') ? 1 : -1;
    });
    return lista;
  }

  function cuerpoComisiones(est) {
    if (!(est.comisiones || []).length) {
      return '<div class="tarjeta">' + VF.ui.vacio('Sin comisiones registradas. Registra las comisiones por venta o referido que debes pagar; puedes calcularlas sobre una factura.', 'Agregar comisión', function () {
        abrirFormularioComision({});
      }) + '</div>';
    }
    var pendientes = VF.calc.comisionesPendientes(est);
    var pagadas = (est.comisiones || []).filter(function (c) { return c && c.estado === 'pagada'; });
    var totalPagadas = U.suma(pagadas, function (c) { return c.monto; });
    var proxima = pendientes.lista[0] || null;
    var html = '<div class="kpis" id="prov-kpis-comisiones">' +
      VF.ui.kpi({ titulo: 'Comisiones pendientes', valor: pendientes.lista.length ? fmt(pendientes.total) : '—',
        sub: pendientes.lista.length ? plural(pendientes.lista.length, 'comisión por pagar', 'comisiones por pagar') : 'Nada pendiente', tono: pendientes.lista.length ? 'alerta' : 'positivo' }) +
      VF.ui.kpi({ titulo: 'Próxima a pagar', valor: proxima ? fmt(proxima.monto) : '—',
        sub: proxima ? (proxima.beneficiario || '') + ' · ' + capitalizar(VF.ui.fechaRelativa(proxima.fecha)) : 'Sin comisiones pendientes', tono: 'neutro' }) +
      VF.ui.kpi({ titulo: 'Pagadas', valor: pagadas.length ? fmt(totalPagadas) : '—',
        sub: pagadas.length ? plural(pagadas.length, 'comisión pagada', 'comisiones pagadas') : 'Aún no se ha pagado ninguna', tono: 'neutro' }) +
      '</div>';
    html += '<div class="fila-entre mb-2">' + segmentosFiltro(FILTROS_COMISION, filtroComision, 'prov-filtro-comision') + '</div>';
    html += '<div id="prov-lista-comisiones">' + listaComisiones(est) + '</div>';
    return html;
  }

  function listaComisiones(est) {
    var lista = comisionesFiltradas(est);
    var vacioTexto = { todas: 'Sin comisiones', pendientes: 'Sin comisiones pendientes', pagadas: 'Aún no hay comisiones pagadas' }[filtroComision];
    if (!lista.length) return '<div class="tarjeta">' + VF.ui.vacio(vacioTexto) + '</div>';
    var filas = lista.map(function (c) {
      var f = c.facturaId ? buscar(est.facturas, c.facturaId) : null;
      return {
        id: c.id, fecha: c.fecha, beneficiario: c.beneficiario || '', factura: f ? (f.folio || 'Factura') : '',
        facturaDetalle: f ? nombreCliente(est, f.clienteId) : '', base: c.base, porcentaje: c.porcentaje, monto: c.monto, estado: c.estado
      };
    });
    var columnas = [
      { clave: 'fecha', titulo: 'Fecha', render: function (f, fila) { return fechaConRelativa(f, fila.estado === 'pendiente' && f && f < hoy() ? 'negativo' : 'texto-2'); } },
      { clave: 'beneficiario', titulo: 'Beneficiario', render: function (v) { return '<strong>' + esc(v || '—') + '</strong>'; } },
      { clave: 'factura', titulo: 'Base', render: function (v, fila) {
        return '<span>' + (v ? esc(v) + (fila.facturaDetalle ? ' · ' + esc(fila.facturaDetalle) : '') : 'Base manual') +
          '<br><small class="texto-3 cifra">' + esc(fmt(fila.base)) + ' × ' + esc(U.fmtNumero(fila.porcentaje, 2)) + ' %</small></span>';
      } },
      { clave: 'monto', titulo: 'Monto', alinear: 'derecha', render: function (v) { return '<strong class="cifra">' + esc(fmt(v)) + '</strong>'; } },
      { clave: 'estado', titulo: 'Estado', render: function (v, fila) { return badgeEstadoComision(fila); } },
      { clave: 'id', titulo: 'Acciones', alinear: 'derecha', render: function (id, fila) {
        return '<span class="celda-acciones">' +
          (fila.estado === 'pendiente' ? '<button type="button" class="btn btn-secundario btn-chico" data-accion="prov-pagar-comision" data-id="' + esc(id) + '">' + VF.ui.icono('pago') + 'Pagar</button>' : '') +
          (fila.estado === 'pendiente' ? btnIcono('prov-editar-comision', 'editar', id, 'Editar comisión') : '') +
          btnIcono('prov-eliminar-comision', 'eliminar', id, 'Eliminar comisión') + '</span>';
      } }
    ];
    var resumen = '<p class="texto-2 mb-1">' + esc(plural(lista.length, 'comisión', 'comisiones')) + '</p>';
    return resumen + VF.ui.tabla({ columnas: columnas, filas: filas, vacio: vacioTexto, onFila: function (id) { abrirDetalleComision(id); } });
  }

  function pintarListaComisiones() {
    var el = document.getElementById('prov-lista-comisiones');
    var est = estado();
    if (el && est) el.innerHTML = listaComisiones(est);
  }

  /* ---------- modal: detalle de comisión ----------------------------------- */
  function abrirDetalleComision(id) {
    var est = estado();
    if (!est) return null;
    var c = buscar(est.comisiones, id);
    if (!c) { toast('La comisión ya no existe.', 'alerta'); return null; }
    var f = c.facturaId ? buscar(est.facturas, c.facturaId) : null;
    var m = c.movimientoId ? buscar(est.movimientos, c.movimientoId) : null;
    var pendiente = c.estado === 'pendiente';
    var cuerpo = '<p class="hero-cifra cifra mb-0 ' + (pendiente ? 'alerta' : 'positivo') + '">' + esc(fmt(c.monto)) + '</p>' +
      '<p class="texto-2 mb-1">' + esc(U.fmtNumero(c.porcentaje, 2)) + ' % sobre ' + esc(fmt(c.base)) + '</p>' +
      '<p class="fila mb-2">' + badgeEstadoComision(c) + VF.ui.badgeAmbito('empresa') + '</p>' +
      filaTexto('Beneficiario', c.beneficiario || '—') +
      filaCifra('Base', f
        ? '<a href="#/facturas?id=' + esc(encodeURIComponent(f.id)) + '">' + esc(f.folio || 'Factura') + '</a>' + (f.clienteId ? ' <small class="texto-3">' + esc(nombreCliente(est, f.clienteId)) + '</small>' : '') + '<br><small class="texto-3">Subtotal ' + esc(fmt(f.subtotal)) + '</small>'
        : (c.facturaId ? '<span class="texto-3">Factura eliminada</span>' : 'Base manual')) +
      filaCifra('Fecha', esc(U.fmtFecha(c.fecha)) + ' <small class="texto-3">' + esc(capitalizar(VF.ui.fechaRelativa(c.fecha))) + '</small>') +
      (c.notas ? '<p class="aviso mt-1">' + esc(c.notas) + '</p>' : '');
    if (c.estado === 'pagada') {
      cuerpo += '<hr><h3>Pago</h3>' + (m
        ? '<p class="mb-0">Gasto «' + esc(m.categoria || CATEGORIA_PAGO_COMISION) + '» de ' + esc(fmt(m.monto)) + ' el ' + esc(U.fmtFecha(m.fecha)) + ' desde ' + esc(nombreCuenta(est, m.cuentaId)) +
          ' · <a href="#" data-accion="prov-ver-movimiento" data-id="' + esc(m.id) + '">ver movimiento</a></p>'
        : '<p class="texto-2 mb-0">Marcada como pagada sin movimiento vinculado.</p>');
    }
    var botones = [{ texto: 'Eliminar', tono: 'peligro', accion: function () { return eliminarComision(c.id); } }];
    if (pendiente) {
      botones.push({ texto: 'Editar', tono: 'secundario', accion: function () { setTimeout(function () { abrirFormularioComision({ id: c.id }); }, 60); } });
      botones.push({ texto: 'Pagar', tono: 'primario', accion: function () { setTimeout(function () { abrirPagoComision(c.id); }, 60); } });
    } else {
      botones.push({ texto: 'Revertir pago', tono: 'secundario', accion: function () { return revertirPagoComision(c.id); } });
      botones.push({ texto: 'Cerrar', tono: 'primario' });
    }
    return VF.ui.modal({ titulo: 'Comisión', cuerpo: cuerpo, botones: botones });
  }

  /* ---------- modal: alta / edición de comisión ---------------------------- */
  function abrirFormularioComision(opciones) {
    var o = opciones || {};
    var est = estado();
    if (!est) return null;
    var existente = o.id ? buscar(est.comisiones, o.id) : null;
    if (o.id && !existente) { toast('La comisión ya no existe.', 'alerta'); return null; }
    if (existente && existente.estado === 'pagada') { toast('La comisión ya está pagada; revierte el pago para editarla.', 'alerta'); return null; }
    var facturas = (est.facturas || []).filter(function (f) { return f && f.estado !== 'cancelada'; });
    facturas = U.ordenar(facturas, 'folio', 'desc');
    var opcionesFactura = facturas.map(function (f) {
      var cliente = nombreCliente(est, f.clienteId);
      return { valor: f.id, texto: (f.folio || 'Factura') + (cliente ? ' · ' + cliente : '') + ' · subtotal ' + fmt(f.subtotal) };
    });
    var valores = existente ? {
      beneficiario: existente.beneficiario || '', facturaId: existente.facturaId || '', base: existente.base, porcentaje: existente.porcentaje,
      fecha: existente.fecha || hoy(), notas: existente.notas || ''
    } : { beneficiario: '', facturaId: o.facturaId || '', base: '', porcentaje: '', fecha: hoy(), notas: '' };
    if (!existente && o.facturaId) {
      var fi = buscar(est.facturas, o.facturaId);
      if (fi) valores.base = fi.subtotal;
    }
    var campos = [
      { nombre: 'beneficiario', etiqueta: 'Beneficiario', tipo: 'texto', requerido: true, placeholder: 'Vendedor, agente o quien refirió', maxlength: 100, autofoco: true },
      { nombre: 'facturaId', etiqueta: 'Factura (opcional)', tipo: 'select', placeholder: opcionesFactura.length ? 'Base manual (sin factura)' : 'Sin facturas registradas', opciones: opcionesFactura,
        ayuda: 'Al elegir una factura, la base toma su subtotal (sin IVA).' },
      { nombre: 'base', etiqueta: 'Base (MXN)', tipo: 'monto', requerido: true, min: 0.01, placeholder: '0.00' },
      { nombre: 'porcentaje', etiqueta: 'Porcentaje (%)', tipo: 'numero', requerido: true, min: 0, max: 100, paso: 0.01, placeholder: '3' },
      { nombre: 'fecha', etiqueta: 'Fecha de pago prevista', tipo: 'fecha', requerido: true },
      { nombre: 'notas', etiqueta: 'Notas', tipo: 'textarea', filas: 2, placeholder: 'Condición de pago, acuerdo…' }
    ];
    var envoltura = VF.ui.el('<div>' + VF.ui.formulario(campos, valores) +
      '<div class="aviso mb-0" aria-live="polite"><span class="texto-2">Monto de la comisión</span> ' +
      '<strong class="cifra" data-prov-monto-comision>—</strong></div></div>');
    var form = envoltura.querySelector('form');
    agruparCampos(form, ['base', 'porcentaje']);
    var campoFactura = form.querySelector('[data-campo="facturaId"]');
    var campoBase = form.querySelector('[data-campo="base"]');
    var salidaMonto = envoltura.querySelector('[data-prov-monto-comision]');

    function recalcular() {
      var v = VF.ui.leerFormulario(form);
      var m = montoComision(v.base, v.porcentaje);
      salidaMonto.textContent = isNaN(m) ? '—' : fmt(m);
    }
    if (campoFactura) {
      campoFactura.addEventListener('change', function () {
        var f = buscar(est.facturas, campoFactura.value);
        if (f && campoBase) campoBase.value = Number(f.subtotal).toFixed(2);
        recalcular();
      });
    }
    form.addEventListener('input', recalcular);
    form.addEventListener('change', recalcular);
    recalcular();

    var reglas = {
      base: function (x) { return x > 0 ? null : 'Ingresa una base mayor a cero'; },
      porcentaje: function (x) { return x != null && x > 0 && x <= 100 ? null : 'Ingresa un porcentaje entre 0.01 y 100'; }
    };
    function guardar() {
      if (!VF.ui.validar(form, reglas)) return false;
      var v = VF.ui.leerFormulario(form);
      var registro = {
        beneficiario: v.beneficiario, facturaId: v.facturaId || null, base: U.round2(v.base), porcentaje: Number(v.porcentaje),
        monto: montoComision(v.base, v.porcentaje), fecha: v.fecha, notas: v.notas
      };
      try {
        if (existente) {
          VF.store.actualizar('comisiones', existente.id, registro);
          toast('Comisión actualizada', 'exito');
        } else {
          VF.store.agregar('comisiones', Object.assign({ estado: 'pendiente', movimientoId: null }, registro));
          toast('Comisión guardada', 'exito');
          if (pestanaActual !== 'comisiones' && document.getElementById('prov-cuerpo')) fijarPestana('comisiones');
        }
      } catch (e) {
        toast(mensajeError(e), 'error');
        return false;
      }
      return true;
    }
    var api = VF.ui.modal({
      titulo: existente ? 'Editar comisión' : 'Nueva comisión',
      cuerpo: envoltura,
      botones: [
        { texto: 'Cancelar', tono: 'secundario' },
        { texto: existente ? 'Guardar cambios' : 'Guardar', tono: 'primario', accion: guardar }
      ]
    });
    enviarConEnter(form, api, guardar);
    return api;
  }

  /* ---------- modal: pagar comisión ---------------------------------------- */
  function abrirPagoComision(id) {
    var est = estado();
    if (!est) return null;
    var c = buscar(est.comisiones, id);
    if (!c) { toast('La comisión ya no existe.', 'alerta'); return null; }
    if (c.estado !== 'pendiente') { toast('Esta comisión ya está pagada.', 'alerta'); return null; }
    var cuentas = opcionesCuentas(est);
    if (!cuentas.length) { toast('No hay cuentas de empresa activas. Crea una en Empresa para registrar pagos.', 'alerta'); return null; }
    var campos = [
      { nombre: 'fecha', etiqueta: 'Fecha del pago', tipo: 'fecha', requerido: true, valor: hoy() },
      { nombre: 'cuentaId', etiqueta: 'Cuenta de empresa', tipo: 'select', requerido: true, placeholder: 'Elige la cuenta', opciones: cuentas,
        valor: cuentas.length === 1 ? cuentas[0].valor : '', ayuda: 'Se registrará un gasto en la categoría «' + CATEGORIA_PAGO_COMISION + '» vinculado a esta comisión.' }
    ];
    var envoltura = VF.ui.el('<div><p class="hero-cifra cifra mb-0">' + esc(fmt(c.monto)) + '</p>' +
      '<p class="texto-2 mb-2">' + esc(c.beneficiario || '') + (c.facturaId && folioFactura(est, c.facturaId) ? ' · ' + esc(folioFactura(est, c.facturaId)) : '') + '</p>' +
      VF.ui.formulario(campos) + '</div>');
    var form = envoltura.querySelector('form');
    var reglas = { cuentaId: function (x) { return x ? null : 'Elige una cuenta'; } };
    function guardar() {
      if (!VF.ui.validar(form, reglas)) return false;
      var v = VF.ui.leerFormulario(form);
      var ok = pagarComision(c.id, { fecha: v.fecha, cuentaId: v.cuentaId });
      if (ok) setTimeout(function () { abrirDetalleComision(c.id); }, 80);
      return ok;
    }
    var api = VF.ui.modal({
      titulo: 'Pagar comisión',
      cuerpo: envoltura,
      botones: [{ texto: 'Cancelar', tono: 'secundario' }, { texto: 'Pagar', tono: 'primario', accion: guardar }]
    });
    enviarConEnter(form, api, guardar);
    return api;
  }

  /** Crea el movimiento gasto 'Comisiones' (empresa, comisionId) y marca la comisión como pagada. → bool */
  function pagarComision(id, pago) {
    var est = estado();
    var c = est ? buscar(est.comisiones, id) : null;
    if (!c || c.estado !== 'pendiente') { toast('La comisión no está pendiente.', 'alerta'); return false; }
    var cuenta = buscar(est.cuentas, pago.cuentaId);
    if (!cuenta || cuenta.ambito !== 'empresa') { toast('Elige una cuenta de empresa.', 'error'); return false; }
    var monto = U.round2(c.monto);
    if (!(monto > 0)) { toast('La comisión no tiene un monto válido.', 'error'); return false; }
    try {
      var folio = c.facturaId ? folioFactura(est, c.facturaId) : '';
      var m = VF.store.agregar('movimientos', {
        ambito: 'empresa', cuentaId: cuenta.id, tipo: 'gasto', monto: monto, fecha: pago.fecha,
        categoria: CATEGORIA_PAGO_COMISION, descripcion: 'Comisión — ' + (c.beneficiario || '') + (folio ? ' · factura ' + folio : ''),
        contraparte: c.beneficiario || '', cuentaDestinoId: null,
        facturaId: null, cxpId: null, prestamoId: null, comisionId: c.id, estado: 'confirmado', etiquetas: []
      });
      VF.store.actualizar('comisiones', c.id, { estado: 'pagada', movimientoId: m.id });
      toast('Comisión pagada', 'exito');
      return true;
    } catch (e) {
      toast(mensajeError(e), 'error');
      return false;
    }
  }

  /** Elimina el movimiento del pago y devuelve la comisión a 'pendiente'. → Promise<bool> */
  function revertirPagoComision(id) {
    var est = estado();
    var c = est ? buscar(est.comisiones, id) : null;
    if (!c || c.estado !== 'pagada') { toast('La comisión no está pagada.', 'alerta'); return Promise.resolve(false); }
    return VF.ui.confirmar('¿Revertir el pago de esta comisión? Se eliminará el movimiento de gasto vinculado y volverá a quedar pendiente.', { peligro: true, textoAceptar: 'Revertir pago' })
      .then(function (ok) {
        if (!ok) return false;
        try {
          if (c.movimientoId && VF.store.obtener('movimientos', c.movimientoId)) VF.store.eliminar('movimientos', c.movimientoId);
          VF.store.actualizar('comisiones', c.id, { estado: 'pendiente', movimientoId: null });
          toast('Pago revertido: la comisión vuelve a estar pendiente', 'exito');
          return true;
        } catch (e) {
          toast(mensajeError(e), 'error');
          return false;
        }
      });
  }

  function eliminarComision(id) {
    var est = estado();
    var c = est ? buscar(est.comisiones, id) : null;
    if (!c) { toast('La comisión ya no existe.', 'alerta'); return Promise.resolve(true); }
    var msg = '¿Eliminar la comisión de ' + fmt(c.monto) + ' para ' + (c.beneficiario || 'sin beneficiario') + '?' +
      (c.estado === 'pagada' ? ' También se eliminará el movimiento de pago vinculado.' : '');
    return VF.ui.confirmar(msg, { peligro: true, textoAceptar: 'Eliminar' }).then(function (ok) {
      if (!ok) return false;
      try {
        VF.store.eliminar('comisiones', id);
        toast('Comisión eliminada', 'exito');
        return true;
      } catch (e) {
        toast(mensajeError(e), 'error');
        return false;
      }
    });
  }

  /* ---------- movimiento vinculado (detalle del panel) ---------------------- */
  function verMovimiento(id) {
    if (VF.panel && typeof VF.panel.verMovimiento === 'function') { VF.panel.verMovimiento(id); return; }
    if (VF.vistas && typeof VF.vistas.detalleMovimiento === 'function') { VF.vistas.detalleMovimiento('empresa', id); return; }
    VF.router.ir('empresa');
  }

  /* ---------- delegación de eventos (data-accion="prov-…") ----------------- */
  function alAccion(t, e) {
    var accion = t.getAttribute('data-accion');
    var id = t.getAttribute('data-id');
    var enModal = !!t.closest('.modal');
    function desdeModal(fn) { if (enModal) abrirTrasCerrar(fn); else fn(); }
    switch (accion) {
      case 'prov-pestana': fijarPestana(t.getAttribute('data-valor')); break;
      case 'prov-nuevo':
        if (pestanaActual === 'cxp') abrirFormularioCxP({});
        else if (pestanaActual === 'comisiones') abrirFormularioComision({});
        else abrirFormularioProveedor({});
        break;
      case 'prov-nuevo-proveedor': desdeModal(function () { abrirFormularioProveedor({}); }); break;
      case 'prov-ver-proveedor': e.preventDefault(); desdeModal(function () { abrirDetalleProveedor(id); }); break;
      case 'prov-editar-proveedor': desdeModal(function () { abrirFormularioProveedor({ id: id }); }); break;
      case 'prov-eliminar-proveedor': eliminarProveedor(id); break;
      case 'prov-nueva-cxp': {
        var proveedorId = t.getAttribute('data-proveedor') || '';
        desdeModal(function () { abrirFormularioCxP({ proveedorId: proveedorId }); });
        break;
      }
      case 'prov-ver-cxp': desdeModal(function () { abrirDetalleCxP(id); }); break;
      case 'prov-editar-cxp': desdeModal(function () { abrirFormularioCxP({ id: id }); }); break;
      case 'prov-pagar-cxp': desdeModal(function () { abrirPagoCxP(id); }); break;
      case 'prov-eliminar-cxp': eliminarCxP(id).then(function (ok) { if (ok && enModal) VF.ui.cerrarModales(); }); break;
      case 'prov-eliminar-pago': {
        var pagoId = t.getAttribute('data-pago');
        eliminarPagoCxP(id, pagoId).then(function (ok) { if (ok) abrirTrasCerrar(function () { abrirDetalleCxP(id); }); });
        break;
      }
      case 'prov-filtro-cxp': filtroCxP = t.getAttribute('data-valor') || 'todas'; marcarSegmento(t); pintarListaCxP(); break;
      case 'prov-cxp-agrupar':
        agruparCxP = !agruparCxP;
        t.setAttribute('aria-pressed', agruparCxP ? 'true' : 'false');
        t.innerHTML = VF.ui.icono('filtro') + (agruparCxP ? 'Agrupado por proveedor' : 'Agrupar por proveedor');
        pintarListaCxP();
        break;
      case 'prov-nueva-comision': desdeModal(function () { abrirFormularioComision({}); }); break;
      case 'prov-ver-comision': desdeModal(function () { abrirDetalleComision(id); }); break;
      case 'prov-editar-comision': desdeModal(function () { abrirFormularioComision({ id: id }); }); break;
      case 'prov-pagar-comision': desdeModal(function () { abrirPagoComision(id); }); break;
      case 'prov-revertir-comision': revertirPagoComision(id); break;
      case 'prov-eliminar-comision': eliminarComision(id).then(function (ok) { if (ok && enModal) VF.ui.cerrarModales(); }); break;
      case 'prov-filtro-comision': filtroComision = t.getAttribute('data-valor') || 'todas'; marcarSegmento(t); pintarListaComisiones(); break;
      case 'prov-ver-movimiento': e.preventDefault(); abrirTrasCerrar(function () { verMovimiento(id); }); break;
      default: break;
    }
  }

  /** Marca el segmento pulsado (los segmentos propios no pasan por VF.ui.segmentos). */
  function marcarSegmento(btn) {
    var cont = btn.closest('.segmentos');
    if (!cont) return;
    Array.prototype.forEach.call(cont.querySelectorAll('.segmento'), function (b) {
      var activo = b === btn;
      b.setAttribute('aria-selected', activo ? 'true' : 'false');
      if (activo) b.removeAttribute('tabindex'); else b.setAttribute('tabindex', '-1');
    });
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-accion^="prov-"]') : null;
    if (!t) return;
    if (!VF.store.estaDesbloqueado()) return;
    alAccion(t, e);
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.hasAttribute || !t.hasAttribute('data-prov-busqueda')) return;
    busquedaProveedores = String(t.value || '');
    pintarTablaProveedores();
  });
  /* Flechas ←/→ entre pestañas (patrón de tablist). */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    var t = e.target;
    if (!t || !t.matches || !t.matches('#prov-pestanas .pestana')) return;
    var botones = Array.prototype.slice.call(t.parentNode.querySelectorAll('.pestana'));
    var i = botones.indexOf(t);
    var sig = botones[(i + (e.key === 'ArrowRight' ? 1 : botones.length - 1)) % botones.length];
    if (sig) { e.preventDefault(); sig.focus(); sig.click(); }
  });

  /* ---------- reacción a cambios del store --------------------------------- */
  VF.store.on('cambio', function () {
    clearTimeout(temporizadorCambio);
    temporizadorCambio = setTimeout(function () {
      if (!VF.store.estaDesbloqueado()) return;
      if (VF.router.actual().ruta !== 'proveedores') return;
      pintarCuerpo();
    }, 30);
  });

  /* ---------- registro ----------------------------------------------------- */
  VF.router.registrar('proveedores', { titulo: 'Proveedores', icono: 'proveedores', nav: 'mas', render: render });

  VF.proveedores = {
    render: render,
    pestana: function () { return pestanaActual; },
    fijarPestana: fijarPestana,
    nuevoProveedor: function (opciones) { return abrirFormularioProveedor(opciones || {}); },
    verProveedor: abrirDetalleProveedor,
    nuevaCxP: function (opciones) { return abrirFormularioCxP(opciones || {}); },
    verCxP: abrirDetalleCxP,
    pagarCxP: abrirPagoCxP,
    registrarPagoCxP: registrarPagoCxP,
    nuevaComision: function (opciones) { return abrirFormularioComision(opciones || {}); },
    verComision: abrirDetalleComision,
    pagarComision: abrirPagoComision
  };
})(window.VF);
