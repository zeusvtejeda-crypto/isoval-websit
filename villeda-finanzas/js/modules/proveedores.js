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
    { valor: 'cxp', texto: 'Cuentas por pagar' },
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
    return '<span class="truncar">' + esc(U.fmtFecha(iso)) + '</span><br><small class="truncar ' + esc(tonoVencido || 'texto-2') + '">' + esc(rel) + '</small>';
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
        ' aria-selected="' + (sel ? 'true' : 'false') + '"' + (sel ? '' : ' tabindex="-1"') + ' id="prov-pestana-' + esc(p.valor) + '">' + esc(p.texto) + '</button>';
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
        return '<strong>' + esc(v) + '</strong>' + (f.rfc ? '<br><small class="texto-3">' + esc(f.rfc) + '</small>' : '');
      } },
      { clave: 'categoria', titulo: 'Categoría', render: function (v) { return v ? esc(v) : '<span class="texto-3">—</span>'; } },
      { clave: 'contacto', titulo: 'Contacto', render: function (v, f) {
        var partes = [f.contacto, f.telefono, f.email].filter(Boolean);
        return partes.length ? esc(partes.join(' · ')) : '<span class="texto-3">—</span>';
      } },
      { clave: 'porPagar', titulo: 'Por pagar', alinear: 'derecha', render: function (v, f) {
        if (!f.cuentas) return '<span class="texto-3">Sin pendientes</span>';
        return '<strong class="cifra">' + esc(fmt(v)) + '</strong>' +
          (f.vencido > 0 ? '<br><span class="badge badge-negativo">Vencido ' + esc(fmt(f.vencido)) + '</span>' : '<br><small class="texto-3">' + esc(plural(f.cuentas, 'cuenta')) + '</small>');
      } },
      { clave: 'id', titulo: 'Acciones', alinear: 'derecha', render: function (id) {
        return '<span class="fila" style="justify-content:flex-end;gap:2px">' +
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
