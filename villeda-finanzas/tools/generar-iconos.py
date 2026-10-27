#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera los iconos PNG de VILLEDA Finanzas con Pillow (sin fuentes externas).

Diseño: monograma "VF" blanco trazado con líneas gruesas sobre azul #1D4ED8,
esquinas suaves (radio ~22 %). El icono maskable usa fondo completo (sin
transparencia) y mantiene el monograma dentro de la zona segura (80 % central).

Uso:  python3 tools/generar-iconos.py            (escribe en ../icons/)
      python3 tools/generar-iconos.py /ruta/salida
"""
import os
import sys

from PIL import Image, ImageDraw

AZUL = (29, 78, 216, 255)          # #1D4ED8
BLANCO = (255, 255, 255, 255)
TRANSPARENTE = (0, 0, 0, 0)
ESCALA = 4                         # supermuestreo para bordes suaves


def _monograma(dibujo, caja, grosor):
    """Dibuja 'VF' con trazos redondeados dentro de la caja (x0, y0, x1, y1)."""
    x0, y0, x1, y1 = caja
    ancho = x1 - x0
    alto = y1 - y0
    # Proporciones tomadas del logo SVG de index.html (viewBox 64):
    #   V: (15,19) -> (26,46) -> (37,19)      F: tallo x=42 de 46 a 19, techo hasta 53, brazo hasta 50 en y=32
    def p(x, y):
        return (x0 + (x - 13) / 42.0 * ancho, y0 + (y - 17) / 31.0 * alto)

    v = [p(15, 19), p(26, 46), p(37, 19)]
    dibujo.line(v, fill=BLANCO, width=grosor, joint='curve')
    dibujo.line([p(42, 46), p(42, 19), p(53, 19)], fill=BLANCO, width=grosor, joint='curve')
    dibujo.line([p(42, 32), p(50, 32)], fill=BLANCO, width=grosor)
    # Remates redondeados en los extremos abiertos
    r = grosor / 2.0
    for (x, y) in (p(15, 19), p(37, 19), p(42, 46), p(53, 19), p(50, 32)):
        dibujo.ellipse([x - r, y - r, x + r, y + r], fill=BLANCO)


def crear_icono(tamano, maskable=False, radio_pct=0.22):
    s = tamano * ESCALA
    img = Image.new('RGBA', (s, s), TRANSPARENTE)
    d = ImageDraw.Draw(img)

    if maskable:
        d.rectangle([0, 0, s, s], fill=AZUL)
        # Zona segura: círculo de 40 % de radio; el monograma ocupa ~52 % del lado.
        margen = s * 0.26
    else:
        radio = int(s * radio_pct)
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radio, fill=AZUL)
        margen = s * 0.20

    caja = (margen, margen * 1.08, s - margen, s - margen * 1.08)
    grosor = max(ESCALA, int(s * 0.095))
    _monograma(d, caja, grosor)

    return img.resize((tamano, tamano), Image.LANCZOS)


def main():
    base = os.path.dirname(os.path.abspath(__file__))
    salida = sys.argv[1] if len(sys.argv) > 1 else os.path.join(base, '..', 'icons')
    salida = os.path.abspath(salida)
    os.makedirs(salida, exist_ok=True)

    archivos = {
        'icon-192.png': crear_icono(192),
        'icon-512.png': crear_icono(512),
        'icon-maskable-512.png': crear_icono(512, maskable=True),
        'apple-touch-icon-180.png': crear_icono(180, radio_pct=0.0).convert('RGB'),  # iOS redondea por su cuenta
        'favicon-32.png': crear_icono(32, radio_pct=0.25),
    }
    for nombre, img in archivos.items():
        ruta = os.path.join(salida, nombre)
        img.save(ruta, 'PNG', optimize=True)
        print('OK', ruta, img.size)


if __name__ == '__main__':
    main()
