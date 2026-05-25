import { describe, it, expect } from "vitest";
import { classifyOrderStatus, BLOCKED_MESSAGES } from "@/lib/erp-order-status";

describe("classifyOrderStatus", () => {
  it("status nulo → VALID", () => {
    expect(classifyOrderStatus(null)).toBe("VALID");
  });
  it("cancelado (qualquer variação) → CANCELLED", () => {
    expect(classifyOrderStatus("CANCELADO")).toBe("CANCELLED");
    expect(classifyOrderStatus("Pedido em cancelamento")).toBe("CANCELLED");
  });
  it("bloqueado → BLOCKED", () => {
    expect(classifyOrderStatus("BLOQUEADO")).toBe("BLOCKED");
  });
  it("aguardando aprovação/liberação → APPROVAL_PENDING", () => {
    expect(classifyOrderStatus("AGUARDANDO APROVACAO")).toBe("APPROVAL_PENDING");
    expect(classifyOrderStatus("aguardando liberacao")).toBe("APPROVAL_PENDING");
  });
  it("faturado/encerrado → ALREADY_FULFILLED", () => {
    expect(classifyOrderStatus("FATURADO")).toBe("ALREADY_FULFILLED");
    expect(classifyOrderStatus("NF EMITIDA")).toBe("ALREADY_FULFILLED");
  });
  it("status comum → VALID", () => {
    expect(classifyOrderStatus("APROVADO")).toBe("VALID");
  });
  it("BLOCKED_MESSAGES cobre cada status não-VALID", () => {
    for (const k of ["CANCELLED", "BLOCKED", "APPROVAL_PENDING", "ALREADY_FULFILLED"]) {
      expect(typeof BLOCKED_MESSAGES[k]).toBe("string");
    }
  });
});
