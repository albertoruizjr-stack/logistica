// services/citel-stock.service.ts
// Integração completa com o estoque Citel para solicitações de entrega.
//
// Responsabilidades:
//   - Buscar itens reais do PD na Citel
//   - Enriquecer cada item com peso, barcode, marca e saldo real
//   - Classificar disponibilidade de estoque por item
//   - Validar capacidade do veículo (moto/fiorino/caminhão)
//   - Calcular peso e volume total da entrega

import {
  fetchEstoqueCitelBatch,
  fetchProdutoDetalhe,
  fetchPedidoItens,
  fetchPedidoCabecalho,
  getSaldoForEmpresa,
  isCitelConfigured,
} from "@/services/citel.service";
import { prisma } from "@/lib/prisma";
import type {
  CitelPedidoItem,
  EnrichedDeliveryItem,
  StockItemStatus,
  VehicleCapacityResult,
  VehicleType,
  StockValidationStatus,
} from "@/types/stock";

// ──────────────────────────────────────────────
// CAPACIDADE POR TIPO DE VEÍCULO
// ──────────────────────────────────────────────

export const VEHICLE_CAPACITY: Record<VehicleType, { maxWeightKg: number; maxLatas: number }> = {
  MOTO:     { maxWeightKg: 30,   maxLatas: 0    }, // bloqueada para lata/balde/galão
  FIORINO:  { maxWeightKg: 750,  maxLatas: 25   }, // atualizado 2026-05-19 (era 500 / 20)
  VAN:      { maxWeightKg: 800,  maxLatas: 40   },
  CARRO:    { maxWeightKg: 200,  maxLatas: 10   },
  CAMINHAO: { maxWeightKg: 1650, maxLatas: 9999 },
};

// Unidades que representam volume pesado (lata/balde/galão/barrica).
// LA é a sigla mais comum no Citel pra Lata 18L (antes faltava — itens com LA
// eram contados como zero volume e o sistema mostrava "0 latas").
const HEAVY_UNITS = new Set(["LA", "LAT", "BD", "BAL", "GL", "GAL", "LT", "BR"]);

// Palavras que aparecem na DESCRIÇÃO do produto e indicam item volumoso/grande
// mesmo quando a unidade vem como UN/PC (papelão de tinta seca, lona, kraft).
// Match case-insensitive, palavra inteira.
const VOLUMINOUS_DESCRIPTION_PATTERNS = [
  /\bPAPEL[ÃA]O\b/i,
  /\bLONA\b/i,
  /\bKRAFT\b/i,
  /\bBARRICA\b/i,
];

export function isHeavyUnit(unit: string): boolean {
  return HEAVY_UNITS.has(unit.toUpperCase().trim());
}

export function isVoluminousByDescription(description: string): boolean {
  if (!description) return false;
  return VOLUMINOUS_DESCRIPTION_PATTERNS.some((re) => re.test(description));
}

// Peso padrão por unidade quando Citel não informa pesoBruto
const WEIGHT_FALLBACK_KG: Record<string, number> = {
  LA: 25,   // lata 18L de tinta ~22-25kg (PVA/acrílica/esmalte)
  LAT: 25,
  BD: 30,   // balde 18L ~30kg
  BAL: 30,
  GL: 28,   // galão 18L ~28kg
  GAL: 28,
  LT: 5,    // quarto 3.6L ~5kg
  BR: 80,   // barrica ~80kg
  UN: 1,    // unidade genérica — melhor que 0
};
const WEIGHT_FALLBACK_DEFAULT_KG = 1;

// ──────────────────────────────────────────────
// FETCH DE ITENS DO PEDIDO (PD)
// Usa endpoint de itens do Citel (/pedidovenda/{numero}/itens/{empresa})
// com fallback para dados parciais do endpoint de faturamento.
// ──────────────────────────────────────────────

export async function fetchOrderItemsFromCitel(
  orderNumber: string,
  storeCode: string
): Promise<CitelPedidoItem[] | null> {
  if (!isCitelConfigured()) return null;

  // Busca itens com quantidade do endpoint dedicado
  const rawItems = await fetchPedidoItens(orderNumber, storeCode);
  if (!rawItems || rawItems.length === 0) return null;

  // Para cada item, busca detalhe de produto em paralelo
  const detalhes = await Promise.allSettled(
    rawItems.map((item) => fetchProdutoDetalhe(item.codigo))
  );

  return rawItems.map((item, idx) => {
    const detalhe = detalhes[idx].status === "fulfilled" ? detalhes[idx].value : null;
    const unit    = detalhe?.unidade ?? item.unidade ?? "UN";

    // ⚠️ pesoBruto da Citel: convenções diferentes por fonte
    // - item.pesoBruto (campo pesoBruto do PD): é o peso TOTAL da linha (já × quantidade).
    //   Ex: lixa 0.02 kg × 50 unidades → Citel devolve pesoBruto=1.0 (não 0.02).
    // - detalhe.pesoBruto (cadastro do produto): é o peso UNITÁRIO.
    let totalWeight: number;
    let pesoUnitario: number | null;
    let usingFallback = false;

    if (item.pesoBruto != null) {
      totalWeight  = item.pesoBruto;
      pesoUnitario = item.quantidade > 0 ? item.pesoBruto / item.quantidade : null;
    } else if (detalhe?.pesoBruto != null) {
      pesoUnitario = detalhe.pesoBruto;
      totalWeight  = item.quantidade * detalhe.pesoBruto;
    } else {
      const fallback = WEIGHT_FALLBACK_KG[unit.toUpperCase()] ?? WEIGHT_FALLBACK_DEFAULT_KG;
      pesoUnitario = null; // peso real ausente — marca hasMissingWeight
      totalWeight  = item.quantidade * fallback;
      usingFallback = true;
      console.warn(
        `[citel-stock] peso bruto ausente · order=${orderNumber} sku=${item.codigo} unit=${unit} ` +
        `→ usando fallback ${fallback}kg/un`,
      );
    }

    const peso = pesoUnitario;

    return {
      codigo:           item.codigo,
      descricao:        detalhe?.descricao ?? item.descricao,
      marca:            detalhe?.marca ?? null,
      quantidade:       item.quantidade,
      unidade:          unit,
      codigoBarra:      detalhe?.codigoBarra ?? null,
      pesoBruto:        peso,
      totalWeight,
      hasMissingWeight: usingFallback,
    };
  });
}

// ──────────────────────────────────────────────
// ENRIQUECIMENTO COM SALDO
// Adiciona saldoDisponivel e saldoFisico para cada item
// numa única chamada batch ao Citel.
// ──────────────────────────────────────────────

export async function enrichDeliveryItemsWithStock(
  items: CitelPedidoItem[],
  codigoEmpresaCitel: string
): Promise<EnrichedDeliveryItem[]> {
  const codes = [...new Set(items.map((i) => i.codigo))];

  // Batch — uma única chamada para todos os SKUs
  const estoques = await fetchEstoqueCitelBatch(codes, [codigoEmpresaCitel]);
  const stockMap = new Map(estoques.map((e) => [e.codigoProduto, e]));

  return items.map((item) => {
    const produto = stockMap.get(item.codigo);
    const saldo   = produto ? getSaldoForEmpresa(produto, codigoEmpresaCitel) : null;

    const availableStock = saldo?.saldoDisponivel ?? 0;
    const physicalStock  = saldo?.saldoFisico     ?? 0;
    const citelDown      = produto === undefined;

    const stockStatus = classifyStockStatus(
      availableStock,
      physicalStock,
      item.quantidade,
      citelDown
    );

    return {
      productCode:      item.codigo,
      description:      item.descricao,
      brand:            item.marca,
      quantity:         item.quantidade,
      unit:             item.unidade,
      barcode:          item.codigoBarra,
      grossWeight:      item.pesoBruto,
      totalWeight:      item.totalWeight,
      hasMissingWeight: item.hasMissingWeight,
      availableStock,
      physicalStock,
      daysWithoutSale:  null, // retornado apenas em fetchProdutoDetalhe, não no batch de estoque
      turnoverClass:    null,
      stockStatus,
      availableAtStore: stockStatus === "AVAILABLE",
      sourceStoreId:    null,
    };
  });
}

// ──────────────────────────────────────────────
// CLASSIFICAÇÃO DE ESTOQUE POR ITEM
// ──────────────────────────────────────────────

function classifyStockStatus(
  disponivel: number,
  fisico: number,
  solicitado: number,
  citelDown: boolean
): StockItemStatus {
  if (citelDown) return "CITEL_DOWN";
  if (disponivel === 0) return "ZERO_STOCK";
  if (disponivel >= solicitado) return "AVAILABLE";
  if (fisico >= solicitado) return "RESERVED_ELSEWHERE";
  return "UNAVAILABLE";
}

// ──────────────────────────────────────────────
// VALIDAÇÃO DE DISPONIBILIDADE
// Retorna status consolidado para a solicitação.
// ──────────────────────────────────────────────

export function validateStockAvailability(
  items: EnrichedDeliveryItem[]
): StockValidationStatus {
  if (items.length === 0) return "PENDING";

  const allDown = items.every((i) => i.stockStatus === "CITEL_DOWN");
  if (allDown) return "CITEL_DOWN";

  const anyDown = items.some((i) => i.stockStatus === "CITEL_DOWN");
  const anyUnavailable = items.some(
    (i) => i.stockStatus === "UNAVAILABLE" || i.stockStatus === "ZERO_STOCK"
  );
  const anyReserved = items.some((i) => i.stockStatus === "RESERVED_ELSEWHERE");

  if (anyUnavailable) return "UNAVAILABLE";
  if (anyDown || anyReserved) return "PARTIAL";
  return "VALIDATED";
}

// ──────────────────────────────────────────────
// CÁLCULO DE PESO TOTAL
// ──────────────────────────────────────────────

export function calculateDeliveryWeight(items: EnrichedDeliveryItem[]): {
  totalWeightKg: number;
  hasMissingWeights: boolean;
  missingWeightCodes: string[];
} {
  let totalWeightKg = 0;
  const missingWeightCodes: string[] = [];

  for (const item of items) {
    totalWeightKg += item.totalWeight;
    if (item.hasMissingWeight) missingWeightCodes.push(item.productCode);
  }

  return {
    totalWeightKg,
    hasMissingWeights: missingWeightCodes.length > 0,
    missingWeightCodes,
  };
}

// ──────────────────────────────────────────────
// CÁLCULO DE REGRAS DE VOLUME
// ──────────────────────────────────────────────

export function calculateDeliveryVolumeRules(items: EnrichedDeliveryItem[]): {
  totalLatas:        number;            // soma de quantidade de itens "volumosos"
  hasHeavyUnit:      boolean;
  heavyItems:        string[];
  // breakdown pra UI: { LA: 3, GL: 2, BD: 0, ... }
  volumeBreakdown:   Record<string, number>;
  // descrição/produto contém papelão, lona, kraft, barrica
  hasVoluminousDesc: boolean;
} {
  let totalLatas = 0;
  let hasVoluminousDesc = false;
  const heavyItems: string[] = [];
  const volumeBreakdown: Record<string, number> = {};

  for (const item of items) {
    const unit = item.unit.toUpperCase().trim();
    const isHeavy   = isHeavyUnit(unit);
    const isVolDesc = isVoluminousByDescription(item.description);

    if (isHeavy) {
      totalLatas += item.quantity;
      heavyItems.push(item.productCode);
      volumeBreakdown[unit] = (volumeBreakdown[unit] ?? 0) + item.quantity;
    }
    // Itens identificados por descrição entram como "PAPEL/LONA/KRAFT/BARRICA"
    // no breakdown — não viram lata, mas o operador vê que tem volume grande.
    if (isVolDesc) {
      hasVoluminousDesc = true;
      const tag = item.description.match(/\bPAPEL[ÃA]O\b/i) ? "PAPEL"
                : item.description.match(/\bLONA\b/i)       ? "LONA"
                : item.description.match(/\bKRAFT\b/i)      ? "KRAFT"
                : "BARRICA";
      volumeBreakdown[tag] = (volumeBreakdown[tag] ?? 0) + item.quantity;
    }
  }

  return {
    totalLatas,
    hasHeavyUnit: heavyItems.length > 0,
    heavyItems,
    volumeBreakdown,
    hasVoluminousDesc,
  };
}

// ──────────────────────────────────────────────
// FORMATTER PRA UI — converte breakdown em string legível
//   { LA: 3, GL: 2 }     → "3 LA · 2 GL"
//   {}                    → "0 volumes"
//   { PAPEL: 1, LA: 5 }  → "5 LA · 1 papelão"
// ──────────────────────────────────────────────

const VOLUME_LABEL: Record<string, string> = {
  LA: "LA", LAT: "LA",
  GL: "GL", GAL: "GL",
  BD: "BD", BAL: "BD",
  LT: "LT",
  BR: "BR",
  PAPEL:   "papelão",
  LONA:    "lona",
  KRAFT:   "kraft",
  BARRICA: "barrica",
};

export function formatVolumeBreakdown(breakdown: Record<string, number> | null | undefined): string {
  if (!breakdown) return "0 volumes";
  const parts = Object.entries(breakdown)
    .filter(([, qty]) => qty > 0)
    .map(([key, qty]) => {
      const label = VOLUME_LABEL[key] ?? key.toLowerCase();
      return `${qty} ${label}`;
    });
  return parts.length === 0 ? "0 volumes" : parts.join(" · ");
}

// ──────────────────────────────────────────────
// VALIDAÇÃO DE CAPACIDADE DO VEÍCULO
// ──────────────────────────────────────────────

export function validateVehicleCapacity(
  totalWeightKg: number,
  totalLatas: number,
  hasHeavyUnit: boolean,
  vehicleType: VehicleType
): VehicleCapacityResult {
  const cap = VEHICLE_CAPACITY[vehicleType];

  const exceedsWeight = totalWeightKg > cap.maxWeightKg;
  const exceedsLatas  = totalLatas > cap.maxLatas;
  // Moto não pode carregar lata/balde/galão grande
  const blockedByUnit = vehicleType === "MOTO" && hasHeavyUnit;

  const allowed = !exceedsWeight && !exceedsLatas && !blockedByUnit;

  let blockedReason: string | null = null;
  let suggestedModal: VehicleType | null = null;

  if (blockedByUnit) {
    blockedReason  = `Moto não pode transportar latas/baldes/galões. Itens pesados detectados.`;
    suggestedModal = totalWeightKg <= VEHICLE_CAPACITY.FIORINO.maxWeightKg ? "FIORINO" : "CAMINHAO";
  } else if (exceedsWeight && exceedsLatas) {
    blockedReason  = `Peso (${totalWeightKg.toFixed(1)} kg) e volume (${totalLatas} latas) excedem capacidade de ${vehicleType}.`;
    suggestedModal = suggestNextVehicle(vehicleType, totalWeightKg, totalLatas);
  } else if (exceedsWeight) {
    blockedReason  = `Peso total (${totalWeightKg.toFixed(1)} kg) excede limite de ${cap.maxWeightKg} kg para ${vehicleType}.`;
    suggestedModal = suggestNextVehicle(vehicleType, totalWeightKg, totalLatas);
  } else if (exceedsLatas) {
    blockedReason  = `Volume (${totalLatas} latas/baldes) excede limite de ${cap.maxLatas} para ${vehicleType}.`;
    suggestedModal = suggestNextVehicle(vehicleType, totalWeightKg, totalLatas);
  }

  return { allowed, blockedReason, suggestedModal, totalWeightKg, totalLatas, exceedsWeight, exceedsLatas, hasHeavyUnit };
}

function suggestNextVehicle(
  current: VehicleType,
  weightKg: number,
  latas: number
): VehicleType | null {
  const order: VehicleType[] = ["MOTO", "CARRO", "FIORINO", "VAN", "CAMINHAO"];
  const candidates = order.filter((v) => {
    const cap = VEHICLE_CAPACITY[v];
    return cap.maxWeightKg >= weightKg && cap.maxLatas >= latas;
  });
  // retorna o menor veículo que comporta — excluindo o atual
  return candidates.find((v) => v !== current) ?? null;
}

// ──────────────────────────────────────────────
// FUNÇÃO PRINCIPAL — enriquece uma solicitação
// Chamada na criação da DeliveryRequest.
// ──────────────────────────────────────────────

export interface DeliveryStockResult {
  items:                 EnrichedDeliveryItem[];
  totalWeightKg:         number;
  totalLatas:            number;
  hasHeavyUnit:          boolean;
  /** Breakdown por sigla pra UI: { LA: 3, GL: 2, PAPEL: 1 } */
  volumeBreakdown:       Record<string, number>;
  /** true se algum item tem papelão/lona/kraft/barrica na descrição */
  hasVoluminousDesc:     boolean;
  hasMissingWeights:     boolean;
  missingWeightCodes:    string[];
  stockValidationStatus: StockValidationStatus;
  citelAvailable:        boolean;
  /** true quando o PD foi marcado como entrega CD no Autcom — estoque foi conferido no CD */
  isEntregaCD:           boolean;
  /** Empresa Citel que efetivamente foi usada para conferir estoque (CD se entregaCD, senão a loja origem) */
  empresaConsultada:     string;
}

export async function enrichDeliveryRequestStock(
  orderNumber: string,
  storeCode:   string,
  codigoEmpresaCitel: string
): Promise<DeliveryStockResult | null> {
  if (!isCitelConfigured()) return null;

  // 1. Busca cabeçalho pra detectar entrega CD
  const cabecalho = await fetchPedidoCabecalho(orderNumber, storeCode);

  // 2. Busca itens do pedido com detalhes de produto
  const pedidoItems = await fetchOrderItemsFromCitel(orderNumber, storeCode);
  if (!pedidoItems || pedidoItems.length === 0) return null;

  // 3. Decide qual empresa Citel usar para o estoque:
  //    - Se entregaPeloCD=true → usar codigoEmpresaCD (ex: "132" Vila Andrade/CD)
  //    - Senão → usar a loja origem do PD
  const isEntregaCD     = Boolean(cabecalho?.entregaPeloCD && cabecalho.codigoEmpresaCD);
  const empresaEstoque  = isEntregaCD ? cabecalho!.codigoEmpresaCD! : codigoEmpresaCitel;
  if (isEntregaCD) {
    console.log(`[CitelStock] PD ${orderNumber} é entrega CD — consultando estoque na empresa ${empresaEstoque} (loja origem do PD: ${codigoEmpresaCitel})`);
  }

  // 4. Enriquece com saldo disponível e físico (usa a empresa decidida acima)
  const enrichedItems = await enrichDeliveryItemsWithStock(pedidoItems, empresaEstoque);

  // 3. Calcula totais
  const { totalWeightKg, hasMissingWeights, missingWeightCodes } = calculateDeliveryWeight(enrichedItems);
  const { totalLatas, hasHeavyUnit, volumeBreakdown, hasVoluminousDesc } = calculateDeliveryVolumeRules(enrichedItems);

  // 4. Status consolidado
  const stockValidationStatus = validateStockAvailability(enrichedItems);

  // 5. Loga alerta se houver pesos ausentes
  if (hasMissingWeights) {
    console.warn(
      `[CitelStock] Peso bruto ausente para ${missingWeightCodes.length} produto(s) no pedido ${orderNumber}: ${missingWeightCodes.join(", ")}. Usando fallback.`
    );
  }

  return {
    items:                 enrichedItems,
    totalWeightKg,
    totalLatas,
    hasHeavyUnit,
    volumeBreakdown,
    hasVoluminousDesc,
    hasMissingWeights,
    missingWeightCodes,
    stockValidationStatus,
    isEntregaCD,
    empresaConsultada:     empresaEstoque,
    citelAvailable:        true,
  };
}

// ──────────────────────────────────────────────
// CONSULTA DE ESTOQUE DE UM PRODUTO ESPECÍFICO
// Usado para verificar saldo antes de despacho/separação
// ──────────────────────────────────────────────

export async function fetchProductStockFromCitel(
  productCode: string,
  codigoEmpresaCitel: string
): Promise<{ disponivel: number; fisico: number; status: StockItemStatus } | null> {
  if (!isCitelConfigured()) return null;

  const [estoques, detalhe] = await Promise.all([
    fetchEstoqueCitelBatch([productCode], [codigoEmpresaCitel]),
    fetchProdutoDetalhe(productCode),
  ]);

  const produto = estoques[0];
  if (!produto) return null;

  const saldo = getSaldoForEmpresa(produto, codigoEmpresaCitel);
  if (!saldo) return null;

  const status = classifyStockStatus(
    saldo.saldoDisponivel,
    saldo.saldoFisico,
    0, // sem quantidade solicitada — apenas retorna os saldos
    false
  );

  void detalhe; // disponível para uso futuro se necessário

  return {
    disponivel: saldo.saldoDisponivel,
    fisico:     saldo.saldoFisico,
    status,
  };
}
