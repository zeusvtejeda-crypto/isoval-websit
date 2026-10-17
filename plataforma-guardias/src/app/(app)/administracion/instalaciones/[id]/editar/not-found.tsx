import Link from "next/link";
import { EmptyState } from "@/components/ui/states";
import { buttonClasses } from "@/components/ui/button";

export default function InstalacionNoEncontrada() {
  return (
    <EmptyState
      title="Instalación no encontrada"
      description="El registro no existe o fue eliminado."
      action={
        <Link href="/administracion/instalaciones" className={buttonClasses("primary")}>
          Ver instalaciones
        </Link>
      }
    />
  );
}
