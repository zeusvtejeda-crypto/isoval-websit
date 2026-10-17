/**
 * Tarjetas del panel de administración según el rol (lógica pura).
 * La autorización real está en cada página y en RLS; esto solo decide qué
 * accesos se muestran.
 */
import type { AppRole } from "@/lib/auth";

export type PanelCard = { key: string; href: string; title: string; description: string };

const CARDS = {
  instalaciones: {
    key: "instalaciones",
    href: "/administracion/instalaciones",
    title: "Instalaciones",
    description: "Alta, edición y verificación de sedes del directorio.",
  },
  categorias: {
    key: "categorias",
    href: "/administracion/categorias",
    title: "Categorías",
    description: "Clasificación de instalaciones en el directorio y el mapa.",
  },
  importarInstalaciones: {
    key: "importar-instalaciones",
    href: "/administracion/instalaciones/importar",
    title: "Importar instalaciones",
    description: "Carga masiva desde CSV o Excel con revisión previa.",
  },
  importarTrabajadores: {
    key: "importar-trabajadores",
    href: "/trabajadores/importar",
    title: "Importar trabajadores",
    description: "Carga masiva del directorio privado de trabajadores.",
  },
  usuarios: {
    key: "usuarios",
    href: "/administracion/usuarios",
    title: "Usuarios y permisos",
    description: "Cuentas de acceso, roles, sedes asignadas y contraseñas temporales.",
  },
  configuracion: {
    key: "configuracion",
    href: "/administracion/configuracion",
    title: "Configuración",
    description: "Aviso de privacidad, conservación de datos, registro de asistencia y datos de demostración.",
  },
  bitacora: {
    key: "bitacora",
    href: "/administracion/bitacora",
    title: "Bitácora",
    description: "Quién cambió qué, cuándo y por qué, con valor anterior y nuevo.",
  },
  correcciones: {
    key: "correcciones",
    href: "/correcciones",
    title: "Correcciones",
    description: "Solicitudes de corrección de entradas y salidas por revisar.",
  },
} satisfies Record<string, PanelCard>;

export function adminPanelCards(role: AppRole): PanelCard[] {
  switch (role) {
    case "admin":
      return [
        CARDS.instalaciones,
        CARDS.categorias,
        CARDS.importarInstalaciones,
        CARDS.importarTrabajadores,
        CARDS.usuarios,
        CARDS.configuracion,
        CARDS.bitacora,
        CARDS.correcciones,
      ];
    case "coordinador":
      return [
        CARDS.correcciones,
        CARDS.importarTrabajadores,
        { ...CARDS.bitacora, description: "Cambios registrados en tus sedes asignadas." },
      ];
    case "auditor":
      return [{ ...CARDS.bitacora, description: "Consulta de cambios en tus sedes asignadas (solo lectura)." }];
    default:
      return [];
  }
}

export function panelDescription(role: AppRole): string {
  switch (role) {
    case "admin":
      return "Catálogos, cuentas de acceso, configuración y bitácora de la plataforma.";
    case "coordinador":
      return "Herramientas de coordinación para tus sedes asignadas.";
    case "auditor":
      return "Consulta de la bitácora de tus sedes asignadas.";
    default:
      return "";
  }
}
