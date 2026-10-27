'use strict';
window.VF = window.VF || {};
/**
 * VF.seed — estado vacío por defecto y datos FICTICIOS de ejemplo.
 *
 * Los datos de ejemplo describen a "VILLEDA Inc", un despacho de arquitectura y construcción
 * mexicano, y las finanzas personales de su socio. Todas las fechas se calculan en relación con
 * hoy (VF.util.hoy()): últimos 120 días de movimientos y vencimientos en los próximos 45 días.
 * Todos los ids terminan en '_demo' para que VF.store.borrarDatosEjemplo() pueda eliminarlos.
 * Nada de lo que aparece aquí corresponde a personas, empresas ni cuentas reales.
 */
(function (VF) {
  var CATEGORIAS_POR_DEFECTO = {
    empresa: {
      ingreso: ['Ventas', 'Servicios', 'Anticipos', 'Otros ingresos', 'Aportación de capital'],
      gasto: ['Nómina', 'Renta', 'Proveedores', 'Materiales', 'Comisiones', 'Servicios (luz, agua, internet)',
        'Impuestos', 'Software', 'Transporte', 'Publicidad', 'Honorarios', 'Préstamos', 'Retiro de socio', 'Otros gastos']
    },
    personal: {
      ingreso: ['Sueldo', 'Retiro de socio', 'Intereses', 'Otros ingresos'],
      gasto: ['Vivienda', 'Supermercado', 'Restaurantes', 'Transporte', 'Gasolina', 'Salud', 'Educación',
        'Entretenimiento', 'Suscripciones', 'Ropa', 'Tarjeta de crédito', 'Préstamos', 'Ahorro', 'Aportación de capital', 'Otros gastos']
    }
  };

  var CATEGORIA_TRANSFERENCIA = 'Transferencia entre cuentas';

  function copiarCategorias() {
    return {
      empresa: {
        ingreso: CATEGORIAS_POR_DEFECTO.empresa.ingreso.slice(),
        gasto: CATEGORIAS_POR_DEFECTO.empresa.gasto.slice()
      },
      personal: {
        ingreso: CATEGORIAS_POR_DEFECTO.personal.ingreso.slice(),
        gasto: CATEGORIAS_POR_DEFECTO.personal.gasto.slice()
      }
    };
  }

  function ajustesPorDefecto() {
    return {
      nombreUsuario: 'Zeus',
      nombreEmpresa: 'VILLEDA Inc',
      moneda: 'MXN',
      autobloqueoMin: 5,
      reservaOperativaDias: 30,
      asistenteEndpoint: '',
      tema: 'auto',
      datosEjemplo: false
    };
  }

  /** Estado vacío con categorías y ajustes por defecto. */
  function vacio() {
    return {
      version: 1,
      ajustes: ajustesPorDefecto(),
      cuentas: [],
      movimientos: [],
      clientes: [],
      facturas: [],
      proveedores: [],
      cuentasPorPagar: [],
      comisiones: [],
      prestamos: [],
      presupuestos: [],
      metas: [],
      categorias: copiarCategorias()
    };
  }

  // ---------- Datos de ejemplo ----------

  function datos() {
    var U = VF.util;
    var hoy = U.hoy();
    var ahora = new Date().toISOString();
    var limiteInferior = U.sumarDias(hoy, -120);
    var r2 = U.round2;

    var estado = vacio();
    estado.ajustes.datosEjemplo = true;

    /** hoy + n días. */
    function d(n) { return U.sumarDias(hoy, n); }

    /** Día `dia` del mes actual menos `k` meses (día ajustado al máximo del mes). null si cae en el futuro o antes de 120 días. */
    function diaDelMes(k, dia) {
      var base = U.parseFecha(hoy);
      var y = base.getFullYear();
      var m = base.getMonth() - k;
      var ultimoDia = new Date(y, m + 1, 0).getDate();
      var iso = U.fechaISO(new Date(y, m, Math.min(dia, ultimoDia)));
      if (iso > hoy || iso < limiteInferior) return null;
      return iso;
    }

    /** iso + n meses, conservando el día (ajustado al máximo del mes). */
    function sumarMeses(iso, n) {
      var f = U.parseFecha(iso);
      var dia = f.getDate();
      var destino = new Date(f.getFullYear(), f.getMonth() + n, 1);
      var ultimoDia = new Date(destino.getFullYear(), destino.getMonth() + 1, 0).getDate();
      destino.setDate(Math.min(dia, ultimoDia));
      return U.fechaISO(destino);
    }

    /** Ajusta el día del mes a un máximo (p. ej. 28) para que los pagos mensuales siempre existan. */
    function conDiaMaximo(iso, maximo) {
      var f = U.parseFecha(iso);
      if (f.getDate() > maximo) f.setDate(maximo);
      return U.fechaISO(f);
    }

    function pagoMensual(principal, tasaAnual, plazoMeses) {
      if (!tasaAnual) return r2(principal / plazoMeses);
      var r = tasaAnual / 100 / 12;
      return r2(principal * r / (1 - Math.pow(1 + r, -plazoMeses)));
    }

    var contador = 0;
    function idMov(etiqueta) {
      contador += 1;
      return 'mov_' + etiqueta + '_' + contador + '_demo';
    }

    var cuentaPorId = {};

    function cuenta(c) {
      var registro = Object.assign({
        moneda: 'MXN', limiteCredito: null, diaCorte: null, diaPago: null, activa: true,
        creado: ahora, actualizado: ahora
      }, c);
      estado.cuentas.push(registro);
      cuentaPorId[registro.id] = registro;
      return registro;
    }

    /** Movimiento. `extra` permite contraparte, estado, vínculos, etiquetas, cuentaDestinoId. */
    function mov(etiqueta, cuentaId, tipo, monto, fecha, categoria, descripcion, extra) {
      if (!fecha) return null;
      var origen = cuentaPorId[cuentaId];
      var registro = Object.assign({
        id: idMov(etiqueta),
        ambito: origen.ambito,
        cuentaId: cuentaId,
        tipo: tipo,
        monto: r2(monto),
        fecha: fecha,
        categoria: categoria,
        descripcion: descripcion,
        contraparte: '',
        cuentaDestinoId: null,
        facturaId: null,
        cxpId: null,
        prestamoId: null,
        comisionId: null,
        estado: 'confirmado',
        etiquetas: [],
        creado: ahora,
        actualizado: ahora
      }, extra || {});
      estado.movimientos.push(registro);
      return registro;
    }

    /** Transferencia; si cambia de ámbito, categoría 'Retiro de socio' / 'Aportación de capital'. */
    function transferencia(etiqueta, origenId, destinoId, monto, fecha, descripcion, categoriaMismoAmbito) {
      if (!fecha) return null;
      var origen = cuentaPorId[origenId];
      var destino = cuentaPorId[destinoId];
      var categoria = categoriaMismoAmbito || CATEGORIA_TRANSFERENCIA;
      if (origen.ambito !== destino.ambito) {
        categoria = origen.ambito === 'empresa' ? 'Retiro de socio' : 'Aportación de capital';
      }
      return mov(etiqueta, origenId, 'transferencia', monto, fecha, categoria, descripcion, {
        cuentaDestinoId: destinoId,
        contraparte: destino.nombre
      });
    }

    /** Repite una operación mensual para los últimos 4 meses (sólo fechas válidas). */
    function mensual(dia, fn) {
      for (var k = 0; k < 4; k++) {
        var fecha = diaDelMes(k, dia);
        if (fecha) fn(fecha, k);
      }
    }

    // ----- Cuentas: empresa (3) -----
    cuenta({ id: 'cta_emp_bbva_demo', ambito: 'empresa', nombre: 'Mercado Pago Empresa', banco: 'Mercado Pago', tipo: 'billetera', saldoInicial: 420000, color: '#1D4ED8' });
    cuenta({ id: 'cta_emp_banorte_demo', ambito: 'empresa', nombre: 'Nu Empresa', banco: 'Nu', tipo: 'cheques', saldoInicial: 62000, color: '#B91C1C' });
    cuenta({ id: 'cta_emp_caja_demo', ambito: 'empresa', nombre: 'Caja chica', banco: 'Efectivo', tipo: 'efectivo', saldoInicial: 8500, color: '#B45309' });

    // ----- Cuentas: personal (4, una de crédito con deuda) -----
    cuenta({ id: 'cta_per_nu_demo', ambito: 'personal', nombre: 'Nu Cuenta', banco: 'Nu', tipo: 'cheques', saldoInicial: 18000, color: '#7C3AED' });
    cuenta({ id: 'cta_per_santander_demo', ambito: 'personal', nombre: 'BBVA Débito', banco: 'BBVA', tipo: 'cheques', saldoInicial: 48000, color: '#DC2626' });
    cuenta({ id: 'cta_per_ahorro_demo', ambito: 'personal', nombre: 'Mercado Pago', banco: 'Mercado Pago', tipo: 'ahorro', saldoInicial: 60000, color: '#047857' });
    cuenta({ id: 'cta_per_tdc_demo', ambito: 'personal', nombre: 'Tarjeta Nu', banco: 'Nu', tipo: 'credito', saldoInicial: -12450, limiteCredito: 60000, diaCorte: 12, diaPago: 2, color: '#0F766E' });

    var BBVA = 'cta_emp_bbva_demo';
    var BANORTE = 'cta_emp_banorte_demo';
    var CAJA = 'cta_emp_caja_demo';
    var NU = 'cta_per_nu_demo';
    var SANTANDER = 'cta_per_santander_demo';
    var AHORRO = 'cta_per_ahorro_demo';
    var TDC = 'cta_per_tdc_demo';

    // ----- Clientes (5) -----
    var clientes = [
      { id: 'cli_altavista_demo', nombre: 'Desarrollos Altavista SA de CV', rfc: 'DAL180512KJ3', email: 'pagos@altavista-ejemplo.mx', telefono: '55 5555 0101', notas: 'Torre de oficinas Altavista. Pagan a 30 días vía transferencia.' },
      { id: 'cli_fontana_demo', nombre: 'Hotel Boutique La Fontana', rfc: 'HBF150923QA7', email: 'administracion@lafontana-ejemplo.mx', telefono: '55 5555 0102', notas: 'Remodelación de lobby y recepción.' },
      { id: 'cli_hernandez_demo', nombre: 'Mariana Hernández Ruiz (Residencia Lomas)', rfc: 'HERM850614ABC', email: 'mariana@correo-ejemplo.mx', telefono: '55 5555 0103', notas: 'Casa habitación. Suele pagar en dos partes.' },
      { id: 'cli_montealban_demo', nombre: 'Constructora Monte Albán SA de CV', rfc: 'CMA120307RT9', email: 'tesoreria@montealban-ejemplo.mx', telefono: '55 5555 0104', notas: 'Subcontrato de supervisión de obra. Historial de atrasos.' },
      { id: 'cli_sonrisa_demo', nombre: 'Clínica Dental Sonrisa Integral', rfc: 'CDS190821LM2', email: 'contacto@sonrisaintegral-ejemplo.mx', telefono: '55 5555 0105', notas: 'Diseño de interiores de consultorio.' }
    ];
    clientes.forEach(function (c) { estado.clientes.push(Object.assign({ creado: ahora, actualizado: ahora }, c)); });

    // ----- Facturas (8): 2 pagadas, 2 parciales, 1 vencida, 3 emitidas vigentes -----
    function factura(f) {
      var subtotal = r2(f.subtotal);
      var iva = r2(subtotal * 0.16);
      var registro = Object.assign({
        estado: 'emitida', pagos: [], uuidCfdi: '', notas: '', creado: ahora, actualizado: ahora
      }, f, { subtotal: subtotal, iva: iva, total: r2(subtotal + iva) });
      estado.facturas.push(registro);
      return registro;
    }

    /** Registra un pago de factura y su movimiento de ingreso vinculado. */
    function pagoFactura(f, numero, fecha, monto, cuentaId, categoria) {
      var cliente = estado.clientes.filter(function (c) { return c.id === f.clienteId; })[0];
      var m = mov('pagofac', cuentaId, 'ingreso', monto, fecha, categoria || 'Ventas',
        'Pago de factura ' + f.folio + ' — ' + f.concepto, { facturaId: f.id, contraparte: cliente.nombre });
      f.pagos.push({ id: 'pago_' + f.folio.toLowerCase().replace('-', '') + '_' + numero + '_demo', fecha: fecha, monto: r2(monto), cuentaId: cuentaId, movimientoId: m.id });
    }

    var f1 = factura({ id: 'fac_0001_demo', folio: 'F-0001', clienteId: 'cli_altavista_demo', fechaEmision: d(-110), fechaVencimiento: d(-80), concepto: 'Anticipo 30 % proyecto ejecutivo Torre Altavista', subtotal: 250000, uuidCfdi: '3FA85F64-5717-4562-B3FC-2C963F66AFA6' });
    pagoFactura(f1, 1, d(-95), f1.total, BBVA, 'Anticipos');

    var f2 = factura({ id: 'fac_0002_demo', folio: 'F-0002', clienteId: 'cli_fontana_demo', fechaEmision: d(-85), fechaVencimiento: d(-55), concepto: 'Remodelación de lobby y recepción — estimación 1', subtotal: 180000, uuidCfdi: '8B1D2C3E-4F50-4A6B-9C7D-1E2F3A4B5C6D' });
    pagoFactura(f2, 1, d(-60), f2.total, BBVA);

    var f3 = factura({ id: 'fac_0003_demo', folio: 'F-0003', clienteId: 'cli_hernandez_demo', fechaEmision: d(-70), fechaVencimiento: d(-40), concepto: 'Proyecto arquitectónico Residencia Lomas', subtotal: 95000, notas: 'Acordado pago en dos exhibiciones; falta la segunda.' });
    pagoFactura(f3, 1, d(-45), r2(f3.total / 2), BANORTE);

    factura({ id: 'fac_0004_demo', folio: 'F-0004', clienteId: 'cli_montealban_demo', fechaEmision: d(-50), fechaVencimiento: d(-20), concepto: 'Supervisión de obra — mes 1', subtotal: 60000, notas: 'Vencida. Se envió recordatorio a tesorería.' });

    var f5 = factura({ id: 'fac_0005_demo', folio: 'F-0005', clienteId: 'cli_altavista_demo', fechaEmision: d(-35), fechaVencimiento: d(10), concepto: 'Proyecto ejecutivo Torre Altavista — estimación 2', subtotal: 320000, uuidCfdi: 'C1D2E3F4-0516-4789-ABCD-EF0123456789' });
    pagoFactura(f5, 1, d(-12), 150000, BBVA);

    factura({ id: 'fac_0006_demo', folio: 'F-0006', clienteId: 'cli_sonrisa_demo', fechaEmision: d(-20), fechaVencimiento: d(10), concepto: 'Diseño de interiores y mobiliario de consultorio', subtotal: 48000 });
    factura({ id: 'fac_0007_demo', folio: 'F-0007', clienteId: 'cli_fontana_demo', fechaEmision: d(-8), fechaVencimiento: d(22), concepto: 'Remodelación de lobby y recepción — estimación 2', subtotal: 210000 });
    factura({ id: 'fac_0008_demo', folio: 'F-0008', clienteId: 'cli_montealban_demo', fechaEmision: d(-3), fechaVencimiento: d(27), concepto: 'Supervisión de obra — mes 2', subtotal: 60000 });

    // ----- Proveedores (4) -----
    var proveedores = [
      { id: 'prov_cementos_demo', nombre: 'Cementos y Agregados del Bajío SA de CV', rfc: 'CAB090415HG8', categoria: 'Materiales', contacto: 'Ing. Laura Medina', telefono: '477 555 0201', email: 'ventas@cementosbajio-ejemplo.mx', notas: 'Crédito a 30 días.' },
      { id: 'prov_ferreteria_demo', nombre: 'Ferretería Industrial Hermanos López', rfc: 'FIH011120ZX1', categoria: 'Materiales', contacto: 'Sr. Jorge López', telefono: '55 5555 0202', email: 'pedidos@ferrelopez-ejemplo.mx', notas: '' },
      { id: 'prov_salinas_demo', nombre: 'Ing. Roberto Salinas — Cálculo estructural', rfc: 'SARO780302KL5', categoria: 'Honorarios', contacto: 'Roberto Salinas', telefono: '55 5555 0203', email: 'rsalinas@correo-ejemplo.mx', notas: 'Honorarios por proyecto.' },
      { id: 'prov_nunez_demo', nombre: 'Despacho Contable Núñez y Asociados', rfc: 'DCN050918PQ4', categoria: 'Honorarios', contacto: 'C.P. Elena Núñez', telefono: '55 5555 0204', email: 'contacto@nunezasociados-ejemplo.mx', notas: 'Iguala trimestral.' }
    ];
    proveedores.forEach(function (p) { estado.proveedores.push(Object.assign({ creado: ahora, actualizado: ahora }, p)); });

    // ----- Cuentas por pagar (6): 2 pagadas, 1 parcial vencida, 1 vencida, 2 pendientes -----
    function cxp(c) {
      var registro = Object.assign({ pagos: [], estado: 'pendiente', notas: '', creado: ahora, actualizado: ahora }, c, { monto: r2(c.monto) });
      estado.cuentasPorPagar.push(registro);
      return registro;
    }

    function pagoCxP(c, numero, fecha, monto, cuentaId) {
      var proveedor = estado.proveedores.filter(function (p) { return p.id === c.proveedorId; })[0];
      var m = mov('pagocxp', cuentaId, 'gasto', monto, fecha, 'Proveedores',
        'Pago a proveedor — ' + c.concepto, { cxpId: c.id, contraparte: proveedor.nombre });
      c.pagos.push({ id: c.id.replace('_demo', '') + '_pago_' + numero + '_demo', fecha: fecha, monto: r2(monto), cuentaId: cuentaId, movimientoId: m.id });
    }

    var c1 = cxp({ id: 'cxp_01_demo', proveedorId: 'prov_cementos_demo', concepto: 'Cemento, varilla y grava — cimentación Altavista', fecha: d(-60), fechaVencimiento: d(-30), monto: 86500 });
    pagoCxP(c1, 1, d(-32), c1.monto, BBVA);
    var c2 = cxp({ id: 'cxp_02_demo', proveedorId: 'prov_ferreteria_demo', concepto: 'Herramienta y consumibles de obra', fecha: d(-45), fechaVencimiento: d(-15), monto: 23400 });
    pagoCxP(c2, 1, d(-14), c2.monto, BANORTE);
    var c3 = cxp({ id: 'cxp_03_demo', proveedorId: 'prov_salinas_demo', concepto: 'Cálculo estructural Torre Altavista', fecha: d(-40), fechaVencimiento: d(-10), monto: 75000, notas: 'Se pagó 40 000 a cuenta; resto al entregar memoria de cálculo.' });
    pagoCxP(c3, 1, d(-20), 40000, BBVA);
    cxp({ id: 'cxp_04_demo', proveedorId: 'prov_cementos_demo', concepto: 'Acero y concreto — estimación 2 Altavista', fecha: d(-15), fechaVencimiento: d(15), monto: 142000 });
    cxp({ id: 'cxp_05_demo', proveedorId: 'prov_nunez_demo', concepto: 'Honorarios contables del trimestre', fecha: d(-10), fechaVencimiento: d(5), monto: 18000 });
    cxp({ id: 'cxp_06_demo', proveedorId: 'prov_ferreteria_demo', concepto: 'Impermeabilizante y acabados — Residencia Lomas', fecha: d(-25), fechaVencimiento: d(-5), monto: 31200, notas: 'Vencida; acordar fecha de pago con el proveedor.' });

    // ----- Comisiones (3): 2 pagadas con movimiento, 1 pendiente -----
    function comision(c) {
      var registro = Object.assign({ estado: 'pendiente', movimientoId: null, notas: '', creado: ahora, actualizado: ahora }, c);
      registro.monto = r2(registro.base * registro.porcentaje / 100);
      if (registro.estado === 'pagada') {
        var m = mov('comision', registro.cuentaPagoId, 'gasto', registro.monto, registro.fecha, 'Comisiones',
          'Comisión por venta — factura ' + registro.folioRef, { comisionId: registro.id, contraparte: registro.beneficiario });
        registro.movimientoId = m.id;
      }
      delete registro.cuentaPagoId;
      delete registro.folioRef;
      estado.comisiones.push(registro);
      return registro;
    }

    comision({ id: 'com_01_demo', beneficiario: 'Lic. Andrea Castillo (ventas)', facturaId: 'fac_0001_demo', folioRef: 'F-0001', base: 250000, porcentaje: 3, fecha: d(-90), estado: 'pagada', cuentaPagoId: BANORTE });
    comision({ id: 'com_02_demo', beneficiario: 'Lic. Andrea Castillo (ventas)', facturaId: 'fac_0002_demo', folioRef: 'F-0002', base: 180000, porcentaje: 3, fecha: d(-55), estado: 'pagada', cuentaPagoId: BANORTE });
    comision({ id: 'com_03_demo', beneficiario: 'Arq. Diego Ramírez (referido)', facturaId: 'fac_0005_demo', folioRef: 'F-0005', base: 320000, porcentaje: 2.5, fecha: d(-10), estado: 'pendiente', notas: 'Se paga al cobrar el total de la factura.' });

    // ----- Préstamos (3): empresa recibido, personal recibido, personal otorgado -----
    /**
     * Crea un préstamo y registra `numPagos` pagos mensuales ya realizados con capital/interés
     * coherentes con la amortización francesa, cada uno con su movimiento vinculado.
     */
    function prestamo(p, numPagos, cuentaId, categoriaMov, tipoMov, descripcionMov) {
      var registro = Object.assign({ pagos: [], estado: 'activo', notas: '', creado: ahora, actualizado: ahora }, p);
      registro.fechaInicio = conDiaMaximo(registro.fechaInicio, 28);
      registro.diaPago = U.parseFecha(registro.fechaInicio).getDate();
      var r = registro.tasaAnual / 100 / 12;
      var pago = pagoMensual(registro.principal, registro.tasaAnual, registro.plazoMeses);
      var saldo = registro.principal;
      for (var k = 1; k <= numPagos; k++) {
        var fecha = sumarMeses(registro.fechaInicio, k);
        if (fecha > hoy) break;
        var interes = r2(saldo * r);
        var capital = r2(pago - interes);
        if (capital > saldo) capital = r2(saldo);
        var montoPago = r2(capital + interes);
        var m = mov('prestamo', cuentaId, tipoMov, montoPago, fecha, categoriaMov,
          descripcionMov + ' — pago ' + k + ' de ' + registro.plazoMeses, { prestamoId: registro.id, contraparte: registro.contraparte });
        registro.pagos.push({ id: registro.id.replace('_demo', '') + '_pago_' + k + '_demo', fecha: fecha, monto: montoPago, capital: capital, interes: interes, movimientoId: m.id });
        saldo = r2(saldo - capital);
      }
      estado.prestamos.push(registro);
      return registro;
    }

    prestamo({
      id: 'pre_emp_pyme_demo', ambito: 'empresa', tipo: 'recibido', contraparte: 'Mercado Crédito — Crédito PyME',
      principal: 500000, tasaAnual: 18, plazoMeses: 36, fechaInicio: d(-100),
      notas: 'Capital de trabajo para Torre Altavista. El desembolso está incluido en el saldo inicial de Mercado Pago Empresa.'
    }, 3, BBVA, 'Préstamos', 'gasto', 'Crédito PyME Mercado Crédito');

    prestamo({
      id: 'pre_per_auto_demo', ambito: 'personal', tipo: 'recibido', contraparte: 'Financiera — Crédito automotriz',
      principal: 280000, tasaAnual: 14.5, plazoMeses: 48, fechaInicio: d(-95),
      notas: 'Camioneta familiar. Desembolso incluido en saldo inicial.'
    }, 3, SANTANDER, 'Préstamos', 'gasto', 'Crédito automotriz');

    prestamo({
      id: 'pre_per_otorgado_demo', ambito: 'personal', tipo: 'otorgado', contraparte: 'Carlos Villeda (hermano)',
      principal: 30000, tasaAnual: 0, plazoMeses: 10, fechaInicio: d(-70),
      notas: 'Préstamo familiar sin intereses; abonos mensuales de 3 000.'
    }, 2, NU, 'Otros ingresos', 'ingreso', 'Abono préstamo a Carlos');

    // ----- Movimientos empresa -----
    mensual(15, function (fecha) { mov('nomina', BANORTE, 'gasto', 41200, fecha, 'Nómina', 'Nómina quincenal — equipo de proyecto y administración', { contraparte: 'Equipo VILLEDA' }); });
    mensual(30, function (fecha) { mov('nomina', BANORTE, 'gasto', 41200, fecha, 'Nómina', 'Nómina quincenal — equipo de proyecto y administración', { contraparte: 'Equipo VILLEDA' }); });
    mensual(3, function (fecha) { mov('renta', BBVA, 'gasto', 18500, fecha, 'Renta', 'Renta de oficina y taller de maquetas', { contraparte: 'Inmobiliaria Reforma 222' }); });
    mensual(8, function (fecha) { mov('cfe', BBVA, 'gasto', 4320, fecha, 'Servicios (luz, agua, internet)', 'CFE — energía eléctrica oficina', { contraparte: 'CFE' }); });
    mensual(12, function (fecha) { mov('internet', BBVA, 'gasto', 1899, fecha, 'Servicios (luz, agua, internet)', 'Internet y telefonía de oficina', { contraparte: 'Telmex' }); });
    mensual(6, function (fecha) { mov('software', BBVA, 'gasto', 3480, fecha, 'Software', 'Licencia mensual de software de diseño (CAD/BIM)', { contraparte: 'Autodesk' }); });
    mensual(20, function (fecha) { mov('software', BBVA, 'gasto', 1250, fecha, 'Software', 'Correo y almacenamiento en la nube del equipo', { contraparte: 'Google Workspace' }); });
    mensual(17, function (fecha) { mov('impuestos', BBVA, 'gasto', 22600, fecha, 'Impuestos', 'Pago provisional ISR e IVA mensual', { contraparte: 'SAT' }); });
    mensual(14, function (fecha) { transferencia('interna', BBVA, BANORTE, 80000, fecha, 'Fondeo de cuenta de nómina'); });
    mensual(2, function (fecha) { transferencia('retiro', BBVA, NU, 25000, fecha, 'Retiro de socio mensual'); });

    transferencia('caja', BBVA, CAJA, 5000, d(-50), 'Reposición de caja chica');
    transferencia('caja', BBVA, CAJA, 5000, d(-20), 'Reposición de caja chica');
    mov('caja', CAJA, 'gasto', 850, d(-45), 'Transporte', 'Viáticos y casetas — visita a obra Altavista', { contraparte: 'Caja chica' });
    mov('caja', CAJA, 'gasto', 1240, d(-38), 'Materiales', 'Tornillería y consumibles para maqueta', { contraparte: 'Ferretería local' });
    mov('caja', CAJA, 'gasto', 620, d(-18), 'Otros gastos', 'Papelería e impresión de planos', { contraparte: 'Papelería Lumen' });
    mov('caja', CAJA, 'gasto', 980, d(-12), 'Transporte', 'Viáticos — supervisión Residencia Lomas', { contraparte: 'Caja chica' });

    [[-5, 1450], [-17, 1380], [-29, 1520], [-41, 1410], [-55, 1495], [-70, 1360]].forEach(function (par) {
      mov('gasolina', BBVA, 'gasto', par[1], d(par[0]), 'Transporte', 'Gasolina camioneta de obra', { contraparte: 'Gasolinera' });
    });
    // Gasto atípico (muy por encima de la mediana de su categoría) para que el asistente lo detecte.
    mov('atipico', BBVA, 'gasto', 9800, d(-9), 'Transporte', 'Renta de grúa y camioneta para montaje de estructura', { contraparte: 'Grúas del Centro' });

    mov('publicidad', BBVA, 'gasto', 3500, d(-62), 'Publicidad', 'Campaña en redes sociales — portafolio residencial', { contraparte: 'Meta Ads' });
    mov('publicidad', BBVA, 'gasto', 2800, d(-21), 'Publicidad', 'Impresión de lonas para obra', { contraparte: 'Imprenta Digital Sur' });
    mov('honorarios', BBVA, 'gasto', 6500, d(-33), 'Honorarios', 'Notaría — ratificación de contrato de obra', { contraparte: 'Notaría 118' });
    mov('servicio', BBVA, 'ingreso', 11600, d(-28), 'Servicios', 'Asesoría técnica — dictamen de factibilidad (recibo de honorarios)', { contraparte: 'Particular' });

    // Movimiento DUPLICADO (misma cuenta, fecha, monto y tipo) para que el asistente lo detecte.
    mov('duplicado', BBVA, 'gasto', 2380, d(-6), 'Materiales', 'Brocas y discos de corte', { id: 'mov_dup_a_demo', contraparte: 'Ferretería Industrial Hermanos López' });
    mov('duplicado', BBVA, 'gasto', 2380, d(-6), 'Materiales', 'Brocas y discos de corte', { id: 'mov_dup_b_demo', contraparte: 'Ferretería Industrial Hermanos López' });

    // Movimiento marcado para REVISAR.
    mov('revisar', BBVA, 'gasto', 15800, d(-4), 'Otros gastos', 'Cargo no identificado — verificar con el banco', { id: 'mov_revisar_demo', estado: 'revisar', contraparte: 'Desconocido', etiquetas: ['revisar'] });

    // ----- Movimientos personales -----
    mensual(28, function (fecha) { mov('sueldo', SANTANDER, 'ingreso', 32000, fecha, 'Sueldo', 'Sueldo mensual como director de VILLEDA Inc', { contraparte: 'VILLEDA Inc' }); });
    mensual(1, function (fecha, k) { mov('intereses', AHORRO, 'ingreso', [481, 474, 468, 455][k], fecha, 'Intereses', 'Rendimientos mensuales de Mercado Pago', { contraparte: 'Mercado Pago' }); });
    mensual(1, function (fecha) { mov('vivienda', SANTANDER, 'gasto', 14500, fecha, 'Vivienda', 'Renta de departamento Col. Roma', { contraparte: 'Arrendador' }); });
    mensual(5, function (fecha) { mov('educacion', SANTANDER, 'gasto', 9800, fecha, 'Educación', 'Colegiatura mensual', { contraparte: 'Colegio Montessori del Valle' }); });
    mensual(3, function (fecha) { transferencia('ahorro', NU, AHORRO, 5000, fecha, 'Ahorro mensual programado', 'Ahorro'); });
    mensual(2, function (fecha, k) { transferencia('pagotdc', NU, TDC, [9200, 8750, 9400, 9100][k], fecha, 'Pago de Tarjeta Nu', 'Tarjeta de crédito'); });
    mensual(5, function (fecha) { mov('suscripcion', TDC, 'gasto', 299, fecha, 'Suscripciones', 'Netflix', { contraparte: 'Netflix' }); });
    mensual(9, function (fecha) { mov('suscripcion', TDC, 'gasto', 179, fecha, 'Suscripciones', 'Spotify Familiar', { contraparte: 'Spotify' }); });
    mensual(14, function (fecha) { mov('suscripcion', TDC, 'gasto', 49, fecha, 'Suscripciones', 'iCloud+ 200 GB', { contraparte: 'Apple' }); });
    mensual(22, function (fecha) { mov('suscripcion', TDC, 'gasto', 599, fecha, 'Suscripciones', 'Gimnasio — membresía mensual', { contraparte: 'Smart Fit' }); });

    var superMontos = [1850, 2340, 1620, 2980, 2110];
    var superTiendas = ['Walmart', 'La Comer', 'Chedraui', 'Costco', 'Soriana'];
    for (var w = 0; w < 17; w++) {
      mov('super', w % 2 === 0 ? NU : TDC, 'gasto', superMontos[w % 5], d(-(w * 7 + 2)), 'Supermercado', 'Despensa semanal', { contraparte: superTiendas[w % 5] });
    }

    [[-3, 890, 'Comida familiar — La Casa de Toño'], [-9, 1260, 'Cena de aniversario — Contramar'], [-16, 540, 'Desayuno de trabajo'],
      [-24, 1780, 'Cena con clientes'], [-33, 720, 'Tacos y antojitos'], [-47, 960, 'Comida de domingo'],
      [-61, 1340, 'Cena cumpleaños'], [-78, 680, 'Café y pan dulce'], [-95, 1120, 'Mariscos — Boca del Río'], [-109, 870, 'Pizza familiar']
    ].forEach(function (t) {
      mov('restaurante', TDC, 'gasto', t[1], d(t[0]), 'Restaurantes', t[2], { contraparte: 'Restaurante' });
    });

    [[-2, 1150], [-19, 1200], [-36, 1100], [-53, 1180], [-71, 1220], [-88, 1090], [-105, 1160]].forEach(function (par) {
      mov('gasolina', TDC, 'gasto', par[1], d(par[0]), 'Gasolina', 'Gasolina camioneta familiar', { contraparte: 'Gasolinera' });
    });

    mov('salud', NU, 'gasto', 1200, d(-37), 'Salud', 'Consulta pediátrica', { contraparte: 'Dra. Patricia Soto' });
    mov('salud', TDC, 'gasto', 640, d(-36), 'Salud', 'Farmacia — medicamentos', { contraparte: 'Farmacias del Ahorro' });
    mov('salud', SANTANDER, 'gasto', 4850, d(-72), 'Salud', 'Seguro de gastos médicos — pago trimestral', { contraparte: 'GNP Seguros' });
    mov('entretenimiento', TDC, 'gasto', 560, d(-11), 'Entretenimiento', 'Cine en familia', { contraparte: 'Cinépolis' });
    mov('entretenimiento', TDC, 'gasto', 2400, d(-44), 'Entretenimiento', 'Boletos para concierto', { contraparte: 'Ticketmaster' });
    mov('ropa', TDC, 'gasto', 1890, d(-27), 'Ropa', 'Ropa de temporada', { contraparte: 'Zara' });
    mov('ropa', TDC, 'gasto', 2250, d(-83), 'Ropa', 'Tenis deportivos', { contraparte: 'Innovasport' });
    [[-1, 230], [-8, 185], [-22, 310], [-57, 265]].forEach(function (par) {
      mov('transporte', NU, 'gasto', par[1], d(par[0]), 'Transporte', 'Viajes en aplicación', { contraparte: 'Uber' });
    });

    // ----- Presupuestos del mes actual (ambos ámbitos, por separado) -----
    var periodoActual = U.periodo(hoy);
    function presupuesto(ambito, categoria, monto) {
      estado.presupuestos.push({
        id: 'ppto_' + ambito + '_' + U.normalizar(categoria).replace(/[^a-z0-9]+/g, '') + '_demo',
        ambito: ambito, periodo: periodoActual, categoria: categoria, monto: monto, creado: ahora, actualizado: ahora
      });
    }
    presupuesto('empresa', 'Nómina', 85000);
    presupuesto('empresa', 'Renta', 18500);
    presupuesto('empresa', 'Materiales', 120000);
    presupuesto('empresa', 'Proveedores', 160000);
    presupuesto('empresa', 'Servicios (luz, agua, internet)', 6500);
    presupuesto('empresa', 'Software', 5000);
    presupuesto('empresa', 'Transporte', 8000);
    presupuesto('empresa', 'Impuestos', 25000);
    presupuesto('empresa', 'Comisiones', 10000);
    presupuesto('empresa', 'Publicidad', 5000);
    presupuesto('empresa', 'Préstamos', 19000);
    presupuesto('empresa', 'Otros gastos', 5000);
    presupuesto('personal', 'Vivienda', 14500);
    presupuesto('personal', 'Supermercado', 9000);
    presupuesto('personal', 'Restaurantes', 4000);
    presupuesto('personal', 'Gasolina', 3500);
    presupuesto('personal', 'Transporte', 1000);
    presupuesto('personal', 'Suscripciones', 1200);
    presupuesto('personal', 'Salud', 2500);
    presupuesto('personal', 'Educación', 9800);
    presupuesto('personal', 'Entretenimiento', 2500);
    presupuesto('personal', 'Ropa', 2000);
    presupuesto('personal', 'Préstamos', 8000);
    presupuesto('personal', 'Otros gastos', 1500);

    // ----- Metas de ahorro (2) -----
    estado.metas.push({
      id: 'meta_emergencia_demo', ambito: 'personal', nombre: 'Fondo de emergencia (6 meses de gastos)', objetivo: 150000,
      cuentaId: AHORRO, fechaMeta: sumarMeses(hoy, 8), notas: 'Se alimenta con el ahorro programado mensual.', creado: ahora, actualizado: ahora
    });
    estado.metas.push({
      id: 'meta_viaje_demo', ambito: 'personal', nombre: 'Viaje familiar a Oaxaca', objetivo: 40000,
      cuentaId: null, fechaMeta: sumarMeses(hoy, 5), notas: 'Aún sin cuenta asignada; abrir subcuenta de ahorro.', creado: ahora, actualizado: ahora
    });

    return estado;
  }

  VF.seed = {
    datos: datos,
    vacio: vacio
  };
})(window.VF);
