// Classificação e ordenação das entregas elegíveis na roteirização.
// Lógica pura (sem React/Prisma) — testável isoladamente.
//
// Selos derivados de campos já existentes em DeliveryRequest:
//   ⚡ App    = slaType EXPRESS  (precisa Lalamove/99)
//   🔴 Hoje   = slaType URGENT   (same-day pela frota)
//   📅 dd/MM  = scheduledFor depois de hoje (agendada futura)
//   🏪 código = loja de despacho != CD (132)

export interface EligibleDeliveryInput {
  slaType:         string;
  scheduledFor:    Date | null;
  dispatchStoreId: string | null;
  entregaPeloCD:   boolean;
  storeId:         string;
}

export interface ClassifyContext {
  cdCode:        string;               // "132"
  cdStoreId:     string | null;        // id da loja com code "132"
  storeCodeById: Map<string, string>;  // id -> code
  now:           Date;
}

export interface EligibleDeliveryFlags {
  appUrgent:          boolean;
  todayUrgent:        boolean;
  scheduledDateLabel: string | null;   // "28/05" quando futura, senão null
  isFutureScheduled:  boolean;
  originStoreCode:    string | null;   // "067" quando != CD, senão null
  sortRank:           number;          // 0 app · 1 hoje · 2 normal · 3 futura
}

function endOfDayMs(d: Date): number {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e.getTime();
}

// Formata "dd/MM" sem depender de locale/ICU (determinístico em qualquer ambiente).
function formatDayMonth(d: Date): string {
  const day   = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

export function classifyEligibleDelivery(
  input: EligibleDeliveryInput,
  ctx:   ClassifyContext,
): EligibleDeliveryFlags {
  const isFutureScheduled =
    input.scheduledFor != null && input.scheduledFor.getTime() > endOfDayMs(ctx.now);

  const appUrgent   = input.slaType === "EXPRESS";
  const todayUrgent = input.slaType === "URGENT";

  const scheduledDateLabel =
    isFutureScheduled && input.scheduledFor ? formatDayMonth(input.scheduledFor) : null;

  const originStoreId =
    input.dispatchStoreId ?? (input.entregaPeloCD ? ctx.cdStoreId : input.storeId);
  const originCode = originStoreId ? ctx.storeCodeById.get(originStoreId) ?? null : null;
  const originStoreCode = originCode && originCode !== ctx.cdCode ? originCode : null;

  const sortRank =
    isFutureScheduled ? 3 :
    appUrgent         ? 0 :
    todayUrgent       ? 1 :
                        2;

  return {
    appUrgent,
    todayUrgent,
    scheduledDateLabel,
    isFutureScheduled,
    originStoreCode,
    sortRank,
  };
}

export function sortEligibleDeliveries<
  T extends { sortRank: number; scheduledFor: Date | null; createdAt: Date },
>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
    if (a.sortRank === 3) {
      const at = a.scheduledFor?.getTime() ?? 0;
      const bt = b.scheduledFor?.getTime() ?? 0;
      if (at !== bt) return at - bt;
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}
