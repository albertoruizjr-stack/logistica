// Normaliza um telefone BR para o formato do wa.me (55 + DDD + número, só dígitos).
export function toWhatsappNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.length < 10) return null;
  if (!d.startsWith("55")) d = "55" + d;
  return d;
}
