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
  function mas(n, texto) { return n > 0 ? nota('… y ' + plural(n, texto || 'más')) : ''; }
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
    utilidad: /\b(utilidad|utilidades|ganancia|ganancias|gane|ganamos|ganado|margen|resultado|resultados|rentabilidad|rentable|beneficio|beneficios|perdida|perdidas|perdi|perdimos|estado de resultados)\b/,
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
      if (puntos) candidatas.push({ cuenta: c, puntos: puntos });
    });
    if (!candidatas.length) return [];
    var maximo = Math.max.apply(null, candidatas.map(function (x) { return x.puntos; }));
    var lista = candidatas.filter(function (x) { return x.puntos === maximo; }).map(function (x) { return x.cuenta; });
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
