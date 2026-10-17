import Link from "next/link";
import { EmptyState } from "@/components/ui/states";
import { buttonClasses } from "@/components/ui/button";

export default function GuardiaNoEncontrada() {
  return (
    <EmptyState
      title="Guardia no encontrada"
      description="La guardia no existe o tu cuenta no tiene acceso a ella."
      action={
        <Link href="/guardias" className={buttonClasses("primary")}>
          Ver guardias
        </Link>
      }
    />
  );
}
