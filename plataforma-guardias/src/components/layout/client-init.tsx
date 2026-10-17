"use client";

import { config } from "zod";

// zod 4 prueba `new Function("")` para compilar validaciones; con la CSP
// (sin 'unsafe-eval') eso genera reportes en la consola. El modo sin JIT
// valida igual sin intentar eval.
config({ jitless: true });

export function ClientInit() {
  return null;
}
