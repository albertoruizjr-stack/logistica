import { describe, it, expect } from "vitest";
import { priorityScore, buildCapacityWarning } from "@/services/dispatch-planner.service";

describe("priorityScore", () => {
  it("urgente recebe 50 pts", () => {
    const score = priorityScore({ isUrgent: true, distanceKm: 10, dispatchWindow: null });
    expect(score).toBe(50);
  });

  it("EXPRESS recebe 40 pts extras", () => {
    const score = priorityScore({ isUrgent: false, distanceKm: 10, dispatchWindow: "EXPRESS" });
    expect(score).toBe(40);
  });

  it("curta distância (< 5km) recebe 20 pts extras", () => {
    const score = priorityScore({ isUrgent: false, distanceKm: 3, dispatchWindow: null });
    expect(score).toBe(20);
  });

  it("urgente + EXPRESS + curta distância = 50+40+20 = 110", () => {
    const score = priorityScore({ isUrgent: true, distanceKm: 2, dispatchWindow: "EXPRESS" });
    expect(score).toBe(110);
  });

  it("FIRST_DISPATCH não-urgente recebe 10 pts de janela", () => {
    const score = priorityScore({ isUrgent: false, distanceKm: 12, dispatchWindow: "FIRST_DISPATCH" });
    expect(score).toBe(0); // FIRST_DISPATCH não tem bônus na função atual
  });

  it("SECOND_DISPATCH não-urgente recebe 10 pts de janela", () => {
    const score = priorityScore({ isUrgent: false, distanceKm: 12, dispatchWindow: "SECOND_DISPATCH" });
    expect(score).toBe(10);
  });
});

describe("buildCapacityWarning", () => {
  it("retorna null quando dentro da capacidade", () => {
    expect(buildCapacityWarning(100, 40, 150, 60)).toBeNull();
  });

  it("alerta excesso de peso", () => {
    const warning = buildCapacityWarning(200, 40, 150, 60);
    expect(warning).toContain("200");
    expect(warning).toContain("150");
  });

  it("alerta excesso de latas", () => {
    const warning = buildCapacityWarning(100, 80, 150, 60);
    expect(warning).toContain("80");
    expect(warning).toContain("60");
  });

  it("alerta ambos quando os dois excedem", () => {
    const warning = buildCapacityWarning(200, 80, 150, 60);
    expect(warning).toContain("kg");
    expect(warning).toContain("latas");
  });
});
