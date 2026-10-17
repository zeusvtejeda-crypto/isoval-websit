import { categoryIconPaths, resolveCategoryIcon } from "@/lib/directory/icons";

/**
 * Ícono de categoría (decorativo: siempre va junto al nombre de la categoría).
 * Toma el color del texto (currentColor). Sirve en el servidor y en el navegador.
 */
export function CategoryIcon({ icon, className }: { icon: string | null | undefined; className?: string }) {
  const name = resolveCategoryIcon(icon);
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      className={className}
    >
      {categoryIconPaths(name).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
