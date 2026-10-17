import "server-only";
import QRCode from "qrcode";

/**
 * Genera el QR como texto SVG en el servidor. Se muestra en la página como
 * <img src="data:image/svg+xml…">, nunca insertado como HTML.
 */
export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
}
