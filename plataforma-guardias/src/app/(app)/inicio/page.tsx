import { requireStaff } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";

export default async function InicioPage() {
  const user = await requireStaff();
  return <PageHeader title="Inicio" description={`Hola, ${user.displayName ?? ""}`} />;
}
