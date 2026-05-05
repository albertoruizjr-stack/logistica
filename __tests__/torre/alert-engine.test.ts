// __tests__/torre/alert-engine.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { processOccurrences } from "../../services/torre/alert-engine.service";
import type { AlertOccurrence } from "../../types/torre";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    controlTowerAlert: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findFirst: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
  },
}));

import { prisma } from "../../lib/prisma";

const baseOccurrence: AlertOccurrence = {
  ruleId: "R03",
  type: "ABAIXO_MINIMO",
  severity: "CRITICAL",
  storeId: "store-1",
  actionType: "CREATE_TRANSFER",
  slaMinutes: 240,
  ownerRole: "COMPRAS",
  groupKey: "store-1_R03_CRITICAL_123",
  dataConfidence: "HIGH",
  items: [
    {
      productCode: "TINT-001",
      productName: "Tinta Branca 18L",
      abcClassification: "A",
      metricValue: 3,
      metricUnit: "unidades",
    },
  ],
};

describe("processOccurrences — criação de alerta", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cria novo alerta quando não existe alerta aberto com o mesmo groupKey", async () => {
    (prisma.controlTowerAlert.findFirst as any).mockResolvedValue(null);
    (prisma.user.findFirst as any).mockResolvedValue({ id: "user-fernanda" });
    (prisma.controlTowerAlert.create as any).mockResolvedValue({ id: "alert-1" });

    await processOccurrences([baseOccurrence]);

    expect(prisma.controlTowerAlert.create).toHaveBeenCalledTimes(1);
    const call = (prisma.controlTowerAlert.create as any).mock.calls[0][0];
    expect(call.data.type).toBe("ABAIXO_MINIMO");
    expect(call.data.severity).toBe("CRITICAL");
    expect(call.data.ownerId).toBe("user-fernanda");
    expect(call.data.status).toBe("PENDING");
    expect(call.data.slaStatus).toBe("ON_TRACK");
    expect(call.data.notifiedUserIds).toEqual([]);
  });

  it("não cria alerta duplicado se já existe um aberto com o mesmo groupKey", async () => {
    // Ajuste 5: findFirst agora retorna severity e slaDeadline também
    (prisma.controlTowerAlert.findFirst as any).mockResolvedValue({
      id: "alert-existente",
      severity: "CRITICAL",
      slaDeadline: new Date(Date.now() + 200 * 60 * 1000),
    });
    (prisma.controlTowerAlert.update as any).mockResolvedValue({ id: "alert-existente" });

    await processOccurrences([baseOccurrence]);

    expect(prisma.controlTowerAlert.create).not.toHaveBeenCalled();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("usa ADMIN como fallback quando owner por papel não é encontrado", async () => {
    (prisma.controlTowerAlert.findFirst as any).mockResolvedValue(null);
    (prisma.systemConfig.findUnique as any).mockResolvedValue(null);
    (prisma.user.findFirst as any)
      .mockResolvedValueOnce(null)           // OPERATOR (COMPRAS) não encontrado
      .mockResolvedValueOnce({ id: "user-alberto" }); // ADMIN fallback
    (prisma.controlTowerAlert.create as any).mockResolvedValue({ id: "alert-2" });

    await processOccurrences([baseOccurrence]);

    const call = (prisma.controlTowerAlert.create as any).mock.calls[0][0];
    expect(call.data.ownerId).toBe("user-alberto");
  });

  it("persiste items do alerta na criação", async () => {
    (prisma.controlTowerAlert.findFirst as any).mockResolvedValue(null);
    (prisma.user.findFirst as any).mockResolvedValue({ id: "user-fernanda" });
    (prisma.controlTowerAlert.create as any).mockResolvedValue({ id: "alert-3" });

    await processOccurrences([baseOccurrence]);

    const call = (prisma.controlTowerAlert.create as any).mock.calls[0][0];
    expect(call.data.items.create).toHaveLength(1);
    expect(call.data.items.create[0].productCode).toBe("TINT-001");
    expect(call.data.items.create[0].metricValue).toBe(3);
  });

  it("calcula slaDeadline a partir de slaMinutes", async () => {
    (prisma.controlTowerAlert.findFirst as any).mockResolvedValue(null);
    (prisma.user.findFirst as any).mockResolvedValue({ id: "user-abc" });
    (prisma.controlTowerAlert.create as any).mockResolvedValue({ id: "alert-4" });

    const before = Date.now();
    await processOccurrences([baseOccurrence]);
    const after = Date.now();

    const call = (prisma.controlTowerAlert.create as any).mock.calls[0][0];
    const slaDeadline: Date = call.data.slaDeadline;

    // slaDeadline deve estar entre (before + 240min) e (after + 240min)
    const expectedMin = before + 240 * 60 * 1000;
    const expectedMax = after + 240 * 60 * 1000;
    expect(slaDeadline.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(slaDeadline.getTime()).toBeLessThanOrEqual(expectedMax);
  });
});

describe("processOccurrences — auto-resolução", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolve alertas abertos cujas ocorrências desapareceram", async () => {
    (prisma.controlTowerAlert.updateMany as any).mockResolvedValue({ count: 1 });

    await processOccurrences([], { storeId: "store-1", ruleIds: ["R03"] });

    expect(prisma.controlTowerAlert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: "store-1",
          status: { in: ["PENDING", "IN_PROGRESS"] },
          type: { in: ["ABAIXO_MINIMO"] },
        }),
        data: expect.objectContaining({
          status: "RESOLVED",
          // Ajuste 2: agora é AUTO_RESOLVED
          resolutionType: "AUTO_RESOLVED",
        }),
      })
    );
  });
});

describe("processOccurrences — atualização de alerta existente", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atualiza items e slaStatus quando alerta já existe", async () => {
    const existingSlaDeadline = new Date(Date.now() + 30 * 60 * 1000); // 30min restantes
    (prisma.controlTowerAlert.findFirst as any).mockResolvedValue({
      id: "alert-existente",
      severity: "WARNING",
      slaDeadline: existingSlaDeadline,
    });
    (prisma.controlTowerAlert.update as any).mockResolvedValue({ id: "alert-existente" });

    const warningOccurrence: AlertOccurrence = {
      ...baseOccurrence,
      severity: "WARNING",
      slaMinutes: 240, // 240min total, 30min restantes → AT_RISK
    };

    await processOccurrences([warningOccurrence]);

    expect(prisma.controlTowerAlert.create).not.toHaveBeenCalled();
    expect(prisma.controlTowerAlert.update).toHaveBeenCalledTimes(1);
    const call = (prisma.controlTowerAlert.update as any).mock.calls[0][0];
    expect(call.data.slaStatus).toBe("AT_RISK"); // 30min < 50% de 240min
    expect(call.data.items.deleteMany).toBeDefined();
    expect(call.data.items.create).toHaveLength(1);
  });

  it("escalona severity de WARNING para CRITICAL quando ocorrência é mais grave", async () => {
    const existingSlaDeadline = new Date(Date.now() + 200 * 60 * 1000);
    (prisma.controlTowerAlert.findFirst as any).mockResolvedValue({
      id: "alert-existente",
      severity: "WARNING",
      slaDeadline: existingSlaDeadline,
    });
    (prisma.controlTowerAlert.update as any).mockResolvedValue({ id: "alert-existente" });

    await processOccurrences([{ ...baseOccurrence, severity: "CRITICAL", slaMinutes: 240 }]);

    const call = (prisma.controlTowerAlert.update as any).mock.calls[0][0];
    expect(call.data.severity).toBe("CRITICAL");
  });

  it("não deescalona severity de CRITICAL para WARNING", async () => {
    const existingSlaDeadline = new Date(Date.now() + 200 * 60 * 1000);
    (prisma.controlTowerAlert.findFirst as any).mockResolvedValue({
      id: "alert-existente",
      severity: "CRITICAL",
      slaDeadline: existingSlaDeadline,
    });
    (prisma.controlTowerAlert.update as any).mockResolvedValue({ id: "alert-existente" });

    await processOccurrences([{ ...baseOccurrence, severity: "WARNING", slaMinutes: 240 }]);

    const call = (prisma.controlTowerAlert.update as any).mock.calls[0][0];
    expect(call.data.severity).toBe("CRITICAL"); // mantém o mais grave
  });
});

describe("processOccurrences — auto-resolução com AUTO_RESOLVED", () => {
  beforeEach(() => vi.clearAllMocks());

  it("usa resolutionType AUTO_RESOLVED na resolução automática", async () => {
    (prisma.controlTowerAlert.updateMany as any).mockResolvedValue({ count: 1 });

    await processOccurrences([], { storeId: "store-1", ruleIds: ["R03"] });

    const call = (prisma.controlTowerAlert.updateMany as any).mock.calls[0][0];
    expect(call.data.resolutionType).toBe("AUTO_RESOLVED");
    expect(call.data.resolutionNotes).toContain("Condição normalizada automaticamente");
  });
});
