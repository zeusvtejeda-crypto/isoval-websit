"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { NavItem } from "@/lib/nav";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

function NavLinks({ items, pathname, onNavigate }: { items: NavItem[]; pathname: string; onNavigate?: () => void }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center rounded-xl px-3 font-medium",
                active ? "bg-brand-800 text-white" : "text-gray-800 hover:bg-gray-100",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AppNav({
  primary,
  personal,
  userLabel,
  roleLabel,
  logoutAction,
  bottomBar,
}: {
  primary: NavItem[];
  personal: NavItem[];
  userLabel: string;
  roleLabel: string;
  logoutAction: () => Promise<void>;
  /** Barra inferior en móvil (trabajadores: 3 accesos grandes). */
  bottomBar: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const menu = (
    <nav aria-label="Navegación principal" className="space-y-5">
      <NavLinks items={primary} pathname={pathname} onNavigate={() => setOpen(false)} />
      {personal.length > 0 ? (
        <div>
          <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Mis guardias</p>
          <NavLinks items={personal} pathname={pathname} onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
      <div className="border-t border-gray-200 pt-4">
        <p className="px-3 text-sm font-semibold text-gray-900">{userLabel}</p>
        <p className="px-3 text-xs text-gray-600">{roleLabel}</p>
        <form action={logoutAction} className="mt-2 px-1">
          <button type="submit" className="min-h-11 w-full rounded-xl px-2 text-left font-medium text-red-800 hover:bg-red-50">
            Cerrar sesión
          </button>
        </form>
      </div>
    </nav>
  );

  return (
    <>
      {/* Barra superior móvil */}
      <div className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2 lg:hidden">
        <Link href="/" className="font-bold text-brand-900">
          Guardias y Directorio
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="menu-movil"
          className="min-h-11 rounded-xl border border-gray-300 px-4 font-semibold"
        >
          Menú
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Cerrar menú" onClick={() => setOpen(false)} />
          <div id="menu-movil" className="absolute inset-y-0 right-0 w-80 max-w-[85%] overflow-y-auto bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-bold text-brand-900">Menú</span>
              <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-xl px-3 font-semibold hover:bg-gray-100">
                Cerrar
              </button>
            </div>
            {menu}
          </div>
        </div>
      ) : null}

      {/* Barra lateral en escritorio */}
      <aside className="no-print hidden w-64 shrink-0 border-r border-gray-200 bg-white p-4 lg:block">
        <Link href="/" className="mb-6 block px-3 text-lg font-bold leading-tight text-brand-900">
          Guardias y Directorio
        </Link>
        {menu}
      </aside>

      {/* Barra inferior móvil para trabajadores */}
      {bottomBar ? (
        <nav aria-label="Accesos rápidos" className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-gray-200 bg-white lg:hidden">
          {primary.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-16 items-center justify-center px-1 text-center text-sm font-semibold",
                  active ? "bg-brand-50 text-brand-900" : "text-gray-700",
                )}
              >
                {item.short ?? item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </>
  );
}
