'use strict';
window.VF = window.VF || {};
/**
 * VF.util — utilidades puras: identificadores, fechas (YYYY-MM-DD local), formato es-MX,
 * escape para innerHTML, colecciones y CSV. Sin dependencias, sin DOM salvo `descargar`.
 */
(function (VF) {
  var ALFABETO36 = '0123456789abcdefghijklmnopqrstuvwxyz';
  var MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var MS_DIA = 86400000;

  var fmtMoneda = null;
  var cacheNumero = {};

  function criptoNativo() {
    return (typeof window !== 'undefined' && window.crypto) || globalThis.crypto;
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** 'prefijo_' + 10 caracteres base36 aleatorios con crypto.getRandomValues. */
  function uid(prefijo) {
    var bytes = new Uint8Array(10);
    criptoNativo().getRandomValues(bytes);
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += ALFABETO36[bytes[i] % 36];
    return (prefijo || 'id') + '_' + s;
  }

  /** Date → 'YYYY-MM-DD' en hora local. */
  function fechaISO(date) {
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** 'YYYY-MM-DD' en hora local de hoy. */
  function hoy() {
    return fechaISO(new Date());
  }

  /** 'YYYY-MM-DD' → Date local a medianoche. Inválido → Date inválida. */
  function parseFecha(iso) {
    if (iso instanceof Date) return new Date(iso.getFullYear(), iso.getMonth(), iso.getDate());
    if (typeof iso !== 'string') return new Date(NaN);
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
    if (!m) return new Date(NaN);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function sumarDias(iso, n) {
    var d = parseFecha(iso);
    d.setDate(d.getDate() + (Number(n) || 0));
    return fechaISO(d);
  }

  function inicioMes(iso) {
    var d = parseFecha(iso);
    return fechaISO(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  function finMes(iso) {
    var d = parseFecha(iso);
    return fechaISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }

  /** Lunes de la semana que contiene `iso`. */
  function inicioSemana(iso) {
    var d = parseFecha(iso);
    var desplazamiento = (d.getDay() + 6) % 7; // lunes = 0
    d.setDate(d.getDate() - desplazamiento);
    return fechaISO(d);
  }

  /** 'YYYY-MM'. */
  function periodo(iso) {
    var d = parseFecha(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  /** Días enteros entre A y B (B − A). */
  function diasEntre(isoA, isoB) {
    var a = parseFecha(isoA);
    var b = parseFecha(isoB);
    return Math.round((b.getTime() - a.getTime()) / MS_DIA);
  }

  function esNumeroValido(n) {
    return typeof n === 'number' && isFinite(n);
  }

  /** '$12,345.67' (es-MX). null/undefined/NaN → '—'. */
  function fmtMXN(n) {
    if (!esNumeroValido(n)) return '—';
    if (!fmtMoneda) {
      fmtMoneda = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
    }
    return fmtMoneda.format(round2(n));
  }

  function fmtNumero(n, dec) {
    if (!esNumeroValido(n)) return '—';
    var d = dec === undefined || dec === null ? 2 : Number(dec);
    if (!cacheNumero[d]) {
      cacheNumero[d] = new Intl.NumberFormat('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
    }
    return cacheNumero[d].format(n);
  }

  /** '25 oct 2026'. Construido a mano para que sea idéntico en Safari y Chrome. */
  function fmtFecha(iso) {
    var d = parseFecha(iso);
    if (isNaN(d.getTime())) return '—';
    return d.getDate() + ' ' + MESES_CORTOS[d.getMonth()] + ' ' + d.getFullYear();
  }

  /** 'sábado, 25 de octubre de 2026'. */
  function fmtFechaLarga(iso) {
    var d = parseFecha(iso);
    if (isNaN(d.getTime())) return '—';
    return DIAS_LARGOS[d.getDay()] + ', ' + d.getDate() + ' de ' + MESES_LARGOS[d.getMonth()] + ' de ' + d.getFullYear();
  }

  /** Redondeo a 2 decimales estable (evita 1.005 → 1). */
  function round2(n) {
    var x = Number(n);
    if (!isFinite(x)) return 0;
    var signo = x < 0 ? -1 : 1;
    return signo * Math.round((Math.abs(x) + 1e-9) * 100) / 100;
  }

  /** Acepta '1,234.50', '$1,234.50', ' 1234 ', '-250' → número; inválido → NaN. */
  function parseMonto(str) {
    if (typeof str === 'number') return isFinite(str) ? str : NaN;
    if (str === null || str === undefined) return NaN;
    var limpio = String(str)
      .replace(/\s/g, '')
      .replace(/MXN|MN|\$/gi, '')
      .replace(/,/g, '');
    if (limpio === '' || !/^-?\d+(\.\d+)?$/.test(limpio)) return NaN;
    return Number(limpio);
  }

  /** Escapa & < > " ' para insertar texto de usuario vía innerHTML. */
  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Minúsculas sin acentos, sin espacios dobles (para el asistente). */
  function normalizar(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Agrupa por clave; fn puede ser función o nombre de campo. */
  function agrupar(arr, fn) {
    var clave = typeof fn === 'function' ? fn : function (x) { return x ? x[fn] : undefined; };
    var grupos = {};
    (arr || []).forEach(function (item) {
      var k = String(clave(item));
      if (!grupos[k]) grupos[k] = [];
      grupos[k].push(item);
    });
    return grupos;
  }

  /** Suma de fn(item) (o del propio número) con round2. */
  function suma(arr, fn) {
    var total = 0;
    (arr || []).forEach(function (item) {
      var v = fn ? fn(item) : item;
      v = Number(v);
      if (isFinite(v)) total += v;
    });
    return round2(total);
  }

  /** Devuelve un arreglo NUEVO ordenado por campo (string, número o fecha ISO). */
  function ordenar(arr, campo, dir) {
    var factor = dir === 'desc' ? -1 : 1;
    var copia = (arr || []).slice();
    copia.sort(function (a, b) {
      var va = a ? a[campo] : undefined;
      var vb = b ? b[campo] : undefined;
      if (va === vb) return 0;
      if (va === undefined || va === null) return 1;
      if (vb === undefined || vb === null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
      return String(va).localeCompare(String(vb), 'es-MX', { numeric: true }) * factor;
    });
    return copia;
  }

  function debounce(fn, ms) {
    var temporizador = null;
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(temporizador);
      temporizador = setTimeout(function () {
        temporizador = null;
        fn.apply(ctx, args);
      }, ms || 250);
    };
  }

  /** Crea un Blob y lo descarga con <a download>. Sin DOM no hace nada. */
  function descargar(nombreArchivo, contenido, mime) {
    if (typeof document === 'undefined' || typeof Blob === 'undefined') return false;
    var blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo || 'archivo';
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
    return true;
  }

  function celdaCSV(valor) {
    if (valor === null || valor === undefined) return '';
    var s;
    if (typeof valor === 'number') s = isFinite(valor) ? String(valor) : '';
    else if (typeof valor === 'boolean') s = valor ? 'sí' : 'no';
    else if (Array.isArray(valor)) s = valor.join('; ');
    else s = String(valor);
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /** columnas: [{clave, titulo}] → CSV con BOM UTF-8, separador ',' y CRLF. */
  function csv(filas, columnas) {
    var cols = columnas || [];
    var lineas = [cols.map(function (c) { return celdaCSV(c.titulo || c.clave); }).join(',')];
    (filas || []).forEach(function (fila) {
      lineas.push(cols.map(function (c) {
        var v = fila ? fila[c.clave] : '';
        return celdaCSV(v);
      }).join(','));
    });
    return '﻿' + lineas.join('\r\n') + '\r\n';
  }

  VF.util = {
    uid: uid,
    hoy: hoy,
    fechaISO: fechaISO,
    parseFecha: parseFecha,
    sumarDias: sumarDias,
    inicioMes: inicioMes,
    finMes: finMes,
    inicioSemana: inicioSemana,
    periodo: periodo,
    diasEntre: diasEntre,
    fmtMXN: fmtMXN,
    fmtNumero: fmtNumero,
    fmtFecha: fmtFecha,
    fmtFechaLarga: fmtFechaLarga,
    round2: round2,
    parseMonto: parseMonto,
    esc: esc,
    normalizar: normalizar,
    agrupar: agrupar,
    suma: suma,
    ordenar: ordenar,
    debounce: debounce,
    descargar: descargar,
    csv: csv
  };
})(window.VF);
