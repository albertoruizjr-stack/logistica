// Tipos para o Pilar 1 — Estoque Comprometido
// O StockLedger cobre apenas o gap PENDING→NF:
// o período em que o sistema_logistica aprovou uma transferência
// mas o Citel ainda não tem documento correspondente.

// ──────────────────────────────────────────────
// RESPOSTA DO CITEL
// Baseado nos campos retornados por
// GET /produtoEstoqueCodigo/{codigoProduto}
// ──────────────────────────────────────────────

export interface CitelEstoqueEmpresa {
  codigoEmpresa: string;
  saldoFisico: number;
  saldoDisponivel: number;           // físico − todas as reservas internas do Citel
  saldoReservadoPedido: number;
  saldoReservadoPedidoFilial: number; // transferências entre filiais com NF no Citel
  saldoReservadoExterno: number;
  saldoReservadoEnderecamento: number;
  saldoEntregaFuturaAguardando: number;
  estoqueMinimo: number;
  estoqueMaximo: number;
}

export interface CitelEstoqueProduto {
  codigoProduto: string;
  descricaoProduto?: string;
  saldoEmpresas: CitelEstoqueEmpresa[];
}

// ──────────────────────────────────────────────
// SNAPSHOT DE ESTOQUE (visão consolidada)
// saldoDisponivelReal = Citel.saldoDisponivel − ledger.qtdComprometida
// ──────────────────────────────────────────────

export interface StockSnapshot {
  storeId: string;
  storeCode: string;
  storeName: string;
  codigoEmpresaCitel: string;
  productCode: string;
  productName: string;
  // do Citel (fonte de verdade para estoque físico)
  saldoFisico: number;
  saldoDisponivelCitel: number;
  // do StockLedger (gap que o Citel ainda não enxerga)
  qtdComprometida: number;           // transfers PENDING/APPROVED sem NF
  qtdEmTransito: number;             // transfers IN_TRANSIT a caminho desta loja
  // calculado
  saldoDisponivelReal: number;       // saldoDisponivelCitel − qtdComprometida
  ledgerSyncedAt: Date | null;
}

// ──────────────────────────────────────────────
// OPERAÇÕES DO LEDGER
// ──────────────────────────────────────────────

export interface StockCommitInput {
  storeId: string;
  productCode: string;
  productName: string;
  qty: number;
  transferId: string;
  operatorId?: string;
}

export interface StockCommitResult {
  success: boolean;
  saldoDisponivelReal?: number;      // disponível após o commit (para exibir ao usuário)
  error?: "INSUFFICIENT_STOCK" | "CITEL_UNAVAILABLE" | "CONCURRENT_CONFLICT";
  detail?: {
    saldoDisponivelCitel: number;
    qtdComprometida: number;
    qtdSolicitada: number;
  };
}

export interface StockReconcileInput {
  transferId: string;
  sendingStoreId: string;
  receivingStoreId: string;
  items: {
    transferItemId: string;
    productCode: string;
    productName: string;
    sentQty: number;
    receivedQty: number;
  }[];
  operatorId?: string;
}

export interface StockReconcileResult {
  hasDivergence: boolean;
  divergences: {
    transferItemId: string;
    productCode: string;
    sentQty: number;
    receivedQty: number;
    divergenceQty: number;           // positivo = faltou, negativo = sobrou
  }[];
}

export type ResolutionType = "MISSING_PRODUCT" | "EXTRA_PRODUCT" | "OPERATIONAL_ERROR";

export interface DivergenceResolveInput {
  divergenceId: string;
  resolutionType: ResolutionType;
  resolution: string;
  resolvedById: string;
}

// ──────────────────────────────────────────────
// SYNC DO ERP
// ──────────────────────────────────────────────

export interface ErpSyncItem {
  storeId: string;
  codigoEmpresaCitel: string;
  productCode: string;
  productName: string;
  saldoFisico: number;
  saldoDisponivelCitel: number;
}

export interface ErpSyncResult {
  synced: number;
  created: number;
  errors: number;
  syncedAt: Date;
}
