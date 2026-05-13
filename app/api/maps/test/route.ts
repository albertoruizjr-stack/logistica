// app/api/maps/test — endpoint de diagnóstico para testar a integração Google Maps.
// Restrito a ADMIN. Nunca expor em produção sem autenticação.

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest }     from "@/lib/auth";
import { geocodeAddress }            from "@/lib/google-maps";
import { checkMapsQuota }            from "@/services/maps/quota-guard";
import { apiSuccess, apiError }      from "@/types";

// Casos de teste representativos da operação
const TEST_CASES = [
  { label: "Capital SP",            address: "Av. Paulista, 1000, São Paulo - SP" },
  { label: "Grande ABC",            address: "Rua Marechal Deodoro, 50, Santo André - SP" },
  { label: "Litoral SP",            address: "Av. Ana Costa, 100, Santos - SP" },
  { label: "Interior SP",           address: "Av. Brasil, 200, Ribeirão Preto - SP" },
  { label: "RJ — rua homônima",     address: "Rua das Flores, 10, Rio de Janeiro - RJ" },
  { label: "Endereço inexistente",  address: "Rua Totalmente Fictícia, 99999, São Paulo - SP" },
  { label: "CEP válido",            address: "01310-100" },
  { label: "Endereço incompleto",   address: "Rua das Flores" },
] as const;

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json(apiError("Restrito a ADMIN"), { status: 403 });
  }

  const quota = await checkMapsQuota();

  const results = await Promise.allSettled(
    TEST_CASES.map(async (tc) => {
      const start  = Date.now();
      const result = await geocodeAddress(tc.address);
      const ms     = Date.now() - start;
      return {
        label:    tc.label,
        address:  tc.address,
        found:    result !== null,
        withinSP: result?.withinSP ?? null,
        city:     result?.city     ?? null,
        state:    result?.state    ?? null,
        ms,
      };
    })
  );

  return NextResponse.json(
    apiSuccess({
      quota,
      tests: results.map((r, i) =>
        r.status === "fulfilled"
          ? r.value
          : { label: TEST_CASES[i].label, error: String(r.reason) }
      ),
    })
  );
}
