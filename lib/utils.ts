import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ──────────────────────────────────────────────
// FORMATAÇÃO
// ──────────────────────────────────────────────

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function formatDate(date: Date | string): string {
  return format(new Date(date), "dd/MM/yyyy", { locale: ptBR });
}

export function formatDateTime(date: Date | string): string {
  return format(new Date(date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
}

export function formatRelativeTime(date: Date | string): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: ptBR });
}

export function formatDistance(km: number): string {
  if (km < 1) return `${(km * 1000).toFixed(0)} m`;
  return `${km.toFixed(1)} km`;
}

// ──────────────────────────────────────────────
// CÁLCULO DE DISTÂNCIA (Haversine)
// Usado como fallback quando não há API de mapas
// ──────────────────────────────────────────────

export function calculateHaversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // raio da Terra em km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

// ──────────────────────────────────────────────
// VALIDAÇÃO
// ──────────────────────────────────────────────

export function isValidCPF(cpf: string): boolean {
  const cleaned = cpf.replace(/\D/g, "");
  if (cleaned.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cleaned)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cleaned[i]) * (10 - i);
  let digit = 11 - (sum % 11);
  if (digit > 9) digit = 0;
  if (parseInt(cleaned[9]) !== digit) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cleaned[i]) * (11 - i);
  digit = 11 - (sum % 11);
  if (digit > 9) digit = 0;
  return parseInt(cleaned[10]) === digit;
}

export function formatCPFCNPJ(value: string): string {
  const cleaned = value.replace(/\D/g, "");
  if (cleaned.length <= 11) {
    return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  return cleaned.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

// ──────────────────────────────────────────────
// HELPERS DE NEGÓCIO
// ──────────────────────────────────────────────

// verifica se o horário atual está antes do corte de rota (16h)
export function isBeforeRouteCutoff(cutoffHour = 16): boolean {
  return new Date().getHours() < cutoffHour;
}

// retorna a data prevista de entrega baseada no tipo
export function getExpectedDeliveryDate(deliveryType: string): Date {
  const today = new Date();
  if (deliveryType === "URGENT") {
    // urgente = hoje
    return today;
  }
  // padrão = amanhã
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}

// gera um número de referência interna para rastreamento
export function generateReference(prefix: string): string {
  const now = new Date();
  const date = format(now, "yyyyMMdd");
  const time = format(now, "HHmmss");
  return `${prefix}-${date}-${time}`;
}
