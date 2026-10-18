/**
 * Crea la primera cuenta de administración (producción o local).
 * Uso: npm run crear-admin -- correo@dominio.mx "Nombre visible" [--promover]
 * La contraseña se pide sin mostrarla en pantalla (o se lee de ADMIN_PASSWORD en
 * automatizaciones); nunca va como argumento ni queda en el historial.
 * Si el correo ya tiene cuenta, no se modifica salvo con --promover (entonces se
 * le asigna el rol de administración y la contraseña nueva).
 */
import { upsertAccount } from "./lib";

async function askHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) throw new Error("Define ADMIN_PASSWORD o ejecuta el comando en una terminal.");
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          reject(new Error("Cancelado."));
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const promote = args.includes("--promover");
  const [email, displayName] = args.filter((a) => a !== "--promover");
  if (!email) {
    console.error('Uso: npm run crear-admin -- correo@dominio.mx "Nombre" [--promover]');
    process.exit(1);
  }
  let password = process.env.ADMIN_PASSWORD ?? "";
  if (!password) {
    password = await askHidden("Contraseña (mínimo 12 caracteres, no se muestra): ");
    const again = await askHidden("Repítela: ");
    if (password !== again) {
      console.error("Las contraseñas no coinciden.");
      process.exit(1);
    }
  }
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    console.error("La contraseña debe tener al menos 12 caracteres, con minúsculas, mayúsculas y números.");
    process.exit(1);
  }
  const id = await upsertAccount({
    email,
    password,
    role: "admin",
    displayName: displayName ?? "Administración",
    existing: promote ? "promote" : "fail",
  });
  console.log(`${promote ? "Cuenta promovida a administración" : "Administración creada"}: ${email} (${id})`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
