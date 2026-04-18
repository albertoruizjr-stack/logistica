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

export interface FreightQuoteInput {
  storeId: string;
  originAddress: string;
  originLat: number;
  originLng: number;
  destAddress: string;
  destLat: number;
  destLng: number;
  isUrgent: boolean;
}

export interface FreightQuoteResult {
  distanceKm: number;
  durationMinutes: number;       // duração real de rota em minutos (ou estimativa)
  isApproximate: boolean;        // true = fallback Haversine — dado não é rota real
  warning?: string;              // mensagem de alerta quando isApproximate = true
  zone: FreightZone | null;
  suggestedPrice: number;
  isUrgent: boolean;
  urgentFactor: number | null;
  estimatedDays: number;
  deliveryType: DeliveryType;
  underConsultation: boolean;
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
