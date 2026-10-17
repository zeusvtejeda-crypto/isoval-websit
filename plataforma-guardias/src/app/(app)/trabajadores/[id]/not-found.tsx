import Link from "next/link";
import { EmptyState } from "@/components/ui/states";
import { buttonClasses } from "@/components/ui/button";

export default function TrabajadorNoEncontrado() {
  return (
    <EmptyState
      title="Trabajador no encontrado"
      description="El registro no existe o tu cuenta no tiene acceso a él."
      action={
        <Link href="/trabajadores" className={buttonClasses("primary")}>
          Ver trabajadores
        </Link>
      }
    />
  );
}
