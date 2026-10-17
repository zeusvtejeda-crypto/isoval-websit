import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export default function TrabajadorNoEncontrado() {
  return (
    <EmptyState
      title="Trabajador no encontrado"
      description="La persona no existe o tu cuenta no tiene acceso a su historial."
      action={<LinkButton href="/historial">Volver al historial</LinkButton>}
    />
  );
}
