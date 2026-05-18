"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  MapPin, Clock, Truck, Zap, Calendar, CheckCircle2,
  XCircle, AlertCircle, RotateCcw, Package, Filter,
  ChevronLeft, ChevronRight, Search,
} from "lucide-react";
import { cn, formatCurrency, formatDistance } from "@/lib/utils";
import { SolicitarEntregaDrawer } from "@/components/cotacao/solicitar-entrega-drawer";

interface Quote {
  id:             string;
  status:         string;
  deliveryOption: string | null;
  destAddress:    string;
  city?:          string;
  state?:         string;
  distanceKm:     number;
  suggestedPrice: number;
  dispatchWindow?: string;
  isUrgent:       boolean;
  storeId:        string;
  expiresAt?:     string;
  createdAt:      string;
  store:          { code: string; name: string };
  createdBy:      { name: string };
}

interface Pagination {
  items:  Quote[];
  total:  number;
  page:   number;
  pages:  number;
  limit:  number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  DRAFT:     { label: "Rascunho",    color: "bg-gray-100 text-gray-600",    icon: <Clock className="w-3 h-3" /> },
  QUOTED:    { label: "Aberta",      color: "bg-green-100 text-green-700",  icon: <CheckCircle2 className="w-3 h-3" /> },
  CONVERTED: { label: "Convertida",  color: "bg-blue-100 text-blue-700",    icon: <Package className="w-3 h-3" /> },
  EXPIRED:   { label: "Expirada",    color: "bg-amber-100 text-amber-700",  icon: <AlertCircle className="w-3 h-3" /> },
  CANCELLED: { label: "Cancelada",   color: "bg-red-100 text-red-700",      icon: <XCircle className="w-3 h-3" /> },
};

const OPTION_CONFIG: Record<string, { label: string; icon: React.ReactNode; urgent: boolean }> = {
  SAME_DAY:        { label: "Hoje — Same Day",     icon: <Zap className="w-3 h-3" />,      urgent: true },
  TOMORROW_FIRST:  { label: "Amanhã 1º Despacho",  icon: <Truck className="w-3 h-3" />,    urgent: false },
  TOMORROW_SECOND: { label: "Amanhã 2º Despacho",  icon: <Truck className="w-3 h-3" />,    urgent: false },
  EXPRESS:         { label: "Expressa Lalamove",    icon: <Zap className="w-3 h-3" />,      urgent: true },
  SCHEDULED:       { label: "Agendada",             icon: <Calendar className="w-3 h-3" />, urgent: false },
};

const STATUS_FILTERS = [
  { value: "",          label: "Todas" },
  { value: "open",      label: "Abertas" },
  { value: "CONVERTED", label: "Convertidas" },
  { value: "EXPIRED",   label: "Expiradas" },
  { value: "CANCELLED", label: "Canceladas" },
];

interface Props {
  initialStoreId?: string;
  isAdmin:         boolean;
  stores:          { id: string; code: string; name: string }[];
}

export function QuotesList({ initialStoreId, isAdmin, stores }: Props) {
  const router  = useRouter();
  const [data,        setData]        = useState<Pagination | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [mine,        setMine]        = useState(true);
  const [storeId,     setStoreId]     = useState(initialStoreId ?? "");
  const [status,      setStatus]      = useState("");
  const [search,      setSearch]      = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page,        setPage]        = useState(1);
  // Quote sendo convertida — abre o drawer direto sem refazer a cotação
  const [convertingQuote, setConvertingQuote] = useState<Quote | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        mine:  String(mine),
        page:  String(page),
        ...(storeId ? { storeId } : {}),
        ...(status  ? { status }  : {}),
        ...(search  ? { search }  : {}),
      });
      const res  = await fetch(`/api/frete/cotacoes?${params}`);
      const json = await res.json();
      if (json.success) setData(json.data);
    } finally {
      setLoading(false);
    }
  }, [mine, page, storeId, status, search]);

  useEffect(() => { load(); }, [load]);

  function handleSearch() {
    setSearch(searchInput);
    setPage(1);
  }

  async function handleCancel(id: string) {
    if (!confirm("Cancelar esta cotação?")) return;
    await fetch(`/api/frete/cotacoes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED" }),
    });
    load();
  }

  function handleConverter(q: Quote) {
    // Abre o drawer de solicitação direto, sem refazer a cotação.
    setConvertingQuote(q);
  }

  const items = data?.items ?? [];

  return (
    <>
    <div className="space-y-4">
      {/* ── Filtros ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap gap-3">
          {/* Minhas / todas */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            <button
              onClick={() => { setMine(true); setPage(1); }}
              className={cn("px-3 py-1.5 font-medium transition", mine ? "bg-orange-500 text-white" : "text-gray-600 hover:bg-gray-50")}
            >
              Minhas
            </button>
            {isAdmin && (
              <button
                onClick={() => { setMine(false); setPage(1); }}
                className={cn("px-3 py-1.5 font-medium transition border-l", !mine ? "bg-orange-500 text-white" : "text-gray-600 hover:bg-gray-50")}
              >
                Todas
              </button>
            )}
          </div>

          {/* Status */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => { setStatus(f.value); setPage(1); }}
                className={cn(
                  "px-3 py-1.5 font-medium transition border-l first:border-l-0",
                  status === f.value ? "bg-gray-800 text-white" : "text-gray-600 hover:bg-gray-50"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Loja (admin) */}
          {isAdmin && stores.length > 0 && (
            <select
              value={storeId}
              onChange={(e) => { setStoreId(e.target.value); setPage(1); }}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
            >
              <option value="">Todas as lojas</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>Loja {s.code} — {s.name}</option>
              ))}
            </select>
          )}

          {/* Busca */}
          <div className="flex gap-1.5 ml-auto">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Buscar endereço ou cidade..."
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm w-52 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            <button
              onClick={handleSearch}
              className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
            >
              <Search className="w-4 h-4 text-gray-600" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Lista ── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <RotateCcw className="w-5 h-5 animate-spin mr-2" /> Carregando cotações...
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Filter className="w-8 h-8 mb-3 opacity-40" />
            <p className="text-sm">Nenhuma cotação encontrada</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3">Destino</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Loja</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Modalidade</th>
                <th className="text-right px-4 py-3 hidden sm:table-cell">Distância</th>
                <th className="text-right px-4 py-3">Valor</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Válida até</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((q) => {
                const st  = STATUS_CONFIG[q.status]  ?? STATUS_CONFIG.DRAFT;
                const opt = q.deliveryOption ? (OPTION_CONFIG[q.deliveryOption] ?? null) : null;
                const expired = q.expiresAt ? new Date(q.expiresAt) < new Date() : false;
                const canConvert = q.status === "QUOTED" && !expired;

                return (
                  <tr key={q.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-medium text-gray-900 leading-tight line-clamp-1">
                            {q.destAddress}
                          </p>
                          {(q.city || q.state) && (
                            <p className="text-xs text-gray-400">
                              {[q.city, q.state].filter(Boolean).join(" / ")}
                            </p>
                          )}
                          <p className="text-xs text-gray-400 mt-0.5">
                            {new Date(q.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                            {" · "}{q.createdBy.name.split(" ")[0]}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs font-semibold text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                        L{q.store.code}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {opt && (
                        <span className={cn(
                          "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
                          opt.urgent ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"
                        )}>
                          {opt.icon} {opt.label}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell">
                      <span className="text-xs text-gray-600">{formatDistance(q.distanceKm)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-bold text-gray-900">{formatCurrency(q.suggestedPrice)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
                        st.color
                      )}>
                        {st.icon} {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {q.expiresAt ? (
                        <span className={cn("text-xs", expired ? "text-red-500" : "text-gray-500")}>
                          {expired
                            ? "Expirada"
                            : new Date(q.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {canConvert && (
                          <button
                            onClick={() => handleConverter(q)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition"
                          >
                            <Package className="w-3.5 h-3.5" />
                            Converter
                          </button>
                        )}
                        {q.status === "QUOTED" && (
                          <button
                            onClick={() => handleCancel(q.id)}
                            title="Cancelar cotação"
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* ── Paginação ── */}
        {data && data.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              {data.total} cotaç{data.total === 1 ? "ão" : "ões"}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-gray-600 px-1">
                {page} / {data.pages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
                disabled={page === data.pages}
                className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>

    {/* Drawer de solicitação — abre quando o usuário clica em "Converter" */}
    {convertingQuote && (
      <SolicitarEntregaDrawer
        open={true}
        onClose={() => setConvertingQuote(null)}
        freightQuoteId={convertingQuote.id}
        storeId={convertingQuote.storeId}
        stores={stores}
        suggestedPrice={convertingQuote.suggestedPrice}
        isUrgent={convertingQuote.isUrgent}
        destAddress={convertingQuote.destAddress}
      />
    )}
    </>
  );
}
