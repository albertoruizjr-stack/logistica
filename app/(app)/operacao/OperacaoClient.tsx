"use client";

import { useState, useCallback, useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { useOperationalQueue } from "@/hooks/useOperationalQueue";
import { MetricsBar }          from "@/components/operacao/MetricsBar";
import { CutoffBar }           from "@/components/operacao/CutoffBar";
import { WorkQueueColumn }     from "@/components/operacao/WorkQueueColumn";
import { ActionModal }         from "@/components/operacao/ActionModal";
import { MarkDeliveredModal }  from "@/components/operacao/MarkDeliveredModal";
import { ClaimConflictModal }  from "@/components/operacao/ClaimConflictModal";
import { CorrigirPedidoModal } from "@/components/operacao/CorrigirPedidoModal";
import { QueueFilterBar }      from "@/components/operacao/QueueFilterBar";
import type {
  OperationalQueuePayload,
  OperationalCard,
  ActionDefinition,
  OperationalAction,
  FilterMode,
} from "@/components/operacao/types";
import type { ClaimInfo } from "@/services/claim.service";

interface OperacaoClientProps {
  initial:         OperationalQueuePayload;
  currentUserId:   string;
  currentUserName: string;
  currentUserRole: string;
  requirePhoto:    boolean;
}

export function OperacaoClient({ initial, currentUserId, currentUserName, currentUserRole, requirePhoto }: OperacaoClientProps) {
  const { data, loading, error, refetch } = useOperationalQueue(initial);

  // Estado do modal de ação
  const [selectedCard,   setSelectedCard]   = useState<OperationalCard | null>(null);
  const [selectedAction, setSelectedAction] = useState<ActionDefinition | null>(null);
  // Estado do modal de conflito
  const [conflictClaim,  setConflictClaim]  = useState<ClaimInfo | null>(null);
  // Estado do modal de correção de pedido
  const [correctingCard, setCorrectingCard] = useState<OperationalCard | null>(null);
  // Estado do filtro
  const [filterMode,     setFilterMode]     = useState<FilterMode>("all");

  // ── Contadores para os filtros ───────────────────────────────────────────

  const filterCounts = useMemo(() => {
    const allCards = data.columns.flatMap((c) => c.cards);
    return {
      all:    allCards.length,
      mine:   allCards.filter((c) => c.lockedBy === currentUserId && c.lockMinutesLeft !== null).length,
      free:   allCards.filter((c) => !c.lockedBy || c.lockMinutesLeft === null).length,
      locked: allCards.filter((c) => c.lockedBy && c.lockedBy !== currentUserId && c.lockMinutesLeft !== null).length,
    };
  }, [data.columns, currentUserId]);

  // ── Colunas filtradas ────────────────────────────────────────────────────

  const filteredColumns = useMemo(() => {
    if (filterMode === "all") return data.columns;

    return data.columns.map((col) => ({
      ...col,
      cards: col.cards.filter((card) => {
        switch (filterMode) {
          case "mine":
            return card.lockedBy === currentUserId && card.lockMinutesLeft !== null;
          case "free":
            return !card.lockedBy || card.lockMinutesLeft === null;
          case "locked":
            return card.lockedBy && card.lockedBy !== currentUserId && card.lockMinutesLeft !== null;
        }
      }),
      count: col.cards.filter((card) => {
        switch (filterMode) {
          case "mine":
            return card.lockedBy === currentUserId && card.lockMinutesLeft !== null;
          case "free":
            return !card.lockedBy || card.lockMinutesLeft === null;
          case "locked":
            return card.lockedBy && card.lockedBy !== currentUserId && card.lockMinutesLeft !== null;
        }
      }).length,
    }));
  }, [data.columns, filterMode, currentUserId]);

  // ── Claim antes de abrir modal ───────────────────────────────────────────

  const openModal = useCallback(async (card: OperationalCard, action: ActionDefinition) => {
    // Tenta adquirir o claim antes de abrir o modal
    try {
      const res = await fetch("/api/operacao/claim", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ requestId: card.id, action: "claim" }),
      });

      const json = await res.json();

      if (res.status === 409) {
        // Card claimado por outro — exibe modal de conflito
        setConflictClaim(json.claim as ClaimInfo);
        return;
      }

      if (!res.ok) {
        console.warn("[claim] Erro ao claimar card:", json.error);
        // Abre o modal mesmo assim — a validação final é no servidor
      }

      // Claim bem-sucedido → abre o modal de ação
      setSelectedCard(card);
      setSelectedAction(action);
      // Atualiza fila para mostrar o lock nos outros clients
      refetch();
    } catch {
      // Falha de rede — abre o modal de qualquer forma; server valida claim
      setSelectedCard(card);
      setSelectedAction(action);
    }
  }, [refetch]);

  const closeModal = useCallback(async () => {
    // Libera o claim ao fechar sem executar ação
    if (selectedCard) {
      fetch("/api/operacao/claim", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ requestId: selectedCard.id, action: "release" }),
      }).catch(() => { /* silencioso */ });
    }
    setSelectedCard(null);
    setSelectedAction(null);
  }, [selectedCard]);

  // ── Execução de ação ─────────────────────────────────────────────────────

  const handleAction = useCallback(async (payload: OperationalAction) => {
    const res = await fetch("/api/operacao/action", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    const json = await res.json();

    if (res.status === 409 && json.claim) {
      // Conflito detectado pelo servidor (claim expirou e outro pegou)
      setSelectedCard(null);
      setSelectedAction(null);
      setConflictClaim(json.claim as ClaimInfo);
      return;
    }

    if (!res.ok) {
      throw new Error(json.error ?? `Erro ${res.status}`);
    }

    // Sucesso — atualiza fila imediatamente
    await refetch();
  }, [refetch]);

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ backgroundColor: "#0D1117" }}
    >
      {/* Barra de corte horário */}
      <CutoffBar />

      {/* Barra de métricas */}
      <MetricsBar metrics={data.metrics} loading={loading} />

      {/* Header com filtros e ações */}
      <div
        className="flex items-center justify-between px-5 py-2"
        style={{ borderBottom: "1px solid #1E2530", backgroundColor: "#0D1117" }}
      >
        <div className="flex items-center gap-3">
          <QueueFilterBar
            current={filterMode}
            onChange={setFilterMode}
            counts={filterCounts}
          />
          {error && (
            <span
              className="text-[10px] px-2 py-0.5 rounded"
              style={{ backgroundColor: "#EF444422", color: "#F87171", border: "1px solid #EF444433" }}
            >
              {error}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px]" style={{ color: "#374151" }}>
            Atualiza a cada 30s
          </span>
          <button
            onClick={refetch}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium"
            style={{ backgroundColor: "#1E2530", color: "#6B7280" }}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Colunas com scroll horizontal */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 p-4 h-full" style={{ minWidth: "max-content" }}>
          {filteredColumns.map((column) => (
            <WorkQueueColumn
              key={column.id}
              column={column}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              onAction={openModal}
              onCorrigirPedido={setCorrectingCard}
            />
          ))}
        </div>
      </div>

      {/* Modal de ação — "Marcar entregue" usa o modal de foto; demais usam o ActionModal */}
      {selectedCard && selectedAction && (
        selectedAction.toStatus === "DELIVERED" ? (
          <MarkDeliveredModal
            card={selectedCard}
            requirePhoto={requirePhoto}
            onClose={closeModal}
            onSuccess={refetch}
          />
        ) : (
          <ActionModal
            card={selectedCard}
            action={selectedAction}
            onClose={closeModal}
            onSubmit={handleAction}
          />
        )
      )}

      {/* Modal de conflito de claim */}
      {conflictClaim && (
        <ClaimConflictModal
          claim={conflictClaim}
          onClose={() => setConflictClaim(null)}
        />
      )}

      {/* Modal de correção do número do pedido */}
      {correctingCard && (
        <CorrigirPedidoModal
          card={correctingCard}
          onClose={() => setCorrectingCard(null)}
          onSuccess={refetch}
        />
      )}
    </div>
  );
}
