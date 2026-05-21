import { describe, it, expect } from "vitest";
import { pathToInTransit, pathToDelivered } from "@/lib/delivery-progression";

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

// Operador finalizando manualmente pela fila operacional.
describe("pathToDelivered", () => {
  it("de PRONTO_ROTEIRIZACAO percorre todo o fluxo até DELIVERED", () => {
    expect(pathToDelivered("PRONTO_ROTEIRIZACAO")).toEqual([
      "ROTEIRIZADO", "DISPATCHED", "IN_TRANSIT", "DELIVERED",
    ]);
  });

  it("de ROTEIRIZADO pula a roteirização", () => {
    expect(pathToDelivered("ROTEIRIZADO")).toEqual(["DISPATCHED", "IN_TRANSIT", "DELIVERED"]);
  });

  it("de IN_TRANSIT só falta DELIVERED", () => {
    expect(pathToDelivered("IN_TRANSIT")).toEqual(["DELIVERED"]);
  });

  it("já em DELIVERED não falta nada", () => {
    expect(pathToDelivered("DELIVERED")).toEqual([]);
  });

  it("não marca entregue de estados anteriores à NF nem de OCORRENCIA", () => {
    expect(pathToDelivered("PENDING")).toBeNull();
    expect(pathToDelivered("AGUARDANDO_NF")).toBeNull();
    expect(pathToDelivered("OCORRENCIA")).toBeNull();
  });
});
