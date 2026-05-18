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
// DETALHE DO PRODUTO
// Baseado em GET /produto/{codigoProduto}
// Campos retornados pelo Citel/Autcom para
// peso, código de barras, marca, giro, etc.
// ──────────────────────────────────────────────

export interface CitelProdutoDetalhe {
  codigo:         string;
  descricao:      string;
  marca:          string | null;
  unidade:        string;          // UN, BD, GL, LT, SC, CX, etc.
  codigoBarra:    string | null;   // EAN/código de barras
  pesoBruto:      number | null;   // kg por unidade
  pesoLiquido:    number | null;
  diasSemVenda:   number | null;
  giro:           string | null;   // A, B, C ou código de giro
  grupo:          string | null;   // ex: "TINTA", "SOLVENTE"
  subgrupo:       string | null;
}

// ──────────────────────────────────────────────
// ITEM DO PEDIDO (PD) — enriquecido com detalhe
// ──────────────────────────────────────────────

export interface CitelPedidoItem {
  codigo:         string;
  descricao:      string;
  marca:          string | null;
  quantidade:     number;
  unidade:        string;
  codigoBarra:    string | null;
  pesoBruto:      number | null;   // kg por unidade (do cadastro do produto)
  totalWeight:    number;          // pesoBruto * quantidade (0 se sem peso)
  hasMissingWeight: boolean;       // true quando pesoBruto é null
}

// ──────────────────────────────────────────────
// STATUS DE ESTOQUE DE UM ITEM
// ──────────────────────────────────────────────

export type StockItemStatus =
  | "AVAILABLE"            // saldoDisponivel >= quantidade
  | "RESERVED_ELSEWHERE"  // saldoFisico ok, mas saldoDisponivel < quantidade
  | "UNAVAILABLE"          // saldoFisico < quantidade
  | "ZERO_STOCK"           // saldoDisponivel = 0
  | "CITEL_DOWN"           // não foi possível consultar

// ──────────────────────────────────────────────
// RESULTADO DO ENRIQUECIMENTO DE ITEM
// ──────────────────────────────────────────────

export interface EnrichedDeliveryItem {
  productCode:      string;
  description:      string;
  brand:            string | null;
  quantity:         number;
  unit:             string;
  barcode:          string | null;
  grossWeight:      number | null;
  totalWeight:      number;
  hasMissingWeight: boolean;
  availableStock:   number;
  physicalStock:    number;
  daysWithoutSale:  number | null;
  turnoverClass:    string | null;
  stockStatus:      StockItemStatus;
  availableAtStore: boolean;
  sourceStoreId:    string | null;
}

// ──────────────────────────────────────────────
// RESULTADO DE VALIDAÇÃO DE CAPACIDADE
// ──────────────────────────────────────────────

export type VehicleType = "MOTO" | "FIORINO" | "CAMINHAO" | "VAN" | "CARRO"

export interface VehicleCapacityResult {
  allowed:       boolean;
  blockedReason: string | null;
  suggestedModal: VehicleType | null;
  totalWeightKg: number;
  totalLatas:    number;
  exceedsWeight: boolean;
  exceedsLatas:  boolean;
  hasHeavyUnit:  boolean;  // tem BD/GL/LT que bloqueia moto
}

// ──────────────────────────────────────────────
// STATUS DE VALIDAÇÃO DE ESTOQUE DA SOLICITAÇÃO
// ──────────────────────────────────────────────

export type StockValidationStatus =
  | "VALIDATED"       // tudo consultado e disponível
  | "PARTIAL"         // alguns itens sem estoque suficiente
  | "UNAVAILABLE"     // algum item totalmente sem estoque
  | "CITEL_DOWN"      // Citel indisponível — aguardando validação manual
  | "PENDING"         // ainda não foi consultado

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
// ENDEREÇO NORMALIZADO (Citel)
// Usado em customerAddress e deliveryAddress
// ──────────────────────────────────────────────

export interface CitelEndereco {
  logradouro:  string;
  numero:      string | null;
  complemento: string | null;
  bairro:      string | null;
  cidade:      string;
  estado:      string;
  cep:         string | null;
}

// ──────────────────────────────────────────────
// CABEÇALHO DE PEDIDO (Citel)
// Retornado por GET /pedidovenda/{numero}/{empresa}
//
// customerAddress = endereço do cadastro do cliente (sede, escritório)
// deliveryAddress = endereço de entrega da obra/pedido (campo enderecoEntrega)
//                  null quando a Citel não informa endereço alternativo
// ──────────────────────────────────────────────

export interface CitelPedidoCabecalho {
  numeroPedido:     string;
  codigoEmpresa:    string;
  nomeCliente:      string;
  documento:        string | null;   // CPF ou CNPJ (campo numeroDocumento no Citel)
  telefone:         string | null;
  celular:          string | null;
  email:            string | null;
  customerAddress:  CitelEndereco;   // endereço do cadastro do cliente
  deliveryAddress:  CitelEndereco | null; // endereço da obra — null se não informado
  valorTotal:       number | null;
  status:           string | null;
  quantidadeItens:  number;          // qtd de produtos distintos no pedido
  pesoBrutoTotal:   number | null;   // soma do peso bruto do pedido (kg) — do campo pesoBruto
  jaFaturado:       boolean;         // pedido já virou NF
  cancelado:        boolean;         // bandeira de cancelamento na raiz do response
  /** true quando o checkbox "entrega CD" foi marcado no Autcom — expedição vai pelo CD */
  entregaPeloCD:    boolean;
  /** código da empresa CD que vai expedir (ex: "132" para Vila Andrade). Null quando entregaPeloCD=false */
  codigoEmpresaCD:  string | null;
}

// ──────────────────────────────────────────────
// VALIDAÇÃO DE STATUS DO PEDIDO ERP
// ──────────────────────────────────────────────

export type ERPOrderValidationStatus =
  | "VALID"              // pedido pode gerar entrega
  | "CANCELLED"          // pedido cancelado
  | "BLOCKED"            // bloqueio financeiro/crédito
  | "APPROVAL_PENDING"   // aguardando aprovação comercial
  | "ALREADY_FULFILLED"  // já faturado ou encerrado
  | "ERP_UNAVAILABLE"    // Citel inacessível
  | "NOT_FOUND"          // pedido não existe

export type DeliveryAddressSource =
  | "ORDER_DELIVERY_ADDRESS"  // campo enderecoEntrega da Citel (obra)
  | "CUSTOMER_MAIN_ADDRESS"   // fallback para endereço do cliente
  | "MANUAL_OVERRIDE"         // operador editou manualmente
  | "QUOTE_ADDRESS"           // endereço veio da cotação salva (prioritário sobre ERP)

// ──────────────────────────────────────────────
// RESULTADO DA CONSULTA DE PEDIDO (erp/pedido)
// Retornado por GET /api/erp/pedido
// ──────────────────────────────────────────────

export interface ErpPedidoResult {
  numeroPedido:         string;
  erpOrderStatus:       string | null;
  erpValidationStatus:  ERPOrderValidationStatus;
  customerName:         string;
  customerPhone:        string;
  customerDocument:     string | null;
  customerAddressObj:   CitelEndereco;
  customerAddressStr:   string;
  deliveryAddressObj:   CitelEndereco;
  deliveryAddressStr:   string;
  deliveryAddressSource: DeliveryAddressSource;
  isAlternateDelivery:  boolean;  // true quando endereço de entrega ≠ endereço do cliente
  totalValue:           number | null;
  totalWeightKg:        number;
  itemCount:            number;
  stockSummary: {
    available: number;
    reserved:  number;
    missing:   number;
    unknown:   number;
  };
  items:       unknown[];  // EnrichedDeliveryItem[]
  cacheHit:    boolean;
  fetchedInMs: number;
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
