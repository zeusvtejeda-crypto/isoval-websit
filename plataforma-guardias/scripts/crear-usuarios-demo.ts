/**
 * Crea cuentas de DEMOSTRACIÓN vinculadas a los datos del seed (solo local).
 * Uso: npm run demo:usuarios
 */
import { upsertAccount, loadEnv } from "./lib";

loadEnv();
const password = process.env.DEMO_PASSWORD ?? "Demo-Guardias-2026!";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/127\.0\.0\.1|localhost/.test(url) && process.env.ALLOW_DEMO_USERS !== "true") {
  console.error("Por seguridad, las cuentas de demostración solo se crean contra Supabase local. Define ALLOW_DEMO_USERS=true para forzarlo.");
  process.exit(1);
}

const F1 = "d0000000-0000-4000-8000-000000000001";
const F2 = "d0000000-0000-4000-8000-000000000002";
const W = (n: number) => `d1000000-0000-4000-8000-00000000000${n}`;

async function main() {
  await upsertAccount({ email: "admin@demo.local", password, role: "admin", displayName: "Administración (demo)" });
  await upsertAccount({ email: "coordinacion@demo.local", password, role: "coordinador", displayName: "Coordinación (demo)", workerId: W(3), facilityIds: [F1, F2] });
  await upsertAccount({ email: "auditoria@demo.local", password, role: "auditor", displayName: "Auditoría (demo)", facilityIds: [F1] });
  await upsertAccount({ email: "trabajador@demo.local", password, role: "trabajador", displayName: "Ana (demo)", workerId: W(1) });
  await upsertAccount({ email: "trabajador2@demo.local", password, role: "trabajador", displayName: "Luis (demo)", workerId: W(2) });
  console.log("Cuentas de demostración listas:");
  console.log("  admin@demo.local, coordinacion@demo.local, auditoria@demo.local, trabajador@demo.local, trabajador2@demo.local");
  console.log(`  Contraseña: ${process.env.DEMO_PASSWORD ? "(la definida en DEMO_PASSWORD)" : password}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
