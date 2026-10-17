import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/layout/service-worker-registration";

export const metadata: Metadata = {
  title: {
    default: "Guardias y Directorio de Instalaciones",
    template: "%s · Guardias y Directorio",
  },
  description:
    "Directorio de instalaciones y control de guardias. Plataforma independiente: no es una aplicación oficial del IMSS.",
  applicationName: "Guardias y Directorio",
  appleWebApp: { capable: true, title: "Guardias", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#14532d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX" className="h-full antialiased">
      <body className="min-h-full">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
