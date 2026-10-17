import Link from "next/link";
import { EmptyState } from "@/components/ui/states";
import { buttonClasses } from "@/components/ui/button";

export default function CategoriaNoEncontrada() {
  return (
    <EmptyState
      title="Categoría no encontrada"
      description="La categoría no existe o fue eliminada."
      action={
        <Link href="/administracion/categorias" className={buttonClasses("primary")}>
          Ver categorías
        </Link>
      }
    />
  );
}
