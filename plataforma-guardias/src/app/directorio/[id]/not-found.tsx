import Link from "next/link";
import { EmptyState } from "@/components/ui/states";
import { buttonClasses } from "@/components/ui/button";

export default function InstalacionNoEncontrada() {
  return (
    <EmptyState
      title="Instalación no encontrada"
      description="La instalación no existe o no forma parte del directorio público."
      action={
        <Link href="/directorio" className={buttonClasses("primary", "lg")}>
          Ver directorio
        </Link>
      }
    />
  );
}
