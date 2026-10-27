'use strict';
/*
 * js/modules/asistente.js — Asistente (#/asistente) de VILLEDA Finanzas (docs/ARQUITECTURA.md §4).
 *
 *  - Motor LOCAL de preguntas y respuestas: VF.asistente.responder(pregunta, estado) →
 *    { texto, html, intent, ambito, periodo, enlaces:[{texto, ruta}] }. Funciona sin DOM (sólo necesita
 *    VF.util y VF.calc), por eso se puede probar en Node con el seed.
 *  - Detección con VF.util.normalizar + sinónimos: ámbito (VILLEDA / empresa / negocio → empresa; personal /
 *    yo / mío → personal; sin pista → responde ambos ámbitos POR SEPARADO; sólo `disponible_total` añade el
 *    combinado informativo), periodos (hoy, ayer, esta semana, semana pasada, este mes, mes pasado, mañana,
 *    próximos N días, en N días, últimos N días, mes nombrado, este año) e intenciones:
 *    disponible_total, gastos_periodo, ingresos_periodo, por_cobrar, por_pagar, disponible_personal,
 *    vencimientos, utilidad, presupuesto, revisar, flujo, saldo_cuenta, prestamos, comisiones, metas,
 *    ayuda, desconocido.
 *  - Toda cifra sale de VF.calc; sin datos → "Sin movimientos" / "Sin cuentas", nunca ceros falsos.
 *  - Vista: chat con historial en memoria de la sesión (se borra al bloquear), chips sugeridos, campo de
 *    texto con Enter, respuestas en tarjetas (texto + tabla/lista + "Ver detalle"), aria-live.
 *  - Modo remoto: si ajustes.asistenteEndpoint tiene URL → POST JSON { pregunta, contexto:
 *    VF.calc.resumenParaIA(estado) } con tiempo límite de 15 s; si falla → motor local + nota. Nunca se
 *    envían descripciones, contrapartes ni contraseñas (resumenParaIA ya las omite).
 *
 * Convenciones: JavaScript clásico, textos en español, todo texto de usuario pasa por VF.util.esc,
 * eventos por delegación con data-accion="asistente-…" (sin handlers inline).
 */
window.VF = window.VF || {};
(function (VF) {
  if (!VF.util || !VF.calc) {
    console.error('[VF.asistente] faltan módulos del núcleo (util, calc).');
    return;
  }

  var U = VF.util;
  var C = VF.calc;
  var esc = U.esc;
  var fmt = U.fmtMXN;

  var NOMBRES = { empresa: 'Empresa', personal: 'Personal' };
  var AMBITOS = ['empresa', 'personal'];
  var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var MESES_NORM = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var NUMEROS = {
    un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
    once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50,
    sesenta: 60, noventa: 90, cien: 100
  };
  var TIPO_CUENTA = { cheques: 'Cheques', ahorro: 'Ahorro', credito: 'Tarjeta de crédito', efectivo: 'Efectivo', inversion: 'Inversión', billetera: 'Billetera digital' };
  // Palabras que no identifican a una cuenta por sí solas ("Nu Empresa" → núcleo "nu").
  var GENERICAS_CUENTA = ['empresa', 'personal', 'cuenta', 'tarjeta', 'de', 'la', 'el', 'debito', 'credito', 'ahorro', 'cheques', 'inversion', 'billetera', 'mi', 'mis'];
  var MAX_FILAS = 8;
  var DIAS_VENCIMIENTOS = 7;
  var DIAS_FLUJO = 30;
  var TIEMPO_REMOTO_MS = 15000;

  var PREGUNTAS_SUGERIDAS = [
    '¿Cuánto dinero tengo disponible entre todas mis cuentas?',
    '¿Cuánto gastó VILLEDA esta semana?',
    '¿Qué clientes todavía me deben?',
    '¿Cuánto puedo gastar personalmente sin afectar los pagos del negocio?',
    '¿Qué pagos y cobros tengo pendientes mañana?',
    '¿Cuál fue mi utilidad este mes?',
    '¿Qué movimientos debo revisar?',
    '¿Cómo voy con el presupuesto?',
    '¿Cómo se ve mi flujo a 30 días?'
  ];

  var INTENCIONES = [
    { id: 'disponible_total', descripcion: 'Dinero disponible en todas las cuentas (empresa y personal por separado, más el combinado informativo).', ejemplo: '¿Cuánto dinero tengo disponible entre todas mis cuentas?' },
    { id: 'gastos_periodo', descripcion: 'Gastos de un periodo (hoy, esta semana, este mes, mes pasado…).', ejemplo: '¿Cuánto gastó VILLEDA esta semana?' },
    { id: 'ingresos_periodo', descripcion: 'Ingresos de un periodo.', ejemplo: '¿Cuánto ingresó la empresa este mes?' },
    { id: 'por_cobrar', descripcion: 'Facturas por cobrar y clientes que deben.', ejemplo: '¿Qué clientes todavía me deben?' },
    { id: 'por_pagar', descripcion: 'Cuentas por pagar a proveedores y comisiones pendientes.', ejemplo: '¿Cuánto debo a proveedores?' },
    { id: 'disponible_personal', descripcion: 'Cuánto puedes gastar personalmente sin tocar el negocio.', ejemplo: '¿Cuánto puedo gastar personalmente sin afectar los pagos del negocio?' },
    { id: 'vencimientos', descripcion: 'Pagos y cobros programados (mañana, esta semana, próximos N días).', ejemplo: '¿Qué pagos y cobros tengo pendientes mañana?' },
    { id: 'utilidad', descripcion: 'Utilidad de la empresa en un mes.', ejemplo: '¿Cuál fue mi utilidad este mes?' },
    { id: 'presupuesto', descripcion: 'Presupuesto contra gasto real del mes.', ejemplo: '¿Cómo voy con el presupuesto?' },
    { id: 'revisar', descripcion: 'Movimientos duplicados, atípicos, marcados o sin categoría.', ejemplo: '¿Qué movimientos debo revisar?' },
    { id: 'flujo', descripcion: 'Flujo de efectivo proyectado a N días.', ejemplo: '¿Cómo se ve mi flujo a 30 días?' },
    { id: 'saldo_cuenta', descripcion: 'Saldo de una cuenta o tarjeta por su nombre o banco.', ejemplo: '¿Cuánto hay en Nu?' },
    { id: 'prestamos', descripcion: 'Préstamos y deudas: saldo, pago mensual y próximo pago.', ejemplo: '¿Cuánto debo de préstamos?' },
    { id: 'comisiones', descripcion: 'Comisiones pendientes de pago.', ejemplo: '¿Qué comisiones debo pagar?' },
    { id: 'metas', descripcion: 'Avance de metas de ahorro.', ejemplo: '¿Cómo van mis metas de ahorro?' },
    { id: 'ayuda', descripcion: 'Qué puede responder el asistente.', ejemplo: '¿Qué puedes hacer?' },
    { id: 'desconocido', descripcion: 'No se reconoció la pregunta.', ejemplo: '' }
  ];

  /* ======================================================================
   * Auxiliares generales
   * ==================================================================== */
  function hoy() { return C.hoy(); }
  function capitalizar(s) { s = String(s == null ? '' : s); return s.charAt(0).toUpperCase() + s.slice(1); }
  function plural(n, singular, pluralTexto) { return n + ' ' + (n === 1 ? singular : (pluralTexto || singular + 's')); }
  function mesLargo(periodo) {
    var p = String(periodo || '').split('-');
    return (MESES_LARGOS[Number(p[1]) - 1] || '') + ' ' + (p[0] || '');
  }
  function listaDe(estado, coleccion) { return (estado && Array.isArray(estado[coleccion])) ? estado[coleccion] : []; }
  function buscar(arr, id) {
    arr = arr || [];
    for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) return arr[i];
    return null;
  }
  function ambitosDe(ambito) { return NOMBRES[ambito] ? [ambito] : AMBITOS.slice(); }
  function nombreEmpresa(estado) {
    return (estado && estado.ajustes && estado.ajustes.nombreEmpresa) || 'la empresa';
  }
  function fechaRel(iso) {
    var d = U.diasEntre(hoy(), iso);
    if (d === 0) return 'hoy';
    if (d === 1) return 'mañana';
    if (d === -1) return 'ayer';
    if (d > 1 && d < 15) return 'en ' + d + ' días';
    if (d < -1 && d > -15) return 'hace ' + (-d) + ' días';
    return U.fmtFecha(iso);
  }
  function fechaCorta(iso) { return U.fmtFecha(iso).replace(/ \d{4}$/, ''); }
  function rangoTexto(desde, hasta) {
    if (desde === hasta) return U.fmtFecha(desde);
    return fechaCorta(desde) + ' – ' + U.fmtFecha(hasta);
  }

  /** Texto de la pregunta normalizado: minúsculas, sin acentos ni signos, espacios simples. */
  function limpiar(pregunta) {
    return U.normalizar(pregunta).replace(/[¿?¡!.,;:()"'«»“”]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function tiene(n, re) { return re.test(n); }
  function numeroEn(texto) {
    var m = /\b(\d{1,3})\b/.exec(texto);
    if (m) return Number(m[1]);
    var partes = String(texto || '').split(' ');
    var total = 0;
    var hallado = false;
    partes.forEach(function (p) { if (NUMEROS[p] != null) { total += NUMEROS[p]; hallado = true; } });
    return hallado ? total : null;
  }

  /* ======================================================================
   * HTML (sin VF.ui, para que el motor funcione también en Node)
   * ==================================================================== */
  function badge(ambito) { return '<span class="badge badge-' + esc(ambito) + '">' + esc(NOMBRES[ambito] || ambito) + '</span>'; }
  function badgeEstado(texto, tono) { return '<span class="badge badge-' + esc(tono || 'info') + '">' + esc(texto) + '</span>'; }
  function parrafo(texto, clase) { return '<p class="' + esc(clase || 'asistente-texto') + '">' + esc(texto) + '</p>'; }
  function nota(texto) { return '<p class="asistente-nota texto-3">' + esc(texto) + '</p>'; }
  function titulo(html) { return '<h3 class="asistente-subtitulo">' + html + '</h3>'; }
  function filaKV(etiqueta, valor, clase) {
    return '<div class="fila-entre asistente-kv"><span class="texto-2">' + esc(etiqueta) + '</span>' +
      '<strong class="cifra ' + esc(clase || '') + '">' + esc(valor) + '</strong></div>';
  }
  /** Tabla compacta. columnas: [{titulo, clave, num, render(valor, fila)}]; filas: objetos. */
  function tabla(columnas, filas) {
    if (!filas || !filas.length) return '';
    var html = '<div class="tabla-envoltura asistente-tabla-env"><table class="tabla asistente-tabla"><thead><tr>';
    columnas.forEach(function (c) { html += '<th scope="col"' + (c.num ? ' class="num"' : '') + '>' + esc(c.titulo) + '</th>'; });
    html += '</tr></thead><tbody>';
    filas.forEach(function (f) {
      html += '<tr>';
      columnas.forEach(function (c) {
        var v = f[c.clave];
        html += '<td' + (c.num ? ' class="num"' : '') + '>' + (c.render ? c.render(v, f) : esc(v == null ? '' : v)) + '</td>';
      });
      html += '</tr>';
    });
    return html + '</tbody></table></div>';
  }
  /** Lista compacta. items: [{titulo, sub (html ya escapado o texto via esc), valor, tono}] */
  function listaHtml(items) {
    if (!items || !items.length) return '';
    var html = '<ul class="asistente-lista">';
    items.forEach(function (it) {
      html += '<li class="asistente-item"><div class="asistente-item-texto"><span class="asistente-item-titulo">' + esc(it.titulo) + '</span>' +
        (it.sub ? '<span class="asistente-item-sub">' + it.sub + '</span>' : '') + '</div>' +
        (it.valor != null ? '<strong class="cifra asistente-item-valor ' + esc(it.tono || '') + '">' + esc(it.valor) + '</strong>' : '') + '</li>';
    });
    return html + '</ul>';
  }
  function seccion(ambito, cuerpo) {
    return '<section class="asistente-seccion" data-ambito="' + esc(ambito) + '">' + titulo(badge(ambito)) + cuerpo + '</section>';
  }
  function mas(n, singular, pluralTexto) { return n > 0 ? nota('… y ' + plural(n, singular || 'más', pluralTexto || singular || 'más')) : ''; }
  function enlace(texto, ruta) { return { texto: texto, ruta: ruta }; }
  function respuesta(intent, ambito, texto, html, enlaces, periodo) {
    return { intent: intent, ambito: ambito || null, texto: texto, html: html || parrafo(texto), enlaces: enlaces || [], periodo: periodo || null };
  }

  /* ======================================================================
   * Detección de periodo
   * ==================================================================== */
  function per(clave, etiqueta, desde, hasta, futuro, dias) {
    return {
      clave: clave, etiqueta: etiqueta, desde: desde, hasta: hasta, futuro: !!futuro,
      dias: dias == null ? U.diasEntre(desde, hasta) : dias, periodo: U.periodo(desde),
      esMes: clave === 'este_mes' || clave === 'mes_pasado' || clave === 'mes_nombrado' || clave === 'mes_proximo'
    };
  }
  function rangoSemana(iso) { var d = U.inicioSemana(iso); return { desde: d, hasta: U.sumarDias(d, 6) }; }
  function mesRelativo(iso, k) { var f = U.parseFecha(iso); return U.fechaISO(new Date(f.getFullYear(), f.getMonth() + k, 1)); }

  /** Devuelve el periodo mencionado en la pregunta o null. */
  function detectarPeriodo(n) {
    var h = hoy();
    var m, k, r;
    m = /\b(?:proximos?|siguientes?|en(?: los| las)?|dentro de|durante(?: los)?|a|para los|para las|los proximos|las proximas)\s+((?:\d{1,3})|[a-z]+(?: y [a-z]+)?)\s+(dias?|semanas?)\b/.exec(n);
    if (m) {
      k = numeroEn(m[1]);
      if (k) {
        if (/^semana/.test(m[2])) k = k * 7;
        return per('dias_futuro', 'los próximos ' + k + ' días', h, U.sumarDias(h, k), true, k);
      }
    }
    m = /\b(?:ultimos?|ultimas?|pasados|anteriores)\s+((?:\d{1,3})|[a-z]+(?: y [a-z]+)?)\s+(dias?|semanas?)\b/.exec(n);
    if (m) {
      k = numeroEn(m[1]);
      if (k) {
        if (/^semana/.test(m[2])) k = k * 7;
        return per('dias_pasado', 'los últimos ' + k + ' días', U.sumarDias(h, -k), h, false, k);
      }
    }
    if (tiene(n, /\bpasado manana\b/)) return per('pasado_manana', 'pasado mañana', U.sumarDias(h, 2), U.sumarDias(h, 2), true, 2);
    if (tiene(n, /\bmanana\b/)) return per('manana', 'mañana', U.sumarDias(h, 1), U.sumarDias(h, 1), true, 1);
    if (tiene(n, /\bhoy\b/)) return per('hoy', 'hoy', h, h, false, 0);
    if (tiene(n, /\bayer\b/)) return per('ayer', 'ayer', U.sumarDias(h, -1), U.sumarDias(h, -1), false, 1);
    if (tiene(n, /\bsemana\b/)) {
      if (tiene(n, /\b(pasada|anterior|antepasada)\b/)) {
        r = rangoSemana(U.sumarDias(U.inicioSemana(h), -7));
        return per('semana_pasada', 'la semana pasada', r.desde, r.hasta, false, 6);
      }
      if (tiene(n, /\b(proxima|siguiente|que viene|entrante|que entra)\b/)) {
        r = rangoSemana(U.sumarDias(U.inicioSemana(h), 7));
        return per('semana_proxima', 'la próxima semana', r.desde, r.hasta, true, U.diasEntre(h, r.hasta));
      }
      r = rangoSemana(h);
      return per('esta_semana', 'esta semana', r.desde, r.hasta, false, 6);
    }
    if (tiene(n, /\bquincena\b/)) return per('dias_pasado', 'los últimos 15 días', U.sumarDias(h, -15), h, false, 15);
    if (tiene(n, /\bmes\b/)) {
      if (tiene(n, /\b(pasado|anterior|antepasado)\b/)) {
        var mp = mesRelativo(h, -1);
        return per('mes_pasado', 'el mes pasado (' + mesLargo(U.periodo(mp)) + ')', mp, U.finMes(mp), false);
      }
      if (tiene(n, /\b(proximo|siguiente|que viene|entrante|que entra)\b/)) {
        var mx = mesRelativo(h, 1);
        return per('mes_proximo', 'el próximo mes (' + mesLargo(U.periodo(mx)) + ')', mx, U.finMes(mx), true, U.diasEntre(h, U.finMes(mx)));
      }
      return per('este_mes', 'este mes (' + mesLargo(U.periodo(h)) + ')', U.inicioMes(h), U.finMes(h), false);
    }
    for (var i = 0; i < MESES_NORM.length; i++) {
      if (tiene(n, new RegExp('\\b' + MESES_NORM[i] + '\\b'))) {
        var f = U.parseFecha(h);
        var anio = f.getFullYear();
        var mAnio = /\b(20\d{2})\b/.exec(n);
        if (mAnio) anio = Number(mAnio[1]);
        else if (i > f.getMonth()) anio -= 1;
        var ini = U.fechaISO(new Date(anio, i, 1));
        return per('mes_nombrado', MESES_LARGOS[i] + ' ' + anio, ini, U.finMes(ini), ini > h);
      }
    }
    if (tiene(n, /\bano\b|\banual\b/)) {
      var fa = U.parseFecha(h);
      var y = fa.getFullYear();
      if (tiene(n, /\b(pasado|anterior)\b/)) y -= 1;
      return per('anio', (y === fa.getFullYear() ? 'este año' : 'el año') + ' ' + y, y + '-01-01', y + '-12-31', false);
    }
    return null;
  }

  /* ======================================================================
   * Detección de ámbito e intención
   * ==================================================================== */
  var RE_EMPRESA = /\b(villeda|empresa|empresarial|empresariales|negocio|negocios|despacho|compania|firma|oficina|corporativ[oa]|comercial)\b/;
  var RE_PERSONAL = /\b(personal|personales|personalmente|yo|mio|mia|mios|mias|propio|propia|familia|familiar|familiares|casa|hogar|bolsillo)\b/;

  /** 'empresa' | 'personal' | null (sin pista o con pistas de ambos). */
  function detectarAmbito(n) {
    var emp = tiene(n, RE_EMPRESA);
    var pers = tiene(n, RE_PERSONAL);
    if (emp && !pers) return 'empresa';
    if (pers && !emp) return 'personal';
    return null;
  }

  var RE = {
    ayuda: /\b(ayuda|ayudame|que puedes|que sabes|que haces|como funciona|como funcionas|opciones|que te puedo preguntar|que preguntas|instrucciones|comandos|hola|buenos dias|buenas tardes|buenas noches|quien eres|que eres)\b/,
    gastar: /\b(gastar|gastarme|disponer|darme el lujo|me alcanza|sin afectar|sin tocar|puedo usar)\b/,
    revisar: /\b(revisar|revision|revise|revisa|duplicad[oa]s?|repetid[oa]s?|atipic[oa]s?|rar[oa]s?|sospechos[oa]s?|extran[oa]s?|anomalias?|inconsistencias?|checar|verificar|sin categoria|alertas?|irregular\w*)\b/,
    presupuesto: /\b(presupuest\w*|como voy|voy bien|me pase|me excedi|excedid[oa]s?|exced\w*|limite de gasto|tope de gasto)\b/,
    flujo: /\b(flujo|proyeccion|proyectad[oa]|pronostico|como se ve|como se vera|como pinta|caja proyectada|liquidez futura|saldo proyectado|tendencia|como voy a estar|como voy a quedar)\b/,
    utilidad: /\b(utilidad|utilidades|balance|balances|ganancia|ganancias|gane|ganamos|ganado|margen|resultado|resultados|rentabilidad|rentable|beneficio|beneficios|perdida|perdidas|perdi|perdimos|estado de resultados)\b/,
    comisiones: /\b(comision|comisiones|comisionista|comisionistas|vendedor|vendedores|referid[oa]s?)\b/,
    metas: /\b(meta|metas|ahorro|ahorros|ahorrar|ahorrado|ahorrando|fondo de emergencia|objetivo de ahorro|viaje)\b/,
    prestamos: /\b(prestamo|prestamos|credito|creditos|deuda|deudas|endeudad[oa]|financiamiento|hipoteca|automotriz|pyme|amortizacion|me prestaron|preste|prestado|prestados)\b/,
    porCobrar: /\b(me deben|deben|adeudan|adeuda|por cobrar|cobrar|cobrarle|cartera|clientes?|facturas?|cxc|cobranza|moros[oa]s?|me pagan|me paguen|quien me debe)\b/,
    porPagar: /\b(debo|debemos|adeudo|adeudamos|por pagar|proveedor|proveedores|cxp|le debo|les debo|pasivos?|facturas de proveedores)\b/,
    vencimientos: /\b(vence|vencen|vencimientos?|vencid[oa]s?|agenda|calendario|programad[oa]s?|proximos? (?:pagos?|cobros?)|pagos y cobros|cobros y pagos|que (?:pago|pagos|cobro|cobros)|me toca|compromisos?|pendientes?|tengo que pagar|debo pagar|toca pagar|por vencer)\b/,
    pagoCobro: /\b(pag\w*|cobr\w*|compromisos?|vencimientos?)\b/,
    gastos: /\b(gasto|gastos|gaste|gastamos|gastaste|gastaron|gastado|egreso|egresos|salidas|pague|pagamos|pagado|desembols\w*|consumo|consumos|se fue|se gasto|cuanto salio|erogaci\w*)\b/,
    ingresos: /\b(ingreso|ingresos|ingresaron|ingresamos|entro|entraron|entrada|entradas|cobre|cobramos|cobrado|vendi|vendimos|venta|ventas|facture|facturamos|facturado|facturacion|recibi|recibimos|percib\w*)\b/,
    disponible: /\b(disponible|disponibles|tengo|tenemos|dinero|lana|varo|feria|billete|saldo|saldos|liquidez|liquido|efectivo|total|totales|patrimonio|cuanto hay|capital|fondos|recursos|cuentas|cuanto traigo|traigo)\b/,
    tarjeta: /\btarjetas?\b/,
    saldoCue: /\b(saldo|saldos|cuanto|hay|tengo|tenemos|queda|quedan|tiene|dinero|lana|debo|deuda|disponible)\b/
  };

  /** Núcleo del nombre de una cuenta: tokens no genéricos ("Nu Empresa" → ["nu"]). */
  function nucleoCuenta(cuenta) {
    var tokens = U.normalizar(cuenta.nombre || '').split(' ').filter(function (t) { return t && GENERICAS_CUENTA.indexOf(t) < 0; });
    return tokens;
  }
  function contieneFrase(n, frase) {
    if (!frase) return false;
    return new RegExp('\\b' + frase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(n);
  }

  /** Cuentas mencionadas en la pregunta (por nombre completo, núcleo del nombre o banco). */
  function cuentasMencionadas(n, estado) {
    var candidatas = [];
    listaDe(estado, 'cuentas').forEach(function (c) {
      if (!c) return;
      var puntos = 0;
      var nombre = U.normalizar(c.nombre || '');
      if (nombre && contieneFrase(n, nombre)) puntos = 3;
      else {
        var nucleo = nucleoCuenta(c);
        if (nucleo.length && contieneFrase(n, nucleo.join(' '))) puntos = 2;
        var banco = U.normalizar(c.banco || '');
        if (!puntos && banco && contieneFrase(n, banco)) puntos = 2;
      }
      if (puntos) candidatas.push({ cuenta: c, puntos: puntos, tokens: puntos === 3 ? nombre.split(' ').length : nucleoCuenta(c).length });
    });
    if (!candidatas.length) return [];
    // "nu empresa" (nombre completo, 2 tokens) descarta a "Nu Cuenta" (núcleo "nu", 1 token); "mercado pago" (2) no
    // descarta a "Mercado Pago Empresa" (núcleo "mercado pago", 2): la mención es ambigua y se muestran ambas.
    var completas = candidatas.filter(function (x) { return x.puntos === 3; });
    var maxTokens = completas.length ? Math.max.apply(null, completas.map(function (x) { return x.tokens; })) : 0;
    var lista = candidatas.filter(function (x) { return x.puntos === 3 || x.tokens >= maxTokens; }).map(function (x) { return x.cuenta; });
    if (tiene(n, RE.tarjeta)) {
      var tarjetas = lista.filter(function (c) { return c.tipo === 'credito'; });
      if (tarjetas.length) lista = tarjetas;
    }
    return lista;
  }

  /** Devuelve { intent, cuentas?, tipoVenc? }. */
  function detectarIntent(n, estado, ambito, periodo) {
    var futuro = !!(periodo && periodo.futuro);
    if (!n) return { intent: 'ayuda' };
    if (tiene(n, RE.ayuda) && !tiene(n, RE.gastos) && !tiene(n, RE.ingresos) && !tiene(n, /\b(saldo|deben|debo|utilidad|presupuesto|flujo)\b/)) return { intent: 'ayuda' };

    var cuentas = cuentasMencionadas(n, estado);
    if (cuentas.length && tiene(n, RE.saldoCue) && !tiene(n, RE.gastos) && !tiene(n, RE.ingresos)) return { intent: 'saldo_cuenta', cuentas: cuentas };
    if (tiene(n, RE.tarjeta) && !tiene(n, RE.gastos) && !tiene(n, RE.ingresos) && !tiene(n, RE.presupuesto)) {
      return { intent: 'saldo_cuenta', cuentas: listaDe(estado, 'cuentas').filter(function (c) { return c && c.tipo === 'credito' && (!ambito || c.ambito === ambito); }), tarjetas: true };
    }

    if (tiene(n, RE.gastar) || (tiene(n, /\bdisponible\b/) && ambito === 'personal')) {
      return { intent: ambito === 'empresa' ? 'disponible_total' : 'disponible_personal' };
    }
    if (tiene(n, RE.revisar)) return { intent: 'revisar' };
    if (tiene(n, RE.presupuesto)) return { intent: 'presupuesto' };
    if (tiene(n, RE.flujo)) return { intent: 'flujo' };
    if (tiene(n, RE.utilidad)) return { intent: 'utilidad' };
    if (tiene(n, RE.comisiones)) return { intent: 'comisiones' };
    if (tiene(n, RE.metas)) return { intent: 'metas' };
    if (tiene(n, RE.prestamos)) return { intent: 'prestamos' };
    if (!futuro && tiene(n, RE.porCobrar)) return { intent: 'por_cobrar' };
    if (!futuro && tiene(n, RE.porPagar) && !tiene(n, /\b(tengo que pagar|debo pagar)\b/)) return { intent: 'por_pagar' };
    if (tiene(n, RE.vencimientos) || (futuro && tiene(n, RE.pagoCobro))) {
      var hayPago = tiene(n, /\b(pag\w*|debo)\b/);
      var hayCobro = tiene(n, /\bcobr\w*\b/);
      return { intent: 'vencimientos', tipoVenc: hayPago && !hayCobro ? 'pago' : (hayCobro && !hayPago ? 'cobro' : null) };
    }
    if (tiene(n, RE.gastos)) return { intent: 'gastos_periodo' };
    if (tiene(n, RE.ingresos)) return { intent: 'ingresos_periodo' };
    if (tiene(n, RE.disponible)) return { intent: 'disponible_total' };
    return { intent: 'desconocido' };
  }

  /* ======================================================================
   * Manejadores de intención (todas las cifras salen de VF.calc)
   * ==================================================================== */
  function sinCuentas(estado) { return !listaDe(estado, 'cuentas').length; }
  function cuentasActivas(estado, ambito) {
    return listaDe(estado, 'cuentas').filter(function (c) { return c && c.ambito === ambito && c.activa !== false; });
  }
  /** "Banco · Tipo" sin repetir cuando coinciden (p. ej. Caja chica: Efectivo). */
  function descripcionCuenta(c) {
    var tipo = TIPO_CUENTA[c.tipo] || c.tipo || '';
    var banco = c.banco || '';
    if (!banco || U.normalizar(banco) === U.normalizar(tipo)) return tipo || banco;
    return banco + ' · ' + tipo;
  }
  function itemCuenta(estado, x) {
    var c = x.cuenta;
    return {
      titulo: c.nombre || 'Cuenta',
      sub: esc(descripcionCuenta(c)),
      valor: fmt(x.saldo),
      tono: x.saldo < 0 ? 'negativo' : ''
    };
  }

  // ---- disponible_total ------------------------------------------------
  function rDisponibleTotal(estado, ambito) {
    if (sinCuentas(estado)) {
      return respuesta('disponible_total', ambito, 'Aún no hay cuentas registradas, así que no puedo calcular tu disponible. Crea tus cuentas en Empresa y Personal.',
        null, [enlace('Crear cuenta de empresa', 'empresa'), enlace('Crear cuenta personal', 'personal')]);
    }
    var ambitos = ambitosDe(ambito);
    var html = '';
    var partes = [];
    var enlaces = [];
    ambitos.forEach(function (a) {
      var s = C.saldosPorAmbito(estado, a);
      var d = a === 'empresa' ? C.disponibleEmpresa(estado) : C.disponiblePersonal(estado);
      var cuerpo;
      if (!s.cuentas.length) {
        cuerpo = parrafo('Sin cuentas activas en ' + NOMBRES[a].toLowerCase() + '.');
        partes.push(NOMBRES[a] + ': sin cuentas activas');
      } else {
        cuerpo = filaKV('Líquido en ' + plural(s.cuentas.filter(function (x) { return x.cuenta.tipo !== 'credito'; }).length, 'cuenta'), fmt(s.liquido)) +
          (s.credito !== 0 ? filaKV('Tarjetas (deuda)', fmt(s.credito), 'negativo') : '') +
          filaKV('Compromisos a ' + d.dias + ' días (' + d.compromisos.length + ')', fmt(d.totalCompromisos), d.totalCompromisos > 0 ? 'negativo' : '') +
          filaKV('Disponible real', fmt(d.disponible), d.disponible < 0 ? 'negativo' : 'positivo') +
          listaHtml(s.cuentas.map(function (x) { return itemCuenta(estado, x); }));
        partes.push(NOMBRES[a] + ': líquido ' + fmt(s.liquido) + ' en ' + plural(s.cuentas.length, 'cuenta') +
          (s.credito !== 0 ? ' (tarjetas ' + fmt(s.credito) + ')' : '') + '; disponible real ' + fmt(d.disponible) + ' tras ' + fmt(d.totalCompromisos) + ' de compromisos a ' + d.dias + ' días');
      }
      html += seccion(a, cuerpo);
      enlaces.push(enlace('Ver ' + NOMBRES[a].toLowerCase(), a));
    });
    var texto;
    if (ambitos.length === 2) {
      var comb = C.combinado(estado).combinadoInformativo;
      html += '<section class="asistente-seccion asistente-combinado">' + titulo(badgeEstado('Total combinado (solo informativo)', 'combinado')) +
        filaKV('Líquido combinado', fmt(comb.liquido)) + (comb.credito !== 0 ? filaKV('Tarjetas (deuda)', fmt(comb.credito), 'negativo') : '') + filaKV('Total', fmt(comb.total)) +
        nota('Empresa y personal se calculan por separado; esta suma es sólo una referencia y no se usa en ningún otro cálculo.') + '</section>';
      texto = partes.join('. ') + '. Total combinado (solo informativo): líquido ' + fmt(comb.liquido) + ', total con tarjetas ' + fmt(comb.total) + '.';
      enlaces.push(enlace('Panel combinado', 'panel?ambito=combinado'));
    } else {
      texto = partes.join('. ') + '.';
    }
    return respuesta('disponible_total', ambito, texto, html, enlaces);
  }

  // ---- gastos_periodo / ingresos_periodo -------------------------------
  /** Periodo de referencia cuando el pedido no tiene movimientos (p. ej. "esta semana" en lunes). */
  function referenciasPeriodo(p) {
    var h = hoy();
    var refs = [];
    if (p.clave === 'este_mes') { var mp = mesRelativo(h, -1); refs.push({ etiqueta: 'el mes pasado (' + mesLargo(U.periodo(mp)) + ')', desde: mp, hasta: U.finMes(mp) }); }
    if (p.dias <= 7) refs.push({ etiqueta: 'los últimos 7 días', desde: U.sumarDias(h, -7), hasta: h });
    refs.push({ etiqueta: 'los últimos 30 días', desde: U.sumarDias(h, -30), hasta: h });
    return refs;
  }
  function rPeriodo(tipo, estado, ambito, periodo) {
    var p = periodo || per('este_mes', 'este mes (' + mesLargo(U.periodo(hoy())) + ')', U.inicioMes(hoy()), U.finMes(hoy()), false);
    var esGasto = tipo === 'gasto';
    var intent = esGasto ? 'gastos_periodo' : 'ingresos_periodo';
    if (sinCuentas(estado) && !listaDe(estado, 'movimientos').length) {
      return respuesta(intent, ambito, 'Sin movimientos registrados todavía.', null, [enlace('Ir al panel', 'panel')], p);
    }
    var html = '';
    var partes = [];
    var enlaces = [];
    ambitosDe(ambito).forEach(function (a) {
      var movs = C.movimientosEn(estado, a, p.desde, p.hasta, { tipo: tipo });
      var total = esGasto ? C.gastos(estado, a, p.desde, p.hasta) : C.ingresos(estado, a, p.desde, p.hasta);
      var quien = a === 'empresa' ? nombreEmpresa(estado) : 'tú (personal)';
      var cuerpo;
      if (!movs.length) {
        cuerpo = parrafo('Sin ' + (esGasto ? 'gastos' : 'ingresos') + ' de ' + NOMBRES[a].toLowerCase() + ' ' + p.etiqueta + ' (' + rangoTexto(p.desde, p.hasta) + ').');
        var textoA = NOMBRES[a] + ': sin ' + (esGasto ? 'gastos' : 'ingresos') + ' ' + p.etiqueta;
        // Referencia etiquetada (nunca se presenta como el periodo pedido): últimos 7 días, mes pasado o últimos 30 días.
        var ref = null;
        var movsRef = [];
        referenciasPeriodo(p).some(function (cand) {
          var mv = C.movimientosEn(estado, a, cand.desde, cand.hasta, { tipo: tipo });
          if (mv.length) { ref = cand; movsRef = mv; return true; }
          return false;
        });
        if (ref) {
          var totalRef = esGasto ? C.gastos(estado, a, ref.desde, ref.hasta) : C.ingresos(estado, a, ref.desde, ref.hasta);
          cuerpo += filaKV('Referencia: ' + (esGasto ? 'gastos ' : 'ingresos ') + ref.etiqueta, fmt(totalRef), esGasto ? 'negativo' : 'positivo') +
            nota('Como referencia, en ' + ref.etiqueta + ' (' + rangoTexto(ref.desde, ref.hasta) + ') hubo ' + plural(movsRef.length, 'movimiento') + '.');
          textoA += ' (como referencia, ' + ref.etiqueta + ': ' + fmt(totalRef) + ' en ' + plural(movsRef.length, 'movimiento') + ')';
        }
        partes.push(textoA);
      } else {
        var cats = (esGasto ? C.gastosPorCategoria : C.ingresosPorCategoria)(estado, a, p.desde, p.hasta);
        cuerpo = filaKV((esGasto ? 'Gastos ' : 'Ingresos ') + p.etiqueta, fmt(total), esGasto ? 'negativo' : 'positivo') +
          filaKV('Movimientos', String(movs.length)) +
          tabla([
            { titulo: 'Categoría', clave: 'categoria' },
            { titulo: 'Monto', clave: 'monto', num: true, render: function (v) { return esc(fmt(v)); } },
            { titulo: '%', clave: 'porcentaje', num: true, render: function (v) { return esc(U.fmtNumero(v, 0) + ' %'); } }
          ], cats.slice(0, 5)) + mas(cats.length - 5, 'categorías más', 'categorías más');
        partes.push(capitalizar(quien) + (esGasto ? ' gastó ' : ' ingresó ') + fmt(total) + ' ' + p.etiqueta + ' (' + rangoTexto(p.desde, p.hasta) + ', ' + plural(movs.length, 'movimiento') + ')' +
          (cats.length ? '; principal: ' + cats[0].categoria + ' ' + fmt(cats[0].monto) : ''));
      }
      html += seccion(a, cuerpo);
      enlaces.push(enlace('Ver movimientos de ' + NOMBRES[a].toLowerCase(), a));
    });
    if (!ambito) html += nota('Empresa y personal se muestran por separado; no se suman.');
    enlaces.push(enlace('Reportes', 'reportes'));
    return respuesta(intent, ambito, partes.join('. ') + '.', html, enlaces, p);
  }

  // ---- por_cobrar --------------------------------------------------------
  function prestamosDe(estado, ambito, tipo) {
    return listaDe(estado, 'prestamos').filter(function (p) {
      return p && p.estado === 'activo' && p.ambito === ambito && (!tipo || p.tipo === tipo) && C.saldoPrestamo(p) > 0;
    });
  }
  function itemPrestamo(p) {
    var prox = C.proximoPagoPrestamo(p, hoy());
    return {
      titulo: (p.tipo === 'otorgado' ? 'Te debe: ' : 'Debes a: ') + (p.contraparte || 'Sin contraparte'),
      sub: esc('Saldo ' + fmt(C.saldoPrestamo(p)) + ' · pago mensual ' + fmt(C.pagoMensual(p)) +
        (prox ? ' · próximo ' + fechaRel(prox.fecha) + ' (' + fmt(prox.monto) + ')' : '')),
      valor: fmt(C.saldoPrestamo(p)),
      tono: p.tipo === 'otorgado' ? 'positivo' : 'negativo'
    };
  }
  function rPorCobrar(estado, ambito, n) {
    var html = '';
    var partes = [];
    var enlaces = [];
    var soloVencidas = tiene(n || '', /\bvencid[oa]s?\b/);
    if (ambito !== 'personal') {
      var pc = C.porCobrar(estado);
      var facturas = soloVencidas ? pc.facturas.filter(function (x) { return x.vencida; }) : pc.facturas;
      var cuerpo;
      if (!facturas.length) {
        cuerpo = parrafo(soloVencidas ? 'No hay facturas vencidas por cobrar.' : 'No hay facturas pendientes de cobro.');
        partes.push(soloVencidas ? 'Empresa: sin facturas vencidas' : 'Empresa: nadie te debe facturas pendientes');
      } else {
        var porCliente = pc.porCliente.map(function (c) {
          var fs = soloVencidas ? c.facturas.filter(function (x) { return x.vencida; }) : c.facturas;
          return { cliente: c.cliente ? c.cliente.nombre : 'Cliente eliminado', clienteId: c.clienteId, n: fs.length, vencido: U.suma(fs.filter(function (x) { return x.vencida; }), function (x) { return x.pendiente; }), total: U.suma(fs, function (x) { return x.pendiente; }) };
        }).filter(function (c) { return c.n > 0; });
        var totalMostrado = soloVencidas ? pc.vencido : pc.total;
        cuerpo = filaKV(soloVencidas ? 'Vencido por cobrar' : 'Por cobrar', fmt(totalMostrado), 'positivo') +
          (!soloVencidas ? filaKV('De eso, vencido', fmt(pc.vencido), pc.vencido > 0 ? 'negativo' : '') : '') +
          tabla([
            { titulo: 'Cliente', clave: 'cliente', render: function (v, f) { return esc(v) + (f.vencido > 0 ? ' ' + badgeEstado('Vencido ' + fmt(f.vencido), 'negativo') : ''); } },
            { titulo: 'Facturas', clave: 'n', num: true },
            { titulo: 'Pendiente', clave: 'total', num: true, render: function (v) { return esc(fmt(v)); } }
          ], porCliente.slice(0, MAX_FILAS)) + mas(porCliente.length - MAX_FILAS, 'clientes más', 'clientes más');
        partes.push('Te deben ' + fmt(totalMostrado) + ' en ' + plural(facturas.length, 'factura') + ' de ' + plural(porCliente.length, 'cliente') +
          (pc.vencido > 0 ? '; ' + fmt(pc.vencido) + ' ya está vencido' : '; nada vencido') +
          '. Principales: ' + porCliente.slice(0, 3).map(function (c) { return c.cliente + ' ' + fmt(c.total); }).join(', '));
      }
      html += seccion('empresa', cuerpo);
      enlaces.push(enlace('Ver cobros', 'cobros'));
    }
    AMBITOS.forEach(function (a) {
      if (ambito && ambito !== a) return;
      var otorgados = prestamosDe(estado, a, 'otorgado');
      if (!otorgados.length) {
        if (a === 'personal' && ambito === 'personal') {
          html += seccion('personal', parrafo('No tienes préstamos otorgados pendientes de cobro. Las facturas por cobrar pertenecen a la empresa.'));
          partes.push('Personal: nadie te debe préstamos');
        }
        return;
      }
      var saldo = U.suma(otorgados, function (p) { return C.saldoPrestamo(p); });
      html += seccion(a, titulo(esc('Préstamos otorgados')) + listaHtml(otorgados.map(itemPrestamo)));
      partes.push(NOMBRES[a] + ': te deben ' + fmt(saldo) + ' por ' + plural(otorgados.length, 'préstamo otorgado', 'préstamos otorgados'));
      enlaces.push(enlace('Ver préstamos', 'prestamos'));
    });
    return respuesta('por_cobrar', ambito, partes.join('. ') + '.', html, enlaces);
  }

  // ---- por_pagar ---------------------------------------------------------
  function rPorPagar(estado, ambito, n) {
    var html = '';
    var partes = [];
    var enlaces = [];
    var soloVencidas = tiene(n || '', /\bvencid[oa]s?\b/);
    if (ambito !== 'personal') {
      var pp = C.porPagar(estado);
      var com = C.comisionesPendientes(estado);
      var cuentas = soloVencidas ? pp.cuentas.filter(function (x) { return x.vencida; }) : pp.cuentas;
      var cuerpo;
      if (!cuentas.length && !com.lista.length) {
        cuerpo = parrafo(soloVencidas ? 'No hay cuentas por pagar vencidas.' : 'No hay cuentas por pagar ni comisiones pendientes.');
        partes.push('Empresa: nada pendiente de pago a proveedores');
      } else {
        var porProv = pp.porProveedor.map(function (g) {
          var cs = soloVencidas ? g.cuentas.filter(function (x) { return x.vencida; }) : g.cuentas;
          return { proveedor: g.proveedor ? g.proveedor.nombre : 'Proveedor eliminado', n: cs.length, vencido: U.suma(cs.filter(function (x) { return x.vencida; }), function (x) { return x.pendiente; }), total: U.suma(cs, function (x) { return x.pendiente; }) };
        }).filter(function (g) { return g.n > 0; });
        var totalMostrado = soloVencidas ? pp.vencido : pp.total;
        cuerpo = filaKV(soloVencidas ? 'Vencido por pagar' : 'Por pagar a proveedores', fmt(totalMostrado), 'negativo') +
          (!soloVencidas ? filaKV('De eso, vencido', fmt(pp.vencido), pp.vencido > 0 ? 'negativo' : '') : '') +
          (!soloVencidas && com.lista.length ? filaKV('Comisiones pendientes (' + com.lista.length + ')', fmt(com.total), 'negativo') : '') +
          tabla([
            { titulo: 'Proveedor', clave: 'proveedor', render: function (v, f) { return esc(v) + (f.vencido > 0 ? ' ' + badgeEstado('Vencido ' + fmt(f.vencido), 'negativo') : ''); } },
            { titulo: 'Cuentas', clave: 'n', num: true },
            { titulo: 'Pendiente', clave: 'total', num: true, render: function (v) { return esc(fmt(v)); } }
          ], porProv.slice(0, MAX_FILAS)) + mas(porProv.length - MAX_FILAS, 'proveedores más', 'proveedores más');
        partes.push('Debes ' + fmt(totalMostrado) + ' a ' + plural(porProv.length, 'proveedor', 'proveedores') + ' en ' + plural(cuentas.length, 'cuenta por pagar', 'cuentas por pagar') +
          (pp.vencido > 0 ? '; ' + fmt(pp.vencido) + ' ya venció' : '') +
          (com.lista.length ? '. Comisiones pendientes: ' + fmt(com.total) : ''));
      }
      html += seccion('empresa', cuerpo);
      enlaces.push(enlace('Ver cuentas por pagar', 'proveedores?pestana=cxp'));
    }
    if (ambito === 'personal' || !ambito) {
      var recibidos = prestamosDe(estado, 'personal', 'recibido');
      var tarjetas = C.saldosPorAmbito(estado, 'personal').cuentas.filter(function (x) { return x.cuenta.tipo === 'credito' && x.saldo < 0; });
      if (recibidos.length || tarjetas.length) {
        var items = tarjetas.map(function (x) { return { titulo: 'Tarjeta ' + (x.cuenta.nombre || ''), sub: esc('Deuda al día de hoy' + (x.cuenta.diaPago ? ' · pago el día ' + x.cuenta.diaPago : '')), valor: fmt(-x.saldo), tono: 'negativo' }; })
          .concat(recibidos.map(itemPrestamo));
        var deudaTarjetas = U.suma(tarjetas, function (x) { return -x.saldo; });
        var saldoPrest = U.suma(recibidos, function (p) { return C.saldoPrestamo(p); });
        html += seccion('personal', (ambito === 'personal' ? parrafo('Las cuentas por pagar a proveedores son de la empresa. Tus deudas personales:') : '') + listaHtml(items));
        partes.push('Personal: ' + (tarjetas.length ? 'tarjetas ' + fmt(deudaTarjetas) : '') + (tarjetas.length && recibidos.length ? ' y ' : '') + (recibidos.length ? 'préstamos ' + fmt(saldoPrest) : ''));
        enlaces.push(enlace('Ver personal', 'personal'));
      } else if (ambito === 'personal') {
        html += seccion('personal', parrafo('No tienes deudas personales registradas. Las cuentas por pagar a proveedores son de la empresa.'));
        partes.push('Personal: sin deudas registradas');
      }
    }
    return respuesta('por_pagar', ambito, partes.join('. ') + '.', html, enlaces);
  }

  // ---- disponible_personal ---------------------------------------------
  function rDisponiblePersonal(estado, periodo) {
    if (!cuentasActivas(estado, 'personal').length) {
      return respuesta('disponible_personal', 'personal', 'No tienes cuentas personales activas, así que no puedo calcular cuánto puedes gastar. Crea una cuenta en Personal.',
        null, [enlace('Ir a personal', 'personal')]);
    }
    var dias = periodo && periodo.futuro && periodo.dias > 0 ? periodo.dias : 30;
    var d = C.disponiblePersonal(estado, dias);
    var e = C.disponibleEmpresa(estado);
    var texto = (d.disponible >= 0
      ? 'Puedes gastar hasta ' + fmt(d.disponible) + ' de tus cuentas personales sin tocar el negocio'
      : 'Tus cuentas personales no alcanzan: te faltan ' + fmt(-d.disponible) + ' para cubrir tus compromisos') +
      ': líquido personal ' + fmt(d.liquido) + ' menos ' + fmt(d.totalCompromisos) + ' en ' + plural(d.compromisos.length, 'compromiso') + ' hasta el ' + U.fmtFecha(d.hasta) + ' (' + dias + ' días). ' +
      'Los pagos de ' + nombreEmpresa(estado) + ' se cubren con sus propias cuentas: disponible de empresa ' + fmt(e.disponible) + ' (líquido ' + fmt(e.liquido) + ' menos ' + fmt(e.totalCompromisos) + ' de compromisos a ' + e.dias + ' días).';
    var html = seccion('personal',
      filaKV('Líquido en cuentas personales', fmt(d.liquido)) +
      filaKV('Compromisos personales a ' + dias + ' días (' + d.compromisos.length + ')', fmt(d.totalCompromisos), d.totalCompromisos > 0 ? 'negativo' : '') +
      filaKV('Puedes gastar', fmt(d.disponible), d.disponible < 0 ? 'negativo' : 'positivo') +
      (d.compromisos.length ? tabla([
        { titulo: 'Compromiso', clave: 'concepto' },
        { titulo: 'Fecha', clave: 'fecha', render: function (v, f) { return esc(fechaCorta(v)) + (f.vencido ? ' ' + badgeEstado('Vencido', 'negativo') : ''); } },
        { titulo: 'Monto', clave: 'monto', num: true, render: function (v) { return esc(fmt(v)); } }
      ], d.compromisos.slice(0, MAX_FILAS)) + mas(d.compromisos.length - MAX_FILAS, 'compromisos más', 'compromisos más') : nota('Sin compromisos personales en el periodo.'))) +
      seccion('empresa',
        parrafo('Los pagos del negocio no salen de tus cuentas personales. Disponible operativo de ' + nombreEmpresa(estado) + ':') +
        filaKV('Líquido en cuentas de empresa', fmt(e.liquido)) +
        filaKV('Compromisos a ' + e.dias + ' días (' + e.compromisos.length + ')', fmt(e.totalCompromisos), e.totalCompromisos > 0 ? 'negativo' : '') +
        filaKV('Disponible de empresa', fmt(e.disponible), e.disponible < 0 ? 'negativo' : 'positivo')) +
      nota('Las cifras personales y de empresa nunca se suman.');
    return respuesta('disponible_personal', 'personal', texto, html, [enlace('Ver personal', 'personal'), enlace('Panel personal', 'panel?ambito=personal')], periodo);
  }

  // ---- vencimientos ------------------------------------------------------
  function rVencimientos(estado, ambito, periodo, tipoVenc) {
    var h = hoy();
    var p = periodo && periodo.clave !== 'ayer' && periodo.clave !== 'dias_pasado' && periodo.clave !== 'semana_pasada' && periodo.clave !== 'mes_pasado' && periodo.clave !== 'anio'
      ? periodo : per('dias_futuro', 'los próximos ' + DIAS_VENCIMIENTOS + ' días', h, U.sumarDias(h, DIAS_VENCIMIENTOS), true, DIAS_VENCIMIENTOS);
    function filtro(v) {
      return (!ambito || v.ambito === ambito) && (!tipoVenc || v.tipo === tipoVenc);
    }
    var lista = C.vencimientos(estado, p.desde, p.hasta).filter(filtro);
    var vencidos = p.desde >= h ? C.vencimientos(estado, null, U.sumarDias(h, -1)).filter(filtro) : [];
    var siguientes = C.vencimientos(estado, U.sumarDias(p.hasta, 1), null).filter(filtro).slice(0, 3);
    var que = tipoVenc === 'pago' ? 'pagos' : tipoVenc === 'cobro' ? 'cobros' : 'pagos ni cobros';
    var cuando = p.etiqueta + (p.desde === p.hasta ? ' (' + U.fmtFechaLarga(p.desde) + ')' : ' (' + rangoTexto(p.desde, p.hasta) + ')');
    var html = '';
    var texto;
    var enlaces = [enlace('Ver todos los vencimientos', 'panel')];
    if (!lista.length) {
      texto = 'No tienes ' + que + ' programados para ' + cuando + '.';
      html += parrafo(texto);
    } else {
      var porAmbito = [];
      ambitosDe(ambito).forEach(function (a) {
        var la = lista.filter(function (v) { return v.ambito === a; });
        if (!la.length) return;
        var pagos = U.suma(la.filter(function (v) { return v.tipo === 'pago'; }), function (v) { return v.monto; });
        var cobros = U.suma(la.filter(function (v) { return v.tipo === 'cobro'; }), function (v) { return v.monto; });
        porAmbito.push(NOMBRES[a] + ': ' + plural(la.length, 'vencimiento') + (pagos > 0 ? ', pagos ' + fmt(pagos) : '') + (cobros > 0 ? ', cobros ' + fmt(cobros) : ''));
        html += seccion(a, (pagos > 0 ? filaKV('Pagos', fmt(pagos), 'negativo') : '') + (cobros > 0 ? filaKV('Cobros', fmt(cobros), 'positivo') : '') +
          tabla([
            { titulo: 'Fecha', clave: 'fecha', render: function (v, f) { return esc(fechaCorta(v)) + (f.vencido ? ' ' + badgeEstado('Vencido', 'negativo') : ''); } },
            { titulo: 'Concepto', clave: 'concepto', render: function (v, f) { return badgeEstado(f.tipo === 'cobro' ? 'Cobro' : 'Pago', f.tipo === 'cobro' ? 'positivo' : 'negativo') + ' ' + esc(v); } },
            { titulo: 'Monto', clave: 'monto', num: true, render: function (v, f) { return '<span class="' + (f.tipo === 'cobro' ? 'positivo' : 'negativo') + '">' + esc((f.tipo === 'cobro' ? '+' : '−') + fmt(v)) + '</span>'; } }
          ], la.slice(0, MAX_FILAS)) + mas(la.length - MAX_FILAS, 'vencimientos más', 'vencimientos más'));
      });
      texto = 'Para ' + cuando + ' tienes ' + plural(lista.length, 'vencimiento') + '. ' + porAmbito.join('. ') + '.';
    }
    if (vencidos.length) {
      var vp = vencidos.filter(function (v) { return v.tipo === 'pago'; });
      var vc = vencidos.filter(function (v) { return v.tipo === 'cobro'; });
      var textoV = 'Además hay ' + plural(vencidos.length, 'vencimiento atrasado', 'vencimientos atrasados') + ' que siguen pendientes' +
        (vp.length ? ': por pagar ' + fmt(U.suma(vp, function (v) { return v.monto; })) : '') + (vc.length ? (vp.length ? ', ' : ': ') + 'por cobrar ' + fmt(U.suma(vc, function (v) { return v.monto; })) : '') + '.';
      texto += ' ' + textoV;
      var kvAtrasados = '';
      ambitosDe(ambito).forEach(function (a) {
        var va = vencidos.filter(function (v) { return v.ambito === a; });
        if (!va.length) return;
        var vap = U.suma(va.filter(function (v) { return v.tipo === 'pago'; }), function (v) { return v.monto; });
        var vac = U.suma(va.filter(function (v) { return v.tipo === 'cobro'; }), function (v) { return v.monto; });
        if (vap > 0) kvAtrasados += filaKV('Por pagar atrasado · ' + NOMBRES[a], fmt(vap), 'negativo');
        if (vac > 0) kvAtrasados += filaKV('Por cobrar atrasado · ' + NOMBRES[a], fmt(vac), 'positivo');
      });
      html += '<section class="asistente-seccion">' + titulo(badgeEstado('Atrasados', 'negativo') + ' ' + esc(plural(vencidos.length, 'pendiente'))) + kvAtrasados +
        listaHtml(vencidos.slice(0, 5).map(function (v) {
          return { titulo: v.concepto, sub: badge(v.ambito) + ' ' + esc(U.fmtFecha(v.fecha) + ' · hace ' + plural(-v.dias, 'día')), valor: (v.tipo === 'cobro' ? '+' : '−') + fmt(v.monto), tono: v.tipo === 'cobro' ? 'positivo' : 'negativo' };
        })) + mas(vencidos.length - 5, 'atrasados más', 'atrasados más') + '</section>';
    }
    if (!lista.length && siguientes.length) {
      texto += ' Lo más próximo: ' + siguientes.slice(0, 2).map(function (v) { return v.concepto + ' ' + fechaRel(v.fecha) + ' (' + (v.tipo === 'cobro' ? 'cobro ' : 'pago ') + fmt(v.monto) + ')'; }).join('; ') + '.';
      html += '<section class="asistente-seccion">' + titulo(esc('Lo más próximo')) + listaHtml(siguientes.map(function (v) {
        return { titulo: v.concepto, sub: badge(v.ambito) + ' ' + esc(capitalizar(fechaRel(v.fecha)) + ' · ' + U.fmtFecha(v.fecha)), valor: (v.tipo === 'cobro' ? '+' : '−') + fmt(v.monto), tono: v.tipo === 'cobro' ? 'positivo' : 'negativo' };
      })) + '</section>';
    }
    if (!ambito) html += nota('Los importes de empresa y personal se muestran por separado.');
    if (!tipoVenc || tipoVenc === 'cobro') enlaces.push(enlace('Cobros', 'cobros'));
    if (!tipoVenc || tipoVenc === 'pago') enlaces.push(enlace('Cuentas por pagar', 'proveedores?pestana=cxp'));
    return respuesta('vencimientos', ambito, texto, html, enlaces, p);
  }

  // ---- utilidad ----------------------------------------------------------
  function periodoMesActual() {
    var h = hoy();
    return per('este_mes', 'este mes (' + mesLargo(U.periodo(h)) + ')', U.inicioMes(h), U.finMes(h), false);
  }
  function rUtilidad(estado, ambito, periodo) {
    var p = periodo || periodoMesActual();
    if (ambito === 'personal') {
      var movsP = C.movimientosEn(estado, 'personal', p.desde, p.hasta);
      if (!movsP.length) return respuesta('utilidad', 'personal', 'Sin movimientos personales ' + p.etiqueta + '. La utilidad es un concepto de empresa; en lo personal se habla de balance (ingresos − gastos).', null, [enlace('Ver personal', 'personal')], p);
      var ingP = C.ingresos(estado, 'personal', p.desde, p.hasta);
      var gasP = C.gastos(estado, 'personal', p.desde, p.hasta);
      var balP = C.balance(estado, 'personal', p.desde, p.hasta);
      var textoP = 'La utilidad es un concepto de empresa. Tu balance personal ' + p.etiqueta + ' es ' + fmt(balP) + ': ingresos ' + fmt(ingP) + ' menos gastos ' + fmt(gasP) + '.';
      return respuesta('utilidad', 'personal', textoP, seccion('personal', filaKV('Ingresos', fmt(ingP), 'positivo') + filaKV('Gastos', fmt(gasP), 'negativo') + filaKV('Balance', fmt(balP), balP >= 0 ? 'positivo' : 'negativo')) + nota('Las transferencias y los retiros de socio no cuentan como ingreso ni gasto.'),
        [enlace('Ver personal', 'personal'), enlace('Reportes', 'reportes')], p);
    }
    var movs = C.movimientosEn(estado, 'empresa', p.desde, p.hasta);
    if (!movs.length) {
      return respuesta('utilidad', 'empresa', 'Sin movimientos de ' + nombreEmpresa(estado) + ' ' + p.etiqueta + ' (' + rangoTexto(p.desde, p.hasta) + '), así que no hay utilidad que calcular.', null, [enlace('Ver empresa', 'empresa')], p);
    }
    var u;
    if (p.esMes) u = C.utilidadMes(estado, p.periodo);
    else {
      var ing = C.ingresos(estado, 'empresa', p.desde, p.hasta);
      var gas = C.gastos(estado, 'empresa', p.desde, p.hasta);
      u = { ingresos: ing, gastos: gas, utilidad: U.round2(ing - gas), margen: ing > 0 ? U.round2((ing - gas) / ing * 100) : null };
    }
    var cats = C.gastosPorCategoria(estado, 'empresa', p.desde, p.hasta).slice(0, 3);
    var texto = (u.utilidad >= 0 ? 'La utilidad de ' : 'La pérdida de ') + nombreEmpresa(estado) + ' ' + p.etiqueta + ' es ' + fmt(Math.abs(u.utilidad)) +
      ': ingresos ' + fmt(u.ingresos) + ' menos gastos ' + fmt(u.gastos) + (u.margen === null ? ' (sin ingresos en el periodo)' : ' (margen ' + U.fmtNumero(u.margen, 1) + ' %)') + '.' +
      (cats.length ? ' Mayores gastos: ' + cats.map(function (c) { return c.categoria + ' ' + fmt(c.monto); }).join(', ') + '.' : '');
    var html = seccion('empresa',
      filaKV('Ingresos', fmt(u.ingresos), 'positivo') + filaKV('Gastos', fmt(u.gastos), 'negativo') +
      filaKV(u.utilidad >= 0 ? 'Utilidad' : 'Pérdida', fmt(u.utilidad), u.utilidad >= 0 ? 'positivo' : 'negativo') +
      filaKV('Margen', u.margen === null ? '—' : U.fmtNumero(u.margen, 1) + ' %') +
      (cats.length ? titulo(esc('Mayores gastos')) + listaHtml(cats.map(function (c) { return { titulo: c.categoria, sub: esc(U.fmtNumero(c.porcentaje, 0) + ' % de los gastos · ' + plural(c.cantidad, 'movimiento')), valor: fmt(c.monto) }; })) : '')) +
      nota('Las transferencias, los retiros de socio y las aportaciones de capital no cuentan como ingreso ni gasto.');
    return respuesta('utilidad', 'empresa', texto, html, [enlace('Estado de resultados', 'reportes'), enlace('Ver empresa', 'empresa')], p);
  }

  // ---- presupuesto -------------------------------------------------------
  function rPresupuesto(estado, ambito, periodo) {
    var p = periodo && periodo.esMes ? periodo : (periodo ? per('este_mes', mesLargo(periodo.periodo), U.inicioMes(periodo.desde), U.finMes(periodo.desde), false) : periodoMesActual());
    var html = '';
    var partes = [];
    var enlaces = [];
    ambitosDe(ambito).forEach(function (a) {
      var pr = C.presupuestoVsReal(estado, a, p.periodo);
      var conPpto = pr.filter(function (f) { return f.tipo === 'gasto' && !f.sinPresupuesto; });
      var cuerpo;
      if (!conPpto.length) {
        cuerpo = parrafo('Sin presupuesto definido para ' + NOMBRES[a].toLowerCase() + ' en ' + mesLargo(p.periodo) + '.' + (pr.totalReal > 0 ? ' Gasto real del mes: ' + fmt(pr.totalReal) + '.' : ''));
        partes.push(NOMBRES[a] + ': sin presupuesto definido para ' + mesLargo(p.periodo));
      } else {
        var excedidas = conPpto.filter(function (f) { return f.real > f.presupuesto; });
        var pct = pr.totalPresupuesto > 0 ? U.round2(pr.totalReal / pr.totalPresupuesto * 100) : null;
        var filas = conPpto.slice().sort(function (x, y) { return (y.porcentaje || 0) - (x.porcentaje || 0); });
        var sinPpto = pr.filter(function (f) { return f.sinPresupuesto && f.real > 0; });
        cuerpo = filaKV('Presupuesto de gastos', fmt(pr.totalPresupuesto)) +
          filaKV('Gastado', fmt(pr.totalReal), pr.totalReal > pr.totalPresupuesto ? 'negativo' : '') +
          filaKV(pr.totalDiferencia >= 0 ? 'Te queda' : 'Excedido en', fmt(Math.abs(pr.totalDiferencia)), pr.totalDiferencia >= 0 ? 'positivo' : 'negativo') +
          (pct !== null ? filaKV('Avance', U.fmtNumero(pct, 0) + ' %') : '') +
          tabla([
            { titulo: 'Categoría', clave: 'categoria', render: function (v, f) { return esc(v) + (f.real > f.presupuesto ? ' ' + badgeEstado('Excedida', 'negativo') : ''); } },
            { titulo: 'Gastado', clave: 'real', num: true, render: function (v, f) { return esc(fmt(v)) + '<br><small class="texto-3">de ' + esc(fmt(f.presupuesto)) + '</small>'; } },
            { titulo: '%', clave: 'porcentaje', num: true, render: function (v) { return esc(v === null ? '—' : U.fmtNumero(v, 0) + ' %'); } }
          ], filas.slice(0, MAX_FILAS)) + mas(filas.length - MAX_FILAS, 'categorías más', 'categorías más') +
          (sinPpto.length ? nota('Gasto sin presupuesto: ' + sinPpto.map(function (f) { return f.categoria + ' ' + fmt(f.real); }).join(', ') + '.') : '');
        partes.push(NOMBRES[a] + ': gastado ' + fmt(pr.totalReal) + ' de ' + fmt(pr.totalPresupuesto) + ' presupuestados' + (pct !== null ? ' (' + U.fmtNumero(pct, 0) + ' %)' : '') +
          (excedidas.length ? '; ' + plural(excedidas.length, 'categoría excedida', 'categorías excedidas') + ': ' + excedidas.map(function (f) { return f.categoria + ' (' + fmt(f.real) + ' de ' + fmt(f.presupuesto) + ')'; }).join(', ') : '; ninguna categoría excedida'));
      }
      html += seccion(a, cuerpo);
      enlaces.push(enlace('Presupuesto ' + NOMBRES[a].toLowerCase(), 'presupuestos?ambito=' + a + '&periodo=' + p.periodo));
    });
    return respuesta('presupuesto', ambito, 'Presupuesto de ' + mesLargo(p.periodo) + '. ' + partes.join('. ') + '.', html, enlaces, p);
  }

  // ---- revisar -----------------------------------------------------------
  function nombreCuenta(estado, id) { var c = buscar(estado.cuentas, id); return c ? c.nombre : 'Cuenta eliminada'; }
  function itemMov(estado, m, extra) {
    return {
      titulo: m.descripcion || m.categoria || 'Movimiento',
      sub: badge(m.ambito) + ' ' + esc(U.fmtFecha(m.fecha) + ' · ' + nombreCuenta(estado, m.cuentaId) + (m.categoria ? ' · ' + m.categoria : '') + (extra ? ' · ' + extra : '')),
      valor: (m.tipo === 'ingreso' ? '+' : m.tipo === 'gasto' ? '−' : '') + fmt(m.monto),
      tono: m.tipo === 'ingreso' ? 'positivo' : m.tipo === 'gasto' ? 'negativo' : ''
    };
  }
  function rRevisar(estado, ambito) {
    var rev = C.movimientosARevisar(estado, ambito || undefined);
    var donde = ambito ? ' en ' + NOMBRES[ambito].toLowerCase() : '';
    var enlaces = [enlace('Ver detalle en el panel', 'panel' + (ambito ? '?ambito=' + ambito : ''))];
    if (!rev.total) return respuesta('revisar', ambito, 'Nada pendiente de revisar' + donde + ': no encontré duplicados, gastos atípicos, movimientos marcados ni movimientos sin categoría.', null, enlaces);
    var partes = [];
    var html = '';
    function bloque(tituloTexto, ayuda, items) {
      if (!items.length) return;
      html += '<section class="asistente-seccion">' + titulo(esc(tituloTexto) + ' ' + badgeEstado(String(items.length), 'alerta')) + nota(ayuda) + listaHtml(items.slice(0, 5)) + mas(items.length - 5, 'más') + '</section>';
    }
    if (rev.duplicados.length) {
      partes.push(plural(rev.duplicados.length, 'posible duplicado') + ' (' + rev.duplicados.map(function (par) { return fmt(par[1].monto); }).join(', ') + ')');
      var vistos = {};
      var dup = [];
      rev.duplicados.forEach(function (par) { par.forEach(function (m) { if (!vistos[m.id]) { vistos[m.id] = true; dup.push(itemMov(estado, m)); } }); });
      bloque('Posibles duplicados', 'Misma cuenta, fecha, monto y tipo. Si uno sobra, elimínalo desde su detalle.', dup);
    }
    if (rev.atipicos.length) {
      partes.push(plural(rev.atipicos.length, 'gasto atípico') + ' (' + rev.atipicos.map(function (a) { return fmt(a.mov.monto); }).join(', ') + ')');
      bloque('Gastos atípicos', 'Más de 3 veces la mediana de su categoría.', rev.atipicos.map(function (a) { return itemMov(estado, a.mov, U.fmtNumero(a.veces, 1) + '× la mediana de ' + fmt(a.mediana)); }));
    }
    if (rev.marcados.length) {
      partes.push(plural(rev.marcados.length, 'movimiento marcado', 'movimientos marcados') + ' para revisar (' + rev.marcados.map(function (m) { return fmt(m.monto); }).join(', ') + ')');
      bloque('Marcados para revisar', 'Guardados con estado “por revisar”.', rev.marcados.map(function (m) { return itemMov(estado, m); }));
    }
    if (rev.sinCategoria.length) {
      partes.push(rev.sinCategoria.length + ' sin categoría (' + fmt(U.suma(rev.sinCategoria, function (m) { return m.monto; })) + ')');
      bloque('Sin categoría', 'Asigna una categoría para que cuenten en presupuestos y reportes.', rev.sinCategoria.map(function (m) { return itemMov(estado, m); }));
    }
    var texto = 'Hay ' + plural(rev.total, 'movimiento que revisar', 'movimientos que revisar') + donde + ': ' + partes.join(', ') + '.';
    html = parrafo('Hay ' + plural(rev.total, 'movimiento que revisar', 'movimientos que revisar') + donde + '. Toca “Ver detalle” para abrirlos desde el panel.') + html;
    if (!ambito) enlaces.push(enlace('Empresa', 'empresa'), enlace('Personal', 'personal'));
    return respuesta('revisar', ambito, texto, html, enlaces);
  }

  // ---- flujo -------------------------------------------------------------
  function rFlujo(estado, ambito, periodo) {
    var dias = periodo && periodo.futuro && periodo.dias > 0 ? periodo.dias : DIAS_FLUJO;
    var html = '';
    var partes = [];
    var enlaces = [];
    ambitosDe(ambito).forEach(function (a) {
      if (!cuentasActivas(estado, a).length) {
        html += seccion(a, parrafo('Sin cuentas activas en ' + NOMBRES[a].toLowerCase() + '; no hay flujo que proyectar.'));
        partes.push(NOMBRES[a] + ': sin cuentas activas');
        return;
      }
      var serie = C.flujoProyectado(estado, a, dias);
      var inicio = C.saldosPorAmbito(estado, a).liquido;
      var fin = serie[serie.length - 1];
      var entradas = U.suma(serie, function (d) { return d.entradas; });
      var salidas = U.suma(serie, function (d) { return d.salidas; });
      var minimo = serie.reduce(function (acc, d) { return d.saldo < acc.saldo ? d : acc; }, serie[0]);
      var conMov = serie.filter(function (d) { return d.entradas > 0 || d.salidas > 0; });
      var cuerpo = filaKV('Líquido hoy', fmt(inicio)) + filaKV('Entradas previstas', fmt(entradas), 'positivo') + filaKV('Salidas previstas', fmt(salidas), 'negativo') +
        filaKV('Saldo proyectado el ' + fechaCorta(fin.fecha), fmt(fin.saldo), fin.saldo < 0 ? 'negativo' : 'positivo') +
        filaKV('Punto más bajo (' + fechaCorta(minimo.fecha) + ')', fmt(minimo.saldo), minimo.saldo < 0 ? 'negativo' : '') +
        (conMov.length ? tabla([
          { titulo: 'Día', clave: 'fecha', render: function (v) { return esc(fechaCorta(v)); } },
          { titulo: 'Entra', clave: 'entradas', num: true, render: function (v) { return v ? '<span class="positivo">' + esc('+' + fmt(v)) + '</span>' : '—'; } },
          { titulo: 'Sale', clave: 'salidas', num: true, render: function (v) { return v ? '<span class="negativo">' + esc('−' + fmt(v)) + '</span>' : '—'; } },
          { titulo: 'Saldo', clave: 'saldo', num: true, render: function (v) { return '<span class="' + (v < 0 ? 'negativo' : '') + '">' + esc(fmt(v)) + '</span>'; } }
        ], conMov.slice(0, MAX_FILAS)) + mas(conMov.length - MAX_FILAS, 'días más con movimientos', 'días más con movimientos') : nota('Sin cobros ni pagos programados en el periodo.'));
      html += seccion(a, cuerpo);
      partes.push(NOMBRES[a] + ': de ' + fmt(inicio) + ' líquido hoy a ' + fmt(fin.saldo) + ' el ' + U.fmtFecha(fin.fecha) + ' (entran ' + fmt(entradas) + ', salen ' + fmt(salidas) + ')' +
        (minimo.saldo < 0 ? '; ALERTA: el saldo se vuelve negativo el ' + U.fmtFecha(minimo.fecha) + ' (' + fmt(minimo.saldo) + ')' : '; punto más bajo ' + fmt(minimo.saldo)));
      enlaces.push(enlace('Ver ' + NOMBRES[a].toLowerCase(), a));
    });
    enlaces.push(enlace('Flujo en reportes', 'reportes'));
    if (!ambito) html += nota('Cada ámbito se proyecta con sus propias cuentas y compromisos; no se suman.');
    return respuesta('flujo', ambito, 'Flujo proyectado a ' + dias + ' días. ' + partes.join('. ') + '.', html, enlaces, periodo);
  }

  // ---- saldo_cuenta ------------------------------------------------------
  function rSaldoCuenta(estado, ambito, cuentas, esTarjeta) {
    var lista = (cuentas || []).filter(function (c) { return !ambito || c.ambito === ambito; });
    if (!lista.length) {
      var nombres = listaDe(estado, 'cuentas').filter(function (c) { return c && c.activa !== false; }).map(function (c) { return c.nombre + ' (' + NOMBRES[c.ambito] + ')'; });
      var texto0 = esTarjeta ? 'No hay tarjetas de crédito registradas' + (ambito ? ' en ' + NOMBRES[ambito].toLowerCase() : '') + '.' : 'No encontré esa cuenta.';
      if (nombres.length) texto0 += ' Cuentas disponibles: ' + nombres.join(', ') + '.';
      return respuesta('saldo_cuenta', ambito, texto0, null, [enlace('Empresa', 'empresa'), enlace('Personal', 'personal')]);
    }
    var html = '';
    var partes = [];
    var enlaces = [];
    var ambitosVistos = {};
    AMBITOS.forEach(function (a) {
      var la = lista.filter(function (c) { return c.ambito === a; });
      if (!la.length) return;
      ambitosVistos[a] = true;
      var items = la.map(function (c) {
        var saldo = C.saldoCuenta(estado, c.id);
        var sub = descripcionCuenta(c) + (c.activa === false ? ' · archivada' : '');
        var texto;
        if (c.tipo === 'credito') {
          var limite = Number(c.limiteCredito) || 0;
          var deuda = saldo < 0 ? -saldo : 0;
          sub += ' · deuda ' + fmt(deuda) + (limite ? ' · crédito disponible ' + fmt(Math.max(0, limite - deuda)) : '') + (c.diaPago ? ' · pago el día ' + c.diaPago : '');
          texto = c.nombre + ' (' + NOMBRES[a] + ', tarjeta): deuda ' + fmt(deuda) + (limite ? ', crédito disponible ' + fmt(Math.max(0, limite - deuda)) : '');
        } else {
          texto = c.nombre + ' (' + NOMBRES[a] + '): ' + fmt(saldo);
        }
        partes.push(texto);
        enlaces.push(enlace('Ver ' + c.nombre, a + '?cuenta=' + encodeURIComponent(c.id)));
        return { titulo: c.nombre, sub: esc(sub), valor: fmt(saldo), tono: saldo < 0 ? 'negativo' : '' };
      });
      html += seccion(a, listaHtml(items));
    });
    if (Object.keys(ambitosVistos).length > 1) html += nota('Cuentas de ámbitos distintos: se muestran por separado, sin sumar.');
    return respuesta('saldo_cuenta', ambito || (Object.keys(ambitosVistos).length === 1 ? Object.keys(ambitosVistos)[0] : null), partes.join('. ') + '.', html, enlaces);
  }

  // ---- prestamos ---------------------------------------------------------
  function rPrestamos(estado, ambito, n) {
    var html = '';
    var partes = [];
    var enlaces = [];
    var conDeudas = tiene(n || '', /\bdeudas?\b|\bendeudad/);
    ambitosDe(ambito).forEach(function (a) {
      var recibidos = prestamosDe(estado, a, 'recibido');
      var otorgados = prestamosDe(estado, a, 'otorgado');
      var tarjetas = conDeudas ? C.saldosPorAmbito(estado, a).cuentas.filter(function (x) { return x.cuenta.tipo === 'credito' && x.saldo < 0; }) : [];
      if (!recibidos.length && !otorgados.length && !tarjetas.length) {
        html += seccion(a, parrafo('Sin préstamos activos' + (conDeudas ? ' ni deudas de tarjeta' : '') + ' en ' + NOMBRES[a].toLowerCase() + '.'));
        partes.push(NOMBRES[a] + ': sin préstamos activos');
        return;
      }
      var debes = U.suma(recibidos, function (p) { return C.saldoPrestamo(p); });
      var teDeben = U.suma(otorgados, function (p) { return C.saldoPrestamo(p); });
      var deudaTarjetas = U.suma(tarjetas, function (x) { return -x.saldo; });
      var items = recibidos.concat(otorgados).map(itemPrestamo).concat(tarjetas.map(function (x) {
        return { titulo: 'Tarjeta ' + x.cuenta.nombre, sub: esc('Deuda de tarjeta' + (x.cuenta.diaPago ? ' · pago el día ' + x.cuenta.diaPago : '')), valor: fmt(-x.saldo), tono: 'negativo' };
      }));
      var cuerpo = (recibidos.length ? filaKV('Debes (saldo insoluto de ' + plural(recibidos.length, 'préstamo') + ')', fmt(debes), 'negativo') : '') +
        (tarjetas.length ? filaKV('Deuda de tarjetas', fmt(deudaTarjetas), 'negativo') : '') +
        (otorgados.length ? filaKV('Te deben (' + plural(otorgados.length, 'préstamo otorgado', 'préstamos otorgados') + ')', fmt(teDeben), 'positivo') : '') +
        listaHtml(items);
      html += seccion(a, cuerpo);
      var t = NOMBRES[a] + ': ';
      var tp = [];
      if (recibidos.length) tp.push('debes ' + fmt(debes) + ' en ' + plural(recibidos.length, 'préstamo') + recibidos.map(function (p) { var px = C.proximoPagoPrestamo(p, hoy()); return ' (' + (p.contraparte || 'préstamo') + ': pago mensual ' + fmt(C.pagoMensual(p)) + (px ? ', próximo ' + fechaRel(px.fecha) + ' por ' + fmt(px.monto) : '') + ')'; }).join(''));
      if (tarjetas.length) tp.push('deuda de tarjetas ' + fmt(deudaTarjetas));
      if (otorgados.length) tp.push('te deben ' + fmt(teDeben) + otorgados.map(function (p) { return ' (' + (p.contraparte || 'préstamo') + ')'; }).join(''));
      partes.push(t + tp.join('; '));
    });
    enlaces.push(enlace('Ver préstamos', 'prestamos'));
    if (!ambito) html += nota('Los préstamos de empresa y personales se muestran por separado.');
    return respuesta('prestamos', ambito, partes.join('. ') + '.', html, enlaces);
  }

  // ---- comisiones --------------------------------------------------------
  function rComisiones(estado, ambito) {
    var com = C.comisionesPendientes(estado);
    var enlaces = [enlace('Ver comisiones', 'proveedores?pestana=comisiones')];
    var aviso = ambito === 'personal' ? 'Las comisiones son un concepto de la empresa. ' : '';
    if (!com.lista.length) return respuesta('comisiones', 'empresa', aviso + 'No hay comisiones pendientes de pago.', null, enlaces);
    var filas = com.lista.map(function (c) {
      var f = buscar(estado.facturas, c.facturaId);
      return { beneficiario: c.beneficiario || '', fecha: c.fecha, monto: c.monto, detalle: (f ? 'Factura ' + f.folio + ' · ' : '') + U.fmtNumero(c.porcentaje, 1) + ' % de ' + fmt(c.base), vencida: c.fecha && c.fecha < hoy() };
    });
    var texto = aviso + 'Comisiones pendientes: ' + fmt(com.total) + ' en ' + plural(com.lista.length, 'comisión', 'comisiones') + ': ' + filas.map(function (f) { return f.beneficiario + ' ' + fmt(f.monto) + ' (' + fechaRel(f.fecha) + ')'; }).join(', ') + '.';
    var html = seccion('empresa', filaKV('Comisiones pendientes', fmt(com.total), 'negativo') + tabla([
      { titulo: 'Beneficiario', clave: 'beneficiario', render: function (v, f) { return esc(v) + '<br><small class="texto-3">' + esc(f.detalle) + '</small>'; } },
      { titulo: 'Fecha', clave: 'fecha', render: function (v, f) { return esc(fechaCorta(v)) + (f.vencida ? ' ' + badgeEstado('Vencida', 'negativo') : ''); } },
      { titulo: 'Monto', clave: 'monto', num: true, render: function (v) { return esc(fmt(v)); } }
    ], filas.slice(0, MAX_FILAS)) + mas(filas.length - MAX_FILAS, 'comisiones más', 'comisiones más'));
    return respuesta('comisiones', 'empresa', texto, html, enlaces);
  }

  // ---- metas -------------------------------------------------------------
  function rMetas(estado, ambito) {
    var metas = listaDe(estado, 'metas').filter(Boolean);
    var enlaces = [enlace('Ver metas en personal', 'personal')];
    var aviso = ambito === 'empresa' ? 'Las metas de ahorro son personales. ' : '';
    if (!metas.length) return respuesta('metas', 'personal', aviso + 'No tienes metas de ahorro registradas.', null, enlaces);
    var items = [];
    var partes = [];
    metas.forEach(function (m) {
      var pr = C.metaProgreso(estado, m);
      var meses = m.fechaMeta ? Math.max(0, Math.round(U.diasEntre(hoy(), m.fechaMeta) / 30)) : null;
      var porMes = meses && pr.faltante > 0 ? U.round2(pr.faltante / meses) : null;
      var sub = fmt(pr.ahorrado) + ' de ' + fmt(pr.objetivo) + ' (' + U.fmtNumero(pr.porcentaje, 0) + ' %)' +
        (m.fechaMeta ? ' · meta ' + U.fmtFecha(m.fechaMeta) : '') + (porMes ? ' · ' + fmt(porMes) + ' al mes para llegar' : '') + (!m.cuentaId ? ' · sin cuenta asignada' : '');
      items.push({ titulo: m.nombre, sub: esc(sub) + '<span class="barra asistente-barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pr.porcentaje) + '"><span class="barra-relleno" style="width:' + pr.porcentaje.toFixed(1) + '%"></span></span>', valor: pr.faltante > 0 ? 'faltan ' + fmt(pr.faltante) : 'cumplida', tono: pr.faltante > 0 ? '' : 'positivo' });
      partes.push(m.nombre + ': ' + fmt(pr.ahorrado) + ' de ' + fmt(pr.objetivo) + ' (' + U.fmtNumero(pr.porcentaje, 0) + ' %' + (meses !== null ? ', ' + plural(meses, 'mes', 'meses') + ' restantes' : '') + (porMes ? ', necesitas ' + fmt(porMes) + ' al mes' : '') + ')');
    });
    return respuesta('metas', 'personal', aviso + 'Tienes ' + plural(metas.length, 'meta de ahorro', 'metas de ahorro') + '. ' + partes.join('. ') + '.', seccion('personal', listaHtml(items)), enlaces);
  }

  // ---- ayuda / desconocido ---------------------------------------------
  function htmlAyuda() {
    return '<ul class="asistente-lista asistente-ayuda">' + INTENCIONES.filter(function (i) { return i.id !== 'desconocido'; }).map(function (i) {
      return '<li class="asistente-item"><div class="asistente-item-texto"><span class="asistente-item-titulo">' + esc(i.descripcion) + '</span>' +
        '<span class="asistente-item-sub"><button type="button" class="btn btn-enlace btn-chico asistente-ejemplo" data-accion="asistente-chip" data-pregunta="' + esc(i.ejemplo) + '">' + esc(i.ejemplo) + '</button></span></div></li>';
    }).join('') + '</ul>';
  }
  function rAyuda() {
    return respuesta('ayuda', null, 'Puedo responder, con tus cifras reales y sin salir de este dispositivo, sobre: dinero disponible, gastos e ingresos por periodo, por cobrar, por pagar, cuánto puedes gastar, vencimientos, utilidad, presupuesto, movimientos a revisar, flujo proyectado, saldo de una cuenta, préstamos, comisiones y metas. Empresa y personal siempre por separado.',
      parrafo('Puedo responder, con tus cifras reales, sobre estos temas. Toca un ejemplo para probarlo:') + htmlAyuda() + nota('Entiendo periodos como hoy, ayer, esta semana, semana pasada, este mes, mes pasado, mañana y próximos N días, y ámbitos como VILLEDA / la empresa o personal / yo.'), []);
  }
  function rDesconocido(pregunta) {
    return respuesta('desconocido', null, 'No entendí la pregunta “' + pregunta + '”. Prueba con una de las sugerencias o pregunta, por ejemplo, “¿cuánto gastó VILLEDA esta semana?” o “¿cuánto hay en Nu?”.',
      parrafo('No entendí la pregunta. Puedo ayudarte con estos temas:') + htmlAyuda(), []);
  }

  /* ======================================================================
   * Motor principal
   * ==================================================================== */
  /**
   * responder(pregunta, estado) → { texto, html, intent, ambito, periodo, enlaces:[{texto, ruta}] }.
   * Puro: no toca el DOM ni el store.
   */
  function responder(pregunta, estado) {
    var est = estado || {};
    var original = String(pregunta == null ? '' : pregunta).trim();
    var n = limpiar(original);
    var ambito = detectarAmbito(n);
    var periodo = detectarPeriodo(n);
    var det = detectarIntent(n, est, ambito, periodo);
    var r;
    try {
      switch (det.intent) {
        case 'ayuda': r = rAyuda(); break;
        case 'saldo_cuenta': r = rSaldoCuenta(est, ambito, det.cuentas, det.tarjetas); break;
        case 'disponible_personal': r = rDisponiblePersonal(est, periodo); break;
        case 'disponible_total': r = rDisponibleTotal(est, ambito); break;
        case 'revisar': r = rRevisar(est, ambito); break;
        case 'presupuesto': r = rPresupuesto(est, ambito, periodo); break;
        case 'flujo': r = rFlujo(est, ambito, periodo); break;
        case 'utilidad': r = rUtilidad(est, ambito, periodo); break;
        case 'comisiones': r = rComisiones(est, ambito); break;
        case 'metas': r = rMetas(est, ambito); break;
        case 'prestamos': r = rPrestamos(est, ambito, n); break;
        case 'por_cobrar': r = rPorCobrar(est, ambito, n); break;
        case 'por_pagar': r = rPorPagar(est, ambito, n); break;
        case 'vencimientos': r = rVencimientos(est, ambito, periodo, det.tipoVenc); break;
        case 'gastos_periodo': r = rPeriodo('gasto', est, ambito, periodo); break;
        case 'ingresos_periodo': r = rPeriodo('ingreso', est, ambito, periodo); break;
        default: r = rDesconocido(original); break;
      }
    } catch (e) {
      console.error('[VF.asistente] error al responder:', e);
      r = respuesta('desconocido', ambito, 'Ocurrió un error al calcular la respuesta: ' + (e && e.message ? e.message : e), null, []);
    }
    r.pregunta = original;
    r.periodo = r.periodo || periodo || null;
    return r;
  }

  function intenciones() {
    return INTENCIONES.map(function (i) { return { id: i.id, descripcion: i.descripcion, ejemplo: i.ejemplo }; });
  }

  /**
   * Modo remoto: POST { pregunta, contexto: VF.calc.resumenParaIA(estado) } al endpoint configurado.
   * Devuelve Promise<{ texto, remoto:true }>; rechaza si no hay endpoint, hay error de red, tiempo
   * límite (15 s) o la respuesta no trae `texto`. Nunca envía descripciones, contrapartes ni contraseñas.
   */
  function responderRemoto(pregunta, estado) {
    var url = estado && estado.ajustes && String(estado.ajustes.asistenteEndpoint || '').trim();
    if (!url) return Promise.reject(new Error('SIN_ENDPOINT'));
    if (typeof fetch !== 'function') return Promise.reject(new Error('SIN_FETCH'));
    var cuerpo = JSON.stringify({ pregunta: String(pregunta || ''), contexto: C.resumenParaIA(estado) });
    var controlador = typeof AbortController === 'function' ? new AbortController() : null;
    var temporizador = null;
    var peticion = new Promise(function (resolver, rechazar) {
      temporizador = setTimeout(function () {
        if (controlador) controlador.abort();
        rechazar(new Error('TIEMPO_AGOTADO'));
      }, TIEMPO_REMOTO_MS);
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cuerpo, signal: controlador ? controlador.signal : undefined, credentials: 'omit', referrerPolicy: 'no-referrer' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP_' + res.status);
          return res.json();
        })
        .then(function (datos) {
          if (!datos || typeof datos.texto !== 'string' || !datos.texto.trim()) throw new Error('RESPUESTA_INVALIDA');
          resolver({ texto: datos.texto.trim(), remoto: true });
        })
        .catch(function (e) { rechazar(e instanceof Error ? e : new Error(String(e))); });
    });
    return peticion.then(function (r) { clearTimeout(temporizador); return r; }, function (e) { clearTimeout(temporizador); throw e; });
  }

  /* ======================================================================
   * Vista #/asistente (sólo si existe el DOM y el resto del núcleo)
   * ==================================================================== */
  var historial = [];          // [{ rol:'usuario', texto } | { rol:'asistente', respuesta, nota, remoto }]
  var ocupado = false;
  var temporizadorCambio = null;
  var hayVista = typeof document !== 'undefined' && !!(VF.ui && VF.store && VF.router);

  /**
   * Estilos propios del módulo. Desde la integración viven en css/app.css (sección "Asistente", que fija
   * `--vf-asistente-css: 1` en :root como señal). Esta copia sólo se inyecta como respaldo si la hoja de
   * estilos cargada no la trae (p. ej. una caché antigua del service worker).
   */
  var ESTILOS = [
    '.asistente-tarjeta{padding:14px}',
    '.asistente-chat{min-height:120px}',
    '.asistente-chat .burbuja{max-width:100%;overflow-wrap:anywhere}',
    '.asistente-chat .burbuja-usuario{max-width:92%;font-weight:500}',
    '.asistente-chat .burbuja-asistente{width:100%;max-width:100%}',
    '.burbuja-asistente .asistente-texto{margin:0 0 8px;line-height:1.5}',
    '.asistente-seccion{margin:10px 0 0;padding-top:8px;border-top:1px dashed var(--borde)}',
    '.asistente-seccion:first-child{border-top:0;padding-top:0;margin-top:0}',
    '.asistente-subtitulo{font-size:0.9rem;margin:0 0 6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
    '.asistente-kv{padding:4px 0;font-size:0.95rem;flex-wrap:nowrap}',
    '.asistente-kv>span{flex:1;min-width:0}',
    '.asistente-kv strong{white-space:nowrap;flex:none}',
    '.asistente-nota{font-size:0.8rem;margin:8px 0 0}',
    '.asistente-tabla-env{margin-top:8px}',
    '.asistente-tabla{font-size:0.86rem}',
    '.asistente-tabla th,.asistente-tabla td{padding:7px 6px}',
    '.asistente-tabla th:first-child,.asistente-tabla td:first-child{padding-left:0}',
    '.asistente-tabla th:last-child,.asistente-tabla td:last-child{padding-right:0}',
    '.asistente-lista{list-style:none;margin:6px 0 0;padding:0}',
    '.asistente-item{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--borde)}',
    '.asistente-item:last-child{border-bottom:0}',
    '.asistente-item-texto{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
    '.asistente-item-titulo{font-weight:600;font-size:0.92rem;overflow-wrap:anywhere}',
    '.asistente-item-sub{font-size:0.8rem;color:var(--texto-2);overflow-wrap:anywhere}',
    '.asistente-item-sub .badge{vertical-align:middle}',
    '.asistente-item-valor{flex:none;white-space:nowrap;font-size:0.92rem}',
    '.asistente-barra{display:block;margin-top:6px;max-width:260px}',
    '.asistente-barra .barra-relleno{display:block}',
    '.asistente-ayuda .asistente-item-titulo{font-weight:500}',
    '.asistente-ejemplo{min-height:32px;padding:4px 0;font-weight:500;text-align:left;white-space:normal}',
    '.asistente-enlaces{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}',
    '.asistente-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;font-size:0.75rem;color:var(--texto-3)}',
    '.asistente-chips{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 6px;margin-top:12px;-webkit-overflow-scrolling:touch;scrollbar-width:thin}',
    '.asistente-chips .chip{flex:none;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;line-height:22px}',
    '.asistente-chips[data-vacio="true"]{flex-wrap:wrap;overflow:visible}',
    '.asistente-chips[data-vacio="true"] .chip{white-space:normal;max-width:100%;line-height:1.3}',
    '@media (min-width:900px){.asistente-chips{flex-wrap:wrap;overflow:visible}.asistente-chips .chip{white-space:normal;line-height:1.3}}',
    '.asistente-form{display:flex;gap:8px;align-items:center;position:sticky;bottom:calc(var(--altura-nav-inferior) + var(--safe-bottom));background:var(--superficie);padding:10px 14px 12px;margin:6px -14px -14px;border-top:1px solid var(--borde);border-radius:0 0 var(--radio) var(--radio);z-index:2}',
    '@media (min-width:900px){.asistente-form{bottom:0}}',
    '.asistente-form .entrada{flex:1;min-width:0;min-height:48px;border:1px solid var(--borde-2);border-radius:12px;padding:11px 14px;background:var(--superficie);color:var(--texto);font:inherit;font-size:17px;-webkit-appearance:none;appearance:none}',
    '.asistente-form .entrada:focus{border-color:var(--acento);box-shadow:var(--foco);outline:none}',
    '.asistente-form .btn{flex:none;height:48px}',
    '.asistente-pensando{display:inline-flex;align-items:center;gap:8px;color:var(--texto-2)}',
    '.asistente-pensando::before{content:"";width:14px;height:14px;border-radius:50%;border:2px solid var(--borde-2);border-top-color:var(--acento);animation:asistente-giro 0.8s linear infinite}',
    '@keyframes asistente-giro{to{transform:rotate(360deg)}}'
  ].join('\n');

  function asegurarEstilos() {
    if (document.getElementById('asistente-estilos')) return;
    try {
      if (String(getComputedStyle(document.documentElement).getPropertyValue('--vf-asistente-css') || '').trim()) return;
    } catch (e) { /* sin getComputedStyle: se inyecta el respaldo */ }
    var s = document.createElement('style');
    s.id = 'asistente-estilos';
    s.textContent = ESTILOS;
    document.head.appendChild(s);
  }

  function estado() { return VF.store.estado(); }
  function endpointConfigurado() {
    var est = VF.store.estaDesbloqueado() ? estado() : null;
    return !!(est && est.ajustes && String(est.ajustes.asistenteEndpoint || '').trim());
  }

  function render(contenedor, params) {
    var p = params || {};
    asegurarEstilos();
    contenedor.innerHTML =
      '<div class="vista-cabecera">' +
      '<div><h1>Asistente</h1><p class="texto-2 mb-0">Responde con tus cifras reales, sin salir de este dispositivo. Empresa y personal siempre por separado.</p></div>' +
      '<div class="vista-acciones">' +
      '<button type="button" class="btn btn-fantasma btn-chico" data-accion="asistente-ayuda">' + VF.ui.icono('ayuda') + '<span>Qué puedo preguntar</span></button>' +
      '<button type="button" class="btn btn-fantasma btn-chico" data-accion="asistente-limpiar"' + (historial.length ? '' : ' hidden') + '>' + VF.ui.icono('eliminar') + '<span>Limpiar</span></button>' +
      '</div></div>' +
      '<section class="tarjeta asistente-tarjeta" aria-labelledby="asistente-titulo-chat">' +
      '<h2 id="asistente-titulo-chat" class="sr-solo">Conversación</h2>' +
      '<div id="asistente-chat" class="chat asistente-chat" role="log" aria-live="polite" aria-relevant="additions"></div>' +
      '<div id="asistente-chips" class="asistente-chips" role="group" aria-label="Preguntas sugeridas"></div>' +
      '<form id="asistente-form" class="asistente-form" autocomplete="off">' +
      '<label for="asistente-entrada" class="sr-solo">Escribe tu pregunta</label>' +
      '<input id="asistente-entrada" class="entrada" type="text" placeholder="Escribe tu pregunta…" enterkeyhint="send" maxlength="300" autocapitalize="sentences">' +
      '<button type="submit" class="btn btn-primario btn-icono" aria-label="Enviar pregunta" title="Enviar">' + VF.ui.icono('enviar') + '</button>' +
      '</form>' +
      '</section>';
    pintarChat();
    pintarChips();
    if (p.pregunta) {
      // Evita repetir la pregunta en cada re-render (p. ej. tras 'cambio'): se limpia el hash.
      try { history.replaceState(null, '', '#/asistente'); } catch (e) { /* file:// en algunos navegadores */ }
      preguntar(p.pregunta);
    }
  }

  function burbujaUsuario(texto) {
    return '<div class="burbuja burbuja-usuario" data-rol="usuario"><p class="mb-0">' + esc(texto) + '</p></div>';
  }
  function burbujaAsistente(entrada) {
    var r = entrada.respuesta;
    var html = '<article class="burbuja burbuja-asistente" data-rol="asistente" data-intent="' + esc(r.intent) + '"' + (r.ambito ? ' data-ambito="' + esc(r.ambito) + '"' : '') + '>';
    if (entrada.remoto) html += parrafo(r.texto);
    else html += r.html || parrafo(r.texto);
    if (r.enlaces && r.enlaces.length) {
      html += '<p class="asistente-enlaces mb-0">' + r.enlaces.map(function (e, i) {
        return '<a class="btn ' + (i === 0 ? 'btn-secundario' : 'btn-fantasma') + ' btn-chico" href="#/' + esc(e.ruta) + '">' + esc(i === 0 ? 'Ver detalle · ' + String(e.texto).replace(/^Ver /, '') : e.texto) + '</a>';
      }).join('') + '</p>';
    }
    html += '<p class="asistente-meta mb-0">' +
      (entrada.remoto ? badgeEstado('Servidor de IA', 'info') : badgeEstado('Motor local', 'neutro')) +
      (r.ambito ? badge(r.ambito) : (r.intent !== 'ayuda' && r.intent !== 'desconocido' ? badgeEstado('Ambos ámbitos', 'combinado') : '')) +
      (r.periodo ? '<span>' + esc(capitalizar(r.periodo.etiqueta)) + '</span>' : '') +
      (entrada.nota ? '<span class="alerta">' + esc(entrada.nota) + '</span>' : '') +
      '</p></article>';
    return html;
  }
  function burbujaBienvenida() {
    var est = VF.store.estaDesbloqueado() ? estado() : null;
    var nombre = est && est.ajustes && est.ajustes.nombreUsuario ? est.ajustes.nombreUsuario : '';
    return '<article class="burbuja burbuja-asistente" data-rol="bienvenida"><p class="mb-1">' +
      esc('Hola' + (nombre ? ', ' + nombre : '') + '. Pregúntame sobre tus finanzas: te respondo con las cifras reales de ' + (est ? nombreEmpresa(est) : 'tu empresa') + ' y de tus cuentas personales, siempre por separado.') +
      '</p><p class="texto-2 mb-0">Toca una pregunta sugerida o escribe la tuya y pulsa Enter.' +
      (endpointConfigurado() ? ' Hay un servidor de IA configurado en Ajustes: se le enviará sólo un resumen numérico, sin descripciones ni contrapartes.' : '') + '</p></article>';
  }

  function pintarChat() {
    var chat = document.getElementById('asistente-chat');
    if (!chat) return;
    var html = historial.length ? historial.map(function (h) { return h.rol === 'usuario' ? burbujaUsuario(h.texto) : burbujaAsistente(h); }).join('') : burbujaBienvenida();
    chat.innerHTML = html;
    var btn = document.querySelector('[data-accion="asistente-limpiar"]');
    if (btn) btn.hidden = !historial.length;
  }

  function pintarChips() {
    var cont = document.getElementById('asistente-chips');
    if (!cont) return;
    cont.setAttribute('data-vacio', historial.length ? 'false' : 'true');
    cont.innerHTML = PREGUNTAS_SUGERIDAS.map(function (q) {
      return '<button type="button" class="chip" data-accion="asistente-chip" data-pregunta="' + esc(q) + '" title="' + esc(q) + '">' + esc(q) + '</button>';
    }).join('');
  }

  function agregarBurbuja(html) {
    var chat = document.getElementById('asistente-chat');
    if (!chat) return null;
    if (chat.querySelector('[data-rol="bienvenida"]')) chat.innerHTML = '';
    var nodo = VF.ui.el(html);
    chat.appendChild(nodo);
    return nodo;
  }
  function desplazarA(nodo) {
    if (!nodo || typeof nodo.scrollIntoView !== 'function') return;
    try { nodo.scrollIntoView({ block: 'nearest', behavior: 'auto' }); } catch (e) { nodo.scrollIntoView(); }
  }

  /**
   * Procesa una pregunta: la añade al historial, consulta el servidor de IA si está configurado
   * (con respaldo al motor local) y pinta la respuesta. Devuelve Promise<respuesta>.
   */
  function preguntar(texto) {
    var pregunta = String(texto == null ? '' : texto).trim();
    if (!pregunta || !VF.store.estaDesbloqueado()) return Promise.resolve(null);
    var est = estado();
    historial.push({ rol: 'usuario', texto: pregunta });
    agregarBurbuja(burbujaUsuario(pregunta));
    var chips = document.getElementById('asistente-chips');
    if (chips) chips.setAttribute('data-vacio', 'false');
    var btnLimpiar = document.querySelector('[data-accion="asistente-limpiar"]');
    if (btnLimpiar) btnLimpiar.hidden = false;

    var local = responder(pregunta, est);
    function terminar(entrada) {
      historial.push(entrada);
      var pensando = document.getElementById('asistente-pensando');
      if (pensando) pensando.remove();
      var nodo = agregarBurbuja(burbujaAsistente(entrada));
      desplazarA(nodo);
      ocupado = false;
      return entrada.respuesta;
    }
    if (!(est.ajustes && String(est.ajustes.asistenteEndpoint || '').trim())) {
      return Promise.resolve(terminar({ rol: 'asistente', respuesta: local, remoto: false, nota: '' }));
    }
    ocupado = true;
    var espera = agregarBurbuja('<article class="burbuja burbuja-asistente" id="asistente-pensando" aria-busy="true"><span class="asistente-pensando">Consultando al servidor de IA…</span></article>');
    desplazarA(espera);
    return responderRemoto(pregunta, est).then(function (rem) {
      return terminar({ rol: 'asistente', remoto: true, nota: '', respuesta: { texto: rem.texto, html: parrafo(rem.texto), intent: local.intent, ambito: local.ambito, periodo: null, enlaces: local.enlaces, pregunta: pregunta } });
    }, function (e) {
      var motivo = e && e.message === 'TIEMPO_AGOTADO' ? 'no respondió en 15 s' : e && /^HTTP_/.test(e.message) ? 'devolvió error ' + e.message.slice(5) : 'no está disponible';
      return terminar({ rol: 'asistente', respuesta: local, remoto: false, nota: 'El servidor de IA ' + motivo + '; esta respuesta la calculó el motor local.' });
    });
  }

  function limpiarHistorial() {
    historial = [];
    ocupado = false;
    pintarChat();
    pintarChips();
  }

  /* ---------- eventos (delegación data-accion="asistente-…") -------------- */
  if (hayVista) {
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-accion^="asistente-"]') : null;
      if (!t || !VF.store.estaDesbloqueado()) return;
      var accion = t.getAttribute('data-accion');
      if (accion === 'asistente-chip') {
        e.preventDefault();
        if (ocupado) return;
        preguntar(t.getAttribute('data-pregunta') || t.textContent);
        var entrada = document.getElementById('asistente-entrada');
        if (entrada) entrada.focus({ preventScroll: true });
      } else if (accion === 'asistente-limpiar') {
        limpiarHistorial();
      } else if (accion === 'asistente-ayuda') {
        if (!ocupado) preguntar('¿Qué puedes hacer?');
      }
    });
    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form || form.id !== 'asistente-form') return;
      e.preventDefault();
      if (ocupado) return;
      var entrada = document.getElementById('asistente-entrada');
      var texto = entrada ? entrada.value : '';
      if (!String(texto).trim()) { if (entrada) entrada.focus(); return; }
      if (entrada) entrada.value = '';
      preguntar(texto);
    });

    VF.store.on('cambio', function () {
      clearTimeout(temporizadorCambio);
      temporizadorCambio = setTimeout(function () {
        if (!VF.store.estaDesbloqueado()) return;
        if (VF.router.actual().ruta !== 'asistente') return;
        var vista = document.getElementById('vista');
        var entrada = document.getElementById('asistente-entrada');
        var borrador = entrada ? entrada.value : '';
        if (vista) render(vista, {});
        var nueva = document.getElementById('asistente-entrada');
        if (nueva && borrador) nueva.value = borrador;
      }, 30);
    });
    // Privacidad: al bloquear se olvida la conversación.
    VF.store.on('bloqueado', function () { historial = []; ocupado = false; });

    VF.router.registrar('asistente', { titulo: 'Asistente', icono: 'asistente', nav: 'principal', render: render });
  }

  VF.asistente = {
    responder: responder,
    intenciones: intenciones,
    responderRemoto: responderRemoto,
    preguntas: function () { return PREGUNTAS_SUGERIDAS.slice(); },
    detectar: function (pregunta, estado) {
      var n = limpiar(pregunta);
      var ambito = detectarAmbito(n);
      var periodo = detectarPeriodo(n);
      return { normalizada: n, ambito: ambito, periodo: periodo, intent: detectarIntent(n, estado || {}, ambito, periodo).intent };
    },
    preguntar: hayVista ? preguntar : null,
    historial: function () { return historial.slice(); },
    limpiar: hayVista ? limpiarHistorial : function () { historial = []; },
    render: hayVista ? render : null
  };
})(window.VF);
