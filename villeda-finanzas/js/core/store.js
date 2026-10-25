'use strict';
window.VF = window.VF || {};
/**
 * VF.store — estado en memoria + persistencia cifrada en localStorage + eventos.
 *
 * localStorage['vf.boveda.v1'] = JSON.stringify({ version:1, salt, iv, datos, verificador })
 *   - salt:        base64, para derivar la clave con la contraseña.
 *   - iv/datos:    AES-GCM del estado completo.
 *   - verificador: { iv, datos } = cifrado de la cadena 'VF-OK' con la misma clave; permite
 *                  distinguir contraseña incorrecta de datos corruptos.
 * La clave derivada vive SÓLO en memoria (variable del cierre) y se descarta al bloquear.
 *
 * Escrituras: cada guardar() toma una instantánea del estado y la encola; una sola cadena de
 * promesas persiste siempre la última instantánea, así las mutaciones rápidas no se pisan y
 * bloquear() nunca pierde un cambio ya solicitado.
 */
(function (VF) {
  var CLAVE_LS = 'vf.boveda.v1';
  var TEXTO_VERIFICADOR = 'VF-OK';
  var VERSION = 1;
  var AMBITOS = ['empresa', 'personal'];

  var PREFIJOS = {
    cuentas: 'cta', movimientos: 'mov', clientes: 'cli', facturas: 'fac', proveedores: 'prov',
    cuentasPorPagar: 'cxp', comisiones: 'com', prestamos: 'pre', presupuestos: 'ppto', metas: 'meta'
  };
  var COLECCIONES = Object.keys(PREFIJOS);
  var CON_AMBITO = ['cuentas', 'movimientos', 'prestamos', 'presupuestos', 'metas'];

  var estado = null;      // objeto estado descifrado
  var clave = null;       // CryptoKey AES-GCM
  var salt = null;        // base64
  var oyentes = {};       // evento → [fn]
  var instantanea = null; // { json, clave, salt } pendiente de persistir
  var cola = null;        // promesa de la cadena de escritura en curso

  // ---------- utilidades privadas ----------

  function ls() {
    var almacen = (typeof window !== 'undefined' && window.localStorage) || globalThis.localStorage;
    if (!almacen) throw new Error('LOCALSTORAGE_NO_DISPONIBLE');
    return almacen;
  }

  function ahora() {
    return new Date().toISOString();
  }

  function emitir(evento, carga) {
    var lista = oyentes[evento] ? oyentes[evento].slice() : [];
    lista.forEach(function (fn) {
      try {
        fn(carga);
      } catch (e) {
        console.error('[VF.store] error en oyente de "' + evento + '":', e);
      }
    });
  }

  function requerirDesbloqueado() {
    if (!estado || !clave) throw new Error('BLOQUEADO');
  }

  function coleccion(nombre) {
    requerirDesbloqueado();
    if (COLECCIONES.indexOf(nombre) === -1 || !Array.isArray(estado[nombre])) {
      throw new Error('COLECCION_INVALIDA');
    }
    return estado[nombre];
  }

  function leerBoveda() {
    var crudo;
    try {
      crudo = ls().getItem(CLAVE_LS);
    } catch (e) {
      return null;
    }
    if (!crudo) return null;
    try {
      var b = JSON.parse(crudo);
      return b && typeof b === 'object' ? b : null;
    } catch (e) {
      return null;
    }
  }

  function esBovedaCifrada(obj) {
    return !!(obj && typeof obj === 'object' && typeof obj.salt === 'string' &&
      typeof obj.iv === 'string' && typeof obj.datos === 'string');
  }

  function esEstadoPlano(obj) {
    return !!(obj && typeof obj === 'object' && !esBovedaCifrada(obj) &&
      (Array.isArray(obj.cuentas) || Array.isArray(obj.movimientos) || obj.ajustes));
  }

  /** Normaliza un estado leído (respaldo o bóveda antigua) contra los valores por defecto. */
  function migrar(datos) {
    var base = VF.seed.vacio();
    var d = datos && typeof datos === 'object' ? datos : {};
    var resultado = { version: VERSION };
    resultado.ajustes = Object.assign({}, base.ajustes, d.ajustes || {});
    COLECCIONES.forEach(function (nombre) {
      resultado[nombre] = Array.isArray(d[nombre]) ? d[nombre].filter(function (x) {
        return x && typeof x === 'object';
      }) : [];
    });
    resultado.categorias = {
      empresa: {
        ingreso: listaStrings(d.categorias && d.categorias.empresa && d.categorias.empresa.ingreso, base.categorias.empresa.ingreso),
        gasto: listaStrings(d.categorias && d.categorias.empresa && d.categorias.empresa.gasto, base.categorias.empresa.gasto)
      },
      personal: {
        ingreso: listaStrings(d.categorias && d.categorias.personal && d.categorias.personal.ingreso, base.categorias.personal.ingreso),
        gasto: listaStrings(d.categorias && d.categorias.personal && d.categorias.personal.gasto, base.categorias.personal.gasto)
      }
    };
    return resultado;
  }

  function listaStrings(lista, porDefecto) {
    if (!Array.isArray(lista) || lista.length === 0) return porDefecto.slice();
    return lista.filter(function (s) { return typeof s === 'string' && s.trim(); });
  }

  /** Persiste una instantánea concreta (JSON ya serializado) con su clave y salt. */
  function persistirInstantanea(inst) {
    var objeto = JSON.parse(inst.json);
    return Promise.all([
      VF.crypto.cifrar(objeto, inst.clave),
      VF.crypto.cifrar(TEXTO_VERIFICADOR, inst.clave)
    ]).then(function (res) {
      var boveda = {
        version: VERSION,
        salt: inst.salt,
        iv: res[0].iv,
        datos: res[0].datos,
        verificador: res[1]
      };
      ls().setItem(CLAVE_LS, JSON.stringify(boveda));
      return true;
    });
  }

  /** Drena la cola: siempre persiste la última instantánea solicitada. */
  function procesarCola() {
    function paso() {
      if (!instantanea) {
        cola = null;
        return Promise.resolve(true);
      }
      var inst = instantanea;
      instantanea = null;
      return persistirInstantanea(inst).then(paso, function (e) {
        console.error('[VF.store] no se pudo guardar la bóveda:', e);
        instantanea = null;
        cola = null;
        emitir('error', e);
        return false;
      });
    }
    return paso();
  }

  /** Encola una instantánea del estado actual; emite 'cambio'. */
  function encolarGuardado(emitirCambio) {
    requerirDesbloqueado();
    instantanea = { json: JSON.stringify(estado), clave: clave, salt: salt };
    if (emitirCambio) emitir('cambio');
    if (!cola) cola = procesarCola();
    return cola;
  }

  function copiaSuperficial(obj) {
    return Object.assign({}, obj);
  }

  function validarAmbito(nombreColeccion, obj) {
    if (CON_AMBITO.indexOf(nombreColeccion) === -1) return;
    if (nombreColeccion === 'metas' && !obj.ambito) obj.ambito = 'personal';
    if (AMBITOS.indexOf(obj.ambito) === -1) throw new Error('AMBITO_INVALIDO');
  }

  function verificarContrasena(contrasena, boveda) {
    return VF.crypto.derivarClave(contrasena, boveda.salt).then(function (k) {
      if (boveda.verificador) {
        return VF.crypto.descifrar(boveda.verificador, k).then(function (texto) {
          if (texto !== TEXTO_VERIFICADOR) throw new Error('CONTRASENA_INCORRECTA');
          return k;
        });
      }
      return k;
    });
  }

  /** Descifra una bóveda {salt, iv, datos, verificador} con una contraseña. → { estado, clave } */
  function abrirBoveda(boveda, contrasena) {
    return verificarContrasena(contrasena, boveda).then(function (k) {
      return VF.crypto.descifrar({ iv: boveda.iv, datos: boveda.datos }, k).then(function (datos) {
        return { estado: migrar(datos), clave: k };
      }, function () {
        // La contraseña abrió el verificador pero no los datos: la bóveda está dañada.
        throw new Error(boveda.verificador ? 'DATOS_CORRUPTOS' : 'CONTRASENA_INCORRECTA');
      });
    });
  }

  // ---------- API pública ----------

  function existeBoveda() {
    try {
      return !!ls().getItem(CLAVE_LS);
    } catch (e) {
      return false;
    }
  }

  function crear(contrasena, opciones) {
    if (typeof contrasena !== 'string' || contrasena.length === 0) {
      return Promise.reject(new Error('CONTRASENA_VACIA'));
    }
    if (existeBoveda()) return Promise.reject(new Error('BOVEDA_EXISTE'));
    var conEjemplo = !!(opciones && opciones.conEjemplo);
    var nuevoSalt = VF.crypto.generarSalt();
    return VF.crypto.derivarClave(contrasena, nuevoSalt).then(function (k) {
      clave = k;
      salt = nuevoSalt;
      estado = migrar(conEjemplo ? VF.seed.datos() : VF.seed.vacio());
      estado.ajustes.datosEjemplo = conEjemplo;
      return encolarGuardado(false);
    }).then(function () {
      emitir('desbloqueado');
    });
  }

  function desbloquear(contrasena) {
    var boveda = leerBoveda();
    if (!boveda) return Promise.reject(new Error('SIN_BOVEDA'));
    if (!esBovedaCifrada(boveda)) return Promise.reject(new Error('DATOS_CORRUPTOS'));
    if (typeof contrasena !== 'string' || contrasena.length === 0) {
      return Promise.reject(new Error('CONTRASENA_INCORRECTA'));
    }
    return abrirBoveda(boveda, contrasena).then(function (res) {
      estado = res.estado;
      clave = res.clave;
      salt = boveda.salt;
      emitir('desbloqueado');
    });
  }

  function bloquear() {
    var estabaDesbloqueado = !!(estado || clave);
    estado = null;
    clave = null;
    salt = null;
    if (estabaDesbloqueado) emitir('bloqueado');
  }

  function estaDesbloqueado() {
    return !!(estado && clave);
  }

  function obtenerEstado() {
    return estado;
  }

  function guardar() {
    try {
      return encolarGuardado(true);
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function agregar(nombre, obj) {
    var lista = coleccion(nombre);
    if (!obj || typeof obj !== 'object') throw new Error('REGISTRO_INVALIDO');
    var registro = copiaSuperficial(obj);
    var t = ahora();
    if (!registro.id) registro.id = VF.util.uid(PREFIJOS[nombre]);
    if (!registro.creado) registro.creado = t;
    if (!registro.actualizado) registro.actualizado = t;
    validarAmbito(nombre, registro);
    if (lista.some(function (x) { return x.id === registro.id; })) throw new Error('ID_DUPLICADO');
    lista.push(registro);
    guardar();
    return registro;
  }

  function actualizar(nombre, id, cambios) {
    var lista = coleccion(nombre);
    var registro = null;
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === id) { registro = lista[i]; break; }
    }
    if (!registro) return null;
    var parcial = Object.assign({}, cambios || {});
    delete parcial.id;
    delete parcial.creado;
    Object.assign(registro, parcial);
    validarAmbito(nombre, registro);
    registro.actualizado = ahora();
    guardar();
    return registro;
  }

  function quitarMovimientosVinculados(campo, id) {
    estado.movimientos = estado.movimientos.filter(function (m) { return m[campo] !== id; });
  }

  function eliminar(nombre, id) {
    var lista = coleccion(nombre);
    var indice = -1;
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === id) { indice = i; break; }
    }
    if (indice === -1) return false;

    // Reglas de integridad (ARQUITECTURA.md 2.1)
    if (nombre === 'cuentas') {
      var usada = estado.movimientos.some(function (m) { return m.cuentaId === id || m.cuentaDestinoId === id; });
      if (usada) throw new Error('CUENTA_CON_MOVIMIENTOS');
    } else if (nombre === 'clientes') {
      if (estado.facturas.some(function (f) { return f.clienteId === id; })) throw new Error('CLIENTE_CON_FACTURAS');
    } else if (nombre === 'proveedores') {
      if (estado.cuentasPorPagar.some(function (c) { return c.proveedorId === id; })) throw new Error('PROVEEDOR_CON_CXP');
    } else if (nombre === 'facturas') {
      quitarMovimientosVinculados('facturaId', id);
      estado.comisiones.forEach(function (c) { if (c.facturaId === id) c.facturaId = null; });
    } else if (nombre === 'cuentasPorPagar') {
      quitarMovimientosVinculados('cxpId', id);
    } else if (nombre === 'prestamos') {
      quitarMovimientosVinculados('prestamoId', id);
    } else if (nombre === 'comisiones') {
      quitarMovimientosVinculados('comisionId', id);
    }

    lista.splice(indice, 1);
    guardar();
    return true;
  }

  function obtener(nombre, id) {
    var lista = coleccion(nombre);
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === id) return lista[i];
    }
    return undefined;
  }

  function listar(nombre, filtro) {
    var lista = coleccion(nombre);
    var prueba;
    if (typeof filtro === 'function') {
      prueba = filtro;
    } else if (filtro && typeof filtro === 'object') {
      var claves = Object.keys(filtro);
      prueba = function (x) {
        return claves.every(function (k) { return x[k] === filtro[k]; });
      };
    } else {
      prueba = function () { return true; };
    }
    var salida = [];
    for (var i = 0; i < lista.length; i++) {
      if (prueba(lista[i])) salida.push(copiaSuperficial(lista[i]));
    }
    return salida;
  }

  function setAjustes(parcial) {
    requerirDesbloqueado();
    Object.assign(estado.ajustes, parcial || {});
    guardar();
    return estado.ajustes;
  }

  function cambiarContrasena(actual, nueva) {
    try {
      requerirDesbloqueado();
    } catch (e) {
      return Promise.reject(e);
    }
    if (typeof nueva !== 'string' || nueva.length === 0) return Promise.reject(new Error('CONTRASENA_VACIA'));
    var boveda = leerBoveda();
    if (!boveda) return Promise.reject(new Error('SIN_BOVEDA'));
    return verificarContrasena(actual, boveda).then(function () {
      var nuevoSalt = VF.crypto.generarSalt();
      return VF.crypto.derivarClave(nueva, nuevoSalt).then(function (k) {
        clave = k;
        salt = nuevoSalt;
        return encolarGuardado(true);
      });
    }).then(function () { return undefined; });
  }

  /**
   * cifrado:true (por defecto) → el mismo formato de la bóveda tal como está persistida
   * (última escritura completada). cifrado:false → estado plano en JSON legible.
   */
  function exportarJSON(opciones) {
    requerirDesbloqueado();
    var cifrado = !opciones || opciones.cifrado !== false;
    if (cifrado) {
      var boveda = leerBoveda();
      if (!boveda) throw new Error('SIN_BOVEDA');
      return JSON.stringify(boveda);
    }
    return JSON.stringify(estado, null, 2);
  }

  function importarJSON(texto, contrasenaOpcional) {
    try {
      requerirDesbloqueado();
    } catch (e) {
      return Promise.reject(e);
    }
    var obj;
    try {
      obj = typeof texto === 'string' ? JSON.parse(texto) : texto;
    } catch (e) {
      return Promise.reject(new Error('JSON_INVALIDO'));
    }
    var promesaEstado;
    if (esBovedaCifrada(obj)) {
      if (typeof contrasenaOpcional === 'string' && contrasenaOpcional.length > 0) {
        promesaEstado = abrirBoveda(obj, contrasenaOpcional).then(function (r) { return r.estado; });
      } else if (obj.salt === salt && clave) {
        // Mismo salt que la bóveda abierta: la clave en memoria sirve.
        promesaEstado = VF.crypto.descifrar({ iv: obj.iv, datos: obj.datos }, clave).then(migrar);
      } else {
        return Promise.reject(new Error('CONTRASENA_REQUERIDA'));
      }
    } else if (esEstadoPlano(obj)) {
      promesaEstado = Promise.resolve(migrar(obj));
    } else {
      return Promise.reject(new Error('FORMATO_DESCONOCIDO'));
    }
    return promesaEstado.then(function (nuevo) {
      requerirDesbloqueado();
      estado = nuevo;
      return encolarGuardado(true);
    }).then(function () { return undefined; });
  }

  function esDemo(x) {
    return !!(x && typeof x.id === 'string' && /_demo$/.test(x.id));
  }

  /** Elimina todo registro (y pagos anidados) con id terminado en '_demo'. → número eliminado */
  function borrarDatosEjemplo() {
    requerirDesbloqueado();
    var eliminados = 0;
    COLECCIONES.forEach(function (nombre) {
      var antes = estado[nombre].length;
      estado[nombre] = estado[nombre].filter(function (x) { return !esDemo(x); });
      eliminados += antes - estado[nombre].length;
      estado[nombre].forEach(function (x) {
        if (Array.isArray(x.pagos)) {
          x.pagos = x.pagos.filter(function (p) { return !esDemo(p); });
        }
      });
    });
    estado.ajustes.datosEjemplo = false;
    guardar();
    return eliminados;
  }

  function borrarTodo() {
    instantanea = null;
    try {
      ls().removeItem(CLAVE_LS);
    } catch (e) {
      console.error('[VF.store] no se pudo borrar la bóveda:', e);
    }
    bloquear();
  }

  function on(evento, fn) {
    if (typeof fn !== 'function') return;
    if (!oyentes[evento]) oyentes[evento] = [];
    if (oyentes[evento].indexOf(fn) === -1) oyentes[evento].push(fn);
  }

  function off(evento, fn) {
    if (!oyentes[evento]) return;
    oyentes[evento] = oyentes[evento].filter(function (f) { return f !== fn; });
  }

  VF.store = {
    existeBoveda: existeBoveda,
    crear: crear,
    desbloquear: desbloquear,
    bloquear: bloquear,
    estaDesbloqueado: estaDesbloqueado,
    estado: obtenerEstado,
    guardar: guardar,
    agregar: agregar,
    actualizar: actualizar,
    eliminar: eliminar,
    obtener: obtener,
    listar: listar,
    setAjustes: setAjustes,
    cambiarContrasena: cambiarContrasena,
    exportarJSON: exportarJSON,
    importarJSON: importarJSON,
    borrarDatosEjemplo: borrarDatosEjemplo,
    borrarTodo: borrarTodo,
    on: on,
    off: off
  };
})(window.VF);
