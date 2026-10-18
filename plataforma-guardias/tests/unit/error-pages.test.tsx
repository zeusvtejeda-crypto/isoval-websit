import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// global-error importa los estilos globales; en pruebas no hacen falta.
vi.mock("@/app/globals.css", () => ({}));
// not-found espera la solicitud (connection()) para renderizarse con el nonce de la CSP.
vi.mock("next/server", () => ({ connection: async () => undefined }));

import NotFound, { metadata as notFoundMetadata } from "@/app/not-found";
import RootError from "@/app/error";
import GlobalError from "@/app/global-error";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Un error del servidor llega con un mensaje genérico y un identificador (digest). */
function serverError(message = "detalle interno: SELECT * FROM worker_private"): Error & { digest: string } {
  return Object.assign(new Error(message), { digest: "2338475123" });
}

describe("página no encontrada (app/not-found.tsx)", () => {
  it("dice «Página no encontrada» en español y enlaza al inicio y al directorio", async () => {
    render(await NotFound());
    expect(screen.getByRole("heading", { level: 1, name: "Página no encontrada" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Ver directorio" })).toHaveAttribute("href", "/directorio");
    expect(screen.getByText(/no es una aplicación oficial del IMSS/)).toBeInTheDocument();
    expect(notFoundMetadata.title).toBe("Página no encontrada");
  });
});

describe("error de rutas públicas (app/error.tsx)", () => {
  it("muestra el aviso en español, el código de referencia y no el mensaje técnico", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = serverError();
    render(<RootError error={error} retry={() => {}} />);
    expect(screen.getByRole("heading", { level: 1, name: "Algo salió mal" })).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("No se pudo mostrar esta página")).toBeInTheDocument();
    expect(within(alert).getByText("2338475123")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("worker_private");
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute("href", "/");
    expect(log).toHaveBeenCalledWith(error);
  });

  it("«Reintentar» llama a retry()", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    render(<RootError error="valor lanzado que no es Error" retry={retry} />);
    expect(screen.queryByText(/Código de referencia/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("error del layout raíz (app/global-error.tsx)", () => {
  it("define su propio documento <html lang=\"es-MX\"> con <body>", () => {
    const html = renderToStaticMarkup(<GlobalError error={serverError()} retry={() => {}} />);
    expect(html).toMatch(/^<html lang="es-MX"[^>]*>/);
    expect(html).toMatch(/<body[^>]*>[\s\S]*<\/body><\/html>$/);
    expect(html).toContain("<title>Error · Guardias y Directorio</title>");
    expect(html).toContain("La aplicación tuvo un problema");
    expect(html).toContain("Reintentar");
    expect(html).toContain("2338475123");
    expect(html).not.toContain("worker_private");
  });

  it("«Reintentar» llama a retry() e «Ir al inicio» recarga el documento", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    // React 19 trata <html> y <body> como únicos: al montar se usan los del documento.
    render(<GlobalError error={new Error("x")} retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute("href", "/");
  });
});
