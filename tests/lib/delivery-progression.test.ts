import { describe, it, expect } from "vitest";
import { pathToInTransit } from "@/lib/delivery-progression";

// Regra: o app do motorista deixa agir na entrega já em ROTEIRIZADO (rota ACTIVE),
// mas concluir exige IN_TRANSIT. pathToInTransit diz quais transições faltam
// para chegar a IN_TRANSIT a partir do estado atual — ou null se não se deve auto-avançar.

describe("pathToInTransit", () => {
  it("de ROTEIRIZADO precisa passar por DISPATCHED e IN_TRANSIT", () => {
    expect(pathToInTransit("ROTEIRIZADO")).toEqual(["DISPATCHED", "IN_TRANSIT"]);
  });

  it("de DISPATCHED só falta IN_TRANSIT", () => {
    expect(pathToInTransit("DISPATCHED")).toEqual(["IN_TRANSIT"]);
  });

  it("já em IN_TRANSIT não falta nada", () => {
    expect(pathToInTransit("IN_TRANSIT")).toEqual([]);
  });

  it("não auto-avança de estados anteriores ao roteiro (PENDING)", () => {
    expect(pathToInTransit("PENDING")).toBeNull();
  });

  it("não auto-avança de estados terminais/laterais (DELIVERED, OCORRENCIA)", () => {
    expect(pathToInTransit("DELIVERED")).toBeNull();
    expect(pathToInTransit("OCORRENCIA")).toBeNull();
  });
});
