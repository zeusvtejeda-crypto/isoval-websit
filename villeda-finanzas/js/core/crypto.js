'use strict';
window.VF = window.VF || {};
/**
 * VF.crypto — cifrado local con WebCrypto.
 * PBKDF2-SHA256 (310 000 iteraciones) para derivar la clave; AES-GCM 256 para los datos.
 * Todo es asíncrono. Los binarios viajan como base64 (codificado por bloques para no
 * desbordar la pila con arreglos grandes).
 */
(function (VF) {
  var ITERACIONES = 310000;
  var LONGITUD_SALT = 16;   // bytes
  var LONGITUD_IV = 12;     // bytes recomendados para AES-GCM
  var BLOQUE_B64 = 0x8000;  // 32 KiB por llamada a String.fromCharCode

  var codificador = new TextEncoder();
  var decodificador = new TextDecoder('utf-8', { fatal: true });

  function criptoNativo() {
    var c = (typeof window !== 'undefined' && window.crypto) || globalThis.crypto;
    if (!c || !c.subtle) throw new Error('WEBCRYPTO_NO_DISPONIBLE');
    return c;
  }

  /** Uint8Array → base64, por bloques. */
  function aBase64(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var binario = '';
    for (var i = 0; i < u8.length; i += BLOQUE_B64) {
      binario += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + BLOQUE_B64, u8.length)));
    }
    return btoa(binario);
  }

  /** base64 → Uint8Array. Lanza si el texto no es base64 válido. */
  function deBase64(b64) {
    if (typeof b64 !== 'string') throw new Error('BASE64_INVALIDO');
    var binario = atob(b64);
    var u8 = new Uint8Array(binario.length);
    for (var i = 0; i < binario.length; i++) u8[i] = binario.charCodeAt(i);
    return u8;
  }

  /** Salt aleatorio de 16 bytes en base64. */
  function generarSalt() {
    var salt = new Uint8Array(LONGITUD_SALT);
    criptoNativo().getRandomValues(salt);
    return aBase64(salt);
  }

  /** PBKDF2-SHA256, 310 000 iteraciones → CryptoKey AES-GCM 256 (no extraíble). */
  function derivarClave(contrasena, saltB64) {
    var subtle = criptoNativo().subtle;
    if (typeof contrasena !== 'string' || contrasena.length === 0) {
      return Promise.reject(new Error('CONTRASENA_VACIA'));
    }
    var salt;
    try {
      salt = deBase64(saltB64);
    } catch (e) {
      return Promise.reject(new Error('SALT_INVALIDO'));
    }
    return subtle.importKey('raw', codificador.encode(contrasena), { name: 'PBKDF2' }, false, ['deriveKey'])
      .then(function (material) {
        return subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: ITERACIONES, hash: 'SHA-256' },
          material,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  /** objeto → JSON → UTF-8 → AES-GCM. Devuelve { iv, datos } en base64. */
  function cifrar(objeto, clave) {
    var cripto = criptoNativo();
    var iv = new Uint8Array(LONGITUD_IV);
    cripto.getRandomValues(iv);
    var texto;
    try {
      texto = JSON.stringify(objeto === undefined ? null : objeto);
    } catch (e) {
      return Promise.reject(new Error('OBJETO_NO_SERIALIZABLE'));
    }
    var bytes = codificador.encode(texto);
    return cripto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, clave, bytes)
      .then(function (cifrado) {
        return { iv: aBase64(iv), datos: aBase64(new Uint8Array(cifrado)) };
      });
  }

  /**
   * { iv, datos } → objeto. Cualquier fallo (clave incorrecta, datos alterados, JSON
   * ilegible) se reporta como Error('CONTRASENA_INCORRECTA'); el store distingue datos
   * corruptos mediante el verificador.
   */
  function descifrar(paquete, clave) {
    var cripto = criptoNativo();
    var iv, datos;
    try {
      if (!paquete || typeof paquete !== 'object') throw new Error('PAQUETE_INVALIDO');
      iv = deBase64(paquete.iv);
      datos = deBase64(paquete.datos);
    } catch (e) {
      return Promise.reject(new Error('CONTRASENA_INCORRECTA'));
    }
    return cripto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, clave, datos)
      .then(function (plano) {
        return JSON.parse(decodificador.decode(new Uint8Array(plano)));
      }, function () {
        throw new Error('CONTRASENA_INCORRECTA');
      })
      .catch(function (e) {
        if (e && e.message === 'CONTRASENA_INCORRECTA') throw e;
        throw new Error('CONTRASENA_INCORRECTA');
      });
  }

  VF.crypto = {
    generarSalt: generarSalt,
    derivarClave: derivarClave,
    cifrar: cifrar,
    descifrar: descifrar
  };
})(window.VF);
