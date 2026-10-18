/**
 * Código de la verificación anti-robots (Cloudflare Turnstile) que el formulario
 * envía en «cf-turnstile-response»; el servidor lo pasa a Supabase Auth, que lo
 * valida si el CAPTCHA está activado en el proyecto.
 */
export function captchaTokenFrom(formData: FormData): string | undefined {
  const value = formData.get("cf-turnstile-response");
  return typeof value === "string" && value.length > 0 && value.length <= 4096 ? value : undefined;
}
