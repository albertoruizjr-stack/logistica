// ──────────────────────────────────────────────
// REGRAS DE CORTE HORÁRIO — JANELA DE DESPACHO
// ──────────────────────────────────────────────
//
// Regras operacionais (segunda a sexta):
//   até 17h30 → FIRST_DISPATCH  (despacho manhã D+1)
//   17h30+    → SECOND_DISPATCH (despacho tarde D+1)
//   após 12h para D+0 urgente → NEXT_DAY
//   Lalamove/urgente → EXPRESS (ignora corte)

export const BRASILIA_TZ = "America/Sao_Paulo";

export const FIRST_CUTOFF = { hour: 17, minute: 30 } as const;   // 17h30
export const SECOND_CUTOFF = { hour: 12, minute: 0 } as const;   // 12h00

export type DispatchWindowValue =
  | "FIRST_DISPATCH"
  | "SECOND_DISPATCH"
  | "NEXT_DAY"
  | "EXPRESS";

export interface BrasiliaTime {
  hour: number;
  minute: number;
  weekday: number; // 0=Dom, 1=Seg, ..., 6=Sáb
  totalMinutes: number;
}

// Extrai hora/minuto/weekday no fuso de Brasília independente do servidor
export function getBrasiliaTime(date: Date = new Date()): BrasiliaTime {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: BRASILIA_TZ,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });

  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";

  const hour = parseInt(get("hour"), 10);
  const minute = parseInt(get("minute"), 10);

  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekday = dayMap[get("weekday")] ?? 0;

  return { hour, minute, weekday, totalMinutes: hour * 60 + minute };
}

const FIRST_CUTOFF_MINUTES = FIRST_CUTOFF.hour * 60 + FIRST_CUTOFF.minute;   // 1050
const SECOND_CUTOFF_MINUTES = SECOND_CUTOFF.hour * 60 + SECOND_CUTOFF.minute; // 720

export function isWeekday(date: Date = new Date()): boolean {
  const { weekday } = getBrasiliaTime(date);
  return weekday >= 1 && weekday <= 5;
}

// Passou das 17h30 (horário de Brasília)?
export function isAfterFirstCutoff(date: Date = new Date()): boolean {
  if (!isWeekday(date)) return true; // fim de semana → sempre "fora do corte"
  return getBrasiliaTime(date).totalMinutes > FIRST_CUTOFF_MINUTES;
}

// Passou das 12h00 (horário de Brasília)?
export function isAfterSecondCutoff(date: Date = new Date()): boolean {
  if (!isWeekday(date)) return true;
  return getBrasiliaTime(date).totalMinutes > SECOND_CUTOFF_MINUTES;
}

export interface CutoffStatus {
  isWeekday: boolean;
  isAfterFirst: boolean;   // passou das 17h30
  isAfterSecond: boolean;  // passou das 12h00
  currentWindow: DispatchWindowValue; // janela padrão para o horário atual
  brasiliaTime: BrasiliaTime;
}

// Retorna o status completo do corte para o momento atual (ou data informada)
export function getCutoffStatus(date: Date = new Date()): CutoffStatus {
  const brt = getBrasiliaTime(date);
  const wd = isWeekday(date);
  const afterFirst = !wd || brt.totalMinutes > FIRST_CUTOFF_MINUTES;
  const afterSecond = !wd || brt.totalMinutes > SECOND_CUTOFF_MINUTES;

  let currentWindow: DispatchWindowValue;
  if (!wd) {
    currentWindow = "NEXT_DAY";
  } else if (brt.totalMinutes <= FIRST_CUTOFF_MINUTES) {
    currentWindow = "FIRST_DISPATCH";
  } else {
    currentWindow = "SECOND_DISPATCH";
  }

  return { isWeekday: wd, isAfterFirst: afterFirst, isAfterSecond: afterSecond, currentWindow, brasiliaTime: brt };
}

// Calcula a janela de despacho com base no horário + tipo + override do vendedor
export function getDispatchWindow(
  date: Date,
  deliveryType: "STANDARD" | "URGENT" | "EXCEPTION",
  override?: "EXPRESS" | "EXCEPTION" | null
): DispatchWindowValue {
  // Express: Lalamove/urgente ignora qualquer regra de corte
  if (override === "EXPRESS" || deliveryType === "URGENT") {
    return "EXPRESS";
  }

  const brtInfo = getBrasiliaTime(date);
  const wd2 = isWeekday(date);
  const totalMinutes = brtInfo.totalMinutes;

  if (!wd2) return "NEXT_DAY";

  if (totalMinutes <= FIRST_CUTOFF_MINUTES) return "FIRST_DISPATCH";

  // Override "EXCEPTION" → vendedor solicitou entrada forçada no 1º despacho
  // Sistema registra a aprovação e mantém FIRST_DISPATCH pendente de confirmação
  if (override === "EXCEPTION") return "FIRST_DISPATCH";

  return "SECOND_DISPATCH";
}

// ──────────────────────────────────────────────
// CORTE SAME-DAY (12h00)
// Entregas URGENT (D+0 via frota interna) precisam ser criadas até 12h.
// Após 12h, o vendedor pode: ir para EXPRESS (Lalamove), reagendar para D+1
// ou solicitar exceção operacional com justificativa.
// ──────────────────────────────────────────────

export type SameDayCutoffChoice = "EXPRESS" | "NEXT_DAY" | "EXCEPTION";

export function isSameDayAfterCutoff(date: Date = new Date()): boolean {
  return isAfterSecondCutoff(date);
}

export const SAME_DAY_CUTOFF_MESSAGES = {
  title: "Corte de 12h00 — entrega no mesmo dia",
  body: "Após as 12h00, a frota interna não garante mais entrega hoje.\n\nPara o cliente receber hoje, use a entrega expressa via Lalamove.",
} as const;

export const SAME_DAY_CHOICE_LABELS: Record<SameDayCutoffChoice, string> = {
  EXPRESS:   "Entrega expressa via Lalamove (entrega hoje)",
  NEXT_DAY:  "Reagendar para amanhã — 1º Despacho",
  EXCEPTION: "Solicitar exceção operacional (aprovação necessária)",
};

// Texto do aviso exibido ao vendedor (após 17h30)
export const CUTOFF_MESSAGES = {
  AFTER_FIRST: {
    title: "Horário de corte das 17h30 atingido",
    body: "Esta solicitação será programada para o segundo despacho do dia seguinte.\n\nCaso o cliente precise receber no período da manhã, altere para entrega expressa via Lalamove, sujeito a novo custo de frete.",
  },
  AFTER_SECOND: {
    title: "Horário de corte das 12h00 atingido",
    body: "Esta solicitação será programada para o despacho do dia seguinte.\n\nCaso o cliente precise receber hoje, altere para entrega expressa via Lalamove, sujeito a novo custo de frete.",
  },
} as const;

export const DISPATCH_WINDOW_LABELS: Record<DispatchWindowValue, string> = {
  FIRST_DISPATCH:  "1º Despacho (manhã D+1)",
  SECOND_DISPATCH: "2º Despacho (tarde D+1)",
  NEXT_DAY:        "Despacho D+2",
  EXPRESS:         "Expresso (Lalamove/99)",
};
