'use strict';
/*
 * app.js — arranque de VILLEDA Finanzas
 *  - Pantalla de bloqueo: crear contraseña (≥ 8 caracteres, medidor de fortaleza, datos de ejemplo) o desbloquear.
 *  - "Olvidé mi contraseña": no hay recuperación; ofrece borrar todo con doble confirmación.
 *  - Autobloqueo por inactividad y por pestaña oculta (ajustes.autobloqueoMin; 0 = nunca).
 *  - Tema: data-tema en <html> según ajustes ('auto' | 'claro' | 'oscuro').
 *  - Service worker sólo en http(s). Banner de datos de ejemplo mientras ajustes.datosEjemplo sea true.
 * Depende de VF.store (firma en docs/ARQUITECTURA.md §3) y de VF.ui / VF.router.
 */
window.VF = window.VF || {};
(function (VF) {

  var CLAVE_TEMA_LOCAL = 'vf.tema';     // preferencia de tema del dispositivo (no sensible), para antes de desbloquear
  var temporizadorBloqueo = null;
  var ocultoDesde = null;
  var desbloqueado = false;
  var ocupado = false;

  function $(sel) { return document.querySelector(sel); }
  function ui() { return VF.ui || null; }
  function store() { return VF.store && typeof VF.store.existeBoveda === 'function' ? VF.store : null; }
  function ajustes() {
    try { return (VF.store && VF.store.estaDesbloqueado && VF.store.estaDesbloqueado() && VF.store.estado().ajustes) || {}; }
    catch (e) { return {}; }
  }
  function toast(msg, tipo) { if (ui() && ui().toast) ui().toast(msg, tipo); }

  /* ---------- tema ---------------------------------------------------------- */
  function leerTemaLocal() {
    try { return localStorage.getItem(CLAVE_TEMA_LOCAL) || 'auto'; } catch (e) { return 'auto'; }
  }
  function guardarTemaLocal(tema) {
    try { localStorage.setItem(CLAVE_TEMA_LOCAL, tema); } catch (e) { /* almacenamiento no disponible */ }
  }
  function aplicarTema(tema) {
    var t = tema === 'claro' || tema === 'oscuro' ? tema : 'auto';
    var raiz = document.documentElement;
    if (t === 'auto') raiz.removeAttribute('data-tema'); else raiz.setAttribute('data-tema', t);
    // theme-color de la barra del sistema
    var oscuroEfectivo = t === 'oscuro' || (t === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    Array.prototype.forEach.call(metas, function (m) {
      if (t === 'auto') {
        m.setAttribute('content', m.getAttribute('media') && m.getAttribute('media').indexOf('dark') >= 0 ? '#0B1120' : '#1D4ED8');
      } else {
        m.setAttribute('content', oscuroEfectivo ? '#0B1120' : '#1D4ED8');
      }
    });
    var btn = $('#btn-tema');
    if (btn && ui()) {
      btn.innerHTML = ui().icono(t === 'oscuro' ? 'luna' : t === 'claro' ? 'sol' : 'tema');
      btn.setAttribute('aria-label', 'Tema: ' + (t === 'auto' ? 'automático' : t) + '. Cambiar tema');
      btn.title = 'Tema: ' + (t === 'auto' ? 'automático' : t);
    }
  }
  function temaActual() {
    var a = ajustes();
    return a.tema || leerTemaLocal();
  }
  function alternarTema() {
    var orden = ['auto', 'claro', 'oscuro'];
    var siguiente = orden[(orden.indexOf(temaActual()) + 1) % orden.length];
    guardarTemaLocal(siguiente);
    if (desbloqueado && VF.store && VF.store.setAjustes) {
      try { VF.store.setAjustes({ tema: siguiente }); } catch (e) { console.error(e); }
    }
    aplicarTema(siguiente);
    toast('Tema ' + (siguiente === 'auto' ? 'automático' : siguiente), 'info');
  }

  /* ---------- fortaleza de contraseña ------------------------------------- */
  function fortaleza(c) {
    var s = String(c || '');
    if (!s.length) return { nivel: 0, texto: '—' };
    var puntos = 0;
    if (s.length >= 8) puntos += 1;
    if (s.length >= 12) puntos += 1;
    if (/[a-z]/.test(s) && /[A-Z]/.test(s)) puntos += 1;
    if (/\d/.test(s)) puntos += 1;
    if (/[^A-Za-z0-9]/.test(s)) puntos += 1;
    if (/^(.)\1+$/.test(s) || /^(1234|abcd|qwer|pass|contra)/i.test(s)) puntos = Math.min(puntos, 1);
    var nivel = s.length < 8 ? 1 : Math.max(1, Math.min(4, puntos - 1));
    var textos = { 0: '—', 1: s.length < 8 ? 'muy corta (mínimo 8 caracteres)' : 'débil', 2: 'regular', 3: 'buena', 4: 'fuerte' };
    return { nivel: nivel, texto: textos[nivel] };
  }

  /* ---------- pantalla de bloqueo ------------------------------------------ */
  function mostrarBloqueo(modo) {
    var pantalla = $('#pantalla-bloqueo');
    var app = $('#app');
    var formCrear = $('#form-crear');
    var formDesbloquear = $('#form-desbloquear');
    var aviso = $('#bloqueo-aviso');
    if (app) app.hidden = true;
    if (pantalla) pantalla.hidden = false;
    document.body.classList.remove('modal-abierto');
    document.documentElement.removeAttribute('data-ambito');
    document.title = 'VILLEDA Finanzas';

    var st = store();
    if (!st) {
      if (aviso) { aviso.textContent = 'El módulo de almacenamiento (VF.store) no está disponible. Verifica que todos los archivos de la aplicación estén presentes.'; aviso.hidden = false; }
      if (formCrear) formCrear.hidden = true;
      if (formDesbloquear) formDesbloquear.hidden = true;
      return;
    }
    if (aviso) aviso.hidden = true;
    if (!window.isSecureContext || !window.crypto || !window.crypto.subtle) {
      if (aviso) {
        aviso.textContent = 'Este navegador no permite cifrado en este contexto. Abre la aplicación desde el archivo index.html, por https o en localhost.';
        aviso.hidden = false;
      }
    }

    var existe = false;
    try { existe = st.existeBoveda(); } catch (e) { console.error(e); }
    var crear = modo === 'crear' || (modo !== 'desbloquear' && !existe);
    if (formCrear) formCrear.hidden = !crear;
    if (formDesbloquear) formDesbloquear.hidden = crear;

    var campo = crear ? $('#crear-contrasena') : $('#desbloquear-contrasena');
    if (campo) { campo.value = ''; setTimeout(function () { campo.focus(); }, 50); }
    var confirmar = $('#crear-confirmar');
    if (confirmar) confirmar.value = '';
    mostrarError(crear ? '#crear-error' : '#desbloquear-error', '');
    actualizarFortaleza('');
  }

  function mostrarError(sel, mensaje) {
    var n = $(sel);
    if (!n) return;
    n.textContent = mensaje || '';
    n.hidden = !mensaje;
  }

  function actualizarFortaleza(valor) {
    var f = fortaleza(valor);
    var barra = document.querySelector('#form-crear .fortaleza');
    var texto = $('#crear-fortaleza');
    if (barra) barra.setAttribute('data-nivel', String(f.nivel));
    if (texto) texto.textContent = 'Fortaleza: ' + f.texto;
  }

  function alCrear(e) {
    e.preventDefault();
    if (ocupado) return;
    var st = store();
    if (!st) return;
    var c = $('#crear-contrasena').value;
    var conf = $('#crear-confirmar').value;
    var conEjemplo = !!($('#crear-ejemplo') && $('#crear-ejemplo').checked);
    mostrarError('#crear-error', '');
    if (c.length < 8) { mostrarError('#crear-error', 'La contraseña debe tener al menos 8 caracteres.'); $('#crear-contrasena').focus(); return; }
    if (c !== conf) { mostrarError('#crear-error', 'Las contraseñas no coinciden.'); $('#crear-confirmar').focus(); return; }

    var btn = $('#btn-crear');
    ocupado = true;
    btn.disabled = true;
    btn.textContent = 'Creando…';
    Promise.resolve().then(function () { return st.crear(c, { conEjemplo: conEjemplo }); })
      .then(function () {
        if (!desbloqueado) alDesbloquear();
        toast(conEjemplo ? 'Bóveda creada con datos de ejemplo' : 'Bóveda creada', 'exito');
      })
      .catch(function (err) {
        console.error(err);
        mostrarError('#crear-error', 'No se pudo crear la bóveda: ' + (err && err.message ? err.message : 'error desconocido'));
      })
      .then(function () {
        ocupado = false;
        btn.disabled = false;
        btn.textContent = 'Crear';
      });
  }

  function alDesbloquearForm(e) {
    e.preventDefault();
    if (ocupado) return;
    var st = store();
    if (!st) return;
    var campo = $('#desbloquear-contrasena');
    var c = campo.value;
    mostrarError('#desbloquear-error', '');
    if (!c) { mostrarError('#desbloquear-error', 'Escribe tu contraseña.'); campo.focus(); return; }
    var btn = $('#btn-desbloquear');
    ocupado = true;
    btn.disabled = true;
    btn.textContent = 'Verificando…';
    Promise.resolve().then(function () { return st.desbloquear(c); })
      .then(function () { if (!desbloqueado) alDesbloquear(); })
      .catch(function (err) {
        var msg = err && err.message === 'CONTRASENA_INCORRECTA'
          ? 'Contraseña incorrecta.'
          : 'No se pudieron leer los datos guardados' + (err && err.message ? ' (' + err.message + ')' : '') + '.';
        mostrarError('#desbloquear-error', msg);
        campo.value = '';
        campo.focus();
      })
      .then(function () {
        ocupado = false;
        btn.disabled = false;
        btn.textContent = 'Desbloquear';
      });
  }

  function alOlvide(e) {
    e.preventDefault();
    var u = ui();
    var st = store();
    if (!u || !st) return;
    u.modal({
      titulo: 'Olvidé mi contraseña',
      cuerpo:
        '<p>Tu información está cifrada con tu contraseña y <strong>no existe forma de recuperarla</strong>: nadie, ni esta aplicación, puede leer los datos sin ella.</p>' +
        '<p>Si tienes un respaldo exportado desde Ajustes, podrás importarlo después de crear una contraseña nueva.</p>' +
        '<p class="texto-2">La única alternativa es borrar todo lo guardado en este dispositivo y empezar de nuevo.</p>',
      botones: [
        { texto: 'Cancelar', tono: 'secundario' },
        {
          texto: 'Borrar todo y empezar de nuevo', tono: 'peligro',
          accion: function () {
            setTimeout(function () {
              u.confirmar('Se eliminarán TODOS los datos guardados en este dispositivo. Esta acción no se puede deshacer. ¿Deseas continuar?', { peligro: true, textoAceptar: 'Sí, borrar' })
                .then(function (ok) {
                  if (!ok) return;
                  return u.confirmar('Última confirmación: ¿borrar definitivamente la bóveda y todos los registros?', { peligro: true, textoAceptar: 'Borrar definitivamente' })
                    .then(function (ok2) {
                      if (!ok2) return;
                      try { st.borrarTodo(); } catch (err) { console.error(err); }
                      desbloqueado = false;
                      mostrarBloqueo('crear');
                      toast('Se borraron todos los datos. Crea una contraseña nueva.', 'alerta');
                    });
                });
            }, 60);
          }
        }
      ]
    });
  }

  function alternarVer(e) {
    var btn = e.target.closest('.btn-ver');
    if (!btn) return;
    var campo = document.getElementById(btn.getAttribute('data-ver'));
    if (!campo) return;
    var mostrar = campo.type === 'password';
    campo.type = mostrar ? 'text' : 'password';
    btn.setAttribute('aria-pressed', mostrar ? 'true' : 'false');
    btn.setAttribute('aria-label', mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña');
    if (ui()) btn.innerHTML = ui().icono(mostrar ? 'ojo-cerrado' : 'ojo');
    campo.focus();
  }

  /* ---------- ciclo desbloqueado / bloqueado ------------------------------ */
  function alDesbloquear() {
    desbloqueado = true;
    var pantalla = $('#pantalla-bloqueo');
    var app = $('#app');
    if (pantalla) pantalla.hidden = true;
    if (app) app.hidden = false;
    var a = ajustes();
    aplicarTema(a.tema || leerTemaLocal());
    actualizarBanner();
    if (VF.router && VF.router.iniciar) VF.router.iniciar();
    reiniciarAutobloqueo();
  }

  function alBloquear() {
    desbloqueado = false;
    detenerAutobloqueo();
    if (ui() && ui().cerrarModales) ui().cerrarModales();
    var vista = $('#vista');
    if (vista) vista.innerHTML = '';
    var toasts = $('#toasts');
    if (toasts) toasts.innerHTML = '';
    // Sin modo: "Desbloquear" si la bóveda sigue existiendo, "Crear contraseña" si se borró (borrarTodo).
    mostrarBloqueo();
  }

  function bloquearAhora() {
    var st = store();
    if (!st || !desbloqueado) return;
    try { st.bloquear(); } catch (e) { console.error(e); alBloquear(); }
  }

  function actualizarBanner() {
    var banner = $('#banner-ejemplo');
    if (!banner) return;
    var a = ajustes();
    banner.hidden = !(desbloqueado && a.datosEjemplo === true);
    var ic = banner.querySelector('.banner-icono');
    if (ic && ui() && !ic.innerHTML) ic.innerHTML = ui().icono('alerta');
  }

  /* ---------- autobloqueo --------------------------------------------------- */
  function minutosAutobloqueo() {
    var a = ajustes();
    var m = Number(a.autobloqueoMin);
    return isNaN(m) || m < 0 ? 5 : m;
  }
  function detenerAutobloqueo() {
    if (temporizadorBloqueo) { clearTimeout(temporizadorBloqueo); temporizadorBloqueo = null; }
  }
  function reiniciarAutobloqueo() {
    detenerAutobloqueo();
    if (!desbloqueado) return;
    var min = minutosAutobloqueo();
    if (!min) return;
    temporizadorBloqueo = setTimeout(function () {
      if (desbloqueado) { bloquearAhora(); toast('Sesión bloqueada por inactividad', 'info'); }
    }, min * 60 * 1000);
  }
  function alCambiarVisibilidad() {
    if (document.visibilityState === 'hidden') {
      ocultoDesde = Date.now();
      return;
    }
    if (!desbloqueado) return;
    var min = minutosAutobloqueo();
    if (min && ocultoDesde && Date.now() - ocultoDesde >= min * 60 * 1000) {
      bloquearAhora();
    } else {
      reiniciarAutobloqueo();
    }
    ocultoDesde = null;
  }

  /* ---------- service worker ------------------------------------------------ */
  function registrarSW() {
    if (!location.protocol || location.protocol.indexOf('http') !== 0) return;
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function (err) {
        console.warn('No se pudo registrar el service worker:', err && err.message ? err.message : err);
      });
    });
  }

  /* ---------- arranque ------------------------------------------------------ */
  function iniciar() {
    aplicarTema(leerTemaLocal());
    var u = ui();
    if (u) {
      Array.prototype.forEach.call(document.querySelectorAll('.btn-ver'), function (b) { b.innerHTML = u.icono('ojo'); });
      var btnBloquear = $('#btn-bloquear');
      if (btnBloquear) btnBloquear.innerHTML = u.icono('bloquear');
    }

    var formCrear = $('#form-crear');
    var formDesbloquear = $('#form-desbloquear');
    if (formCrear) formCrear.addEventListener('submit', alCrear);
    if (formDesbloquear) formDesbloquear.addEventListener('submit', alDesbloquearForm);
    var campoCrear = $('#crear-contrasena');
    if (campoCrear) campoCrear.addEventListener('input', function () { actualizarFortaleza(campoCrear.value); });
    var enlaceOlvide = $('#enlace-olvide');
    if (enlaceOlvide) enlaceOlvide.addEventListener('click', alOlvide);
    document.addEventListener('click', alternarVer);

    var btnBloq = $('#btn-bloquear');
    if (btnBloq) btnBloq.addEventListener('click', function () { bloquearAhora(); });
    var btnTema = $('#btn-tema');
    if (btnTema) btnTema.addEventListener('click', alternarTema);

    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var alCambiarEsquema = function () { aplicarTema(temaActual()); };
      if (mq.addEventListener) mq.addEventListener('change', alCambiarEsquema);
      else if (mq.addListener) mq.addListener(alCambiarEsquema);
    }

    var st = store();
    if (st && typeof st.on === 'function') {
      st.on('desbloqueado', function () { if (!desbloqueado) alDesbloquear(); });
      st.on('bloqueado', alBloquear);
      st.on('cambio', function () {
        var a = ajustes();
        aplicarTema(a.tema || leerTemaLocal());
        actualizarBanner();
      });
    }

    ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
      document.addEventListener(ev, function () { if (desbloqueado) reiniciarAutobloqueo(); }, { passive: true });
    });
    document.addEventListener('visibilitychange', alCambiarVisibilidad);

    registrarSW();
    mostrarBloqueo();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();

  /**
   * VF.app.mostrarBloqueo(modo?) — muestra la pantalla de bloqueo. modo: 'crear' | 'desbloquear' | omitido
   * (elige 'crear' si no existe bóveda). Útil para módulos que borran la bóveda desde dentro de la app.
   */
  VF.app = { version: '1.0.1', bloquear: bloquearAhora, aplicarTema: aplicarTema, mostrarBloqueo: mostrarBloqueo };
})(window.VF);
