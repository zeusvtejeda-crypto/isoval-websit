import { Client } from "pg";

/**
 * Verificación previa de las pruebas E2E (solo lectura: no modifica la base).
 *
 * Las fechas del seed de demostración son relativas al momento de `npm run db:reset`
 * («[DEMO] Guardia matutina» empieza un par de horas antes y dura unas horas). Si la
 * base se reinició hace mucho, esa guardia ya terminó y las pruebas fallarían con
 * errores confusos. Aquí se detecta antes de empezar y se indica cómo arreglarlo.
 *
 * Nota: Playwright arranca `webServer` antes de este paso.
 */
const GUARDIA_DEMO_EN_CURSO = "d2000000-0000-4000-8000-000000000001";
const CUENTA_DEMO = "admin@demo.local";

const MENSAJE =
  "Los datos de demostración no están listos o vencieron (las fechas del seed son relativas al momento del reset). " +
  "Ejecuta: npm run db:reset && npm run demo:usuarios";

export default async function globalSetup() {
  const connectionString = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 });

  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `No se pudo conectar a la base de datos local (${redact(connectionString)}). ` +
        "¿Está corriendo Supabase? Ejecuta: npm run db:start\n" +
        MENSAJE,
      { cause: error },
    );
  }

  const problemas: string[] = [];
  try {
    // Lectura en una transacción de solo lectura: este paso nunca escribe.
    await client.query("begin read only");

    const guardia = await client.query<{ estado: string }>(
      "select public.effective_status(s)::text as estado from public.shifts s where s.id = $1",
      [GUARDIA_DEMO_EN_CURSO],
    );
    if (guardia.rowCount === 0) {
      problemas.push(`no existe la guardia de demostración ${GUARDIA_DEMO_EN_CURSO} («[DEMO] Guardia matutina»)`);
    } else if (guardia.rows[0].estado !== "en_curso") {
      problemas.push(
        `la guardia de demostración «[DEMO] Guardia matutina» está «${guardia.rows[0].estado}» y debe estar «en_curso»`,
      );
    }

    const cuenta = await client.query("select 1 from auth.users where lower(email) = $1 limit 1", [CUENTA_DEMO]);
    if (cuenta.rowCount === 0) {
      problemas.push(`no existe la cuenta de demostración ${CUENTA_DEMO}`);
    }

    await client.query("rollback");
  } catch (error) {
    throw new Error(`No se pudo verificar la base de datos local: ${(error as Error).message}\n${MENSAJE}`, {
      cause: error,
    });
  } finally {
    await client.end().catch(() => undefined);
  }

  if (problemas.length > 0) {
    throw new Error(`${MENSAJE}\nDetalle: ${problemas.join("; ")}.`);
  }
}

/** Oculta la contraseña de la cadena de conexión antes de mostrarla. */
function redact(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "TEST_DATABASE_URL";
  }
}
