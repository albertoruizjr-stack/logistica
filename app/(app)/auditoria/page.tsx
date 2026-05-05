"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AlertOctagon, CheckCircle2, AlertTriangle, ArrowUpDown,
  MessageSquare, TrendingUp, TrendingDown, Truck, Clock,
  AlertCircle, BarChart3,
} from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui";

// ──────────────────────────────────────────────
// TIPOS
// ──────────────────────────────────────────────

interface AuditItem {
  id: string;
  invoiceNumber: string | null;
  storeId: string;
  suggestedFreight: number | null;
  chargedFreight: number | null;
  freightDeviation: number | null;
  deviationPercent: number | null;
  deviationClassification: "WITHIN_RULE" | "BELOW_RULE" | "ABOVE_RULE" | null;
  justificationRequired: boolean;
  justification: string | null;
  justifiedAt: string | null;
  routeSource: "GOOGLE_MAPS" | "HAVERSINE" | null;
  createdAt: string;
  deliveryRequest: { invoiceNumber: string; customerName: string } | null;
  seller: { id: string; name: string } | null;
  justifiedBy: { id: string; name: string } | null;
}

interface KPIData {
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
}

interface AuditListResponse {
  items: AuditItem[];
  total: number;
  page: number;
  totalPages: number;
}

// ──────────────────────────────────────────────
// CLASSIFICAÇÃO — BADGE
// ──────────────────────────────────────────────

function DeviationBadge({
  classification,
  percent,
}: {
  classification: AuditItem["deviationClassification"];
  percent: number | null;
}) {
  if (!classification || percent === null) {
    return <span className="text-xs text-gray-400">—</span>;
  }

  const configs = {
    WITHIN_RULE: {
      color: "bg-green-100 text-green-800 border-green-200",
      label: "Dentro da regra",
      icon: CheckCircle2,
    },
    BELOW_RULE: {
      color: "bg-yellow-100 text-yellow-800 border-yellow-200",
      label: "Abaixo (subsídio)",
      icon: AlertTriangle,
    },
    ABOVE_RULE: {
      color: "bg-red-100 text-red-800 border-red-200",
      label: "Acima (overcharge)",
      icon: AlertOctagon,
    },
  };
  const config = configs[classification];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium",
        config.color
      )}
    >
      <Icon className="w-3 h-3" />
      {percent > 0 ? "+" : ""}
      {percent.toFixed(1)}%
    </span>
  );
}

// ──────────────────────────────────────────────
// MODAL DE JUSTIFICATIVA
// ──────────────────────────────────────────────

function JustificationModal({
  auditId,
  invoiceNumber,
  onClose,
  onSaved,
}: {
  auditId: string;
  invoiceNumber: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (text.trim().length < 10) {
      setError("Justificativa deve ter pelo menos 10 caracteres.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/auditoria/frete/${auditId}/justificativa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ justification: text }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Erro ao salvar");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar justificativa");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare className="w-5 h-5 text-orange-500" />
          <h2 className="font-bold text-gray-900">Justificativa de Desvio</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          NF <strong>{invoiceNumber}</strong> — O frete cobrado está acima da tolerância.
          Esta justificativa será registrada com seu usuário e data/hora.
        </p>
        <textarea
          className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
          rows={4}
          placeholder="Descreva o motivo do desvio (mínimo 10 caracteres)..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
        <div className="flex gap-3 mt-4">
          <button
            onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold py-2 rounded-lg text-sm transition"
          >
            {saving ? "Salvando..." : "Salvar Justificativa"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// PÁGINA PRINCIPAL
// ──────────────────────────────────────────────

export default function AuditoriaPage() {
  const [data, setData] = useState<AuditListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<KPIData | null>(null);
  const [page, setPage] = useState(1);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [classification, setClassification] = useState("");
  const [modalAudit, setModalAudit] = useState<{
    id: string;
    invoiceNumber: string;
  } | null>(null);

  useEffect(() => {
    fetch("/api/auditoria/kpis")
      .then((r) => r.json())
      .then((json) => { if (json.success) setKpis(json.data); })
      .catch(() => {});
  }, []);

  const fetchAudits = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "50",
        ...(pendingOnly ? { pendente: "true" } : {}),
        ...(classification ? { classification } : {}),
      });
      const res = await fetch(`/api/auditoria/frete?${params}`);
      const json = await res.json();
      if (json.success) setData(json.data);
    } finally {
      setLoading(false);
    }
  }, [page, pendingOnly, classification]);

  useEffect(() => {
    fetchAudits();
  }, [fetchAudits]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Auditoria de Frete"
        description="Controle de desvio entre frete sugerido e cobrado — últimos 30 dias"
        actions={
          kpis?.audit.pendingJustifications ? (
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
              {kpis.audit.pendingJustifications} pendente{kpis.audit.pendingJustifications > 1 ? "s" : ""}
            </span>
          ) : undefined
        }
      />

      {/* KPIs */}
      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">

          {/* Frete cobrado total */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-gray-400" />
              <span className="text-xs text-gray-500 font-medium">Frete cobrado</span>
            </div>
            <p className="text-xl font-bold text-gray-900">
              {formatCurrency(kpis.financial.totalFreightCharged)}
            </p>
            {kpis.financial.freightAsPercentOfRevenue != null && (
              <p className="text-xs text-gray-400 mt-0.5">
                {kpis.financial.freightAsPercentOfRevenue.toFixed(1)}% da receita
              </p>
            )}
          </div>

          {/* Dentro da regra */}
          <div className={cn(
            "rounded-xl border p-4",
            kpis.audit.withinRulePercent != null && kpis.audit.withinRulePercent >= 80
              ? "bg-green-50 border-green-200"
              : "bg-yellow-50 border-yellow-200"
          )}>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className={cn(
                "w-4 h-4",
                kpis.audit.withinRulePercent != null && kpis.audit.withinRulePercent >= 80
                  ? "text-green-500"
                  : "text-yellow-500"
              )} />
              <span className="text-xs text-gray-600 font-medium">Dentro da regra</span>
            </div>
            <p className="text-xl font-bold text-gray-900">
              {kpis.audit.withinRulePercent != null
                ? `${kpis.audit.withinRulePercent.toFixed(0)}%`
                : "—"}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              desvio médio {kpis.audit.avgDeviationPercent != null
                ? `${kpis.audit.avgDeviationPercent > 0 ? "+" : ""}${kpis.audit.avgDeviationPercent.toFixed(1)}%`
                : "—"}
            </p>
          </div>

          {/* Pendentes de justificativa */}
          <div className={cn(
            "rounded-xl border p-4",
            kpis.audit.pendingJustifications > 0
              ? "bg-red-50 border-red-200"
              : "bg-white border-gray-200"
          )}>
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className={cn(
                "w-4 h-4",
                kpis.audit.pendingJustifications > 0 ? "text-red-500" : "text-gray-400"
              )} />
              <span className="text-xs text-gray-600 font-medium">Pendentes</span>
            </div>
            <p className={cn(
              "text-xl font-bold",
              kpis.audit.pendingJustifications > 0 ? "text-red-700" : "text-gray-900"
            )}>
              {kpis.audit.pendingJustifications}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">aguardando justificativa</p>
          </div>

          {/* Operacional */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Truck className="w-4 h-4 text-gray-400" />
              <span className="text-xs text-gray-500 font-medium">Operacional</span>
            </div>
            <p className="text-xl font-bold text-gray-900">
              {kpis.operational.totalDeliveries}
            </p>
            <div className="text-xs text-gray-400 mt-0.5 space-y-0.5">
              <p>{kpis.operational.urgentPercent.toFixed(0)}% urgentes</p>
              {kpis.operational.lalamovePercent > 0 && (
                <p>{kpis.operational.lalamovePercent.toFixed(0)}% Lalamove</p>
              )}
              {kpis.operational.haversinePercent != null &&
                kpis.operational.haversinePercent > 10 && (
                  <p className="text-amber-500">
                    {kpis.operational.haversinePercent.toFixed(0)}% distância estimada
                  </p>
                )}
            </div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 mb-5">
        <label
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition",
            pendingOnly
              ? "bg-red-50 border-red-300 text-red-700 font-medium"
              : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
          )}
        >
          <input
            type="checkbox"
            className="w-3.5 h-3.5 accent-red-500"
            checked={pendingOnly}
            onChange={(e) => {
              setPendingOnly(e.target.checked);
              setPage(1);
            }}
          />
          Apenas pendentes de justificativa
        </label>

        <select
          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
          value={classification}
          onChange={(e) => {
            setClassification(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todas as classificações</option>
          <option value="ABOVE_RULE">Acima da regra (overcharge)</option>
          <option value="WITHIN_RULE">Dentro da regra</option>
          <option value="BELOW_RULE">Abaixo (subsídio)</option>
        </select>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">
                  Pedido
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">
                  Vendedor
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">
                  Sugerido
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">
                  Cobrado
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">
                  <span className="flex items-center justify-end gap-1">
                    <ArrowUpDown className="w-3 h-3" /> Desvio
                  </span>
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500">
                  Classificação
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500">
                  Rota
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500">
                  Status
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-gray-400 text-sm">
                    Carregando...
                  </td>
                </tr>
              ) : data?.items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-gray-400 text-sm">
                    Nenhum registro encontrado
                  </td>
                </tr>
              ) : (
                data?.items.map((item) => (
                  <tr
                    key={item.id}
                    className={cn(
                      "hover:bg-gray-50 transition-colors",
                      item.justificationRequired &&
                        !item.justification &&
                        "bg-red-50/30"
                    )}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">
                        NF{" "}
                        {item.deliveryRequest?.invoiceNumber ?? item.invoiceNumber}
                      </p>
                      <p className="text-xs text-gray-400 truncate max-w-[140px]">
                        {item.deliveryRequest?.customerName ?? "—"}
                      </p>
                      <p className="text-xs text-gray-300">
                        {new Date(item.createdAt).toLocaleDateString("pt-BR")}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {item.seller?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {item.suggestedFreight != null
                        ? formatCurrency(item.suggestedFreight)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {item.chargedFreight != null
                        ? formatCurrency(item.chargedFreight)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item.freightDeviation != null ? (
                        <span
                          className={cn(
                            "font-semibold",
                            item.freightDeviation > 0
                              ? "text-red-600"
                              : item.freightDeviation < 0
                              ? "text-yellow-600"
                              : "text-green-600"
                          )}
                        >
                          {item.freightDeviation > 0 ? "+" : ""}
                          {formatCurrency(item.freightDeviation)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <DeviationBadge
                        classification={item.deviationClassification}
                        percent={item.deviationPercent}
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.routeSource === "HAVERSINE" ? (
                        <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded border border-yellow-200 font-medium">
                          ~estimada
                        </span>
                      ) : item.routeSource === "GOOGLE_MAPS" ? (
                        <span className="text-xs text-green-600">Maps ✓</span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.justificationRequired ? (
                        item.justification ? (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full border border-green-200">
                            Justificado
                          </span>
                        ) : (
                          <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full border border-red-200 font-medium animate-pulse">
                            Pendente
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item.justificationRequired && !item.justification && (
                        <button
                          onClick={() =>
                            setModalAudit({
                              id: item.id,
                              invoiceNumber:
                                item.deliveryRequest?.invoiceNumber ??
                                item.invoiceNumber ??
                                item.id,
                            })
                          }
                          className="text-xs bg-orange-500 hover:bg-orange-600 text-white px-3 py-1 rounded-lg font-medium transition"
                        >
                          Justificar
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              {data.total} registros · página {data.page} de {data.totalPages}
            </p>
            <div className="flex gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition"
              >
                Anterior
              </button>
              <button
                disabled={page === data.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal de justificativa */}
      {modalAudit && (
        <JustificationModal
          auditId={modalAudit.id}
          invoiceNumber={modalAudit.invoiceNumber}
          onClose={() => setModalAudit(null)}
          onSaved={() => {
            setModalAudit(null);
            fetchAudits();
          }}
        />
      )}
    </div>
  );
}
