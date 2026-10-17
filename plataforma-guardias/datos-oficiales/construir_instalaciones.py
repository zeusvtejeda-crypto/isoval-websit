#!/usr/bin/env python3
"""Construye instalaciones_nayarit.csv (y el subconjunto IMSS) a partir de fuentes oficiales.

Fuentes (ver FUENTES.md):
  1. CLUES (DGIS, Secretaría de Salud), versión 202608 — fuentes/clues_nayarit_202608_completo.csv
  2. Directorio de instalaciones IMSS (imss.gob.mx/directorio) — fuentes/imss_directorio_nayarit_2026-10-17.csv
  3. Catálogo de localidades INEGI (gaia.inegi.org.mx/wscatgeo) — fuentes/inegi_localidades_nayarit_2026-10-17.csv

Uso: python3 construir_instalaciones.py
"""
import csv, math, re, unicodedata, collections
from pathlib import Path

BASE = Path(__file__).parent
CLUES_VERSION = "202608"
CLUES_FUENTE = f"CLUES DGIS/SSA ESTABLECIMIENTO_SALUD_{CLUES_VERSION} (dgis.salud.gob.mx)"
IMSS_FUENTE = "Directorio IMSS imss.gob.mx/directorio (consulta 2026-10-17)"
INEGI_FUENTE = "Localidades INEGI gaia.inegi.org.mx/wscatgeo (consulta 2026-10-17)"
UMBRAL_COINCIDE_KM = 1.0     # CLUES y directorio IMSS se consideran la misma ubicación
UMBRAL_LOCALIDAD_KM = 10.0   # distancia máxima razonable entre la unidad y el centro de su localidad INEGI
CARGA_INSTITUCIONES = ("IMS", "IMB")  # subconjunto que carga la plataforma por defecto

def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^A-Z0-9 ]+", " ", s.upper())
    return re.sub(r"\s+", " ", s).strip()

def km(a, b, c, d):
    a, b, c, d = map(math.radians, (a, b, c, d))
    h = math.sin((c - a) / 2) ** 2 + math.cos(a) * math.cos(c) * math.sin((d - b) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))

def direccion(r):
    partes = []
    via = " ".join(x for x in (r["TIPO DE VIALIDAD"], r["VIALIDAD"]) if x and x != "NINGUNO")
    if via: partes.append(via)
    if r["NUMERO EXTERIOR"]: partes.append(r["NUMERO EXTERIOR"])
    if r["NUMERO INTERIOR"]: partes.append("INT. " + r["NUMERO INTERIOR"])
    asent = " ".join(x for x in (r["TIPO DE ASENTAMIENTO"], r["ASENTAMIENTO"]) if x and x != "NINGUNO")
    if asent: partes.append(asent)
    return ", ".join(partes)

def fmt(x):
    return f"{x:.7f}".rstrip("0").rstrip(".")

clues = list(csv.DictReader(open(BASE / "fuentes" / f"clues_nayarit_{CLUES_VERSION}_completo.csv", encoding="utf-8")))
imss = list(csv.DictReader(open(BASE / "fuentes" / "imss_directorio_nayarit_2026-10-17.csv", encoding="utf-8")))
inegi = list(csv.DictReader(open(BASE / "fuentes" / "inegi_localidades_nayarit_2026-10-17.csv", encoding="utf-8")))

# Directorio IMSS: puede repetir una unidad (por servicio) con coordenadas distintas
dir_imss = collections.defaultdict(list)
for d in imss:
    if d["lat"] and d["lng"]:
        dir_imss[norm(d["nombre"])].append((float(d["lat"]), float(d["lng"])))

# Localidades INEGI: (municipio, localidad) -> (lat, lng, nombre)
localidades = {(l["cve_mun"], l["cve_loc"]): (float(l["latitud"]), float(l["longitud"]), l["nomgeo"]) for l in inegi}

operacion = [r for r in clues if r["ESTATUS DE OPERACION"].startswith("EN OPERACION")]

# Coordenada compartida con otra unidad que tiene domicilio distinto => dudosa (copiada)
por_coord = collections.defaultdict(set)
for r in operacion:
    por_coord[(r["LATITUD"], r["LONGITUD"])].add(norm(r["VIALIDAD"] + " " + r["NUMERO EXTERIOR"]))
nombres_clues = collections.Counter(norm(r["NOMBRE COMERCIAL"]) for r in operacion if r["CLAVE DE LA INSTITUCION"] in ("IMS", "IMB"))

salida = []
stats = collections.Counter()
for r in operacion:
    lat, lng = float(r["LATITUD"]), float(r["LONGITUD"])
    mun = r["CLAVE DEL MUNICIPIO"]
    fuentes = [CLUES_FUENTE]
    avisos = []
    origen = "CLUES"
    dudosa = False

    compartida = len(por_coord[(r["LATITUD"], r["LONGITUD"])]) > 1
    loc = localidades.get((mun, r["CLAVE DE LA LOCALIDAD"]))
    d_loc = km(lat, lng, loc[0], loc[1]) if loc else None
    lejos_localidad = d_loc is not None and d_loc > UMBRAL_LOCALIDAD_KM
    # ¿La coordenada cae cerca de alguna localidad de Nayarit? Si no, está fuera del estado o es basura.
    d_min = min(km(lat, lng, a, b) for a, b, _ in localidades.values())
    fuera_estado = d_min > UMBRAL_LOCALIDAD_KM
    if compartida:
        avisos.append("coordenada CLUES repetida en unidades con otro domicilio")
    if lejos_localidad:
        avisos.append(f"coordenada CLUES a {d_loc:.0f} km de su localidad registrada ({loc[2]})")
    if fuera_estado:
        avisos.append(f"coordenada CLUES fuera de Nayarit (a {d_min:.0f} km de la localidad más cercana)")
    if not loc:
        avisos.append("localidad no encontrada en catálogo INEGI")
        stats["sin_localidad_inegi"] += 1
    dudosa = compartida or lejos_localidad or fuera_estado

    def cerca_localidad(c):
        return loc is None or km(c[0], c[1], loc[0], loc[1]) <= UMBRAL_LOCALIDAD_KM

    if r["CLAVE DE LA INSTITUCION"] in ("IMS", "IMB"):
        cands = dir_imss.get(norm(r["NOMBRE COMERCIAL"])) or dir_imss.get(norm(r["NOMBRE DE LA UNIDAD"])) or []
        if dudosa:
            cands = [c for c in cands if (c[0], c[1]) != (lat, lng) and cerca_localidad(c)] or cands
        if cands and nombres_clues[norm(r["NOMBRE COMERCIAL"])] > 1 and min(km(lat, lng, *c) for c in cands) > UMBRAL_COINCIDE_KM:
            cands = []  # nombre repetido en CLUES: sin coincidencia cercana no se puede asignar
        if cands:
            fuentes.append(IMSS_FUENTE)
            mejor = min(cands, key=lambda c: km(lat, lng, *c))
            dist = km(lat, lng, *mejor)
            if dudosa and (mejor[0], mejor[1]) != (lat, lng) and cerca_localidad(mejor):
                avisos.append(f"se usa la coordenada del directorio IMSS (CLUES: {fmt(lat)},{fmt(lng)}; {dist:.1f} km)")
                lat, lng = mejor; origen = "Directorio IMSS"; dudosa = fuera_estado = lejos_localidad = compartida = False
                stats["imss_corregido"] += 1
            elif dist <= UMBRAL_COINCIDE_KM:
                avisos.append(f"coincide con directorio IMSS ({dist:.2f} km)")
                stats["imss_ok"] += 1
                if dudosa:
                    avisos.append("revisar")
            else:
                avisos.append(f"directorio IMSS difiere {dist:.1f} km; se conserva CLUES; revisar")
                stats["imss_revisar"] += 1
        else:
            stats["imss_sin_directorio"] += 1

    if fuera_estado and loc:
        avisos.append(f"coordenada aproximada: centro de la localidad INEGI (CLUES: {fmt(lat)},{fmt(lng)})")
        lat, lng = loc[0], loc[1]; origen = "Localidad INEGI (aprox.)"
        fuentes.append(INEGI_FUENTE)
        stats["inegi_aprox"] += 1
    elif lejos_localidad:
        avisos.append("la localidad registrada o la coordenada es incorrecta; se conserva CLUES; revisar")
        stats["revisar"] += 1
    elif compartida:
        avisos.append("se conserva CLUES; revisar")
        stats["revisar"] += 1

    salida.append({
        "clues": r["CLUES"],
        "nombre": r["NOMBRE DE LA UNIDAD"],
        "nombre_corto": r["NOMBRE COMERCIAL"],
        "clave_institucion": r["CLAVE DE LA INSTITUCION"],
        "institucion": r["NOMBRE DE LA INSTITUCION"].strip(),
        "tipo_establecimiento": r["NOMBRE TIPO ESTABLECIMIENTO"],
        "tipologia": r["NOMBRE DE TIPOLOGIA"].strip(),
        "nivel_atencion": r["NIVEL ATENCION"],
        "cve_municipio": "18" + mun.zfill(3),
        "municipio": r["MUNICIPIO"],
        "cve_localidad": "18" + mun.zfill(3) + r["CLAVE DE LA LOCALIDAD"].zfill(4),
        "localidad": r["LOCALIDAD"],
        "direccion": direccion(r),
        "codigo_postal": r["CODIGO POSTAL"],
        "telefono": r["TELEFONO 1 DEL ESTABLECIMIENTO"],
        "lat": fmt(lat),
        "lng": fmt(lng),
        "coord_origen": origen,
        "estatus": r["ESTATUS DE OPERACION"],
        "fuente": "; ".join(fuentes),
        "fuente_fecha": f"CLUES {CLUES_VERSION[:4]}-{CLUES_VERSION[4:]}",
        "validacion": "; ".join(avisos),
    })

salida.sort(key=lambda x: (x["cve_municipio"], x["clave_institucion"], x["nombre"]))
campos = list(salida[0].keys())
with open(BASE / "instalaciones_nayarit.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=campos); w.writeheader(); w.writerows(salida)
carga = [x for x in salida if x["clave_institucion"] in CARGA_INSTITUCIONES]
with open(BASE / "instalaciones_nayarit_imss.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=campos); w.writeheader(); w.writerows(carga)

usados = {norm(x["nombre_corto"]) for x in salida} | {norm(x["nombre"]) for x in salida}
huerfanas = [d for d in imss if norm(d["nombre"]) not in usados]
with open(BASE / "imss_directorio_sin_clues.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(imss[0].keys())); w.writeheader(); w.writerows(huerfanas)

print("filas:", len(salida), "| carga IMSS+IMSS-Bienestar:", len(carga))
print("por institución:", collections.Counter(x["clave_institucion"] for x in salida).most_common())
print("coord_origen:", collections.Counter(x["coord_origen"] for x in salida).most_common())
print("stats:", dict(stats))
print("directorio IMSS sin CLUES:", len(huerfanas))

# ---------------------------------------------------------------------------
# Plantilla del importador de plataforma-guardias (formato indicado por la sesión
# que construye la plataforma): instalaciones_nayarit_imss_plantilla.csv
# ---------------------------------------------------------------------------
import json
CLUES_URL = "http://gobi.salud.gob.mx/gobi/catalogos/catalogosmaestros/ESTABLECIMIENTO_SALUD_202608.xlsx"
IMSS_URL = "https://www.imss.gob.mx/directorio?dom_estado=Nayarit"
INEGI_URL = "https://gaia.inegi.org.mx/wscatgeo/v2/localidades/18/"
FECHA_VERIFICACION = "2026-10-17"
PLANTILLA_CAMPOS = ["identificador_interno", "nombre_oficial", "clave_unidad", "categoria", "descripcion", "estado",
                    "municipio", "direccion", "latitud", "longitud", "telefono", "horario", "servicios",
                    "servicios_verificados", "fuente", "url_fuente", "fecha_verificacion", "estado_verificacion",
                    "observaciones", "zona_horaria", "tolerancia_minutos"]

municipios_inegi = {m["cve_mun"]: m["nomgeo"] for m in
                    json.load(open(BASE / "fuentes" / "inegi_municipios_nayarit_2026-10-17.json", encoding="utf-8"))["datos"]}
horarios_imss = {}
for d in imss:
    h = (d.get("horario") or "").strip()
    if h and h != "N/D":
        horarios_imss.setdefault(norm(d["nombre"]), h)

def categoria(x):
    """Criterio documentado en FUENTES.md."""
    if x["tipo_establecimiento"] == "DE HOSPITALIZACIÓN":
        return "hospitales"
    if x["clave_institucion"] == "IMS" and x["tipologia"] == "UNIDAD DE MEDICINA FAMILIAR":
        return "umf"
    if x["tipologia"] == "OFICINAS ADMINISTRATIVAS":
        return "delegaciones" if "OOAD" in x["nombre"] else "oficinas-administrativas"
    if x["tipo_establecimiento"] in ("DE APOYO", "DE ASISTENCIA SOCIAL"):
        return "otras-instalaciones"
    return "otras-unidades-medicas"

plantilla = []
for x in carga:
    verificada = x["coord_origen"] == "Directorio IMSS" or x["validacion"].startswith("coincide")
    urls = [CLUES_URL]
    if IMSS_FUENTE in x["fuente"]: urls.append(IMSS_URL)
    if INEGI_FUENTE in x["fuente"]: urls.append(INEGI_URL + x["cve_municipio"][2:])
    obs = [f"coord_origen={x['coord_origen']}", f"institucion={x['institucion']}",
           f"tipologia={x['tipologia']}", f"nivel_atencion={x['nivel_atencion']}", f"localidad={x['localidad']}"]
    if x["validacion"]: obs.append(f"validacion={x['validacion']}")
    plantilla.append({
        "identificador_interno": "",
        "nombre_oficial": x["nombre"],
        "clave_unidad": x["clues"],
        "categoria": categoria(x),
        "descripcion": f"{x['tipologia'].title()} · {x['nivel_atencion'].title()} · {x['institucion'].title()}",
        "estado": "Nayarit",
        "municipio": municipios_inegi[x["cve_municipio"][2:]],
        "direccion": ", ".join(p for p in (x["direccion"], f"C.P. {x['codigo_postal']}" if x["codigo_postal"] else "") if p),
        "latitud": x["lat"],
        "longitud": x["lng"],
        "telefono": x["telefono"],
        "horario": horarios_imss.get(norm(x["nombre_corto"]), "") if x["clave_institucion"] in ("IMS", "IMB") else "",
        "servicios": "",
        "servicios_verificados": "no",
        "fuente": "CLUES DGIS (corte 2026-08)" + ("; Directorio IMSS (consulta 2026-10-17)" if IMSS_FUENTE in x["fuente"] else "")
                  + ("; Localidades INEGI (consulta 2026-10-17)" if INEGI_FUENTE in x["fuente"] else ""),
        "url_fuente": " | ".join(urls),
        "fecha_verificacion": FECHA_VERIFICACION if verificada else "",
        "estado_verificacion": "verificado" if verificada else "pendiente",
        "observaciones": "; ".join(obs),
        "zona_horaria": "America/Bahia_Banderas" if x["cve_municipio"] == "18020" else "America/Mazatlan",
        "tolerancia_minutos": "10",
    })
with open(BASE / "instalaciones_nayarit_imss_plantilla.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=PLANTILLA_CAMPOS); w.writeheader(); w.writerows(plantilla)
print("plantilla:", len(plantilla), "| categorías:", collections.Counter(p["categoria"] for p in plantilla).most_common(),
      "| verificadas:", sum(1 for p in plantilla if p["estado_verificacion"] == "verificado"),
      "| con horario:", sum(1 for p in plantilla if p["horario"]))
