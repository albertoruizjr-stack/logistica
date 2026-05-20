// ──────────────────────────────────────────────
// SPOKE (= Circuit) — API de roteirização
//
// Auth: Basic com base64(apiKey + ":")
// Base URL: https://api.getcircuit.com/public/v0.2b
//
// Fluxo canônico de uma onda:
//   1. createPlan         (= cria a wave)
//   2. importStops        (= adiciona todas as entregas de uma vez)
//   3. optimizePlan       (assíncrono — retorna operationId, polling)
//   4. distributePlan     (síncrono — distribui aos motoristas)
//   5. getPlan + getRoute (busca rotas com manifesto pra exibir)
// ──────────────────────────────────────────────

const SPOKE_API_URL = process.env.SPOKE_API_URL ?? "";
const SPOKE_API_KEY = process.env.SPOKE_API_KEY ?? "";

function authHeader(): string {
  const creds = Buffer.from(`${SPOKE_API_KEY}:`).toString("base64");
  return `Basic ${creds}`;
}

export function isSpokeConfigured(): boolean {
  return Boolean(SPOKE_API_URL && SPOKE_API_KEY);
}

export class SpokeError extends Error {
  constructor(
    message:        string,
    readonly status: number,
    readonly body:  unknown,
  ) {
    super(message);
    this.name = "SpokeError";
  }
}

async function call<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path:   string,
  body?:  unknown,
): Promise<T> {
  if (!isSpokeConfigured()) {
    throw new SpokeError("SPOKE_API_URL / SPOKE_API_KEY ausentes", 0, null);
  }
  const url = `${SPOKE_API_URL}${path}`;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: authHeader(),
      Accept:        "application/json",
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(30_000),
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  };
  console.log(`[Spoke] ${method} ${path}`);
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    console.warn(`[Spoke] ${method} ${path} → HTTP ${res.status}`, parsed);
    throw new SpokeError(
      `Spoke ${method} ${path} retornou ${res.status}`,
      res.status,
      parsed,
    );
  }
  return parsed as T;
}

// ──────────────────────────────────────────────
// TIPOS DA API SPOKE
// ──────────────────────────────────────────────

export interface SpokeAddress {
  addressName?:     string;        // ex: "WANDERLEY PEREIRA NUNES"
  addressLineOne:   string;        // ex: "Rua Cônego Roque Viggiano, 75"
  addressLineTwo?:  string;
  city?:            string;
  state?:           string;
  zip?:             string;
  country?:         string;        // "BR"
  latitude?:        number;
  longitude?:       number;
  placeId?:         string;
}

export interface SpokeRecipient {
  name?:        string;
  email?:       string;
  phone?:       string;
  externalId?:  string;            // pra correlacionar com nosso DR
}

// Spoke representa grandezas com unidade como objeto { amount, unit } em vez de número puro.
export interface SpokeWeight {
  amount: number;
  unit:   "kilogram" | "pound" | "metric-ton";
}

export interface SpokeStopInput {
  address:           SpokeAddress;
  recipient?:        SpokeRecipient;
  notes?:            string;
  packageCount?:     number;
  weight?:           SpokeWeight;
  activity?:         "delivery" | "pickup";
  allowedDrivers?:   string[];     // ["drivers/abc"]
  optimizationOrder?: "any" | "first" | "last";
  customProperties?: Record<string, string>;
}

export interface SpokeStopRoute {
  id:     string;                  // "routes/abc"
  driver: string;                  // "drivers/abc"
  title?: string;
  stopCount?: number;
  state?: {
    distributed?:   boolean;
    distributedAt?: number;
    started?:       boolean;
    completed?:     boolean;
  };
  plan?:  string;
}

export interface SpokeStop extends SpokeStopInput {
  id:           string;            // "plans/.../stops/abc"
  // Papel no plan: start/end são o depot, "stop" é cada parada real (cliente).
  type?:        "start" | "stop" | "end";
  stopPosition?: number;
  eta?: {
    estimatedArrivalAt:        number;  // unix seconds (não milissegundos)
    estimatedEarliestArrivalAt: number;
    estimatedLatestArrivalAt:   number;
  };
  // Estrutura aninhada — depois de distribute, route.driver é onde fica o motorista atribuído.
  route?: SpokeStopRoute;
  plan?:  string;
  // Campo legado em algumas respostas — preferir stop.route.driver.
  driverIdentifier?: string;
}

export interface SpokeDriver {
  id:           string;            // "drivers/abc"
  name:         string;
  email?:       string;
  phone?:       string;
  displayName?: string;
  active?:      boolean;
}

export interface SpokePlan {
  id:           string;            // "plans/abc"
  title:        string;
  starts:       { day: number; month: number; year: number };
  drivers?:     string[];          // ["drivers/abc"]
  depot?:       string;            // "depots/abc"
  distributed?: boolean;
  optimized?:   boolean;
  routes?:      string[];          // ["plans/abc/routes/xyz"] após distribute
}

export interface SpokeRoute {
  id:        string;
  title?:    string;
  driver?:   string;
  stopCount?: number;
  state?: {
    distributed?:   boolean;
    distributedAt?: number;
    started?:       boolean;
    startedAt?:     number;
    completed?:     boolean;
    completedAt?:   number;
  };
  plan?:     string;
  stops?:    SpokeStop[];
}

export interface SpokeOperation {
  id:    string;
  type:  string;
  done:  boolean;
  metadata?: Record<string, unknown>;
  result?:   Record<string, unknown>;
  error?:    Record<string, unknown>;
}

// ──────────────────────────────────────────────
// PLANS
// ──────────────────────────────────────────────

export async function createPlan(args: {
  title:    string;
  date:     Date;
  drivers?: string[];
  depot?:   string;
}): Promise<SpokePlan> {
  return call<SpokePlan>("POST", "/plans", {
    title: args.title,
    starts: {
      day:   args.date.getDate(),
      month: args.date.getMonth() + 1,
      year:  args.date.getFullYear(),
    },
    ...(args.drivers && args.drivers.length > 0 ? { drivers: args.drivers } : {}),
    ...(args.depot ? { depot: args.depot } : {}),
  });
}

export async function getPlan(planId: string): Promise<SpokePlan> {
  return call<SpokePlan>("GET", `/${planId}`);
}

export async function importStops(
  planId: string,
  stops:  SpokeStopInput[],
): Promise<{ stops?: SpokeStop[] }> {
  // Spoke aceita até 100 stops por request — chunkamos
  const CHUNK = 100;
  const out: SpokeStop[] = [];
  for (let i = 0; i < stops.length; i += CHUNK) {
    const slice = stops.slice(i, i + CHUNK);
    const res = await call<{ stops?: SpokeStop[] }>(
      "POST",
      `/${planId}/stops:import`,
      slice,
    );
    if (res.stops) out.push(...res.stops);
  }
  return { stops: out };
}

export async function optimizePlan(planId: string): Promise<SpokeOperation> {
  return call<SpokeOperation>("POST", `/${planId}:optimize`, {});
}

export async function distributePlan(planId: string): Promise<SpokePlan> {
  return call<SpokePlan>("POST", `/${planId}:distribute`, {});
}

export async function getOperation(operationId: string): Promise<SpokeOperation> {
  return call<SpokeOperation>("GET", `/${operationId}`);
}

/**
 * Polling até a operação completar (ou timeout).
 * @param operationId id retornado por /optimize
 * @param maxWaitMs timeout total (default: 90s)
 * @param intervalMs intervalo entre polls (default: 2s)
 */
export async function waitForOperation(
  operationId: string,
  maxWaitMs:   number = 90_000,
  intervalMs:  number = 2000,
): Promise<SpokeOperation> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const op = await getOperation(operationId);
    if (op.done) return op;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new SpokeError(`Operação ${operationId} não completou em ${maxWaitMs}ms`, 408, null);
}

// ──────────────────────────────────────────────
// ROUTES
// ──────────────────────────────────────────────

export async function getRoute(routeId: string): Promise<SpokeRoute> {
  return call<SpokeRoute>("GET", `/${routeId}`);
}

// Lista todos os stops de um plan distribuído. Inclui driverIdentifier + stopPosition + eta.
// Mais confiável que iterar GET /plans/X/routes/Y individualmente (que pode dar 404 em rotas
// recém-distribuídas pelo Spoke).
//
// ATENÇÃO: o Spoke/Circuit limita esta resposta a no máximo 10 stops por página
// (maxPageSize máx. = 10) e devolve nextPageToken quando há mais. Precisamos seguir
// a paginação até o fim — senão entregas somem em qualquer wave com >10 stops
// (14 entregas + paradas de depósito já estoura uma página).
export async function listPlanStops(planId: string): Promise<SpokeStop[]> {
  const all: SpokeStop[] = [];
  let pageToken: string | undefined;

  // Guard contra loop infinito: 100 páginas × 10 = 1000 stops, muito além de qualquer wave real.
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({ maxPageSize: "10" });
    if (pageToken) query.set("pageToken", pageToken);

    const res = await call<{ stops?: SpokeStop[]; nextPageToken?: string }>(
      "GET",
      `/${planId}/stops?${query.toString()}`,
    );

    if (res.stops) all.push(...res.stops);
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }

  return all;
}

// ──────────────────────────────────────────────
// DRIVERS
// ──────────────────────────────────────────────

export async function listDrivers(): Promise<SpokeDriver[]> {
  const res = await call<{ drivers?: SpokeDriver[] }>("GET", "/drivers");
  return res.drivers ?? [];
}

export async function createDriver(args: {
  name:         string;
  email:        string;
  phone:        string;
  displayName?: string;
}): Promise<SpokeDriver> {
  return call<SpokeDriver>("POST", "/drivers", {
    name:         args.name,
    email:        args.email,
    phone:        args.phone,
    ...(args.displayName ? { displayName: args.displayName } : {}),
    active:       true,
  });
}
