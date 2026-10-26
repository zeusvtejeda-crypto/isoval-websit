'use strict';
/*
 * js/modules/personal.js — Vista Personal (#/personal) de VILLEDA Finanzas (docs/ARQUITECTURA.md §4).
 *
 *  Reutiliza VF.vistas.ambito (js/modules/empresa.js) con ambito 'personal' y añade dos extras:
 *   - Metas de ahorro: CRUD en modal (nombre, objetivo, cuenta de ahorro asociada, fecha meta, notas);
 *     progreso con VF.calc.metaProgreso (ahorrado = saldo de la cuenta asociada) y barra (VF.ui.barraProgreso).
 *   - Deudas: tarjetas de crédito personales activas con deuda (VF.calc.saldoCuenta < 0), límite, uso,
 *     días de corte / pago y próximo pago (VF.calc.vencimientos, origen 'cuentas'); préstamos recibidos
 *     personales activos con saldo insoluto (VF.calc.saldoPrestamo), progreso y próximo pago
 *     (VF.calc.proximoPagoPrestamo). Total de deuda personal (sólo ámbito personal).
 *  Toda cifra sale de VF.calc; sin registros → "Sin metas…" / "Sin deudas…", nunca ceros falsos.
 *
 * Convenciones: JavaScript clásico, textos en español, todo texto de usuario pasa por VF.util.esc,
 * eventos por delegación con data-accion="personal-…" (sin handlers inline).
 */
window.VF = window.VF || {};
(function (VF) {
  if (!VF.util || !VF.calc || !VF.ui || !VF.store || !VF.router) {
    console.error('[VF.personal] faltan módulos del núcleo (util, calc, ui, store, router).');
    return;
  }
  if (!VF.vistas || typeof VF.vistas.ambito !== 'function') {
    console.error('[VF.personal] falta VF.vistas.ambito (js/modules/empresa.js debe cargarse antes).');
    return;
  }

  var U = VF.util;
  var esc = U.esc;
  var fmt = U.fmtMXN;
  var AMBITO = 'personal';

  /* ---------- auxiliares privados ------------------------------------------ */
  function estado() { return VF.store.estaDesbloqueado() ? VF.store.estado() : null; }
  function hoy() { return VF.calc.hoy(); }
  function toast(mensaje, tipo) { if (VF.ui.toast) VF.ui.toast(mensaje, tipo); }
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
  function cuentasPersonales(est, soloActivas) {
    return (est.cuentas || []).filter(function (c) {
      return c && c.ambito === AMBITO && (!soloActivas || c.activa !== false);
    });
  }
  function metasPersonales(est) {
    return (est.metas || []).filter(function (m) { return m && (m.ambito === AMBITO || !m.ambito); });
  }
  function filaCifra(etiqueta, valor, clase) {
    return '<div class="fila-entre mb-1"><span class="texto-2">' + esc(etiqueta) + '</span>' +
      '<strong class="cifra ' + esc(clase || '') + '">' + esc(valor) + '</strong></div>';
  }
  function fechaConRelativa(iso) {
    var rel = VF.ui.fechaRelativa(iso);
    return U.fmtFecha(iso) + (rel ? ' (' + rel + ')' : '');
  }

  /* ---------- extra: metas de ahorro --------------------------------------- */
  function itemMeta(est, m) {
    var p = VF.calc.metaProgreso(est, m);
    var cuenta = m.cuentaId ? buscar(est.cuentas, m.cuentaId) : null;
    var completa = p.objetivo > 0 && p.ahorrado >= p.objetivo;
    var vencida = !!m.fechaMeta && m.fechaMeta < hoy() && !completa;
    var partes = [];
    if (!cuenta) partes.push('Sin cuenta asignada: asigna una cuenta de ahorro para medir el avance');
    else partes.push((completa ? 'Meta alcanzada' : U.fmtNumero(p.porcentaje, 0) + ' % · faltan ' + fmt(p.faltante)) + ' · Cuenta: ' + cuenta.nombre);
    if (m.fechaMeta) partes.push((vencida ? 'Fecha meta pasada: ' : 'Para el ') + fechaConRelativa(m.fechaMeta));
    var tono = completa ? 'positivo' : vencida ? 'alerta' : undefined;
    return '<li class="lista-item" data-meta="' + esc(m.id) + '" style="align-items:flex-start">' +
      '<span class="lista-icono">' + VF.ui.icono('meta') + '</span>' +
      '<div class="lista-texto">' +
      '<div class="fila-entre" style="gap:4px 8px"><p class="lista-titulo" style="flex:1 1 auto;min-width:0">' + esc(m.nombre) + '</p>' +
      '<strong class="cifra" style="white-space:nowrap" data-meta-progreso>' + (cuenta ? esc(fmt(p.ahorrado)) : '<span class="texto-3">Sin cuenta</span>') + ' <span class="texto-3">/ ' + esc(fmt(p.objetivo)) + '</span></strong></div>' +
      '<div class="mt-1 mb-1">' + VF.ui.barraProgreso(p.porcentaje, tono) + '</div>' +
      '<p class="lista-sub" style="white-space:normal">' + esc(partes.join(' · ')) + '</p>' +
      (m.notas ? '<p class="lista-sub" style="white-space:normal">' + esc(m.notas) + '</p>' : '') +
      '</div>' +
      '<button type="button" class="btn btn-icono" data-accion="personal-editar-meta" data-id="' + esc(m.id) + '" aria-label="Editar meta ' + esc(m.nombre) + '" title="Editar meta">' + VF.ui.icono('editar') + '</button>' +
      '</li>';
  }

  function renderMetas(el, ctx) {
    var est = ctx.estado;
    var metas = metasPersonales(est);
    if (!metas.length) {
      el.innerHTML = VF.ui.vacio('Sin metas de ahorro. Define una meta y asígnale una cuenta de ahorro para seguir su avance.', 'Crear meta', function () {
        abrirFormularioMeta({});
      });
      return;
    }
    metas = U.ordenar(metas, 'fechaMeta');
    var objetivoTotal = U.suma(metas, function (m) { return m.objetivo; });
    var ahorradoTotal = U.suma(metas, function (m) { return VF.calc.metaProgreso(est, m).ahorrado; });
    var html = '<ul class="lista" id="personal-metas">' + metas.map(function (m) { return itemMeta(est, m); }).join('') + '</ul>';
    html += '<div class="mt-1">' + filaCifra('Ahorrado en ' + plural(metas.length, 'meta'), fmt(ahorradoTotal) + ' de ' + fmt(objetivoTotal)) + '</div>';
    html += '<p class="texto-3 mb-0">El avance de cada meta es el saldo actual de su cuenta asociada.</p>';
    el.innerHTML = html;
  }

  /** Abre el modal para crear ({}) o editar ({ id }) una meta de ahorro. */
  function abrirFormularioMeta(opciones) {
    var o = opciones || {};
    var est = estado();
    if (!est) return null;
    var existente = o.id ? buscar(est.metas, o.id) : null;
    if (o.id && !existente) { toast('La meta ya no existe.', 'alerta'); return null; }

    var cuentas = cuentasPersonales(est, true).filter(function (c) { return c.tipo !== 'credito'; });
    var opcionesCuenta = cuentas.map(function (c) {
      return { valor: c.id, texto: c.nombre + (c.banco ? ' · ' + c.banco : '') + ' (' + fmt(VF.calc.saldoCuenta(est, c.id)) + ')' };
    });
    if (existente && existente.cuentaId && !cuentas.some(function (c) { return c.id === existente.cuentaId; })) {
      var cta = buscar(est.cuentas, existente.cuentaId);
      opcionesCuenta.push({ valor: existente.cuentaId, texto: cta ? cta.nombre + (cta.activa === false ? ' (archivada)' : '') : 'Cuenta eliminada' });
    }

    var valores = existente ? {
      nombre: existente.nombre || '', objetivo: existente.objetivo, cuentaId: existente.cuentaId || '',
      fechaMeta: existente.fechaMeta || '', notas: existente.notas || ''
    } : { nombre: '', objetivo: '', cuentaId: '', fechaMeta: '', notas: '' };

    var campos = [
      { nombre: 'nombre', etiqueta: 'Nombre de la meta', tipo: 'texto', requerido: true, placeholder: 'Fondo de emergencia, viaje, enganche…', maxlength: 80 },
      { nombre: 'objetivo', etiqueta: 'Objetivo (MXN)', tipo: 'monto', requerido: true, min: 0.01, placeholder: '0.00' },
      { nombre: 'cuentaId', etiqueta: 'Cuenta de ahorro asociada', tipo: 'select', placeholder: 'Sin cuenta asignada', opciones: opcionesCuenta,
        ayuda: 'El avance se calcula con el saldo actual de esta cuenta personal.' },
      { nombre: 'fechaMeta', etiqueta: 'Fecha meta', tipo: 'fecha' },
      { nombre: 'notas', etiqueta: 'Notas', tipo: 'textarea', filas: 2, placeholder: 'Opcional', maxlength: 300 }
    ];

    var envoltura = VF.ui.el('<div><p class="fila mb-2">' + VF.ui.badgeAmbito(AMBITO) +
      '<span class="texto-3">Las metas son siempre personales.</span></p>' + VF.ui.formulario(campos, valores) + '</div>');
    var form = envoltura.querySelector('form');
    var reglas = {
      objetivo: function (x) { return x > 0 ? null : 'Ingresa un objetivo mayor a cero'; },
      cuentaId: function (x) {
        if (!x) return null;
        var c = buscar(estado().cuentas, x);
        return c && c.ambito === AMBITO ? null : 'Elige una cuenta personal';
      }
    };

    function guardar() {
      if (!VF.ui.validar(form, reglas)) return false;
      var v = VF.ui.leerFormulario(form);
      var registro = {
        ambito: AMBITO,
        nombre: v.nombre,
        objetivo: U.round2(v.objetivo),
        cuentaId: v.cuentaId || null,
        fechaMeta: v.fechaMeta || null,
        notas: v.notas
      };
      try {
        if (existente) {
          VF.store.actualizar('metas', existente.id, registro);
          toast('Meta actualizada', 'exito');
        } else {
          VF.store.agregar('metas', registro);
          toast('Meta creada', 'exito');
        }
      } catch (e) {
        toast('No se pudo guardar: ' + (e && e.message ? e.message : e), 'error');
        return false;
      }
      return true;
    }

    var botones = [];
    if (existente) {
      botones.push({ texto: 'Eliminar', tono: 'peligro', accion: function () {
        return VF.ui.confirmar('¿Eliminar la meta «' + existente.nombre + '»? El saldo de la cuenta asociada no cambia.', { peligro: true, textoAceptar: 'Eliminar' })
          .then(function (ok) {
            if (!ok) return false;
            try {
              VF.store.eliminar('metas', existente.id);
              toast('Meta eliminada', 'exito');
              return true;
            } catch (e) {
              toast('No se pudo eliminar: ' + (e && e.message ? e.message : e), 'error');
              return false;
            }
          });
      } });
    }
    botones.push({ texto: 'Cancelar', tono: 'secundario' });
    botones.push({ texto: existente ? 'Guardar cambios' : 'Crear meta', tono: 'primario', accion: guardar });

    var api = VF.ui.modal({ titulo: existente ? 'Editar meta de ahorro' : 'Nueva meta de ahorro', cuerpo: envoltura, botones: botones });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (guardar() !== false) api.cerrar();
    });
    return api;
  }

  /* ---------- extra: deudas ------------------------------------------------ */
  function itemTarjeta(est, c, vencimientos) {
    var saldo = VF.calc.saldoCuenta(est, c.id);
    var deuda = saldo < 0 ? U.round2(-saldo) : 0;
    var limite = Number(c.limiteCredito) || 0;
    var prox = null;
    for (var i = 0; i < vencimientos.length; i++) {
      var v = vencimientos[i];
      if (v.origen && v.origen.coleccion === 'cuentas' && v.origen.id === c.id) { prox = v; break; }
    }
    var partes = [];
    if (c.banco) partes.push(c.banco);
    if (c.diaCorte) partes.push('corte día ' + c.diaCorte);
    if (c.diaPago) partes.push('pago día ' + c.diaPago);
    var detalle = [];
    if (limite > 0) detalle.push('Uso ' + U.fmtNumero(U.round2(deuda / limite * 100), 1) + ' % de ' + fmt(limite) + ' · disponible ' + fmt(U.round2(limite - deuda)));
    if (prox) detalle.push('Próximo pago ' + fmt(prox.monto) + ' el ' + fechaConRelativa(prox.fecha));
    var uso = limite > 0 ? U.round2(deuda / limite * 100) : 0;
    return '<li class="lista-item clicable" role="button" tabindex="0" data-accion="ambito-ver-cuenta" data-ambito="personal" data-id="' + esc(c.id) + '" style="align-items:flex-start" aria-label="Ver movimientos de ' + esc(c.nombre) + '">' +
      '<span class="lista-icono">' + VF.ui.icono('pago') + '</span>' +
      '<div class="lista-texto">' +
      '<div class="fila-entre" style="flex-wrap:nowrap;gap:8px"><p class="lista-titulo" style="flex:1 1 auto;min-width:0">' + esc(c.nombre) + '</p>' +
      '<strong class="cifra ' + (deuda > 0 ? 'negativo' : 'positivo') + '" style="white-space:nowrap" data-deuda-tarjeta>' + (deuda > 0 ? esc(fmt(deuda)) : 'Sin deuda') + '</strong></div>' +
      '<p class="lista-sub" style="white-space:normal">' + esc(partes.join(' · ') || 'Tarjeta de crédito') + '</p>' +
      (limite > 0 ? '<div class="mt-1 mb-1">' + VF.ui.barraProgreso(uso, uso >= 80 ? 'negativo' : uso >= 50 ? 'alerta' : undefined) + '</div>' : '') +
      (detalle.length ? '<p class="lista-sub" style="white-space:normal">' + esc(detalle.join(' · ')) + '</p>' : '') +
      '</div></li>';
  }

  function itemPrestamo(est, p) {
    var saldo = VF.calc.saldoPrestamo(p);
    var principal = U.round2(Number(p.principal) || 0);
    var pagado = U.round2(principal - saldo);
    var pct = principal > 0 ? U.round2(pagado / principal * 100) : 0;
    var prox = VF.calc.proximoPagoPrestamo(p, hoy());
    var partes = [];
    partes.push(plural((p.pagos || []).length, 'pago') + ' de ' + (p.plazoMeses || '?') + ' · pagado ' + fmt(pagado) + ' (' + U.fmtNumero(pct, 0) + ' %)');
    if (Number(p.tasaAnual) > 0) partes.push('tasa ' + U.fmtNumero(p.tasaAnual, 1) + ' % anual');
    var detalle = prox
      ? 'Próximo pago ' + fmt(prox.monto) + ' el ' + fechaConRelativa(prox.fecha) + (prox.vencido ? ' · vencido' : '')
      : 'Sin pagos pendientes';
    return '<li class="lista-item" style="align-items:flex-start">' +
      '<span class="lista-icono">' + VF.ui.icono('prestamos') + '</span>' +
      '<div class="lista-texto">' +
      '<div class="fila-entre" style="flex-wrap:nowrap;gap:8px"><p class="lista-titulo" style="flex:1 1 auto;min-width:0">' + esc(p.contraparte || 'Préstamo recibido') + '</p>' +
      '<strong class="cifra negativo" style="white-space:nowrap" data-saldo-prestamo>' + esc(fmt(saldo)) + '</strong></div>' +
      '<p class="lista-sub" style="white-space:normal">' + esc(partes.join(' · ')) + '</p>' +
      '<div class="mt-1 mb-1">' + VF.ui.barraProgreso(pct, 'positivo') + '</div>' +
      '<p class="lista-sub" style="white-space:normal">' + (prox && prox.vencido ? '<span class="badge badge-negativo">Vencido</span> ' : '') + esc(detalle) + '</p>' +
      '</div>' +
      '<a class="btn btn-fantasma" href="#/prestamos?id=' + encodeURIComponent(p.id) + '" aria-label="Ver préstamo ' + esc(p.contraparte || '') + '">Ver</a>' +
      '</li>';
  }

  function renderDeudas(el, ctx) {
    var est = ctx.estado;
    var tarjetas = cuentasPersonales(est, true).filter(function (c) { return c.tipo === 'credito'; });
    var prestamos = (est.prestamos || []).filter(function (p) {
      return p && p.ambito === AMBITO && p.tipo === 'recibido' && p.estado === 'activo';
    });
    if (!tarjetas.length && !prestamos.length) {
      el.innerHTML = VF.ui.vacio('Sin deudas registradas en Personal. Las tarjetas de crédito y los préstamos recibidos aparecerán aquí.');
      return;
    }
    var vencimientos = VF.calc.vencimientos(est, null, null);
    var html = '';
    var total = 0;
    if (tarjetas.length) {
      tarjetas.forEach(function (c) { var s = VF.calc.saldoCuenta(est, c.id); if (s < 0) total += -s; });
      html += '<h3 class="texto-2 mb-0" style="font-size:.8rem;text-transform:uppercase;letter-spacing:.06em">Tarjetas de crédito</h3>' +
        '<ul class="lista" id="personal-tarjetas">' + tarjetas.map(function (c) { return itemTarjeta(est, c, vencimientos); }).join('') + '</ul>';
    }
    if (prestamos.length) {
      prestamos = U.ordenar(prestamos, 'fechaInicio');
      prestamos.forEach(function (p) { total += VF.calc.saldoPrestamo(p); });
      html += '<h3 class="texto-2 mb-0 mt-2" style="font-size:.8rem;text-transform:uppercase;letter-spacing:.06em">Préstamos recibidos</h3>' +
        '<ul class="lista" id="personal-prestamos">' + prestamos.map(function (p) { return itemPrestamo(est, p); }).join('') + '</ul>';
    }
    html += '<div class="mt-2">' + filaCifra('Deuda total personal', fmt(U.round2(total)), total > 0 ? 'negativo' : '') + '</div>' +
      '<p class="texto-3 mb-0">Suma de la deuda de tarjetas y el saldo insoluto de préstamos recibidos del ámbito personal.</p>';
    el.innerHTML = html;
  }

  /* ---------- registro ----------------------------------------------------- */
  var EXTRAS_PERSONAL = [
    { id: 'metas', titulo: 'Metas de ahorro',
      acciones: '<button type="button" class="btn btn-secundario" data-accion="personal-nueva-meta">' + VF.ui.icono('agregar') + '<span>Meta</span></button>',
      render: renderMetas },
    { id: 'deudas', titulo: 'Deudas',
      acciones: '<a class="btn btn-fantasma" href="#/prestamos">Préstamos</a>',
      render: renderDeudas }
  ];

  function renderPersonal(contenedor, params) {
    VF.vistas.ambito(contenedor, AMBITO, { extras: EXTRAS_PERSONAL, params: params });
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-accion^="personal-"]') : null;
    if (!t) return;
    if (!VF.store.estaDesbloqueado()) return;
    switch (t.getAttribute('data-accion')) {
      case 'personal-nueva-meta':
        abrirFormularioMeta({});
        break;
      case 'personal-editar-meta':
        abrirFormularioMeta({ id: t.getAttribute('data-id') });
        break;
      default:
        break;
    }
  });

  VF.router.registrar('personal', { titulo: 'Personal', icono: 'personal', nav: 'principal', render: renderPersonal });

  VF.personal = {
    render: renderPersonal,
    nuevaMeta: function () { return abrirFormularioMeta({}); },
    editarMeta: function (id) { return abrirFormularioMeta({ id: id }); },
    nuevoMovimiento: function (o) { return VF.vistas.formularioMovimiento(AMBITO, o || {}); },
    nuevaCuenta: function () { return VF.vistas.formularioCuenta(AMBITO, {}); }
  };
})(window.VF);
