// Normaliza um telefone BR para o formato do wa.me (55 + DDD + número, só dígitos).
export function toWhatsappNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.length < 10) return null;
  if (!d.startsWith("55")) d = "55" + d;
  return d;
}

// Formato E.164 exigido pelo Lalamove: +55 + DDD + número.
export function toE164(raw: string | null | undefined): string | null {
  const n = toWhatsappNumber(raw); // já devolve "55"+DDD+numero (só dígitos) ou null
  return n ? `+${n}` : null;
}
