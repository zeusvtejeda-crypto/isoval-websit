import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { DirectoryHeader } from "@/components/directory/directory-header";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("encabezado público del directorio", () => {
  it("con sesión muestra «Volver a mi panel» visible en cualquier tamaño", () => {
    render(<DirectoryHeader panelHref="/mi-guardia" />);
    const link = screen.getByRole("link", { name: "Volver a mi panel" });
    expect(link).toHaveAttribute("href", "/mi-guardia");
    expect(link.className).not.toMatch(/\bhidden\b/);
    expect(screen.queryByRole("link", { name: "Iniciar sesión" })).not.toBeInTheDocument();
  });

  it("sin sesión ofrece «Iniciar sesión»", () => {
    render(<DirectoryHeader panelHref={null} />);
    expect(screen.getByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("link", { name: /mi panel/ })).not.toBeInTheDocument();
  });
});
