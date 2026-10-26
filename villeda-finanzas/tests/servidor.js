'use strict';
/*
 * tests/servidor.js — servidor http estático mínimo para las pruebas E2E.
 *
 * Sirve la carpeta villeda-finanzas/ (raíz del proyecto) con los tipos MIME correctos,
 * incluido .webmanifest. Sin dependencias externas.
 *
 * Uso directo:   node tests/servidor.js [puerto]   → imprime la URL y queda escuchando (Ctrl+C para salir).
 * Como módulo:   const { iniciar } = require('./servidor');
 *                const srv = await iniciar(puerto?);   // → { url, puerto, raiz, cerrar() → Promise }
 * Puerto omitido o 0 → el sistema elige uno libre.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.py': 'text/plain; charset=utf-8'
};

function responder(res, codigo, cuerpo, tipo) {
  res.writeHead(codigo, {
    'Content-Type': tipo || 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(cuerpo),
    'Cache-Control': 'no-store'
  });
  res.end(cuerpo);
}

function manejar(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return responder(res, 405, 'Método no permitido');
  }
  let ruta;
  try {
    ruta = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    return responder(res, 400, 'Solicitud inválida');
  }
  if (ruta.endsWith('/')) ruta += 'index.html';

  // Nunca salir de la raíz del proyecto
  const archivo = path.normalize(path.join(RAIZ, ruta));
  if (archivo !== RAIZ && !archivo.startsWith(RAIZ + path.sep)) {
    return responder(res, 403, 'Prohibido');
  }

  fs.stat(archivo, function (err, info) {
    if (err || !info.isFile()) {
      if (!err && info.isDirectory()) {
        res.writeHead(301, { Location: ruta + '/' });
        return res.end();
      }
      return responder(res, 404, 'No encontrado: ' + ruta);
    }
    const tipo = MIME[path.extname(archivo).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': tipo,
      'Content-Length': info.size,
      'Cache-Control': 'no-store'
    });
    if (req.method === 'HEAD') return res.end();
    const flujo = fs.createReadStream(archivo);
    flujo.on('error', function () { res.destroy(); });
    flujo.pipe(res);
  });
}

/** Arranca el servidor. puerto 0/omitido = libre. → Promise<{ url, puerto, raiz, cerrar }> */
function iniciar(puerto) {
  return new Promise(function (resolver, rechazar) {
    const servidor = http.createServer(manejar);
    servidor.on('error', rechazar);
    servidor.listen(Number(puerto) || 0, '127.0.0.1', function () {
      const p = servidor.address().port;
      resolver({
        url: 'http://127.0.0.1:' + p + '/',
        puerto: p,
        raiz: RAIZ,
        servidor: servidor,
        cerrar: function () {
          return new Promise(function (ok) {
            servidor.closeAllConnections && servidor.closeAllConnections();
            servidor.close(function () { ok(); });
          });
        }
      });
    });
  });
}

module.exports = { iniciar: iniciar, RAIZ: RAIZ, MIME: MIME };

if (require.main === module) {
  iniciar(process.argv[2]).then(function (srv) {
    console.log('Sirviendo ' + srv.raiz);
    console.log(srv.url);
  }).catch(function (e) {
    console.error('No se pudo iniciar el servidor:', e.message);
    process.exit(1);
  });
}
