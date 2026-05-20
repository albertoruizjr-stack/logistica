import { describe, it, expect, vi, beforeEach } from "vitest";

// spoke.service.ts captura SPOKE_API_URL/KEY no carregamento do módulo,
// então precisamos defini-las ANTES do import (vi.hoisted roda primeiro).
vi.hoisted(() => {
  process.env.SPOKE_API_URL = "https://api.example.com";
  process.env.SPOKE_API_KEY = "test-key";
});

import { listPlanStops } from "@/services/spoke.service";

// O Spoke/Circuit limita GET /plans/:id/stops a no máximo 10 stops por página
// (maxPageSize máximo = 10) e devolve nextPageToken quando há mais dados.
// Este teste prova que listPlanStops precisa seguir a paginação — senão
// entregas somem quando a wave tem mais de 10 stops.

global.fetch = vi.fn();
const mockFetch = vi.mocked(global.fetch);

// Resposta fake no formato que o call() interno espera (precisa de .text()).
function jsonResponse(body: unknown): Response {
  return {
    ok:     true,
    status: 200,
    text:   async () => JSON.stringify(body),
  } as unknown as Response;
}

function makeStops(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id:           `plans/X/stops/${prefix}${i}`,
    type:         "stop",
    stopPosition: i,
    recipient:    { externalId: `dr-${prefix}${i}` },
    route:        { id: "routes/r1", driver: "drivers/d1" },
  }));
}

describe("listPlanStops — paginação", () => {
  beforeEach(() => {
    // mockReset (não clearAllMocks) para também esvaziar a fila de mockResolvedValueOnce.
    mockFetch.mockReset();
  });

  it("devolve TODOS os stops de uma wave com mais de 10 paradas", async () => {
    // Página 1: 10 stops + token; Página 2: 4 stops, sem token.
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ stops: makeStops("a", 10), nextPageToken: "tok2" }))
      .mockResolvedValueOnce(jsonResponse({ stops: makeStops("b", 4) }));

    const stops = await listPlanStops("plans/X");

    expect(stops).toHaveLength(14);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("passa o nextPageToken como pageToken na requisição seguinte", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ stops: makeStops("a", 10), nextPageToken: "tok2" }))
      .mockResolvedValueOnce(jsonResponse({ stops: makeStops("b", 2) }));

    await listPlanStops("plans/X");

    const secondCallUrl = String(mockFetch.mock.calls[1][0]);
    expect(secondCallUrl).toContain("pageToken=tok2");
  });

  it("para quando não há nextPageToken (uma página só)", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ stops: makeStops("a", 7) }));

    const stops = await listPlanStops("plans/X");

    expect(stops).toHaveLength(7);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
