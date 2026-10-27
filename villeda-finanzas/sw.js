'use strict';
/*
 * VILLEDA Finanzas — Service Worker
 * Estrategia: cache-first para el shell de la aplicación (HTML, CSS, JS, iconos, manifest),
 * con actualización en segundo plano. No hay peticiones a terceros: todo es local.
 * Cambia VF_VERSION en cada publicación para invalidar la caché anterior.
 */
var VF_VERSION = '1.0.1';
var CACHE = 'vf-shell-' + VF_VERSION;

var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
  './js/core/util.js',
  './js/core/crypto.js',
  './js/core/store.js',
  './js/core/seed.js',
  './js/core/calc.js',
  './js/core/ui.js',
  './js/core/router.js',
  './js/modules/panel.js',
  './js/modules/empresa.js',
  './js/modules/personal.js',
  './js/modules/facturas.js',
  './js/modules/proveedores.js',
  './js/modules/prestamos.js',
  './js/modules/presupuestos.js',
  './js/modules/reportes.js',
  './js/modules/asistente.js',
  './js/modules/ajustes.js',
  './js/app.js'
];

self.addEventListener('install', function (evento) {
  evento.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // Se agrega archivo por archivo: si alguno falta, la instalación no falla.
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url).catch(function () { /* recurso no disponible; se omite */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (evento) {
  evento.waitUntil(
    caches.keys().then(function (claves) {
      return Promise.all(claves.map(function (clave) {
        if (clave.indexOf('vf-shell-') === 0 && clave !== CACHE) return caches.delete(clave);
        return Promise.resolve(false);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (evento) {
  var solicitud = evento.request;
  if (solicitud.method !== 'GET') return;

  var url = new URL(solicitud.url);
  // Sólo se atiende el propio origen; cualquier otra petición (p. ej. el servidor de IA opcional) va directo a la red.
  if (url.origin !== self.location.origin) return;

  evento.respondWith(
    caches.match(solicitud, { ignoreSearch: true }).then(function (enCache) {
      var red = fetch(solicitud).then(function (respuesta) {
        if (respuesta && respuesta.ok && respuesta.type === 'basic') {
          var copia = respuesta.clone();
          caches.open(CACHE).then(function (cache) { cache.put(solicitud, copia); });
        }
        return respuesta;
      }).catch(function () {
        // Sin red y sin caché: para navegaciones se devuelve el shell.
        if (solicitud.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'Sin conexión' });
      });
      return enCache || red;
    })
  );
});

self.addEventListener('message', function (evento) {
  if (evento.data && evento.data.tipo === 'SALTAR_ESPERA') self.skipWaiting();
});
