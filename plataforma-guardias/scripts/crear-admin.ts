/**
 * Crea la primera cuenta de administración (producción o local).
 * Uso: npm run crear-admin -- correo@dominio.mx "Nombre visible"
 * La contraseña se lee de ADMIN_PASSWORD (no la pases como argumento).
 */
import { upsertAccount } from "./lib";

async function main() {
  const [email, displayName] = process.argv.slice(2);
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error('Uso: ADMIN_PASSWORD="..." npm run crear-admin -- correo@dominio.mx "Nombre"');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("La contraseña debe tener al menos 12 caracteres.");
    process.exit(1);
  }
  const id = await upsertAccount({ email, password, role: "admin", displayName: displayName ?? "Administración" });
  console.log(`Administración creada: ${email} (${id})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
