import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export default function CuentaNoEncontrada() {
  return (
    <EmptyState
      title="Cuenta no encontrada"
      description="La cuenta no existe o fue eliminada."
      action={<LinkButton href="/administracion/usuarios">Volver a Usuarios y permisos</LinkButton>}
    />
  );
}
