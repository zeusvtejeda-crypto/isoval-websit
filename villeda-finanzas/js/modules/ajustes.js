'use strict';
/*
 * js/modules/ajustes.js — Vista Ajustes (#/ajustes) de VILLEDA Finanzas (docs/ARQUITECTURA.md §4).
 *
 *  - Preferencias: nombre, empresa, autobloqueo, reserva operativa y tema (el tema se aplica y guarda
 *    al instante con VF.app.aplicarTema + VF.store.setAjustes, el mismo mecanismo del botón de la cabecera).
 *  - Seguridad: cambiar contraseña (actual, nueva ≥ 8, confirmar) con VF.store.cambiarContrasena.
 *  - Respaldo: exportar cifrado (.vf.json) o sin cifrar (.json, con advertencia modal) e importar un
 *    respaldo (detecta formato, pide contraseña si está cifrado y confirma porque reemplaza todo).
 *  - Datos de ejemplo: borrar todo registro con id '_demo' (VF.store.borrarDatosEjemplo).
 *  - Zona de peligro: borrar todo con doble confirmación escribiendo BORRAR (VF.store.borrarTodo).
 *  - Servidor de IA: URL opcional + "Probar" (POST { pregunta:'ping', contexto:{} }, 10 s de espera).
 *  - Acerca de: versión y aviso de prototipo local (no es asesoría financiera ni contable, sin bancos).
 *  - Se vuelve a pintar al recibir VF.store 'cambio' sólo si la ruta activa sigue siendo ajustes; los
 *    guardados que hace este mismo módulo de forma síncrona se silencian para no repintar en bucle.
 *
 * Convenciones: JavaScript clásico, textos en español, todo texto de usuario pasa por VF.util.esc,
 * eventos por delegación con data-accion="ajustes-…" (sin handlers inline), sin dependencias externas.
 */
window.VF = window.VF || {};
(function (VF) {
  if (!VF.util || !VF.ui || !VF.store || !VF.router) {
    console.error('[VF.ajustes] faltan módulos del núcleo (util, ui, store, router).');
    return;
  }

  var U = VF.util;
  var esc = U.esc;

  var RUTA = 'ajustes';
  var TIMEOUT_IA_MS = 10000;
  var TEXTO_BORRAR = 'BORRAR';
  var CLAVE_TEMA_LOCAL = 'vf.tema';           // preferencia de tema del dispositivo (la lee app.js antes de desbloquear)
  var MIN_CONTRASENA = 8;
  var MAX_TEXTO_RESPUESTA = 300;
  var OPCIONES_AUTOBLOQUEO = [0, 1, 2, 5, 10, 15, 30, 60];
  var TEMAS = [
    { valor: 'auto', texto: 'Automático (según el sistema)' },
    { valor: 'claro', texto: 'Claro' },
    { valor: 'oscuro', texto: 'Oscuro' }
  ];
  var NOMBRE_TEMA = { auto: 'automático', claro: 'claro', oscuro: 'oscuro' };
  var COLECCIONES = [
    { clave: 'cuentas', texto: 'cuentas' },
    { clave: 'movimientos', texto: 'movimientos' },
    { clave: 'clientes', texto: 'clientes' },
    { clave: 'facturas', texto: 'facturas' },
    { clave: 'proveedores', texto: 'proveedores' },
    { clave: 'cuentasPorPagar', texto: 'cuentas por pagar' },
    { clave: 'comisiones', texto: 'comisiones' },
    { clave: 'prestamos', texto: 'préstamos' },
    { clave: 'presupuestos', texto: 'presupuestos' },
    { clave: 'metas', texto: 'metas' }
  ];

  var silencio = false;          // true mientras este módulo guarda de forma síncrona (evita repintar en bucle)
  var temporizadorCambio = null;
  var probandoIA = false;
  var ocupadoContrasena = false;
  var ocupadoExportar = false;

  /* ---------- auxiliares privados ------------------------------------------ */
  function estado() { return VF.store.estaDesbloqueado() ? VF.store.estado() : null; }
  function ajustes() { var e = estado(); return (e && e.ajustes) || {}; }
  function toast(mensaje, tipo) { if (VF.ui.toast) VF.ui.toast(mensaje, tipo); }
  function version() { return (VF.app && VF.app.version) || '1.0.0'; }
  function enRuta() {
    var act = VF.router.actual();
    return !!(act && act.ruta === RUTA && document.getElementById('ajustes-cuerpo'));
  }

  function plural(n, singular, pluralTexto) {
    return n + ' ' + (n === 1 ? singular : (pluralTexto || singular + 's'));
  }

  function fmtTamano(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1).replace(/\.0$/, '') + ' KB';
    return (n / (1024 * 1024)).toFixed(2).replace(/\.?0+$/, '') + ' MB';
  }

  function fmtSegundos(ms) {
    var n = Number(ms) || 0;
    if (n < 1000) return n + ' ms';
    var s = n / 1000;
    return (s === Math.floor(s) ? String(s) : s.toFixed(1)) + ' s';
  }

  /** Guarda ajustes silenciando el repintado propio (el store emite 'cambio' de forma síncrona). */
  function guardarAjustesSilencioso(parcial) {
    silencio = true;
    try {
      return VF.store.setAjustes(parcial);
    } finally {
      silencio = false;
    }
  }

  function guardarTemaLocal(tema) {
    try { localStorage.setItem(CLAVE_TEMA_LOCAL, tema); } catch (e) { /* almacenamiento no disponible */ }
  }

  function esDemo(x) {
    return !!(x && typeof x.id === 'string' && /_demo$/.test(x.id));
  }

  /** Cuenta registros (y pagos anidados) con id terminado en '_demo'. */
  function contarDemo(est) {
    var n = 0;
    if (!est) return 0;
    COLECCIONES.forEach(function (c) {
      (est[c.clave] || []).forEach(function (x) {
        if (esDemo(x)) n += 1;
        if (x && Array.isArray(x.pagos)) x.pagos.forEach(function (p) { if (esDemo(p)) n += 1; });
      });
    });
    return n;
  }

  /** [{ clave, texto, cantidad }] para las colecciones con registros, y total. */
  function resumenColecciones(est) {
    var filas = [];
    var total = 0;
    COLECCIONES.forEach(function (c) {
      var n = Array.isArray(est && est[c.clave]) ? est[c.clave].length : 0;
      total += n;
      if (n) filas.push({ clave: c.clave, texto: c.texto, cantidad: n });
    });
    return { filas: filas, total: total };
  }

  function tamanoBoveda() {
    try {
      return VF.store.exportarJSON({ cifrado: true }).length;
    } catch (e) {
      return 0;
    }
  }

  function nombreArchivo(cifrado) {
    var base = 'villeda-finanzas-' + (cifrado ? 'respaldo-' : 'datos-') + U.hoy();
    return base + (cifrado ? '.vf.json' : '.json');
  }

  function esBovedaCifrada(obj) {
    return !!(obj && typeof obj === 'object' && typeof obj.salt === 'string' &&
      typeof obj.iv === 'string' && typeof obj.datos === 'string');
  }
  function esEstadoPlano(obj) {
    return !!(obj && typeof obj === 'object' && !esBovedaCifrada(obj) &&
      (Array.isArray(obj.cuentas) || Array.isArray(obj.movimientos) || (obj.ajustes && typeof obj.ajustes === 'object')));
  }

  /** Agrupa dos o más campos de un formulario en una .form-fila (2 columnas ≥ 560 px). */
  function agruparCampos(form, nombres) {
    var conts = nombres.map(function (n) { return form.querySelector('[data-campo-cont="' + n + '"]'); }).filter(Boolean);
    if (conts.length < 2) return;
    var fila = document.createElement('div');
    fila.className = 'form-fila';
    conts[0].parentNode.insertBefore(fila, conts[0]);
    conts.forEach(function (c) { fila.appendChild(c); });
  }

  /** Añade a los campos de contraseña el botón "mostrar" que ya gestiona app.js (.btn-ver[data-ver]). */
  function agregarBotonesVer(form) {
    Array.prototype.forEach.call(form.querySelectorAll('input[type="password"]'), function (input) {
      if (!input.id || input.parentNode.classList.contains('campo-con-boton')) return;
      var envoltura = document.createElement('div');
      envoltura.className = 'campo-con-boton';
      input.parentNode.insertBefore(envoltura, input);
      envoltura.appendChild(input);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-icono btn-ver';
      btn.setAttribute('data-ver', input.id);
      btn.setAttribute('aria-label', 'Mostrar contraseña');
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = VF.ui.icono('ojo');
      envoltura.appendChild(btn);
    });
  }

  /** Construye un <form> (Element) con VF.ui.formulario y le añade una fila de acciones. */
  function construirFormulario(campos, valores, accionesHtml) {
    var form = VF.ui.el(VF.ui.formulario(campos, valores));
    if (accionesHtml) {
      var acciones = document.createElement('div');
      acciones.className = 'form-acciones';
      acciones.innerHTML = accionesHtml;
      form.appendChild(acciones);
    }
    return form;
  }

  function marcarErrorCampo(form, nombre, mensaje) {
    var cont = form.querySelector('[data-campo-cont="' + nombre + '"]');
    var control = form.querySelector('[data-campo="' + nombre + '"]');
    if (!cont) return;
    var p = cont.querySelector('.campo-error');
    if (mensaje) {
      cont.classList.add('con-error');
      if (p) { p.textContent = mensaje; p.hidden = false; }
      if (control) { control.setAttribute('aria-invalid', 'true'); control.focus(); }
    } else {
      cont.classList.remove('con-error');
      if (p) { p.textContent = ''; p.hidden = true; }
      if (control) control.removeAttribute('aria-invalid');
    }
  }

  function fijarOcupado(btn, ocupado, textoOcupado) {
    if (!btn) return;
    if (ocupado) {
      if (!btn.getAttribute('data-texto-original')) btn.setAttribute('data-texto-original', btn.textContent);
      btn.disabled = true;
      btn.textContent = textoOcupado || 'Procesando…';
    } else {
      btn.disabled = false;
      var original = btn.getAttribute('data-texto-original');
      if (original) btn.textContent = original;
    }
  }

  function textoError(e) {
    return e && e.message ? e.message : String(e);
  }

  /* ---------- render de la ruta -------------------------------------------- */
  function render(contenedor) {
    contenedor.innerHTML =
      '<div class="vista-cabecera"><div><h1>Ajustes</h1>' +
      '<p class="texto-2 mb-0">Preferencias, seguridad, respaldos y datos de este dispositivo.</p></div></div>' +
      '<div id="ajustes-cuerpo"></div>';
    pintarCuerpo();
  }

  function pintarCuerpo() {
    var cuerpo = document.getElementById('ajustes-cuerpo');
    var est = estado();
    if (!cuerpo || !est) return;
    cuerpo.innerHTML =
      '<div class="rejilla-2">' +
      '<div class="tarjeta-cuerpo">' +
      tarjetaPreferencias() + tarjetaContrasena() + tarjetaIA() +
      '</div>' +
      '<div class="tarjeta-cuerpo">' +
      tarjetaRespaldo() + tarjetaEjemplo(est) + tarjetaPeligro() + tarjetaAcerca(est) +
      '</div>' +
      '</div>';
    montarFormularios(cuerpo);
  }

  /* ---------- tarjetas (HTML) ------------------------------------------------ */
  function tarjetaPreferencias() {
    return VF.ui.tarjeta({
      titulo: 'Preferencias',
      cuerpo: '<div data-slot="preferencias"></div>'
    });
  }

  function tarjetaContrasena() {
    return VF.ui.tarjeta({
      titulo: 'Cambiar contraseña',
      cuerpo: '<p class="texto-2">Tu información se cifra con esta contraseña. No existe forma de recuperarla si la olvidas: ' +
        'guárdala en un lugar seguro.</p>' +
        '<div data-slot="contrasena"></div>'
    });
  }

  function tarjetaIA() {
    return VF.ui.tarjeta({
      titulo: 'Servidor de IA (opcional)',
      cuerpo: '<p class="texto-2">Si configuras un servidor, el asistente le enviará tus preguntas junto con un resumen de cifras ' +
        '<strong>sin descripciones, contrapartes ni contraseñas</strong>. Vacío = asistente local, nada sale del dispositivo.</p>' +
        '<div data-slot="ia"></div>' +
        '<div data-ia-resultado aria-live="polite"></div>'
    });
  }

  function tarjetaRespaldo() {
    return VF.ui.tarjeta({
      titulo: 'Respaldo',
      cuerpo:
        '<h3>Exportar</h3>' +
        '<p class="texto-2">Descarga una copia de todos tus datos. El respaldo cifrado sólo se abre con tu contraseña actual.</p>' +
        '<div class="fila mb-2">' +
        '<button type="button" class="btn btn-primario" data-accion="ajustes-exportar-cifrado">' + VF.ui.icono('exportar') +
        '<span>Respaldo cifrado (.vf.json)</span></button>' +
        '<button type="button" class="btn btn-secundario" data-accion="ajustes-exportar-plano">' + VF.ui.icono('archivo') +
        '<span>Sin cifrar (.json)</span></button>' +
        '</div>' +
        '<hr>' +
        '<h3>Importar</h3>' +
        '<p class="texto-2">Restaura un respaldo <code>.vf.json</code> o <code>.json</code>. ' +
        '<strong>Reemplaza todos los datos actuales</strong> de este dispositivo; te pediremos confirmación.</p>' +
        '<input type="file" accept=".json,.vf.json,application/json" data-ajustes-archivo hidden aria-label="Archivo de respaldo">' +
        '<button type="button" class="btn btn-secundario" data-accion="ajustes-elegir-archivo">' + VF.ui.icono('importar') +
        '<span>Elegir archivo de respaldo…</span></button>'
    });
  }

  function tarjetaEjemplo(est) {
    var n = contarDemo(est);
    var activo = est.ajustes.datosEjemplo === true || n > 0;
    var cuerpo;
    if (activo) {
      cuerpo = '<p class="aviso aviso-alerta">Hay <strong>' + plural(n, 'registro ficticio', 'registros ficticios') + '</strong> ' +
        '(cuentas, movimientos, facturas, préstamos…) para explorar la aplicación. Bórralos cuando empieces a capturar tus datos reales; ' +
        'los registros que hayas creado tú se conservan.</p>' +
        '<button type="button" class="btn btn-secundario" data-accion="ajustes-borrar-ejemplo">' + VF.ui.icono('eliminar') +
        '<span>Borrar datos de ejemplo</span></button>';
    } else {
      cuerpo = '<p class="texto-2 mb-0">No hay datos de ejemplo. Todos los registros son tuyos.</p>';
    }
    return VF.ui.tarjeta({ titulo: 'Datos de ejemplo', cuerpo: cuerpo });
  }

  function tarjetaPeligro() {
    return VF.ui.tarjeta({
      titulo: 'Zona de peligro',
      clase: 'tarjeta-peligro',
      cuerpo: '<p class="aviso aviso-error"><strong>Borrar todo</strong> elimina la bóveda cifrada de este dispositivo: cuentas, ' +
        'movimientos, facturas, préstamos, ajustes y contraseña. No se puede deshacer. Exporta un respaldo antes si quieres conservar algo.</p>' +
        '<button type="button" class="btn btn-peligro" data-accion="ajustes-borrar-todo">' + VF.ui.icono('eliminar') +
        '<span>Borrar todo</span></button>'
    });
  }

  function tarjetaAcerca(est) {
    var resumen = resumenColecciones(est);
    var detalle = resumen.filas.map(function (f) { return f.cantidad + ' ' + f.texto; }).join(' · ');
    return VF.ui.tarjeta({
      titulo: 'Acerca de',
      cuerpo:
        '<p><strong>VILLEDA Finanzas</strong> · Versión ' + esc(version()) + ' · Prototipo local</p>' +
        '<p class="aviso aviso-alerta mb-2">Esta aplicación es un prototipo de uso personal. <strong>No es asesoría financiera ni ' +
        'contable</strong>: valida las cifras con tu contador antes de tomar decisiones o presentar declaraciones.</p>' +
        '<ul class="texto-2">' +
        '<li><strong>Sin conexión bancaria.</strong> Todos los movimientos se capturan a mano; nada se consulta ni se envía a bancos.</li>' +
        '<li><strong>Privacidad local.</strong> Tus datos viven cifrados (AES-GCM, clave derivada de tu contraseña) en este navegador. ' +
        'Nada sale del dispositivo salvo que configures un servidor de IA o exportes un respaldo.</li>' +
        '<li><strong>Empresa y personal, siempre por separado.</strong> Ningún total mezcla los dos ámbitos.</li>' +
        '</ul>' +
        '<div class="fila-entre mb-1"><span class="texto-2">Registros guardados</span><strong class="cifra">' + resumen.total + '</strong></div>' +
        (detalle ? '<p class="campo-ayuda mt-0">' + esc(detalle) + '</p>' : '') +
        '<div class="fila-entre mb-1"><span class="texto-2">Tamaño de la bóveda cifrada</span><strong class="cifra">' + esc(fmtTamano(tamanoBoveda())) + '</strong></div>' +
        '<div class="fila-entre mb-0"><span class="texto-2">Formato de datos</span><strong class="cifra">v' + esc(est.version || 1) + '</strong></div>'
    });
  }

  /* ---------- formularios (Elements montados en los slots) ------------------- */
  function montarFormularios(cuerpo) {
    var a = ajustes();
    var slotPref = cuerpo.querySelector('[data-slot="preferencias"]');
    var slotPass = cuerpo.querySelector('[data-slot="contrasena"]');
    var slotIA = cuerpo.querySelector('[data-slot="ia"]');
    if (slotPref) slotPref.appendChild(formularioPreferencias(a));
    if (slotPass) slotPass.appendChild(formularioContrasena());
    if (slotIA) slotIA.appendChild(formularioIA(a));
  }

  function opcionesAutobloqueo(actual) {
    var valores = OPCIONES_AUTOBLOQUEO.slice();
    var n = Number(actual);
    if (isFinite(n) && n >= 0 && valores.indexOf(n) === -1) {
      valores.push(n);
      valores.sort(function (x, y) { return x - y; });
    }
    return valores.map(function (m) {
      var texto = m === 0 ? 'Nunca' : m === 60 ? '1 hora' : m === 1 ? '1 minuto' : m > 60 ? plural(m, 'minuto') : m + ' minutos';
      return { valor: String(m), texto: texto };
    });
  }

  function formularioPreferencias(a) {
    var campos = [
      { nombre: 'nombreUsuario', etiqueta: 'Tu nombre', tipo: 'texto', requerido: true, maxlength: 60, placeholder: 'Nombre' },
      { nombre: 'nombreEmpresa', etiqueta: 'Nombre de la empresa', tipo: 'texto', requerido: true, maxlength: 80, placeholder: 'Empresa' },
      { nombre: 'autobloqueoMin', etiqueta: 'Autobloqueo', tipo: 'select', requerido: true, opciones: opcionesAutobloqueo(a.autobloqueoMin),
        ayuda: 'La aplicación se bloquea tras este tiempo sin actividad o con la pestaña oculta.' },
      { nombre: 'reservaOperativaDias', etiqueta: 'Reserva operativa (días)', tipo: 'numero', requerido: true, min: 0, max: 365, paso: 1,
        ayuda: 'Días de compromisos de la empresa que se descuentan del líquido para calcular el disponible.' },
      { nombre: 'tema', etiqueta: 'Tema', tipo: 'select', opciones: TEMAS, ayuda: 'Se aplica y guarda al instante.' }
    ];
    var valores = {
      nombreUsuario: a.nombreUsuario || '',
      nombreEmpresa: a.nombreEmpresa || '',
      autobloqueoMin: String(isFinite(Number(a.autobloqueoMin)) ? Number(a.autobloqueoMin) : 5),
      reservaOperativaDias: isFinite(Number(a.reservaOperativaDias)) ? Number(a.reservaOperativaDias) : 30,
      tema: TEMAS.some(function (t) { return t.valor === a.tema; }) ? a.tema : 'auto'
    };
    var form = construirFormulario(campos, valores,
      '<button type="submit" class="btn btn-primario" data-accion="ajustes-guardar-preferencias">' + VF.ui.icono('guardar') + '<span>Guardar</span></button>');
    agruparCampos(form, ['nombreUsuario', 'nombreEmpresa']);
    agruparCampos(form, ['autobloqueoMin', 'reservaOperativaDias']);
    var nota = document.createElement('p');
    nota.className = 'campo-ayuda';
    nota.textContent = 'Moneda: MXN (fija en esta versión). Fechas y cifras en formato de México.';
    form.insertBefore(nota, form.querySelector('.form-acciones'));
    var envoltura = document.createElement('div');
    envoltura.setAttribute('data-ajustes-form', 'preferencias');
    envoltura.appendChild(form);
    return envoltura;
  }

  function formularioContrasena() {
    var campos = [
      { nombre: 'actual', etiqueta: 'Contraseña actual', tipo: 'contrasena', requerido: true, placeholder: 'Tu contraseña de hoy' },
      { nombre: 'nueva', etiqueta: 'Contraseña nueva', tipo: 'contrasena', requerido: true, placeholder: 'Mínimo ' + MIN_CONTRASENA + ' caracteres',
        ayuda: 'Mínimo ' + MIN_CONTRASENA + ' caracteres. Combina letras, números y símbolos.' },
      { nombre: 'confirmar', etiqueta: 'Confirmar contraseña nueva', tipo: 'contrasena', requerido: true, placeholder: 'Repite la contraseña nueva' }
    ];
    var form = construirFormulario(campos, {},
      '<button type="submit" class="btn btn-primario" data-accion="ajustes-cambiar-contrasena">' + VF.ui.icono('bloquear') + '<span>Cambiar contraseña</span></button>');
    agruparCampos(form, ['nueva', 'confirmar']);
    agregarBotonesVer(form);
    var envoltura = document.createElement('div');
    envoltura.setAttribute('data-ajustes-form', 'contrasena');
    envoltura.appendChild(form);
    return envoltura;
  }

  function formularioIA(a) {
    var campos = [
      { nombre: 'asistenteEndpoint', etiqueta: 'URL del servidor', tipo: 'url', placeholder: 'https://mi-servidor.ejemplo/api/asistente',
        ayuda: 'Debe aceptar POST con JSON { pregunta, contexto } y responder { texto }. Si falla, el asistente usa el motor local.' }
    ];
    var form = construirFormulario(campos, { asistenteEndpoint: a.asistenteEndpoint || '' },
      '<button type="button" class="btn btn-secundario" data-accion="ajustes-probar-ia">' + VF.ui.icono('enviar') + '<span>Probar</span></button>' +
      '<button type="submit" class="btn btn-primario" data-accion="ajustes-guardar-ia">' + VF.ui.icono('guardar') + '<span>Guardar</span></button>');
    var envoltura = document.createElement('div');
    envoltura.setAttribute('data-ajustes-form', 'ia');
    envoltura.appendChild(form);
    return envoltura;
  }

  /* ---------- acciones: preferencias ---------------------------------------- */
  function guardarPreferencias(form) {
    var reglas = {
      nombreUsuario: function (v) { return v ? null : 'Escribe tu nombre'; },
      nombreEmpresa: function (v) { return v ? null : 'Escribe el nombre de la empresa'; },
      reservaOperativaDias: function (v) {
        if (v == null || isNaN(v)) return 'Escribe un número de días';
        if (v !== Math.floor(v)) return 'Usa días enteros';
        return null;
      }
    };
    if (!VF.ui.validar(form, reglas)) return false;
    var v = VF.ui.leerFormulario(form);
    var parcial = {
      nombreUsuario: v.nombreUsuario,
      nombreEmpresa: v.nombreEmpresa,
      autobloqueoMin: Math.max(0, Number(v.autobloqueoMin) || 0),
      reservaOperativaDias: Math.max(0, Math.min(365, Number(v.reservaOperativaDias) || 0)),
      tema: TEMAS.some(function (t) { return t.valor === v.tema; }) ? v.tema : 'auto'
    };
    try {
      guardarAjustesSilencioso(parcial);
    } catch (e) {
      toast('No se pudieron guardar los ajustes: ' + textoError(e), 'error');
      return false;
    }
    aplicarTema(parcial.tema, false);
    toast('Ajustes guardados', 'exito');
    return true;
  }

  /** Aplica el tema al instante (mismo mecanismo que el botón de la cabecera) y, si se pide, lo persiste. */
  function aplicarTema(tema, persistir) {
    var t = TEMAS.some(function (x) { return x.valor === tema; }) ? tema : 'auto';
    guardarTemaLocal(t);
    if (VF.app && typeof VF.app.aplicarTema === 'function') VF.app.aplicarTema(t);
    if (persistir) {
      try {
        guardarAjustesSilencioso({ tema: t });
      } catch (e) {
        toast('No se pudo guardar el tema: ' + textoError(e), 'error');
        return;
      }
      toast('Tema ' + NOMBRE_TEMA[t], 'info');
    }
  }

  /* ---------- acciones: contraseña ------------------------------------------ */
  function cambiarContrasena(form) {
    if (ocupadoContrasena) return false;
    var reglas = {
      nueva: function (v) {
        if (!v) return 'Escribe la contraseña nueva';
        if (v.length < MIN_CONTRASENA) return 'La contraseña debe tener al menos ' + MIN_CONTRASENA + ' caracteres';
        return null;
      },
      confirmar: function (v, vals) { return v === vals.nueva ? null : 'Las contraseñas no coinciden'; }
    };
    if (!VF.ui.validar(form, reglas)) return false;
    var v = leerContrasenas(form);
    if (v.nueva === v.actual) {
      marcarErrorCampo(form, 'nueva', 'La contraseña nueva debe ser distinta a la actual');
      return false;
    }
    var btn = form.querySelector('[data-accion="ajustes-cambiar-contrasena"]');
    ocupadoContrasena = true;
    fijarOcupado(btn, true, 'Cambiando…');
    return VF.store.cambiarContrasena(v.actual, v.nueva)
      .then(function () {
        limpiarContrasenas(form);
        toast('Contraseña actualizada. Úsala la próxima vez que desbloquees.', 'exito');
        return true;
      })
      .catch(function (e) {
        var codigo = e && e.message;
        if (codigo === 'CONTRASENA_INCORRECTA') marcarErrorCampo(form, 'actual', 'La contraseña actual no es correcta');
        else if (codigo === 'CONTRASENA_VACIA') marcarErrorCampo(form, 'nueva', 'Escribe la contraseña nueva');
        else toast('No se pudo cambiar la contraseña: ' + textoError(e), 'error');
        return false;
      })
      .then(function (ok) {
        ocupadoContrasena = false;
        if (document.contains(btn)) fijarOcupado(btn, false);
        return ok;
      });
  }

  /** Lee las contraseñas SIN recortar espacios (leerFormulario hace trim en texto). */
  function leerContrasenas(form) {
    var salida = {};
    ['actual', 'nueva', 'confirmar'].forEach(function (n) {
      var c = form.querySelector('[data-campo="' + n + '"]');
      salida[n] = c ? String(c.value || '') : '';
    });
    return salida;
  }

  function limpiarContrasenas(form) {
    Array.prototype.forEach.call(form.querySelectorAll('[data-campo]'), function (c) {
      c.value = '';
      if (c.type === 'text' && c.closest('.campo-con-boton')) {
        // vuelve a ocultar el texto si el usuario había pulsado "mostrar"
        c.type = 'password';
        var btn = c.closest('.campo-con-boton').querySelector('.btn-ver');
        if (btn) { btn.setAttribute('aria-pressed', 'false'); btn.setAttribute('aria-label', 'Mostrar contraseña'); btn.innerHTML = VF.ui.icono('ojo'); }
      }
    });
  }

  /* ---------- acciones: respaldo (exportar) --------------------------------- */
  /**
   * Exporta el respaldo. cifrado:true → bóveda tal como está persistida (espera a que termine la
   * escritura pendiente para que el archivo refleje el último cambio). → Promise<bool>
   */
  function exportarRespaldo(opciones) {
    var cifrado = !opciones || opciones.cifrado !== false;
    if (!VF.store.estaDesbloqueado()) return Promise.resolve(false);
    if (ocupadoExportar) return Promise.resolve(false);
    ocupadoExportar = true;
    var btn = document.querySelector('[data-accion="ajustes-exportar-' + (cifrado ? 'cifrado' : 'plano') + '"]');
    fijarOcupado(btn, true, 'Preparando…');

    var espera;
    if (cifrado) {
      silencio = true;
      try { espera = VF.store.guardar(); } finally { silencio = false; }
    } else {
      espera = Promise.resolve(true);
    }
    return espera.then(function (persistio) {
      if (cifrado && persistio === false) throw new Error('NO_SE_PUDO_GUARDAR');
      var texto = VF.store.exportarJSON({ cifrado: cifrado });
      var nombre = nombreArchivo(cifrado);
      if (!U.descargar(nombre, texto, 'application/json')) throw new Error('DESCARGA_NO_DISPONIBLE');
      toast(cifrado ? 'Respaldo cifrado descargado: ' + nombre : 'Datos sin cifrar descargados: ' + nombre, cifrado ? 'exito' : 'alerta');
      return true;
    }).catch(function (e) {
      toast('No se pudo exportar: ' + textoError(e), 'error');
      return false;
    }).then(function (ok) {
      ocupadoExportar = false;
      if (document.contains(btn)) fijarOcupado(btn, false);
      return ok;
    });
  }

  function confirmarExportarPlano() {
    VF.ui.modal({
      titulo: 'Exportar sin cifrar',
      cuerpo:
        '<p class="aviso aviso-alerta"><strong>El archivo .json contendrá todos tus datos legibles</strong>: cuentas, saldos, movimientos, ' +
        'clientes, facturas, proveedores, préstamos y metas, sin ninguna protección.</p>' +
        '<p>Cualquier persona o programa con acceso al archivo podrá leerlo. Úsalo sólo para revisar la información o llevarla a otra ' +
        'herramienta; guárdalo en un lugar seguro y bórralo cuando ya no lo necesites.</p>' +
        '<p class="texto-2 mb-0">Para resguardar tu información prefiere el <strong>respaldo cifrado</strong>, que sólo se abre con tu contraseña.</p>',
      botones: [
        { texto: 'Cancelar', tono: 'secundario' },
        { texto: 'Exportar sin cifrar', tono: 'peligro', accion: function () { exportarRespaldo({ cifrado: false }); } }
      ]
    });
  }

  /* ---------- acciones: respaldo (importar) --------------------------------- */
  function leerArchivoTexto(archivo) {
    if (archivo && typeof archivo.text === 'function') return archivo.text();
    return new Promise(function (resolver, rechazar) {
      var lector = new FileReader();
      lector.onload = function () { resolver(String(lector.result || '')); };
      lector.onerror = function () { rechazar(new Error('LECTURA_FALLIDA')); };
      lector.readAsText(archivo);
    });
  }

  /** Recibe el File elegido, detecta el formato y abre la confirmación. → Promise<bool> (true si importó) */
  function importarArchivo(archivo) {
    if (!archivo) return Promise.resolve(false);
    return leerArchivoTexto(archivo).then(function (texto) {
      return abrirImportar(texto, archivo.name || 'respaldo', archivo.size || texto.length);
    }).catch(function (e) {
      toast('No se pudo leer el archivo: ' + textoError(e), 'error');
      return false;
    });
  }

  /**
   * Abre el modal de confirmación de importación para un texto JSON ya leído.
   * Detecta formato (cifrado / sin cifrar); si está cifrado pide la contraseña del respaldo (puede
   * dejarse vacía si se creó con la contraseña actual). → Promise<bool>
   */
  function abrirImportar(texto, nombre, tamano) {
    var obj;
    try {
      obj = JSON.parse(texto);
    } catch (e) {
      toast('El archivo no es JSON válido.', 'error');
      return Promise.resolve(false);
    }
    var cifrado = esBovedaCifrada(obj);
    if (!cifrado && !esEstadoPlano(obj)) {
      toast('El archivo no es un respaldo de VILLEDA Finanzas.', 'error');
      return Promise.resolve(false);
    }

    var resumenHtml = '';
    if (!cifrado) {
      var res = resumenColecciones(obj);
      var partes = res.filas.map(function (f) { return f.cantidad + ' ' + f.texto; });
      resumenHtml = '<div class="fila-entre mb-1"><span class="texto-2">Contenido</span><strong class="cifra">' + plural(res.total, 'registro') + '</strong></div>' +
        (partes.length ? '<p class="campo-ayuda mt-0">' + esc(partes.join(' · ')) + '</p>' : '');
      if (obj.ajustes && obj.ajustes.nombreEmpresa) {
        resumenHtml += '<div class="fila-entre mb-1"><span class="texto-2">Empresa</span><strong>' + esc(obj.ajustes.nombreEmpresa) + '</strong></div>';
      }
    } else {
      resumenHtml = '<p class="campo-ayuda">El contenido se verá al descifrarlo. Tu contraseña actual no cambia: el respaldo se vuelve a cifrar con ella.</p>';
    }

    var cuerpo = VF.ui.el('<div>' +
      '<div class="fila-entre mb-1"><span class="texto-2">Archivo</span><strong class="truncar">' + esc(nombre) + '</strong></div>' +
      '<div class="fila-entre mb-1"><span class="texto-2">Formato</span>' +
      (cifrado ? '<span class="badge badge-info">Cifrado</span>' : '<span class="badge badge-alerta">Sin cifrar</span>') + '</div>' +
      '<div class="fila-entre mb-2"><span class="texto-2">Tamaño</span><strong class="cifra">' + esc(fmtTamano(tamano)) + '</strong></div>' +
      resumenHtml +
      (cifrado ? VF.ui.formulario([
        { nombre: 'contrasena', etiqueta: 'Contraseña del respaldo', tipo: 'contrasena', placeholder: 'Déjala vacía si es tu contraseña actual',
          ayuda: 'Sólo hace falta si el respaldo se creó con otra contraseña (por ejemplo, antes de cambiarla).' }
      ], {}) : '') +
      '<p class="aviso aviso-error mt-2 mb-0"><strong>Se reemplazarán TODOS los datos actuales</strong> de este dispositivo por los del respaldo. ' +
      'Esta acción no se puede deshacer; exporta un respaldo antes si tienes dudas.</p>' +
      '<p class="campo-error" data-import-error role="alert" hidden></p>' +
      '</div>');
    var form = cuerpo.querySelector('form');
    if (form) agregarBotonesVer(form);
    var pError = cuerpo.querySelector('[data-import-error]');

    return new Promise(function (resolver) {
      var decidido = false;
      var importando = false;
      function mostrarError(msg) {
        pError.textContent = msg;
        pError.hidden = !msg;
      }
      function ejecutar(api) {
        if (importando) return false;
        mostrarError('');
        var contrasena = '';
        if (form) {
          var c = form.querySelector('[data-campo="contrasena"]');
          contrasena = c ? String(c.value || '') : '';
        }
        importando = true;
        var btn = api && api.elemento ? api.elemento.querySelector('.modal-pie .btn-peligro') : null;
        fijarOcupado(btn, true, 'Importando…');
        return VF.store.importarJSON(texto, contrasena || undefined)
          .then(function () {
            decidido = true;
            resolver(true);
            toast('Respaldo importado correctamente', 'exito');
            return true;
          })
          .catch(function (e) {
            var codigo = e && e.message;
            var msg;
            if (codigo === 'CONTRASENA_REQUERIDA') msg = 'Este respaldo se creó con otra contraseña: escríbela para abrirlo.';
            else if (codigo === 'CONTRASENA_INCORRECTA') msg = 'Contraseña incorrecta para este respaldo.';
            else if (codigo === 'DATOS_CORRUPTOS') msg = 'El respaldo está dañado y no se puede leer.';
            else if (codigo === 'JSON_INVALIDO' || codigo === 'FORMATO_DESCONOCIDO') msg = 'El archivo no es un respaldo válido.';
            else if (codigo === 'BLOQUEADO') msg = 'La sesión se bloqueó; desbloquea e inténtalo de nuevo.';
            else msg = 'No se pudo importar: ' + textoError(e);
            mostrarError(msg);
            if (form) { var c2 = form.querySelector('[data-campo="contrasena"]'); if (c2) c2.focus(); }
            return false;
          })
          .then(function (ok) {
            importando = false;
            if (btn && document.contains(btn)) fijarOcupado(btn, false);
            return ok;
          });
      }
      var api = VF.ui.modal({
        titulo: 'Importar respaldo',
        cuerpo: cuerpo,
        botones: [
          { texto: 'Cancelar', tono: 'secundario' },
          { texto: 'Reemplazar e importar', tono: 'peligro', accion: ejecutar }
        ],
        alCerrar: function () { if (!decidido) resolver(false); }
      });
      if (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var r = ejecutar(api);
          if (r && typeof r.then === 'function') r.then(function (ok) { if (ok) api.cerrar(); });
        });
      }
    });
  }

  /* ---------- acciones: datos de ejemplo y borrar todo ---------------------- */
  function borrarDatosEjemplo() {
    var est = estado();
    if (!est) return Promise.resolve(false);
    var n = contarDemo(est);
    return VF.ui.confirmar(
      'Se eliminarán ' + plural(n, 'registro ficticio', 'registros ficticios') + ' (los que terminan en «_demo»). ' +
      'Los registros que creaste tú se conservan. ¿Deseas continuar?',
      { peligro: true, titulo: 'Borrar datos de ejemplo', textoAceptar: 'Sí, borrar ejemplos' }
    ).then(function (ok) {
      if (!ok) return false;
      var eliminados;
      try {
        eliminados = VF.store.borrarDatosEjemplo();
      } catch (e) {
        toast('No se pudieron borrar los datos de ejemplo: ' + textoError(e), 'error');
        return false;
      }
      toast('Se eliminaron ' + plural(Number(eliminados) || 0, 'registro de ejemplo', 'registros de ejemplo'), 'exito');
      return true;
    });
  }

  function borrarTodo() {
    if (!VF.store.estaDesbloqueado()) return Promise.resolve(false);
    return VF.ui.confirmar(
      'Se eliminarán TODOS los datos guardados en este dispositivo: cuentas, movimientos, facturas, préstamos, ajustes y contraseña. ' +
      'Esta acción no se puede deshacer. ¿Deseas continuar?',
      { peligro: true, titulo: 'Borrar todo', textoAceptar: 'Continuar' }
    ).then(function (ok) {
      if (!ok) return false;
      return new Promise(function (resolver) {
        var decidido = false;
        var cuerpo = VF.ui.el('<div>' +
          '<p>Última confirmación. Para borrar definitivamente la bóveda escribe <strong>' + TEXTO_BORRAR + '</strong> en mayúsculas.</p>' +
          VF.ui.formulario([
            { nombre: 'confirmacion', etiqueta: 'Escribe ' + TEXTO_BORRAR, tipo: 'texto', placeholder: TEXTO_BORRAR, autofoco: true }
          ], {}) +
          '<p class="campo-ayuda mb-0">Si quieres conservar algo, cancela y exporta un respaldo primero.</p>' +
          '</div>');
        var form = cuerpo.querySelector('form');
        var campo = form.querySelector('[data-campo="confirmacion"]');
        campo.setAttribute('autocapitalize', 'characters');
        campo.setAttribute('autocomplete', 'off');
        campo.setAttribute('spellcheck', 'false');

        function coincide() { return String(campo.value || '').trim() === TEXTO_BORRAR; }
        function ejecutar() {
          if (!coincide()) {
            marcarErrorCampo(form, 'confirmacion', 'Escribe exactamente ' + TEXTO_BORRAR + ' para continuar');
            return false;
          }
          decidido = true;
          try {
            VF.store.borrarTodo();   // emite 'bloqueado' → app.js muestra la pantalla de bloqueo en modo "Crear contraseña"
          } catch (e) {
            toast('No se pudo borrar: ' + textoError(e), 'error');
            resolver(false);
            return true;
          }
          toast('Se borraron todos los datos de este dispositivo. Crea una contraseña nueva para empezar.', 'alerta');
          resolver(true);
          return true;
        }

        var api = VF.ui.modal({
          titulo: 'Borrar todo',
          cuerpo: cuerpo,
          botones: [
            { texto: 'Cancelar', tono: 'secundario' },
            { texto: 'Borrar definitivamente', tono: 'peligro', accion: ejecutar }
          ],
          alCerrar: function () { if (!decidido) resolver(false); }
        });
        var btnBorrar = api.elemento.querySelector('.modal-pie .btn-peligro');
        if (btnBorrar) btnBorrar.disabled = true;
        campo.addEventListener('input', function () {
          marcarErrorCampo(form, 'confirmacion', '');
          if (btnBorrar) btnBorrar.disabled = !coincide();
        });
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          if (ejecutar() !== false) api.cerrar();
        });
      });
    });
  }

  /* ---------- acciones: servidor de IA -------------------------------------- */
  function validarUrl(url) {
    var u = String(url == null ? '' : url).trim();
    if (!u) return 'Escribe la URL del servidor para probarla.';
    var analizada;
    try {
      analizada = new URL(u);
    } catch (e) {
      return 'La URL no es válida. Debe empezar con http:// o https:// (por ejemplo https://mi-servidor/api/asistente).';
    }
    if (analizada.protocol !== 'http:' && analizada.protocol !== 'https:') {
      return 'Sólo se admiten direcciones http:// o https://.';
    }
    if (location.protocol === 'https:' && analizada.protocol === 'http:') {
      return 'Desde una página https sólo se permiten servidores https (el navegador bloquea el contenido mixto).';
    }
    return null;
  }

  /**
   * Prueba el servidor de IA: POST { pregunta:'ping', contexto:{} } con tiempo máximo (10 s por defecto).
   * Nunca lanza: → Promise<{ ok, ms, texto? , error? }>
   */
  function probarServidor(url, opciones) {
    var o = opciones || {};
    var timeoutMs = typeof o.timeoutMs === 'number' && o.timeoutMs > 0 ? o.timeoutMs : TIMEOUT_IA_MS;
    var inicio = Date.now();
    var invalida = validarUrl(url);
    if (invalida) return Promise.resolve({ ok: false, ms: 0, error: invalida });
    if (typeof fetch !== 'function') return Promise.resolve({ ok: false, ms: 0, error: 'Este navegador no permite conexiones de red (fetch).' });

    var destino = String(url).trim();
    var expiro = false;
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var temporizador = setTimeout(function () {
      expiro = true;
      if (ctrl) ctrl.abort();
    }, timeoutMs);

    var peticion = {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pregunta: 'ping', contexto: {} })
    };
    if (ctrl) peticion.signal = ctrl.signal;

    return fetch(destino, peticion)
      .then(function (resp) {
        if (!resp.ok) throw { codigo: 'HTTP', estado: resp.status };
        return resp.text().then(function (t) {
          var datos;
          try { datos = JSON.parse(t); } catch (e) { throw { codigo: 'JSON' }; }
          if (!datos || typeof datos.texto !== 'string') throw { codigo: 'SIN_TEXTO' };
          return { ok: true, ms: Date.now() - inicio, texto: datos.texto };
        });
      })
      .catch(function (e) {
        var ms = Date.now() - inicio;
        var error;
        if (expiro || (e && e.name === 'AbortError')) error = 'El servidor no respondió en ' + fmtSegundos(timeoutMs) + '.';
        else if (e && e.codigo === 'HTTP') error = 'El servidor respondió con un error HTTP ' + e.estado + '.';
        else if (e && e.codigo === 'JSON') error = 'La respuesta no es JSON válido.';
        else if (e && e.codigo === 'SIN_TEXTO') error = 'La respuesta no incluye el campo «texto».';
        else if (e && (e.name === 'TypeError' || /fetch/i.test(String(e && e.message)))) {
          error = 'No se pudo conectar. Revisa la URL, que el servidor esté en línea y que permita peticiones desde esta aplicación (CORS).';
        } else error = 'Error inesperado: ' + textoError(e);
        return { ok: false, ms: ms, error: error };
      })
      .then(function (r) {
        clearTimeout(temporizador);
        return r;
      });
  }

  function mostrarResultadoIA(contenedor, resultado) {
    if (!contenedor) return;
    if (!resultado) { contenedor.innerHTML = ''; return; }
    if (resultado.ok) {
      var texto = String(resultado.texto || '');
      if (texto.length > MAX_TEXTO_RESPUESTA) texto = texto.slice(0, MAX_TEXTO_RESPUESTA) + '…';
      contenedor.innerHTML = '<div class="aviso aviso-exito mb-0" data-ia-estado="ok"><strong>Conexión correcta</strong> · respondió en ' +
        esc(resultado.ms) + ' ms.' + (texto ? '<br><span class="texto-2">Respuesta: «' + esc(texto) + '»</span>' : '') + '</div>';
    } else {
      contenedor.innerHTML = '<div class="aviso aviso-error mb-0" role="alert" data-ia-estado="error"><strong>Sin conexión.</strong> ' +
        esc(resultado.error || 'Error desconocido') + '</div>';
    }
  }

  function probarDesdeFormulario(form) {
    if (probandoIA) return Promise.resolve(null);
    var campo = form.querySelector('[data-campo="asistenteEndpoint"]');
    var url = campo ? String(campo.value || '').trim() : '';
    var tarjeta = form.closest('.tarjeta');
    var salida = tarjeta ? tarjeta.querySelector('[data-ia-resultado]') : null;
    var btn = form.querySelector('[data-accion="ajustes-probar-ia"]');
    marcarErrorCampo(form, 'asistenteEndpoint', '');
    var invalida = validarUrl(url);
    if (invalida) {
      marcarErrorCampo(form, 'asistenteEndpoint', invalida);
      mostrarResultadoIA(salida, null);
      return Promise.resolve({ ok: false, ms: 0, error: invalida });
    }
    probandoIA = true;
    fijarOcupado(btn, true, 'Probando…');
    if (salida) salida.innerHTML = '<p class="texto-2 mb-0" data-ia-estado="probando">Enviando prueba…</p>';
    return probarServidor(url).then(function (r) {
      probandoIA = false;
      if (document.contains(btn)) fijarOcupado(btn, false);
      if (salida && document.contains(salida)) mostrarResultadoIA(salida, r);
      return r;
    });
  }

  function guardarIA(form) {
    var campo = form.querySelector('[data-campo="asistenteEndpoint"]');
    var url = campo ? String(campo.value || '').trim() : '';
    marcarErrorCampo(form, 'asistenteEndpoint', '');
    if (url) {
      var invalida = validarUrl(url);
      if (invalida) { marcarErrorCampo(form, 'asistenteEndpoint', invalida); return false; }
    }
    try {
      guardarAjustesSilencioso({ asistenteEndpoint: url });
    } catch (e) {
      toast('No se pudo guardar: ' + textoError(e), 'error');
      return false;
    }
    toast(url ? 'Servidor de IA guardado' : 'Servidor de IA desactivado: el asistente trabaja en local', 'exito');
    return true;
  }

  /* ---------- delegación de eventos (data-accion="ajustes-…") -------------- */
  function formDe(objetivo, nombre) {
    var env = objetivo.closest('[data-ajustes-form="' + nombre + '"]');
    return env ? env.querySelector('form') : null;
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-accion^="ajustes-"]') : null;
    if (!t) return;
    if (!VF.store.estaDesbloqueado()) return;
    var accion = t.getAttribute('data-accion');
    switch (accion) {
      case 'ajustes-exportar-cifrado':
        exportarRespaldo({ cifrado: true });
        break;
      case 'ajustes-exportar-plano':
        confirmarExportarPlano();
        break;
      case 'ajustes-elegir-archivo': {
        var tarjeta = t.closest('.tarjeta');
        var input = tarjeta ? tarjeta.querySelector('[data-ajustes-archivo]') : document.querySelector('[data-ajustes-archivo]');
        if (input) { input.value = ''; input.click(); }
        break;
      }
      case 'ajustes-borrar-ejemplo':
        borrarDatosEjemplo();
        break;
      case 'ajustes-borrar-todo':
        borrarTodo();
        break;
      case 'ajustes-probar-ia': {
        var formIA = formDe(t, 'ia');
        if (formIA) probarDesdeFormulario(formIA);
        break;
      }
      default:
        // Los botones de guardar son type="submit": los atiende el oyente de 'submit'.
        break;
    }
  });

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.closest) return;
    var env = form.closest('[data-ajustes-form]');
    if (!env) return;
    e.preventDefault();
    if (!VF.store.estaDesbloqueado()) return;
    switch (env.getAttribute('data-ajustes-form')) {
      case 'preferencias': guardarPreferencias(form); break;
      case 'contrasena': cambiarContrasena(form); break;
      case 'ia': guardarIA(form); break;
      default: break;
    }
  });

  // Al editar un campo con error, el mensaje desaparece (no esperar al siguiente envío).
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.matches || !t.matches('[data-ajustes-form] [data-campo]')) return;
    var form = t.closest('form');
    var cont = t.closest('[data-campo-cont]');
    if (form && cont && cont.classList.contains('con-error')) marcarErrorCampo(form, t.getAttribute('data-campo'), '');
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.matches) return;
    if (t.matches('[data-ajustes-archivo]')) {
      var archivo = t.files && t.files[0];
      if (archivo && VF.store.estaDesbloqueado()) {
        importarArchivo(archivo).then(function () { if (document.contains(t)) t.value = ''; });
      }
      return;
    }
    if (t.matches('[data-ajustes-form="preferencias"] [data-campo="tema"]') && VF.store.estaDesbloqueado()) {
      aplicarTema(t.value, true);
    }
  });

  /* ---------- reacción a cambios del store --------------------------------- */
  VF.store.on('cambio', function () {
    if (silencio) return;
    clearTimeout(temporizadorCambio);
    temporizadorCambio = setTimeout(function () {
      if (!VF.store.estaDesbloqueado()) return;
      if (!enRuta()) return;
      pintarCuerpo();
    }, 30);
  });
  VF.store.on('bloqueado', function () {
    clearTimeout(temporizadorCambio);
    probandoIA = false;
    ocupadoContrasena = false;
    ocupadoExportar = false;
  });

  /* ---------- registro ----------------------------------------------------- */
  VF.router.registrar(RUTA, { titulo: 'Ajustes', icono: 'ajustes', nav: 'mas', render: render });

  VF.ajustes = {
    render: render,
    exportarRespaldo: exportarRespaldo,
    importarArchivo: importarArchivo,
    abrirImportar: abrirImportar,
    borrarDatosEjemplo: borrarDatosEjemplo,
    borrarTodo: borrarTodo,
    probarServidor: probarServidor,
    aplicarTema: function (tema) { aplicarTema(tema, true); },
    TIMEOUT_IA_MS: TIMEOUT_IA_MS
  };
})(window.VF);
