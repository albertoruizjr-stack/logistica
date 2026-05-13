import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest }            from "@/lib/auth";
import { geocodeAddress, validateAddressQuality } from "@/lib/google-maps";
import { apiSuccess, apiError }             from "@/types";

const schema = z.object({
  address:          z.string().min(5, "Endereço muito curto"),
  allowOutsideSP:   z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(apiError("Não autenticado"), { status: 401 });
  }

  const body   = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(apiError("Endereço inválido", "VALIDATION_ERROR"), { status: 400 });
  }

  // Rejeita endereços genéricos antes de gastar quota da API
  const quality = validateAddressQuality(parsed.data.address);
  if (!quality.valid) {
    return NextResponse.json(
      apiError(quality.reason ?? "Endereço incompleto", "INCOMPLETE_ADDRESS"),
      { status: 400 }
    );
  }

  const result = await geocodeAddress(parsed.data.address);
  if (!result) {
    return NextResponse.json(
      apiError(
        "Não foi possível localizar o endereço. Verifique o CEP ou informe rua, número e cidade.",
        "NOT_FOUND"
      ),
      { status: 404 }
    );
  }

  // Endereço fora de SP: bloqueia salvo permissão explícita de ADMIN/OPERATOR
  if (!result.withinSP && !parsed.data.allowOutsideSP) {
    const canOverride = ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(session.role);
    return NextResponse.json(
      {
        success: false,
        error:   "OUTSIDE_SP",
        message: `Endereço localizado em ${result.city} — ${result.state}, fora da área padrão de entrega (SP).`,
        data:    result,            // retorna mesmo assim para exibir no alerta
        canOverride,               // ADMIN/OPERATOR podem confirmar e continuar
      },
      { status: 422 }
    );
  }

  // Aviso (não bloqueio) se SP mas fora da capital/Grande SP
  const warning =
    result.withinSP && !isGrandeSpArea(result.city)
      ? `Entrega em ${result.city} — SP. Verifique se sua operação atende esta localidade.`
      : undefined;

  return NextResponse.json(apiSuccess({ ...result, warning }));
}

// Cidades da Grande SP e litoral SP mais comuns na operação
const GRANDE_SP_CITIES = new Set([
  "São Paulo",     "Guarulhos",    "Campinas",       "São Bernardo do Campo",
  "Santo André",   "Osasco",       "São Caetano do Sul", "Diadema",
  "Mauá",          "Carapicuíba",  "Barueri",        "Itaquaquecetuba",
  "Suzano",        "Taboão da Serra", "Cotia",        "Embu das Artes",
  "Mogi das Cruzes", "Santana de Parnaíba", "Jandira", "Francisco Morato",
  "Santos",        "São Vicente",  "Praia Grande",   "Guarujá",
  "Cubatão",       "Sorocaba",     "São José dos Campos",
]);

function isGrandeSpArea(city: string): boolean {
  return GRANDE_SP_CITIES.has(city);
}
