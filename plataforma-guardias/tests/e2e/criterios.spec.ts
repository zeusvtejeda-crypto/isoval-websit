import ExcelJS from "exceljs";
import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";
import {
  DEMO,
  addMinutes,
  displayDateTime,
  localInput,
  localParts,
  loginAs,
  metric,
  minutesFromNow,
  stubMapTiles,
} from "./helpers";

/**
 * Criterios de aceptación (12) validados por la INTERFAZ, en un teléfono
 * (proyecto «movil»). Las pruebas forman un flujo: la instalación, el
 * trabajador y las guardias que se crean al inicio se usan en los criterios
 * siguientes. Los nombres llevan un sufijo único por ejecución para poder
 * repetirlas sin reiniciar la base. Los criterios 8, 11 y 12 usan los datos de
 * demostración (supabase/seeds/demo.sql + npm run demo:usuarios).
 */

const expect = baseExpect.configure({ timeout: 20_000 });

test.describe.configure({ mode: "serial" });
// El service worker no interviene en /api/ (ver public/sw.js); se bloquea aquí
// para que page.route() vea todas las solicitudes de forma determinista.
test.use({ serviceWorkers: "block" });

const RUN = String(Date.now());
const DATA = {
  facilityName: `[DEMO] E2E Instalación ${RUN}`,
  facilityKey: `E2E-${RUN}`,
  workerName: `[DEMO] E2E Trabajadora ${RUN}`,
  // Una persona no puede tener dos guardias asignadas que se traslapan: las
  // guardias en curso de los criterios 3 y 7 usan personas distintas, creadas en
  // cada ejecución (así también se pueden repetir sin reiniciar la base).
  companionName: `[DEMO] E2E Compañero ${RUN}`,
  returnWorkerName: `[DEMO] E2E Trabajador regreso ${RUN}`,
  returnEmail: `e2e.regreso.${RUN}@demo.local`,
  employeeNumber: `E2E-${RUN}`,
  workerPhone: "311 555 0101",
  shiftTitle: `[DEMO] E2E Guardia ${RUN}`,
  shiftPoint: `Acceso E2E ${RUN}`,
  nightTitle: `[DEMO] E2E Nocturna ${RUN}`,
  nightPoint: `Urgencias E2E ${RUN}`,
  returnTitle: `[DEMO] E2E Salida y regreso ${RUN}`,
  returnPoint: `Comedor E2E ${RUN}`,
  email: `e2e.${RUN}@demo.local`,
  password: `E2E-Guardias-${RUN}!`,
  correctionReason: `E2E corrección ${RUN}: la entrada se capturó cinco minutos antes`,
};
const HOSPITAL_A = "[DEMO] Hospital de demostración A";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Estado compartido entre criterios (se llena conforme avanza el flujo). */
const state: {
  facilityId?: string;
  workerId?: string;
  shiftId?: string;
  nightShiftId?: string;
  returnShiftId?: string;
  returnStart?: Date;
} = {};

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Falta ${what}: depende de un criterio anterior.`);
  return value;
}

function idFromUrl(page: Page, pattern: RegExp): string {
  const match = page.url().match(pattern);
  if (!match) throw new Error(`No se encontró el identificador en ${page.url()}`);
  return match[1];
}

type ShiftInput = {
  title: string;
  point: string;
  date: string;
  startTime: string;
  endTime: string;
  responsibleId?: string;
  minStaff?: string;
  maxStaff?: string;
  instructions?: string;
};

async function fillShiftForm(page: Page, s: ShiftInput) {
  await page.getByLabel("Título").fill(s.title);
  await page.getByLabel("Punto de reunión o acceso").fill(s.point);
  await page.getByLabel("Fecha").fill(s.date);
  await page.getByLabel("Hora de inicio").fill(s.startTime);
  await page.getByLabel("Hora de término").fill(s.endTime);
  if (s.responsibleId) await page.getByLabel("Responsable").selectOption(s.responsibleId);
  await page.getByLabel("Cupo mínimo").fill(s.minStaff ?? "1");
  await page.getByLabel("Cupo máximo").fill(s.maxStaff ?? "");
  if (s.instructions) await page.getByLabel("Instrucciones").fill(s.instructions);
}

/** Crea una guardia en el Hospital A desde la interfaz y devuelve su identificador. */
async function createShift(page: Page, s: ShiftInput): Promise<string> {
  await page.goto(`/guardias/nueva?sede=${DEMO.hospitalA}`);
  await expect(page.getByRole("heading", { level: 1, name: "Nueva guardia" })).toBeVisible();
  await expect(page.getByText(HOSPITAL_A, { exact: true })).toBeVisible();
  await fillShiftForm(page, s);
  await page.getByRole("button", { name: "Crear guardia" }).click();
  await expect(page).toHaveURL(new RegExp(`/guardias/${UUID}$`));
  await expect(page.getByRole("heading", { level: 1, name: s.title })).toBeVisible();
  return idFromUrl(page, new RegExp(`/guardias/(${UUID})$`));
}

/** Coordinación registra un trabajador del Hospital A (solo datos obligatorios) y devuelve su identificador. */
async function createWorker(page: Page, name: string): Promise<string> {
  await loginAs(page, "coordinacion@demo.local");
  await page.goto("/trabajadores/nuevo");
  await page.getByLabel("Nombre completo").fill(name);
  await page.getByLabel("Municipio").selectOption({ label: "Tepic" });
  await page.getByLabel("Instalación de adscripción").selectOption(DEMO.hospitalA);
  await page.getByRole("button", { name: "Registrar trabajador" }).click();
  await expect(page).toHaveURL(new RegExp(`/trabajadores/${UUID}\\?guardado=1`));
  return idFromUrl(page, new RegExp(`/trabajadores/(${UUID})`));
}

/** Administración crea la cuenta de acceso (rol trabajador) vinculada al trabajador. */
async function createWorkerAccount(page: Page, workerId: string, email: string, password: string) {
  await loginAs(page, "admin@demo.local");
  await page.goto(`/trabajadores/${workerId}`);
  await page.getByRole("link", { name: "Crear cuenta de acceso para esta persona" }).click();
  await expect(page).toHaveURL(/\/administracion\/usuarios\/nueva\?trabajador=/);
  await page.locator("#new-email").fill(email);
  await expect(page.locator("#new-role")).toHaveValue("trabajador");
  await expect(page.locator("#new-worker_id")).toHaveValue(workerId);
  await page.getByRole("radio", { name: /Escribirla/ }).check();
  await page.locator("#new-password").fill(password);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByText(`Cuenta creada para ${email}.`)).toBeVisible();
}

/** Agrega una asignación desde el detalle de la guardia y espera a verla en la lista. */
async function addAssignment(page: Page, workerId: string, workerName: string, expectedCount: number) {
  const disclosure = page.locator("details").filter({ has: page.locator("summary", { hasText: "Agregar asignación" }) });
  if (!(await disclosure.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await disclosure.locator("summary").click();
  }
  await disclosure.getByLabel("Trabajador", { exact: false }).selectOption(workerId);
  await disclosure.getByRole("button", { name: "Agregar asignación" }).click();
  await expect(page.getByRole("heading", { level: 2, name: `Asignaciones (${expectedCount})` })).toBeVisible();
  await expect(assignmentCard(page, workerName)).toBeVisible();
}

/** Tarjeta de una asignación en /guardias/[id]. */
function assignmentCard(page: Page, workerName: string): Locator {
  return page.locator("article").filter({ has: page.getByRole("heading", { level: 3, name: workerName, exact: true }) });
}

/** Lista de registros (sesiones) de una tarjeta de asignación. */
function sessionItems(card: Locator): Locator {
  return card.locator('section[aria-label^="Registros de"] > ul > li');
}

/** Tarjeta de una guardia en /mi-historial o /historial/trabajador/[id] (se identifica por su punto de reunión). */
function historyCard(page: Page, meetingPoint: string): Locator {
  return page.getByText(`Punto de reunión: ${meetingPoint}`, { exact: false }).locator("xpath=ancestor::section[1]");
}

async function openDisclosure(scope: Locator, summary: string | RegExp) {
  const details = scope.locator("details").filter({ has: scope.page().locator("summary", { hasText: summary }) }).first();
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await details.locator("summary").first().click();
  }
  return details;
}

test.describe("Criterios de aceptación por la interfaz", () => {
  test("Criterio 1: crear una instalación y encontrarla en la lista y en el mapa", async ({ page }) => {
    await stubMapTiles(page);
    await loginAs(page, "admin@demo.local");

    await page.goto("/administracion/instalaciones/nueva");
    await page.getByLabel("Nombre oficial").fill(DATA.facilityName);
    await page.getByLabel("Clave de unidad").fill(DATA.facilityKey);
    await page.getByLabel("Categoría").selectOption({ label: "Otras instalaciones" });
    await expect(page.getByLabel("Estado (entidad federativa)")).toHaveValue("18");
    await page.getByLabel("Municipio").selectOption({ label: "Tepic" });
    await page.getByLabel("Dirección").fill(`Domicilio de prueba ${RUN}, Tepic`);
    await page.getByLabel("Latitud").fill("21.5200");
    await page.getByLabel("Longitud").fill("-104.9100");
    await page.getByLabel("Fuente de información").fill("Prueba automatizada E2E (dato ficticio)");
    await page.getByLabel("Marcar como datos de demostración").check();
    await page.getByRole("button", { name: "Registrar instalación" }).click();

    await expect(page).toHaveURL(new RegExp(`/administracion/instalaciones/${UUID}/editar\\?guardado=alta`));
    state.facilityId = idFromUrl(page, new RegExp(`/instalaciones/(${UUID})/editar`));

    // El directorio es público: se consulta sin sesión.
    await page.context().clearCookies();
    await page.goto("/directorio");
    const search = page.getByLabel("Buscar", { exact: true });

    // LISTA: búsqueda por clave de unidad y por nombre.
    const list = page.locator("#dir-panel-lista");
    await search.fill(DATA.facilityKey);
    await expect(list.getByText("1 instalación encontrada")).toBeVisible();
    const item = list.getByRole("listitem").filter({ has: page.getByRole("link", { name: DATA.facilityName, exact: true }) });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(`Clave de unidad: ${DATA.facilityKey}`);
    await expect(item).toContainText("Tepic, Nayarit");
    await expect(item.getByRole("link", { name: `Cómo llegar a ${DATA.facilityName} (se abre en otra pestaña)` })).toHaveAttribute(
      "href",
      /21\.52/,
    );

    await search.fill(`E2E Instalación ${RUN}`);
    await expect(list.getByText("1 instalación encontrada")).toBeVisible();
    await expect(list.getByRole("link", { name: DATA.facilityName, exact: true })).toBeVisible();

    // MAPA: contenedor de Leaflet con atribución de OpenStreetMap y el marcador de la instalación.
    await page.getByRole("tab", { name: "Mapa" }).click();
    const mapPanel = page.locator("#dir-panel-mapa");
    await expect(mapPanel.locator(".leaflet-container")).toBeVisible();
    await expect(mapPanel.locator(".leaflet-control-attribution")).toContainText("OpenStreetMap");
    const marker = mapPanel.locator(`.leaflet-marker-icon[title="${DATA.facilityName} (Otras instalaciones)"]`);
    await expect(marker).toHaveCount(1);
    await marker.click();
    const popup = mapPanel.locator(".leaflet-popup-content");
    await expect(popup).toContainText(DATA.facilityName);
    await expect(popup).toContainText(`Clave ${DATA.facilityKey}`);
    await expect(popup.getByRole("link", { name: /Cómo llegar/ })).toHaveAttribute("href", /21\.52/);

    // Ficha pública desde la ventana emergente.
    await popup.getByRole("link", { name: "Ver ficha" }).click();
    await expect(page).toHaveURL(new RegExp(`/directorio/${state.facilityId}`));
    await expect(page.getByRole("heading", { level: 1, name: DATA.facilityName })).toBeVisible();
    await expect(page.getByText(DATA.facilityKey).first()).toBeVisible();
  });

  test("Criterio 2: registrar un trabajador y asignarlo a una sede", async ({ page }) => {
    await loginAs(page, "coordinacion@demo.local");
    await page.goto("/trabajadores/nuevo");
    await page.getByLabel("Nombre completo").fill(DATA.workerName);
    await expect(page.getByLabel("Estado (entidad federativa)")).toHaveValue("18");
    await page.getByLabel("Municipio").selectOption({ label: "Tepic" });
    await page.getByLabel("Instalación de adscripción").selectOption(DEMO.hospitalA);
    await page.getByLabel("Área").fill("Enfermería");
    await page.getByLabel("Puesto").fill("Enfermera general");
    await page.getByLabel("Turno habitual").selectOption("Matutino");
    await page.getByLabel("Número de trabajador").fill(DATA.employeeNumber);
    await page.getByLabel("Teléfono").fill(DATA.workerPhone);
    await page.getByRole("button", { name: "Registrar trabajador" }).click();

    await expect(page).toHaveURL(new RegExp(`/trabajadores/${UUID}\\?guardado=1`));
    state.workerId = idFromUrl(page, new RegExp(`/trabajadores/(${UUID})`));
    await expect(page.getByRole("heading", { level: 1, name: DATA.workerName })).toBeVisible();
    await expect(page.getByText("Datos guardados. El cambio quedó en la bitácora.")).toBeVisible();

    const general = page.locator("section").filter({ has: page.getByRole("heading", { name: "Datos generales" }) });
    await expect(metric(general, "Instalación de adscripción")).toContainText(HOSPITAL_A);
    await expect(metric(general, "Estado (entidad federativa)")).toHaveText("Nayarit");
    await expect(metric(general, "Municipio")).toHaveText("Tepic");
    // La coordinación de la sede sí ve los datos privados en la ficha.
    const privados = page.locator("section").filter({ has: page.getByRole("heading", { name: "Datos privados" }) });
    await expect(metric(privados, "Número de trabajador")).toHaveText(DATA.employeeNumber);
    // Un trabajador puede existir sin cuenta de acceso.
    await expect(page.getByText("Sin cuenta de acceso.", { exact: false })).toBeVisible();

    // En la lista aparece con su sede, sin teléfono ni número de trabajador.
    await page.goto(`/trabajadores?q=${encodeURIComponent(`E2E Trabajadora ${RUN}`)}`);
    await expect(page.getByText(/^1 trabajador · /)).toBeVisible();
    const card = page.getByRole("list", { name: "Trabajadores" }).getByRole("listitem").filter({ hasText: DATA.workerName });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(HOSPITAL_A);
    await expect(card).toContainText("Sin cuenta");
    await expect(page.getByText(DATA.workerPhone)).toHaveCount(0);
    await expect(page.getByText(DATA.employeeNumber)).toHaveCount(0);

    // Filtro por sede de adscripción.
    await page.goto(`/trabajadores?sede=${DEMO.hospitalA}&q=${encodeURIComponent(RUN)}`);
    await expect(page.getByRole("list", { name: "Trabajadores" }).getByText(DATA.workerName)).toBeVisible();
    await page.goto(`/trabajadores?sede=${DEMO.umf1}&q=${encodeURIComponent(RUN)}`);
    await expect(page.getByText("Sin resultados.")).toBeVisible();
  });

  test("Criterio 3: crear una guardia y asignar trabajadores", async ({ page }) => {
    const workerId = required(state.workerId, "el trabajador del criterio 2");
    const companionId = await createWorker(page, DATA.companionName);
    await loginAs(page, "coordinacion@demo.local");

    // Coordinación tiene dos sedes: primero elige la sede (paso 1 de 2).
    await page.goto("/guardias/nueva");
    await expect(page.getByText("Paso 1 de 2: elige la sede de la guardia.")).toBeVisible();
    const sedes = page.getByLabel("Sede");
    await expect(sedes.locator("option", { hasText: "Unidad de Medicina Familiar de demostración 2" })).toHaveCount(0);
    await sedes.selectOption(DEMO.hospitalA);
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByText("Paso 2 de 2: datos de la guardia.")).toBeVisible();

    // Guardia en curso: inició hace 1 h y termina en 3 h (hora de la sede).
    const start = minutesFromNow(-60);
    const end = minutesFromNow(180);
    await fillShiftForm(page, {
      title: DATA.shiftTitle,
      point: DATA.shiftPoint,
      date: localParts(start).date,
      startTime: localParts(start).time,
      endTime: localParts(end).time,
      responsibleId: workerId,
      minStaff: "1",
      maxStaff: "5",
      instructions: "Instrucciones de prueba automatizada.",
    });
    await page.getByRole("button", { name: "Crear guardia" }).click();
    await expect(page).toHaveURL(new RegExp(`/guardias/${UUID}$`));
    state.shiftId = idFromUrl(page, new RegExp(`/guardias/(${UUID})$`));

    await expect(page.getByRole("heading", { level: 1, name: DATA.shiftTitle })).toBeVisible();
    await expect(page.getByText(DATA.shiftPoint, { exact: true })).toBeVisible();
    await expect(page.getByText("En curso", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Asignaciones (0)" })).toBeVisible();

    await addAssignment(page, workerId, DATA.workerName, 1);
    await addAssignment(page, companionId, DATA.companionName, 2);

    const general = page.locator("section").filter({ hasText: "Punto de reunión o acceso" }).first();
    await expect(metric(general, "Responsable")).toHaveText(DATA.workerName);
    await expect(assignmentCard(page, DATA.workerName)).toContainText("Asignado");
    await expect(assignmentCard(page, DATA.workerName)).toContainText("Pendiente");

    // La guardia aparece en la lista de guardias de la semana.
    await page.goto("/guardias");
    await expect(page.getByRole("link", { name: DATA.shiftTitle, exact: true })).toBeVisible();
  });

  test("Criterio 4: registrar entrada y verla en «En servicio»", async ({ page }) => {
    const workerId = required(state.workerId, "el trabajador del criterio 2");
    required(state.shiftId, "la guardia del criterio 3");

    // Administración crea la cuenta de acceso vinculada al trabajador nuevo.
    await loginAs(page, "admin@demo.local");
    await page.goto(`/trabajadores/${workerId}`);
    await page.getByRole("link", { name: "Crear cuenta de acceso para esta persona" }).click();
    await expect(page).toHaveURL(/\/administracion\/usuarios\/nueva\?trabajador=/);
    // Esta página también lista las sedes como casillas (su nombre puede contener «Rol», «Correo»…):
    // los campos se ubican por su identificador.
    await page.locator("#new-email").fill(DATA.email);
    await expect(page.locator("#new-display_name")).toHaveValue(DATA.workerName);
    await expect(page.locator("#new-role")).toHaveValue("trabajador");
    await expect(page.locator("#new-worker_id")).toHaveValue(workerId);
    await page.getByRole("radio", { name: /Escribirla/ }).check();
    await page.locator("#new-password").fill(DATA.password);
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByText(`Cuenta creada para ${DATA.email}.`)).toBeVisible();

    // La persona registra su entrada con el botón grande.
    await loginAs(page, DATA.email, DATA.password);
    await expect(page).toHaveURL(/\/mi-guardia/);
    await page.goto("/registro");
    await expect(page.getByRole("heading", { level: 2, name: HOSPITAL_A })).toBeVisible();
    await expect(page.getByText(`Punto de reunión: ${DATA.shiftPoint}`)).toBeVisible();
    await expect(page.getByText("Entrada registrada no equivale a presencia física verificada.").first()).toBeVisible();
    await expect(page.getByText(/^Última actualización:/)).toBeVisible();
    const entrada = page.getByRole("button", { name: "Registrar entrada" });
    await expect(entrada).toBeEnabled();
    await expect(page.getByRole("button", { name: "Registrar salida" })).toBeDisabled();
    await entrada.click();
    await expect(page.getByText("Registro confirmado")).toBeVisible();
    await expect(page.getByText(/^Entrada registrada a las \d{2}:\d{2} \(hora del servidor\)$/)).toBeVisible();
    await expect(page.getByText(`Guardia: ${HOSPITAL_A} · ${DATA.shiftPoint}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Registrar salida" })).toBeEnabled();
    await expect(page.getByText("En servicio (entrada registrada)")).toBeVisible();

    // Coordinación la ve en «Quién está aquí».
    await loginAs(page, "coordinacion@demo.local");
    await page.goto("/en-servicio");
    await expect(page.getByRole("heading", { level: 1, name: "Quién está aquí" })).toBeVisible();
    await expect(page.getByText("Entrada registrada no equivale a presencia física verificada.").first()).toBeVisible();
    const row = page.locator("#en-servicio").getByRole("row").filter({ hasText: DATA.workerName });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(HOSPITAL_A);
    await expect(row).toContainText(`Reunión: ${DATA.shiftPoint}`);
    await expect(row).toContainText("Registro propio");
    await expect(row).toContainText(/\d+ min/);
    // Es responsable de la guardia y ya está en servicio.
    const responsible = page.locator("#responsables").getByRole("row").filter({ hasText: DATA.workerName });
    await expect(responsible).toContainText("En servicio");
  });

  test("Criterio 5: registrar salida y actualizar el historial", async ({ page }) => {
    const workerId = required(state.workerId, "el trabajador del criterio 2");
    await loginAs(page, DATA.email, DATA.password);
    await page.goto("/registro");
    const salida = page.getByRole("button", { name: "Registrar salida" });
    await expect(salida).toBeEnabled();
    await salida.click();
    await expect(page.getByText("Registro confirmado")).toBeVisible();
    await expect(page.getByText(/^Salida registrada a las \d{2}:\d{2} \(hora del servidor\)$/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Registrar entrada" })).toBeEnabled();

    // Mi historial: la sesión aparece cerrada (con hora de salida).
    await page.goto("/mi-historial");
    const card = historyCard(page, DATA.shiftPoint);
    await expect(card).toHaveCount(1);
    await expect(card.getByText("Finalizada", { exact: true })).toBeVisible();
    await expect(card.getByText(/^Entrada: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} · Salida: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/)).toHaveCount(1);
    await expect(card.getByText(/sin salida/)).toHaveCount(0);

    // Historial de coordinación: la fila del trabajador como «Finalizada».
    await loginAs(page, "coordinacion@demo.local");
    await page.goto(`/historial?trabajador=${workerId}`);
    const row = page.getByRole("list", { name: "Guardias del periodo" }).getByRole("listitem").filter({ hasText: DATA.workerName });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Finalizada");
    await expect(row).toContainText(HOSPITAL_A);

    // Historial individual: entrada y salida con método y hora.
    await page.goto(`/historial/trabajador/${workerId}`);
    const detail = historyCard(page, DATA.shiftPoint);
    await expect(detail.getByText("Finalizada", { exact: true })).toBeVisible();
    const session = detail.locator("li").filter({ hasText: "Vigente" });
    await expect(session).toHaveCount(1);
    await expect(session).not.toContainText("Sin salida");
    await expect(session.getByText(/^Registro propio/)).toHaveCount(2);
  });

  test("Criterio 9: evitar duplicados por doble clic o reintento", async ({ page }) => {
    await loginAs(page, DATA.email, DATA.password);
    await page.goto("/registro");

    const posts: Array<{ action: string; assignmentId: string; requestId: string }> = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/asistencia") posts.push(request.postDataJSON());
    });

    // Doble clic rápido: dos eventos «click» en el mismo instante.
    const entrada = page.getByRole("button", { name: "Registrar entrada" });
    await expect(entrada).toBeEnabled();
    const firstResponse = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/asistencia");
    await entrada.evaluate((el: HTMLButtonElement) => {
      el.click();
      el.click();
    });
    const first = await (await firstResponse).json();
    expect(first).toMatchObject({ ok: true, result: "created" });
    await expect(page.getByText(/^Entrada registrada a las \d{2}:\d{2} \(hora del servidor\)$/)).toBeVisible();
    expect(posts).toHaveLength(1);

    // Reintento de la MISMA solicitud (p. ej. el teléfono reenvía): el servidor no duplica.
    const replay = await page.request.post("/api/asistencia", { data: posts[0] });
    expect(replay.status()).toBe(200);
    const replayBody = await replay.json();
    expect(replayBody).toMatchObject({ ok: true, result: "duplicate" });
    expect(replayBody.session.id).toBe(first.session.id);

    // Una sola entrada abierta en el historial.
    await page.goto("/mi-historial");
    let card = historyCard(page, DATA.shiftPoint);
    await expect(card.getByText(/^Entrada: /)).toHaveCount(2);
    await expect(card.getByText(/Salida: sin salida$/)).toHaveCount(1);
    await expect(card.getByText("En servicio", { exact: true })).toBeVisible();

    // Salida: el servidor la guarda pero la respuesta se pierde en la red.
    await page.goto("/registro");
    await page.route("**/api/asistencia", async (route) => {
      await route.fetch();
      await route.abort("connectionreset");
    });
    await page.getByRole("button", { name: "Registrar salida" }).click();
    await expect(page.getByText("Registro NO confirmado")).toBeVisible();
    await expect(page.getByText(/no se guardó o no pudo confirmarse/)).toBeVisible();
    await expect(page.getByText(/^Salida registrada a las/)).toHaveCount(0);
    await expect(page.getByText("Registro confirmado")).toHaveCount(0);

    // El reintento usa el mismo identificador: el servidor responde que ya existía.
    await page.unroute("**/api/asistencia");
    await page.getByRole("button", { name: "Reintentar envío" }).click();
    await expect(page.getByText("Registro ya existente")).toBeVisible();
    await expect(page.getByText("El servidor ya tenía este registro; no se duplicó.")).toBeVisible();
    await expect(page.getByText(/^Salida registrada a las \d{2}:\d{2} \(hora del servidor\)$/)).toBeVisible();
    const retried = posts.filter((p) => p.action === "salida");
    expect(retried).toHaveLength(2);
    expect(new Set(retried.map((p) => p.requestId)).size).toBe(1);

    // Sin respuesta del servidor (la solicitud no llega): nunca se muestra como guardado.
    await expect(page.getByRole("button", { name: "Registrar entrada" })).toBeEnabled();
    await page.route("**/api/asistencia", (route) => route.abort("internetdisconnected"));
    await page.getByRole("button", { name: "Registrar entrada" }).click();
    await expect(page.getByText("Registro NO confirmado")).toBeVisible();
    await expect(page.getByText(/^Entrada registrada a las/)).toHaveCount(0);
    await page.unroute("**/api/asistencia");
    await page.reload();
    await expect(page.getByRole("button", { name: "Registrar entrada" })).toBeEnabled();

    // Sin conexión: se avisa y los botones no envían nada.
    await page.context().setOffline(true);
    await expect(page.getByText("Sin conexión", { exact: true })).toBeVisible();
    await expect(page.getByText(/No es posible registrar entrada ni salida sin conexión/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Registrar entrada" })).toBeDisabled();
    await page.context().setOffline(false);
    await expect(page.getByRole("button", { name: "Registrar entrada" })).toBeEnabled();

    // Resultado final: dos sesiones cerradas, ninguna duplicada ni abierta.
    await page.goto("/mi-historial");
    card = historyCard(page, DATA.shiftPoint);
    await expect(card.getByText(/^Entrada: /)).toHaveCount(2);
    await expect(card.getByText(/sin salida/)).toHaveCount(0);
    await expect(card.getByText("Finalizada", { exact: true })).toBeVisible();
  });

  test("Criterio 6: guardia que cruza la medianoche", async ({ page }) => {
    const workerId = required(state.workerId, "el trabajador del criterio 2");
    await loginAs(page, "coordinacion@demo.local");
    const day = localParts(addMinutes(new Date(), 2 * 24 * 60)).date;

    await page.goto(`/guardias/nueva?sede=${DEMO.hospitalA}`);
    await fillShiftForm(page, {
      title: DATA.nightTitle,
      point: DATA.nightPoint,
      date: day,
      startTime: "22:00",
      endTime: "06:00",
      minStaff: "1",
    });
    const notice = page.getByRole("status").filter({ hasText: "Termina al día siguiente" });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("a las 06:00");
    await expect(notice).toContainText("Duración: 8 h.");
    await page.getByRole("button", { name: "Crear guardia" }).click();
    await expect(page).toHaveURL(new RegExp(`/guardias/${UUID}$`));
    state.nightShiftId = idFromUrl(page, new RegExp(`/guardias/(${UUID})$`));

    const horario = page.locator("dl div").filter({ has: page.locator("dt", { hasText: /^Horario$/ }) });
    await expect(horario).toContainText("22:00 – 06:00 (+1 día)");
    await expect(page.getByText("Programada", { exact: true }).first()).toBeVisible();

    // Las horas programadas se calculan con el cruce de medianoche (8 h, no −16 h).
    await addAssignment(page, workerId, DATA.workerName, 1);
    const metrics = assignmentCard(page, DATA.workerName).locator('section[aria-label^="Métricas de"]');
    await expect(metric(metrics, "Programado")).toHaveText("8 h");

    // En la lista de guardias del día también se indica «+1 día».
    await page.goto(`/guardias?desde=${day}&hasta=${day}`);
    const card = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: DATA.nightTitle, exact: true }) });
    await expect(card).toContainText("22:00 – 06:00 (+1 día)");
  });

  test("Criterio 7: salida y regreso sin contar el tiempo ausente", async ({ page }) => {
    // Otra persona: la del criterio 2 sigue asignada a la guardia en curso del criterio 3.
    const workerId = await createWorker(page, DATA.returnWorkerName);
    await createWorkerAccount(page, workerId, DATA.returnEmail, DATA.password);
    await loginAs(page, "coordinacion@demo.local");

    // Guardia de 5 h que inició hace 4 h.
    const start = minutesFromNow(-240);
    const end = minutesFromNow(60);
    state.returnStart = start;
    state.returnShiftId = await createShift(page, {
      title: DATA.returnTitle,
      point: DATA.returnPoint,
      date: localParts(start).date,
      startTime: localParts(start).time,
      endTime: localParts(end).time,
      minStaff: "1",
    });
    await addAssignment(page, workerId, DATA.returnWorkerName, 1);
    const card = assignmentCard(page, DATA.returnWorkerName);
    const sessions = sessionItems(card);

    // Coordinación captura dos tramos: 1 h, ausencia de 30 min y regreso por 1 h.
    const manual = await openDisclosure(card, "Agregar registro manual");
    await manual.getByLabel("Entrada").fill(localInput(start));
    await manual.getByLabel("Salida").fill(localInput(addMinutes(start, 60)));
    await manual.getByLabel("Motivo").fill("E2E: no pudo registrar; salió a comer");
    await manual.getByRole("button", { name: "Agregar registro manual" }).click();
    await expect(sessions).toHaveCount(1);
    await expect(manual.getByText("Registro manual agregado (corrección administrativa).")).toBeVisible();

    await manual.getByLabel("Entrada").fill(localInput(addMinutes(start, 90)));
    await manual.getByLabel("Salida").fill(localInput(addMinutes(start, 150)));
    await manual.getByLabel("Motivo").fill("E2E: regresó del comedor");
    await manual.getByRole("button", { name: "Agregar registro manual" }).click();
    await expect(sessions).toHaveCount(2);

    await expect(sessions.filter({ hasText: "Vigente" })).toHaveCount(2);
    await expect(sessions.nth(0)).toContainText(displayDateTime(start));
    await expect(sessions.nth(0)).toContainText(displayDateTime(addMinutes(start, 60)));
    await expect(sessions.nth(1)).toContainText(displayDateTime(addMinutes(start, 90)));
    await expect(sessions.nth(1)).toContainText(displayDateTime(addMinutes(start, 150)));

    // Total = 2 h (los 30 min entre la salida y el regreso no cuentan).
    const metrics = card.locator('section[aria-label^="Métricas de"]');
    await expect(metric(metrics, "Programado")).toHaveText("5 h");
    await expect(metric(metrics, "Total registrado")).toHaveText("2 h");
    await expect(metric(metrics, "Dentro del horario")).toHaveText("2 h");
    await expect(metric(metrics, "Fuera del horario")).toHaveText("0 min");
    await expect(metric(metrics, "Diferencia")).toHaveText("−3 h");

    // Regreso registrado en tiempo real por coordinación (por otra persona, con motivo).
    await expect(card.locator("summary", { hasText: "Registrar entrada por otra persona" })).toBeVisible();
    const onBehalf = await openDisclosure(card, /Registrar (entrada|salida) por otra persona/);
    await onBehalf.getByLabel("Motivo").fill("E2E: regresó a la guardia sin teléfono");
    await onBehalf.getByRole("button", { name: `Registrar entrada de ${DATA.returnWorkerName}` }).click();
    await expect(onBehalf.getByText("Confirmado por el servidor")).toBeVisible();
    await expect(sessions).toHaveCount(3);
    await expect(card.getByText("Entrada abierta desde", { exact: false })).toBeVisible();
    await expect(card.locator("summary", { hasText: "Registrar salida por otra persona" })).toBeVisible();
    await onBehalf.getByLabel("Motivo").fill("E2E: termina su participación");
    await onBehalf.getByRole("button", { name: `Registrar salida de ${DATA.returnWorkerName}` }).click();
    await expect(onBehalf.getByText("Salida registrada.", { exact: false })).toBeVisible();
    await expect(card.getByText("Entrada abierta desde", { exact: false })).toHaveCount(0);

    const live = sessions.filter({ hasText: "Registrado por coordinación" });
    await expect(live).toHaveCount(1);
    await expect(live).toContainText("Motivo: E2E: regresó a la guardia sin teléfono");
    // Quién registró: la cuenta de coordinación en sesión («Tú»), con método y hora del servidor.
    await expect(live).toContainText("Registró: Tú");
    await expect(live).toContainText("(hora del servidor)");
    await expect(sessions.filter({ hasText: "Sin salida registrada" })).toHaveCount(0);

    // Tres sesiones en la misma guardia; el total sigue sin contar los huecos.
    await expect(metric(metrics, "Total registrado")).toHaveText("2 h");

    // El historial del trabajador muestra las sesiones de esa guardia y el mismo total.
    await page.goto(`/historial/trabajador/${workerId}`);
    const history = historyCard(page, DATA.returnPoint);
    await expect(history.locator("li").filter({ hasText: "Vigente" })).toHaveCount(3);
    await expect(metric(history, "Total registrado")).toHaveText("2 h");
    await expect(history.getByText("Finalizada", { exact: true })).toBeVisible();
  });

  test("Criterio 8: detectar una entrada sin salida", async ({ page }) => {
    await loginAs(page, "coordinacion@demo.local");
    const maria = "[DEMO] María López Díaz";

    // «Quién está aquí»: sección de registros incompletos pendientes de revisión.
    await page.goto("/en-servicio");
    const row = page.locator("#incompletos").getByRole("row").filter({ hasText: maria });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Entrada sin salida");
    await expect(row).toContainText(/Entrada: \d{2}\/\d{2}\/\d{4} 08:02/);
    await expect(page.locator("#en-servicio").getByRole("row").filter({ hasText: maria })).toHaveCount(0);

    // Detalle de la guardia: estado incompleto, sin hora de salida inventada y sin horas sumadas.
    await page.goto(`/guardias/${DEMO.guardiaAyer}`);
    const card = assignmentCard(page, maria);
    await expect(card.getByText("Registro incompleto (pendiente de revisión)")).toBeVisible();
    await expect(card.getByText("Requiere revisión", { exact: true })).toBeVisible();
    const sessions = sessionItems(card);
    await expect(sessions).toHaveCount(1);
    await expect(sessions).toContainText("Sin salida registrada");
    await expect(sessions).toContainText(/\d{2}\/\d{2}\/\d{4} 08:02/);
    const metrics = card.locator('section[aria-label^="Métricas de"]');
    await expect(metric(metrics, "Total registrado")).toHaveText("0 min");
    await expect(card.locator('section[aria-label^="Incidencias de"]')).toContainText("Registro incompleto");

    // Historial con filtro de registros incompletos.
    await page.goto(`/historial?asistencia=registro_incompleto&sede=${DEMO.hospitalA}`);
    const item = page.getByRole("list", { name: "Guardias del periodo" }).getByRole("listitem").filter({ hasText: maria });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("Registro incompleto (pendiente de revisión)");
    await expect(metric(item, "Total registrado")).toHaveText("0 min");
  });

  test("Criterio 10: corregir conservando la auditoría", async ({ page }) => {
    const shiftId = required(state.returnShiftId, "la guardia del criterio 7");
    const start = required(state.returnStart, "el inicio de la guardia del criterio 7");
    await loginAs(page, "coordinacion@demo.local");
    await page.goto(`/guardias/${shiftId}`);

    const card = assignmentCard(page, DATA.returnWorkerName);
    const sessions = sessionItems(card);
    const original = sessions.filter({ hasText: displayDateTime(start) }).filter({ hasText: "Vigente" });
    await expect(original).toHaveCount(1);
    const form = await openDisclosure(original, "Corregir registro");
    await form.getByLabel("Entrada correcta").fill(localInput(addMinutes(start, 5)));
    await form.getByLabel("Motivo de la corrección").fill(DATA.correctionReason);
    await form.getByRole("button", { name: "Guardar corrección" }).click();

    // El original se conserva marcado como corregido; la versión nueva queda vigente.
    const corrected = sessions.filter({ hasText: "Corregido (versión original conservada)" });
    await expect(corrected).toHaveCount(1);
    await expect(corrected).toContainText(displayDateTime(start));
    await expect(corrected).toContainText(`Motivo: ${DATA.correctionReason}`);
    // Quién corrigió (la cuenta en sesión) y cuándo.
    await expect(corrected).toContainText(/Corregido el \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} por ti\./);
    const replacement = sessions.filter({ hasText: "Corrige al registro" });
    await expect(replacement).toHaveCount(1);
    await expect(replacement).toContainText("Vigente");
    await expect(replacement).toContainText(displayDateTime(addMinutes(start, 5)));
    await expect(sessions).toHaveCount(4);

    // Solo cuenta la versión vigente: 55 min + 1 h.
    const metrics = card.locator('section[aria-label^="Métricas de"]');
    await expect(metric(metrics, "Total registrado")).toHaveText("1 h 55 min");

    // Bitácora: autor, motivo y valores anterior y nuevo.
    await page.goto("/administracion/bitacora?tabla=attendance_sessions");
    const events = page.getByRole("list", { name: "Eventos de la bitácora" }).getByRole("listitem");
    const event = events.filter({ hasText: DATA.correctionReason }).filter({ hasText: "Corregid" }).first();
    await expect(event).toBeVisible();
    await expect(event).toContainText("Coordinación (demo)");
    await expect(event).toContainText(HOSPITAL_A);
    await event.locator("summary").click();
    await expect(event.locator("dl").last()).toContainText("Vigente");
    await expect(event.locator("dl").last()).toContainText("Corregido");

    // El trabajador también ve la versión original conservada en su historial.
    await loginAs(page, DATA.returnEmail, DATA.password);
    await page.goto("/mi-historial");
    const mine = historyCard(page, DATA.returnPoint);
    await expect(mine.getByText("Corregido (versión original conservada)")).toBeVisible();
    await expect(mine.getByText(`Motivo del cambio: ${DATA.correctionReason}`)).toBeVisible();
  });

  test("Criterio 11: un trabajador no ve datos privados de otros", async ({ page }) => {
    await loginAs(page, "trabajador@demo.local");
    await expect(page).toHaveURL(/\/mi-guardia/);

    for (const path of ["/trabajadores", `/trabajadores/${DEMO.luis}`, `/historial/trabajador/${DEMO.luis}`, "/historial", "/en-servicio", "/guardias"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/sin-acceso/);
      await expect(page.getByRole("heading", { level: 1, name: "Sin acceso" })).toBeVisible();
    }

    // Su historial solo contiene sus propios registros.
    await page.goto("/mi-historial");
    await expect(page.getByRole("heading", { level: 1, name: "Mi historial" })).toBeVisible();
    const main = page.locator("main");
    await expect(main.getByRole("heading", { level: 3, name: HOSPITAL_A }).first()).toBeVisible();
    for (const other of ["Luis Hernández", "María López", "Sofía Torres", "Jorge Ramírez", "Patricia Flores", "DEMO-0002", "DEMO-0005", "311 000 0005", DATA.workerName]) {
      await expect(main).not.toContainText(other);
    }

    // La exportación ignora el trabajador pedido en la URL y entrega solo sus datos.
    const response = await page.request.get(`/api/exportar?formato=xlsx&trabajador=${DEMO.luis}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("spreadsheetml");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await response.body()) as unknown as ArrayBuffer);
    const cells: string[] = [];
    workbook.eachSheet((sheet) =>
      sheet.eachRow((row) =>
        row.eachCell((cell) => {
          cells.push(String(cell.text ?? ""));
        }),
      ),
    );
    const text = cells.join("\n");
    expect(text).toContain("Ana Martínez Ruiz");
    expect(text).not.toContain("Luis Hernández");
    expect(text).not.toContain("DEMO-0002");

    // Otra persona (Luis) tampoco puede ver a Ana.
    await loginAs(page, "trabajador2@demo.local");
    await page.goto(`/trabajadores/${DEMO.ana}`);
    await expect(page).toHaveURL(/\/sin-acceso/);
    await page.goto("/mi-historial");
    await expect(page.locator("main")).not.toContainText("Ana Martínez");
  });

  test("Criterio 12: un coordinador no accede a sedes ajenas", async ({ page }) => {
    const xalisco = "[DEMO] Guardia Xalisco";
    const umf2 = "[DEMO] Unidad de Medicina Familiar de demostración 2";

    // Referencia: administración sí ve la guardia y a la trabajadora de Xalisco.
    await loginAs(page, "admin@demo.local");
    await page.goto(`/guardias/${DEMO.guardiaXalisco}`);
    await expect(page.getByRole("heading", { level: 1, name: xalisco })).toBeVisible();
    await page.goto(`/trabajadores/${DEMO.patricia}`);
    await expect(page.getByRole("heading", { level: 1, name: "[DEMO] Patricia Flores Ortiz" })).toBeVisible();

    await loginAs(page, "coordinacion@demo.local");

    // Lista de guardias: solo sus sedes.
    await page.goto("/guardias");
    await expect(page.getByRole("link", { name: DATA.shiftTitle, exact: true })).toBeVisible();
    await expect(page.getByText(xalisco)).toHaveCount(0);
    await expect(page.getByText(umf2)).toHaveCount(0);
    await page.goto(`/guardias?sede=${DEMO.umf2Xalisco}`);
    await expect(page.getByText("La sede indicada no está disponible para tu cuenta", { exact: false })).toBeVisible();
    await expect(page.getByText(xalisco)).toHaveCount(0);
    await page.goto(`/guardias?vista=calendario`);
    await expect(page.getByText(xalisco)).toHaveCount(0);

    // Abrir la guardia ajena directamente: no existe para esta cuenta.
    await page.goto(`/guardias/${DEMO.guardiaXalisco}`);
    await expect(page.getByText("Guardia no encontrada")).toBeVisible();
    await expect(page.getByText(xalisco)).toHaveCount(0);
    await page.goto(`/guardias/${DEMO.guardiaXalisco}/editar`);
    await expect(page.getByText(xalisco)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Guardar cambios" })).toHaveCount(0);

    // Tampoco puede programar guardias en esa sede.
    await page.goto(`/guardias/nueva?sede=${DEMO.umf2Xalisco}`);
    await expect(page.getByText(umf2)).toHaveCount(0);
    await expect(page.getByLabel("Sede").locator("option", { hasText: umf2 })).toHaveCount(0);

    // Trabajadores de la sede ajena: no aparecen ni se pueden abrir.
    await page.goto("/trabajadores?q=Patricia");
    await expect(page.getByText("Sin resultados.")).toBeVisible();
    await page.goto("/trabajadores?q=Ricardo");
    await expect(page.getByText("Sin resultados.")).toBeVisible();
    await page.goto("/trabajadores");
    await expect(page.locator("main")).not.toContainText("Patricia Flores");
    await expect(page.getByLabel("Sede de adscripción").locator("option", { hasText: umf2 })).toHaveCount(0);
    await page.goto(`/trabajadores/${DEMO.patricia}`);
    await expect(page.getByText("Trabajador no encontrado")).toBeVisible();
    await page.goto(`/historial/trabajador/${DEMO.patricia}`);
    await expect(page.getByText("Trabajador no encontrado")).toBeVisible();

    // «Quién está aquí» e historial: sin personas ni guardias de Xalisco.
    await page.goto(`/en-servicio?sede=${DEMO.umf2Xalisco}`);
    await expect(page.locator("main")).not.toContainText("Patricia Flores");
    await expect(page.locator("main")).not.toContainText(umf2);
    await page.goto(`/historial?sede=${DEMO.umf2Xalisco}`);
    await expect(page.locator("main")).not.toContainText("Patricia Flores");
    await expect(page.locator("main")).not.toContainText("Ricardo Morales");
  });
});
