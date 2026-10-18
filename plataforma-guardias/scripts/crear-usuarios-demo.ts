/**
 * Crea cuentas de DEMOSTRACIÓN vinculadas a los datos del seed (solo local).
 * Uso: npm run demo:usuarios
 */
import { isLocalSupabase, loadEnv, upsertAccount } from "./lib";

loadEnv();
const DEFAULT_PASSWORD = "Demo-Guardias-2026!";
const password = process.env.DEMO_PASSWORD || DEFAULT_PASSWORD;
if (!isLocalSupabase()) {
  // Fuera del Supabase local (llaves de la CLI y host local) solo con permiso
  // explícito y una contraseña propia: la de omisión está publicada en el README.
  if (process.env.ALLOW_DEMO_USERS !== "true") {
    console.error("Por seguridad, las cuentas de demostración solo se crean contra Supabase local. Define ALLOW_DEMO_USERS=true para forzarlo.");
    process.exit(1);
  }
  if (password === DEFAULT_PASSWORD || password.length < 12) {
    console.error("Fuera de local define DEMO_PASSWORD con al menos 12 caracteres y distinta de la de omisión.");
    process.exit(1);
  }
}

const F1 = "d0000000-0000-4000-8000-000000000001";
const F2 = "d0000000-0000-4000-8000-000000000002";
const W = (n: number) => `d1000000-0000-4000-8000-00000000000${n}`;

async function main() {
  await upsertAccount({ email: "admin@demo.local", password, role: "admin", displayName: "Administración (demo)", existing: "update" });
  await upsertAccount({ email: "coordinacion@demo.local", password, role: "coordinador", displayName: "Coordinación (demo)", workerId: W(3), facilityIds: [F1, F2] , existing: "update" });
  await upsertAccount({ email: "auditoria@demo.local", password, role: "auditor", displayName: "Auditoría (demo)", facilityIds: [F1] , existing: "update" });
  await upsertAccount({ email: "trabajador@demo.local", password, role: "trabajador", displayName: "Ana (demo)", workerId: W(1) , existing: "update" });
  await upsertAccount({ email: "trabajador2@demo.local", password, role: "trabajador", displayName: "Luis (demo)", workerId: W(2) , existing: "update" });
  console.log("Cuentas de demostración listas:");
  console.log("  admin@demo.local, coordinacion@demo.local, auditoria@demo.local, trabajador@demo.local, trabajador2@demo.local");
  console.log(`  Contraseña: ${password === DEFAULT_PASSWORD ? password : "(la definida en DEMO_PASSWORD)"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
