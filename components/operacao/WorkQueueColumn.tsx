"use client";

import { DeliveryCard } from "./DeliveryCard";
import type { OperationalCard, OperationalColumn, ActionDefinition } from "./types";

interface WorkQueueColumnProps {
  column:        OperationalColumn;
  currentUserId: string;
  onAction:      (card: OperationalCard, action: ActionDefinition) => void;
}

const COLUMN_ACCENT: Record<string, string> = {
  pendente:      "#6B7280",
  transferencia: "#3B82F6",
  separacao:     "#F59E0B",
  fiscal:        "#8B5CF6",
  roteirizacao:  "#10B981",
  despacho:      "#06B6D4",
  ocorrencia:    "#EF4444",
};

export function WorkQueueColumn({ column, currentUserId, onAction }: WorkQueueColumnProps) {
  const accent = COLUMN_ACCENT[column.id] ?? "#6B7280";

  return (
    <div
      className="flex flex-col flex-shrink-0 rounded-lg overflow-hidden"
      style={{
        width:           "240px",
        backgroundColor: "#0F1318",
        border:          `1px solid #1E2530`,
      }}
    >
      {/* Header da coluna */}
      <div
        className="flex items-center justify-between px-3 py-2.5"
        style={{
          borderBottom:  "1px solid #1E2530",
          borderLeft:    `3px solid ${accent}`,
          backgroundColor: "#111318",
        }}
      >
        <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: accent }}>
          {column.label}
        </span>
        <span
          className="text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded"
          style={{
            backgroundColor: column.count > 0 ? `${accent}22` : "transparent",
            color:           column.count > 0 ? accent          : "#374151",
            border:          column.count > 0 ? `1px solid ${accent}33` : "1px solid transparent",
          }}
        >
          {column.count}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2" style={{ maxHeight: "calc(100vh - 140px)" }}>
        {column.cards.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-[10px]" style={{ color: "#2D3748" }}>vazio</span>
          </div>
        ) : (
          column.cards.map((card) => (
            <DeliveryCard
              key={card.id}
              card={card}
              currentUserId={currentUserId}
              onAction={onAction}
            />
          ))
        )}
      </div>
    </div>
  );
}
