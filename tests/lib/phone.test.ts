import { describe, it, expect } from "vitest";
import { toWhatsappNumber } from "@/lib/phone";
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
