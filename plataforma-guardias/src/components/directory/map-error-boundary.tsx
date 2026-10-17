"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  children: ReactNode;
  onError?: () => void;
  /** Se llama al pulsar «Reintentar» (p. ej. para volver a ofrecer «Ver en el mapa»). */
  onReset?: () => void;
};
type State = { failed: boolean };

/** Aviso cuando el mapa no está disponible; la lista sigue funcionando. */
export function MapUnavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <div role="alert" className="flex h-full min-h-48 flex-col items-start justify-center gap-3 rounded-card border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <p className="font-semibold">No se pudo cargar el mapa</p>
      <p className="text-sm">
        La lista de instalaciones sigue disponible. Revisa tu conexión; si el problema continúa, recarga la página.
      </p>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Límite de error del mapa: si falla el código del mapa (descarga del módulo,
 * Leaflet o el navegador), muestra un aviso sin afectar al resto de la página.
 */
export class MapErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("El mapa no está disponible:", error, info.componentStack);
    this.props.onError?.();
  }

  private retry = () => {
    this.setState({ failed: false });
    this.props.onReset?.();
  };

  render() {
    if (this.state.failed) return <MapUnavailable onRetry={this.retry} />;
    return this.props.children;
  }
}
