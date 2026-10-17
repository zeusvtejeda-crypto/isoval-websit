import Link from "next/link";

/** Aviso permanente de no oficialidad. */
export function Disclaimer() {
  return (
    <footer className="no-print border-t border-gray-200 bg-white px-4 py-4 text-center text-xs text-gray-600">
      <p>
        Esta plataforma <strong>no es una aplicación oficial del IMSS</strong> ni está afiliada al Instituto.
      </p>
      <p className="mt-1">
        <Link href="/aviso-de-privacidad" className="underline underline-offset-2 hover:text-gray-900">
          Aviso de privacidad
        </Link>
        {" · "}
        Mapas: datos de OpenStreetMap (ver atribución en el mapa).
      </p>
    </footer>
  );
}

/** Franja de datos de demostración. */
export function DemoBanner() {
  return (
    <div className="no-print bg-amber-50 px-4 py-1.5 text-center text-sm font-semibold text-amber-950 ring-1 ring-amber-200">
      Modo de demostración: los registros marcados «[DEMO]» son ficticios y no deben usarse como fuente.
    </div>
  );
}
