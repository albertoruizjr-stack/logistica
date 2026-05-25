import { describe, it, expect } from "vitest";
import {
  classifyEligibleDelivery,
  sortEligibleDeliveries,
  type ClassifyContext,
  type EligibleDeliveryInput,
} from "@/lib/eligible-delivery";

// Hoje = 2026-05-25 12:00. CD = loja "cd-id" (code "132"); Morumbi = "morumbi-id" (code "067").
const NOW = new Date("2026-05-25T12:00:00");
const ctx: ClassifyContext = {
  cdCode:        "132",
  cdStoreId:     "cd-id",
  storeCodeById: new Map([
    ["cd-id", "132"],
    ["morumbi-id", "067"],
  ]),
  now: NOW,
};

function baseInput(over: Partial<EligibleDeliveryInput> = {}): EligibleDeliveryInput {
  return {
    slaType:         "STANDARD",
    scheduledFor:    null,
    dispatchStoreId: "cd-id",
    entregaPeloCD:   true,
    storeId:         "cd-id",
    ...over,
  };
}

describe("classifyEligibleDelivery", () => {
  it("EXPRESS → appUrgent e rank 0", () => {
    const f = classifyEligibleDelivery(baseInput({ slaType: "EXPRESS" }), ctx);
    expect(f.appUrgent).toBe(true);
    expect(f.todayUrgent).toBe(false);
    expect(f.sortRank).toBe(0);
  });

  it("URGENT → todayUrgent e rank 1", () => {
    const f = classifyEligibleDelivery(baseInput({ slaType: "URGENT" }), ctx);
    expect(f.todayUrgent).toBe(true);
    expect(f.appUrgent).toBe(false);
    expect(f.sortRank).toBe(1);
  });

  it("STANDARD sem data → rank 2, sem selos de urgência", () => {
    const f = classifyEligibleDelivery(baseInput(), ctx);
    expect(f.appUrgent).toBe(false);
    expect(f.todayUrgent).toBe(false);
    expect(f.isFutureScheduled).toBe(false);
    expect(f.sortRank).toBe(2);
  });

  it("scheduledFor futura → isFutureScheduled, label dd/MM, rank 3 (prevalece sobre EXPRESS)", () => {
    const f = classifyEligibleDelivery(
      baseInput({ slaType: "EXPRESS", scheduledFor: new Date("2026-05-28T09:00:00") }),
      ctx,
    );
    expect(f.isFutureScheduled).toBe(true);
    expect(f.scheduledDateLabel).toBe("28/05");
    expect(f.sortRank).toBe(3);
  });

  it("scheduledFor hoje → não-futura, sem label", () => {
    const f = classifyEligibleDelivery(
      baseInput({ scheduledFor: new Date("2026-05-25T18:00:00") }),
      ctx,
    );
    expect(f.isFutureScheduled).toBe(false);
    expect(f.scheduledDateLabel).toBeNull();
    expect(f.sortRank).toBe(2);
  });

  it("loja de despacho != 132 → originStoreCode preenchido", () => {
    const f = classifyEligibleDelivery(
      baseInput({ dispatchStoreId: "morumbi-id", entregaPeloCD: false, storeId: "morumbi-id" }),
      ctx,
    );
    expect(f.originStoreCode).toBe("067");
  });

  it("loja de despacho = 132 → originStoreCode null", () => {
    const f = classifyEligibleDelivery(baseInput(), ctx);
    expect(f.originStoreCode).toBeNull();
  });

  it("sem dispatchStoreId usa fallback entregaPeloCD/storeId", () => {
    const f = classifyEligibleDelivery(
      baseInput({ dispatchStoreId: null, entregaPeloCD: false, storeId: "morumbi-id" }),
      ctx,
    );
    expect(f.originStoreCode).toBe("067");
  });
});

describe("sortEligibleDeliveries", () => {
  it("ordena App → Hoje → normal → futuras (futuras por data crescente)", () => {
    const mk = (id: string, sortRank: number, scheduledFor: Date | null, createdAt: Date) =>
      ({ id, sortRank, scheduledFor, createdAt });
    const list = [
      mk("normal",    2, null,                              new Date("2026-05-25T08:00:00")),
      mk("futura-30", 3, new Date("2026-05-30T08:00:00"),   new Date("2026-05-25T08:00:00")),
      mk("app",       0, null,                              new Date("2026-05-25T08:00:00")),
      mk("futura-28", 3, new Date("2026-05-28T08:00:00"),   new Date("2026-05-25T08:00:00")),
      mk("hoje",      1, null,                              new Date("2026-05-25T08:00:00")),
    ];
    const sorted = sortEligibleDeliveries(list).map((x) => x.id);
    expect(sorted).toEqual(["app", "hoje", "normal", "futura-28", "futura-30"]);
  });
});
