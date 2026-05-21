import { describe, it, expect } from "vitest";
import { toWhatsappNumber, toE164 } from "@/lib/phone";
describe("toWhatsappNumber", () => {
  it("normaliza celular SP para 55+DDD+numero", () => {
    expect(toWhatsappNumber("(11) 98888-7777")).toBe("5511988887777");
  });
  it("não duplica o 55 se já tiver", () => {
    expect(toWhatsappNumber("5511988887777")).toBe("5511988887777");
  });
  it("retorna null para telefone vazio/curto", () => {
    expect(toWhatsappNumber("")).toBeNull();
    expect(toWhatsappNumber("123")).toBeNull();
  });
});

describe("toE164", () => {
  it("formata celular BR em E.164 (+55+DDD+numero)", () => {
    expect(toE164("(11) 96411-3474")).toBe("+5511964113474");
  });
  it("retorna null para telefone vazio", () => {
    expect(toE164("")).toBeNull();
  });
});
