"use client";

import { useEffect, useState } from "react";
import { Loader2, Search, X, Check, AlertTriangle } from "lucide-react";

interface Candidate {
  numeroDocumento: string;
  codigoEmpresa:   string;
  dataEntrada:     string;
  cliente:         string;
  jaFaturado:      boolean;
  itemMatch: {
    codigoProduto:    string;
    descricaoProduto: string;
    quantidade:       number;
    unidade:          string;
  };
}

interface Props {
  transferId: string;
  itemId:     string;
  productCode: string;
  productName: string;
  neededQty:   number;
  unit:        string;
  onClose:     () => void;
  onLinked:    (allLinked: boolean) => void;
}

export function TransferItemLinkModal({
  transferId, itemId, productCode, productName, neededQty, unit, onClose, onLinked,
}: Props) {
  const [candidates,    setCandidates]    = useState<Candidate[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [linkingNumber, setLinkingNumber] = useState<string | null>(null);
  // input manual + probe
  const [manualPdInput, setManualPdInput] = useState("");
  const [probing,       setProbing]       = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/transferencias/${transferId}/items/${itemId}/candidates`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return;
        if (!json.success) setError(json.error ?? "Falha ao buscar candidatos");
        else setCandidates(json.data.candidates ?? []);
      })
      .catch(() => { if (!cancelled) setError("Erro de conexão"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [transferId, itemId]);

  // ESC fecha
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !linkingNumber) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, linkingNumber]);

  async function linkPd(numeroPedido: string, storeCode: string) {
    setLinkingNumber(numeroPedido);
    setError(null);
    try {
      const res = await fetch(`/api/transferencias/${transferId}/items/${itemId}/link-pd`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numeroPedido, storeCode }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? "Não foi possível vincular");
        setLinkingNumber(null);
        return;
      }
      onLinked(Boolean(json.data?.allItemsLinked));
      onClose();
    } catch {
      setError("Erro de conexão");
      setLinkingNumber(null);
    }
  }

  async function handleLink(c: Candidate) {
    if (linkingNumber || probing) return;
    await linkPd(c.numeroDocumento, c.codigoEmpresa);
  }

  async function handleManualProbe() {
    const num = manualPdInput.trim();
    if (!num || probing || linkingNumber) return;
    setProbing(true);
    setError(null);
    try {
      const res = await fetch(`/api/transferencias/${transferId}/items/${itemId}/probe-pd`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numeroPedido: num }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? "PD não encontrado");
        setProbing(false);
        return;
      }
      // achou — vincula direto
      await linkPd(json.data.numeroPedido, json.data.storeCode);
    } catch {
      setError("Erro de conexão");
    } finally {
      setProbing(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[2px]" onClick={() => !linkingNumber && onClose()} />

      <div className="fixed inset-0 z-[61] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
             style={{ border: "1px solid var(--color-border)" }}>

          {/* Header */}
          <div className="px-5 py-3.5 border-b flex items-start justify-between gap-3 flex-shrink-0"
               style={{ borderColor: "var(--color-border)" }}>
            <div className="min-w-0">
              <h2 className="text-[14px] font-bold leading-tight"
                  style={{ fontFamily: "var(--font-display)", color: "var(--color-body-text)" }}>
                Buscar transferência criada no Autcom
              </h2>
              <p className="text-[11.5px] mt-1 leading-tight" style={{ color: "var(--color-muted-text)" }}>
                <span className="font-mono">{productCode}</span> · {productName} · {neededQty} {unit}
              </p>
            </div>
            <button onClick={onClose}
                    disabled={!!linkingNumber}
                    className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 disabled:opacity-50">
              <X className="w-4 h-4" style={{ color: "var(--color-muted-text)" }} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4">

            {/* Input manual sempre disponível — caso o auto-busca não pegue */}
            <div className="mb-4 rounded-lg p-3"
                 style={{ backgroundColor: "rgba(99,102,241,0.04)", border: "1px solid rgba(99,102,241,0.18)" }}>
              <p className="text-[10.5px] font-semibold uppercase mb-2"
                 style={{ letterSpacing: "0.10em", color: "#4338CA" }}>
                Já sabe o número?
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Ex: 3415"
                  value={manualPdInput}
                  onChange={(e) => setManualPdInput(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => { if (e.key === "Enter") handleManualProbe(); }}
                  disabled={probing || !!linkingNumber}
                  className="flex-1 px-2.5 py-1.5 rounded-md text-[12px] border outline-none disabled:opacity-50 font-mono"
                  style={{ borderColor: "var(--color-border)", backgroundColor: "white" }}
                />
                <button
                  onClick={handleManualProbe}
                  disabled={!manualPdInput.trim() || probing || !!linkingNumber}
                  className="px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  style={{ backgroundColor: "#6366F1", color: "white" }}>
                  {probing
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> Buscando</>
                    : <><Search className="w-3 h-3" /> Buscar</>}
                </button>
              </div>
              <p className="text-[10px] mt-1.5" style={{ color: "var(--color-muted-text)" }}>
                Digite o número e clique em Buscar — testamos nas 5 lojas e validamos cliente/produto.
              </p>
            </div>

            {loading && (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-primary)" }} />
                <p className="text-[11.5px]" style={{ color: "var(--color-muted-text)" }}>
                  Buscando PDs da Atual Tintas no Autcom…
                </p>
              </div>
            )}

            {!loading && error && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg"
                   style={{ backgroundColor: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.20)" }}>
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "#B91C1C" }} />
                <p className="text-[12px]" style={{ color: "#B91C1C" }}>{error}</p>
              </div>
            )}

            {!loading && !error && candidates.length === 0 && (
              <div className="flex flex-col items-center text-center py-10 gap-2 px-4">
                <Search className="w-8 h-8" style={{ color: "#D1D5DB" }} />
                <p className="text-[13px] font-semibold" style={{ color: "var(--color-body-text)" }}>
                  Nenhum PD encontrado
                </p>
                <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--color-muted-text)" }}>
                  Não achei nenhum pedido recente da <b>Atual Tintas</b> contendo o produto{" "}
                  <span className="font-mono">{productCode}</span> nas 5 lojas. Confirme se você já criou a transferência no Autcom.
                </p>
              </div>
            )}

            {!loading && candidates.length > 0 && (
              <>
                <p className="text-[11px] mb-2.5 px-1" style={{ color: "var(--color-muted-text)" }}>
                  {candidates.length} {candidates.length === 1 ? "PD encontrado" : "PDs encontrados"} — selecione o correto:
                </p>
                <ul className="space-y-2">
                  {candidates.map((c, i) => {
                    const isLinking = linkingNumber === c.numeroDocumento;
                    return (
                      <li key={i}>
                        <button
                          onClick={() => handleLink(c)}
                          disabled={!!linkingNumber || c.jaFaturado}
                          className="w-full text-left rounded-lg px-3.5 py-3 transition-all hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3"
                          style={{ border: "1px solid var(--color-border)", backgroundColor: "white" }}
                          onMouseEnter={(e) => {
                            if (linkingNumber || c.jaFaturado) return;
                            (e.currentTarget as HTMLElement).style.borderColor = "#F97316";
                            (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(249,115,22,0.03)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border)";
                            (e.currentTarget as HTMLElement).style.backgroundColor = "white";
                          }}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="font-mono text-[13px] font-bold"
                                    style={{ color: "var(--color-body-text)" }}>
                                PD {c.numeroDocumento.replace(/^0+/, "")}
                              </span>
                              <span className="text-[10.5px] font-medium px-1.5 py-0.5 rounded"
                                    style={{ backgroundColor: "rgba(99,102,241,0.10)", color: "#4338CA" }}>
                                Loja {c.codigoEmpresa}
                              </span>
                              {c.jaFaturado && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                                      style={{ backgroundColor: "rgba(115,115,115,0.10)", color: "#525252" }}>
                                  JÁ FATURADO
                                </span>
                              )}
                            </div>
                            <p className="text-[11px]" style={{ color: "var(--color-muted-text)" }}>
                              {c.itemMatch.quantidade} {c.itemMatch.unidade}
                              <span className="mx-1.5">·</span>
                              {c.dataEntrada}
                            </p>
                          </div>
                          {isLinking
                            ? <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: "var(--color-primary)" }} />
                            : <Check className="w-4 h-4 flex-shrink-0" style={{ color: "var(--color-primary)" }} />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t text-[10.5px] flex-shrink-0"
               style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg)", color: "var(--color-muted-text)" }}>
            Mostrando PDs da rede Atual Tintas (CNPJ 42.194.537/****-**) dos últimos 7 dias, em todas as 5 lojas.
          </div>
        </div>
      </div>
    </>
  );
}
