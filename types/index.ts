// ──────────────────────────────────────────────
// TIPOS PRINCIPAIS DO SISTEMA DE LOGÍSTICA
// ──────────────────────────────────────────────

import {
  Store,
  User,
  FreightZone,
  FreightQuote,
  DeliveryRequest,
  DeliveryItem,
  Transfer,
  TransferItem,
  TransferHistory,
  Dispatch,
  Driver,
  DriverLocation,
  Route,
  LalamoveOrder,
  FreightAudit,
  Role,
  DeliveryType,
  DeliveryRequestStatus,
  TransferStatus,
  TransferPriority,
  DispatchStatus,
  DispatchModal,
} from "@prisma/client";

// re-exporta enums para uso nos componentes
export {
  Role,
  DeliveryType,
  DeliveryRequestStatus,
  TransferStatus,
  TransferPriority,
  DispatchStatus,
  DispatchModal,
};

// ──────────────────────────────────────────────
// MOTOR DE DECISÃO DE FRETE
// ──────────────────────────────────────────────

// Tipos de veículo da frota própria
export const InternalVehicleType = {
  MOTO:     "MOTO",
  FIORINO:  "FIORINO",
  CAMINHAO: "CAMINHAO",
} as const
export type InternalVehicleType = typeof InternalVehicleType[keyof typeof InternalVehicleType]

// Tipos de serviço Lalamove Brasil
// ATENÇÃO: confirmar os códigos exatos na API Lalamove antes do go-live
export const LalamoveServiceType = {
  LALAPRO:    "MOTORCYCLE",
  UTILITARIO: "VAN",
  VAN:        "VAN_L",
  CARRETO:    "MOVING_TRUCK",
  CAMINHAO:   "TRUCK",
} as const
export type LalamoveServiceType = typeof LalamoveServiceType[keyof typeof LalamoveServiceType]

// Configurações de classificação de veículos (carregadas do SystemConfig)
export interface VehicleConfig {
  INTERNAL_MOTO_MAX_KG:        number
  INTERNAL_FIORINO_MAX_KG:     number
  INTERNAL_FIORINO_MAX_LATAS:  number
  INTERNAL_CAMINHAO_MAX_KG:    number
  INTERNAL_CAMINHAO_MAX_LATAS: number
  LALA_LALAPRO_MAX_KG:         number
  LALA_UTILITARIO_MAX_KG:      number
  LALA_VAN_MAX_KG:             number
  LALA_CARRETO_MAX_KG:         number
  LALA_CAMINHAO_MAX_KG:        number
}

// Configurações de custo de rota interna
export interface CostConfig {
  COST_PER_KM:      number
  COST_PER_HOUR:    number
  FIXED_ROUTE_COST: number
}

export interface FreightDecisionInput {
  originLat:           number
  originLng:           number
  destLat:             number
  destLng:             number
  isUrgent:            boolean
  deliveryDate:        Date
  deliveryWindowStart: Date
  deliveryWindowEnd:   Date
  items: {
    productCode: string
    quantity:    number
    weightKg:    number
    latas?:      number
    volumeM3?:   number
  }[]
  sellerId: string
  storeId:  string
}

export interface FreightDecisionResult {
  selectedMode:             "INTERNAL" | "LALAMOVE"
  selectedVehicle:          InternalVehicleType | LalamoveServiceType
  driverId?:                string
  requiresManualAssignment: boolean
  lalamoveQuote?: {
    quotationId:    string
    estimatedPrice: number
    serviceType:    LalamoveServiceType
  }
  distanceKm:               number
  durationMinutes:          number          // com trânsito quando disponível
  durationInTrafficMinutes: number | null   // null = trânsito não disponível
  isApproximate:            boolean
  internalCost:             number
  lalamoveCost:             number | null
  suggestedPrice:           number
  decisionReason:           string
  consolidationNote?:       string   // sugestão de consolidação D+1 (opcional)
}

// ──────────────────────────────────────────────
// ETA DE MOTORISTAS
// ──────────────────────────────────────────────

export interface DriverETAResult {
  driverId:          string
  driverName:        string
  vehicleType:       string | null
  currentLat:        number | null
  currentLng:        number | null
  isLocationFresh:   boolean        // localização recente (< 30 min)
  activeDeliveries:  number
  minutesUntilFree:  number         // 0 = disponível agora
  estimatedFreeAt:   Date
  score:             number         // score composto (0-100) para seleção — ver scoreDriverWithETA
  etaToOriginMin:    number | null  // tempo de carro até a origem (com trânsito) — null se sem GPS
}

// ──────────────────────────────────────────────
// MOTOR DE DECISÃO — PARÂMETROS ESTENDIDOS
// ──────────────────────────────────────────────

export type ModalRecommendation = "INTERNAL" | "LALAMOVE" | "EXPRESS" | "CONSOLIDATE"

export type DeliveryRisk = "LOW" | "MEDIUM" | "HIGH"

export interface DecisionContext {
  driverEtaMin:     number | null   // minutos até o melhor motorista estar livre (null = nenhum)
  isSameDayAfterCutoff: boolean     // same-day solicitado após 12h
  dispatchWindow:   "FIRST_DISPATCH" | "SECOND_DISPATCH" | "EXPRESS" | null
}

// ──────────────────────────────────────────────
// WORKQUEUE
// ──────────────────────────────────────────────

export interface WorkqueueItem {
  deliveryRequestId:     string
  customerName:          string
  deliveryAddress:       string
  deliveryType:          DeliveryType
  status:                DeliveryRequestStatus
  dispatchWindow:        string | null
  distanceKm:            number | null
  durationMin:           number | null         // com trânsito quando disponível
  etaMinutes:            number | null         // minutos até entrega estimada
  etaAt:                 Date   | null         // timestamp estimado de entrega
  modalRecommendation:   ModalRecommendation
  suggestedDriverId:     string | null
  suggestedDriverName:   string | null
  delayRisk:             DeliveryRisk
  delayReason:           string | null
  recommendationReason:  string
  isUrgent:              boolean
  createdAt:             Date
}

// ──────────────────────────────────────────────
// PLANEJAMENTO DE SEGUNDO DESPACHO
// ──────────────────────────────────────────────

export interface DispatchPlanItem {
  deliveryRequestId: string
  customerName:      string
  deliveryAddress:   string
  distanceKm:        number | null
  durationMin:       number | null
  totalWeightKg:     number | null
  totalLatas:        number | null
  isUrgent:          boolean
  priorityScore:     number         // mais alto = despachar primeiro
}

export interface DispatchPlanSummary {
  window:              "FIRST_DISPATCH" | "SECOND_DISPATCH"
  plannedDepartureAt:  Date
  estimatedReturnAt:   Date
  items:               DispatchPlanItem[]
  totalDistanceKm:     number
  totalDurationMin:    number
  totalWeightKg:       number
  totalLatas:          number
  isOverCapacity:      boolean
  capacityWarning:     string | null
}

// ──────────────────────────────────────────────
// ANALYTICS — PRECISÃO DE ETA E MODAL
// ──────────────────────────────────────────────

export interface ETAAccuracyReport {
  period:              { from: Date; to: Date }
  totalDispatches:     number
  withPrediction:      number
  avgErrorMin:         number         // (previsto - real): positivo = adiantou, negativo = atrasou
  p90ErrorMin:         number         // 90% dos erros ficam abaixo deste valor absoluto
  lateDeliveries:      number         // entregas onde real > previsto
  latePercent:         number
}

export interface ModalAccuracyReport {
  period:              { from: Date; to: Date }
  total:               number
  matchCount:          number         // sugerido === real
  matchPercent:        number
  breakdown: {
    suggested:  Record<string, number>
    actual:     Record<string, number>
    divergence: Array<{ suggested: string; actual: string; count: number }>
  }
  avgCostErrorPercent: number         // (custo_real - custo_previsto) / custo_previsto × 100
}

// ──────────────────────────────────────────────
// VISÃO ESPACIAL OPERACIONAL — MAPA
// ──────────────────────────────────────────────

export type MarkerColor = "red" | "orange" | "blue" | "green" | "purple" | "gray"

export interface MapStore {
  id:      string
  code:    string
  name:    string
  lat:     number
  lng:     number
  address: string
}

export interface MapDriver {
  id:              string
  name:            string
  vehicleType:     string | null
  lat:             number | null
  lng:             number | null
  isLocationFresh: boolean
  minutesUntilFree: number
  activeDeliveries: number
  score:           number
  storeId:         string
  storeName:       string
  color:           MarkerColor   // green=livre, orange=ocupado, red=sem localização
}

export interface MapDelivery {
  id:                  string
  customerName:        string
  deliveryAddress:     string
  lat:                 number | null
  lng:                 number | null
  status:              string
  isUrgent:            boolean
  delayRisk:           DeliveryRisk
  modalRecommendation: ModalRecommendation | null
  suggestedDriverId:   string | null
  distanceKm:          number | null
  storeId:             string
  storeName:           string
  color:               MarkerColor   // red=urgent, orange=high risk, blue=standard
  createdAt:           Date
}

export interface HeatmapPoint {
  lat:   number
  lng:   number
  count: number   // número de entregas nessa célula (~1.1km × 1.1km)
}

export interface MapSummary {
  totalDeliveries:  number
  urgentCount:      number
  highRiskCount:    number
  activeDrivers:    number
  availableDrivers: number
  inTransitCount:   number
  pendingCount:     number
}

export interface MapViewData {
  stores:    MapStore[]
  drivers:   MapDriver[]
  deliveries: MapDelivery[]
  heatmap:   HeatmapPoint[]
  summary:   MapSummary
  updatedAt: Date
}

export interface MapFilters {
  storeId:   string | null
  modal:     ModalRecommendation | null
  risk:      DeliveryRisk | null
  driverId:  string | null
  showUrgentOnly: boolean
}

// ──────────────────────────────────────────────
// TIPOS EXPANDIDOS (com relações)
// ──────────────────────────────────────────────

export type UserWithStore = User & { store: Store };

export type DeliveryRequestWithRelations = DeliveryRequest & {
  store: Store;
  seller: Pick<User, "id" | "name" | "email">;
  freightQuote: FreightQuoteWithZone | null;
  items: DeliveryItem[];
  transfers: TransferSummary[];
  dispatch: Dispatch | null;
  audit: FreightAudit | null;
};

export type FreightQuoteWithZone = FreightQuote & {
  zone: FreightZone | null;
};

export type TransferWithRelations = Transfer & {
  deliveryRequest: Pick<DeliveryRequest, "id" | "invoiceNumber" | "customerName"> | null;
  fromStore: Store;
  toStore: Store;
  requestedBy: Pick<User, "id" | "name"> | null;
  approvedBy: Pick<User, "id" | "name"> | null;
  items: TransferItem[];
  history: TransferHistory[];
  dispatch: Dispatch | null;
};

// resumo leve para listagens
export type TransferSummary = Pick<
  Transfer,
  "id" | "priority" | "status" | "fromStoreId" | "toStoreId" | "requestedAt"
> & {
  fromStore: Pick<Store, "code" | "name">;
  toStore: Pick<Store, "code" | "name">;
  itemCount: number;
};

export type DispatchWithRelations = Dispatch & {
  deliveryRequest: Pick<DeliveryRequest, "id" | "invoiceNumber" | "customerName" | "deliveryAddress"> | null;
  transfer: (Pick<Transfer, "id" | "priority"> & {
    fromStore: Pick<Store, "code" | "name">;
    toStore: Pick<Store, "code" | "name">;
  }) | null;
  store: Store;
  driver: Driver | null;
  route: Route | null;
  lalamoveOrder: LalamoveOrder | null;
};

export type DriverWithLocation = Driver & {
  store: Pick<Store, "code" | "name">;
  locations: DriverLocation[];
  activeDispatches: number;
};

// ──────────────────────────────────────────────
// DTOs — ENTRADA DE DADOS
// ──────────────────────────────────────────────

// Opção de entrega escolhida pelo vendedor na cotação
export type DeliveryOption =
  | "SAME_DAY"         // hoje via frota interna (sujeito ao corte das 12h)
  | "TOMORROW_FIRST"   // amanhã 1º despacho (sujeito ao corte das 17h30)
  | "TOMORROW_SECOND"  // amanhã 2º despacho
  | "EXPRESS"          // Lalamove/99 — ignora horários de corte
  | "SCHEDULED";       // data agendada pelo vendedor

export interface FreightQuoteInput {
  storeId: string;
  originAddress: string;
  originLat: number;
  originLng: number;
  destAddress: string;
  destLat: number;
  destLng: number;
  deliveryOption: DeliveryOption;
  scheduledFor?: string;          // ISO string — para deliveryOption=SCHEDULED
  cutoffException?: boolean;
  cutoffExceptionReason?: string;
  city?: string;
  state?: string;
  quotedAddress?: string;
  // legado — mantido para backward compat com solicitar-entrega-drawer
  isUrgent?: boolean;
}

export interface FreightQuoteResult {
  distanceKm:               number;
  durationMinutes:          number;
  durationMinutesNoTraffic: number;
  durationInTrafficMinutes: number | null;
  isApproximate:            boolean;
  isTrafficFresh:           boolean;
  warning?:                 string;
  zone:                     FreightZone | null;
  suggestedPrice:           number;
  isUrgent:                 boolean;
  urgentFactor:             number | null;
  estimatedDays:            number;
  deliveryType:             DeliveryType;
  deliveryOption:           DeliveryOption;
  dispatchWindowLabel:      string;          // ex: "1º Despacho (manhã D+1)"
  underConsultation:        boolean;
  quoteId?:                 string;          // preenchido após salvar
  expiresAt?:               string;          // ISO — validade da cotação
}

// Item na listagem de cotações salvas
export interface FreightQuoteSummary {
  id:              string;
  status:          string;
  deliveryOption:  string;
  destAddress:     string;
  city?:           string;
  state?:          string;
  distanceKm:      number;
  suggestedPrice:  number;
  dispatchWindow?: string;
  expiresAt?:      string;
  createdAt:       string;
  store:           { code: string; name: string };
  createdBy:       { name: string };
}

export interface CreateDeliveryRequestInput {
  invoiceNumber: string;
  storeId: string;
  sellerId: string;
  freightQuoteId?: string;
  chargedFreight?: number;
  deliveryType: DeliveryType;
  isComplete: boolean;
  notes?: string;
  scheduledFor?: Date;
}

export interface CreateTransferInput {
  deliveryRequestId?: string;
  fromStoreId: string;
  toStoreId: string;
  priority: TransferPriority;
  requestedById?: string;
  notes?: string;
  items: {
    productCode: string;
    productName: string;
    quantity: number;
    unit?: string;
  }[];
}

export interface UpdateTransferStatusInput {
  status: TransferStatus;
  changedById?: string;
  notes?: string;
  // campos específicos por status
  estimatedArrival?: Date;
  sentItems?: { transferItemId: string; sentQty: number }[];
  receivedItems?: { transferItemId: string; receivedQty: number }[];
  // NF emitida no Citel — OBRIGATÓRIO para acionar citelTakesOver().
  // Sem este campo, qtdComprometida NÃO é liberada mesmo em PREPARING/IN_TRANSIT.
  nfCitelNumero?: string;
}

export interface CreateDispatchInput {
  deliveryRequestId?: string;
  transferId?: string;
  storeId: string;
  modal: DispatchModal;
  driverId?: string;
  routeId?: string;
  estimatedCost?: number;
  dispatchedById: string;
  notes?: string;
}

// ──────────────────────────────────────────────
// DADOS DO ERP (formato esperado da API externa)
// ──────────────────────────────────────────────

export interface ERPInvoice {
  invoiceNumber: string;
  storeCode: string;
  seller: {
    id: string;
    name: string;
  };
  customer: {
    id: string;
    name: string;
    phone?: string;
    document?: string;
  };
  deliveryAddress: {
    street: string;
    complement?: string;
    city: string;
    state: string;
    zipCode: string;
  };
  items: {
    productCode: string;
    productName: string;
    quantity: number;
    unit: string;
  }[];
  totalValue: number;
  issuedAt: string;
}

// dados de um Pedido (PD) retornados pelo ERP
export interface ERPOrder {
  orderNumber: string;
  storeCode: string;
  customer: {
    id: string | null;
    name: string;
    phone: string | null;
    document: string | null;
  };
  deliveryAddress: {
    street: string;
    complement: string | null;
    city: string;
    state: string;
    zipCode: string;
  };
  items: {
    productCode: string;
    productName: string;
    quantity: number;
    unit: string;
  }[];
  totalValue: number;
}

// resposta quando consultamos estoque de um produto por loja
export interface ERPStockByStore {
  productCode: string;
  productName: string;
  availability: {
    storeCode: string;
    storeName: string;
    qty: number;
    available: boolean;
  }[];
}

// ──────────────────────────────────────────────
// LALAMOVE
// ──────────────────────────────────────────────

export interface LalamoveQuoteRequest {
  language: string;
  serviceType: string;
  specialRequests: string[];
  stops: LalamoveStop[];
  item: {
    quantity: string;
    weight: string;
    categories: string[];
    handlingInstructions: string[];
  };
}

export interface LalamoveStop {
  coordinates: { lat: string; lng: string };
  address: string;
  name?: string;
  phone?: string;
}

export interface LalamoveQuoteResponse {
  quotationId: string;
  scheduleAt: string;
  serviceType: string;
  specialRequests: string[];
  expiresAt: string;
  priceBreakdown: {
    base: string;
    totalBeforeOptimization: string;
    total: string;
    currency: string;
  };
  stops: LalamoveStop[];
}

// status possíveis de uma ordem Lalamove
export type LalamoveOrderStatus =
  | "PENDING"
  | "ASSIGNING_DRIVER"
  | "ON_GOING"
  | "PICKED_UP"
  | "COMPLETED"
  | "CANCELLED"
  | "REJECTED"
  | "EXPIRED";

// mapeamento de status Lalamove → interno
export const LALAMOVE_STATUS_MAP: Record<LalamoveOrderStatus, DispatchStatus> = {
  PENDING: DispatchStatus.PENDING,
  ASSIGNING_DRIVER: DispatchStatus.PENDING,
  ON_GOING: DispatchStatus.ASSIGNED,
  PICKED_UP: DispatchStatus.IN_TRANSIT,
  COMPLETED: DispatchStatus.COMPLETED,
  CANCELLED: DispatchStatus.FAILED,
  REJECTED: DispatchStatus.FAILED,
  EXPIRED: DispatchStatus.FAILED,
};

// ──────────────────────────────────────────────
// DASHBOARD / KPIs
// ──────────────────────────────────────────────

export interface LogisticsDashboardData {
  // entregas
  pendingDeliveries: number;
  deliveriesToday: number;
  deliveriesInTransit: number;
  deliveredToday: number;
  // transferências
  pendingTransfers: number;
  transfersInTransit: number;
  urgentTransfers: number;
  // divergências operacionais (bloqueia READY enquanto > 0)
  pendingDivergences: number;
  // despacho
  pendingDispatches: number;
  lalamoveActiveOrders: number;
  // motoristas
  activeDrivers: number;
  availableDrivers: number;
  // financeiro (auditoria)
  avgFreightDeviation: number | null;  // média de desvio cobrado vs sugerido
  totalFreightBilled: number;
  totalFreightCost: number;
}

// ──────────────────────────────────────────────
// KPIs DE AUDITORIA DE FRETE
// ──────────────────────────────────────────────

export interface FreightKPIs {
  period: { from: string; to: string };
  financial: {
    totalFreightCharged: number;
    totalLogisticsCost: number;
    netSubsidy: number;
    freightAsPercentOfRevenue: number | null;
    avgCostPerDelivery: number;
  };
  operational: {
    totalDeliveries: number;
    urgentPercent: number;
    lalamovePercent: number;
    avgDurationMin: number | null;
    haversinePercent: number | null;
  };
  audit: {
    avgDeviationPercent: number | null;
    pendingJustifications: number;
    withinRulePercent: number | null;
    aboveRulePercent: number | null;
    belowRulePercent: number | null;
  };
  sellerRanking: {
    sellerId: string;
    sellerName: string;
    avgDeviationPercent: number;
    deliveryCount: number;
  }[];
}

// ──────────────────────────────────────────────
// RESPOSTAS DA API
// ──────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  success: true;
}

export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
  success: false;
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

// helper para criar respostas padronizadas
export function apiSuccess<T>(data: T): ApiResponse<T> {
  return { data, success: true };
}

export function apiError(error: string, code?: string, details?: unknown): ApiError {
  return { error, code, details, success: false };
}
