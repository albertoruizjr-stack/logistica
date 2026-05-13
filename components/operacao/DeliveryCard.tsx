"use client";

import { Zap, ArrowLeftRight, AlertTriangle, Clock, MapPin, Lock, Unlock } from "lucide-react";
import type { OperationalCard, ActionDefinition } from "./types";
import { ACTIONS_BY_STATUS } from "./actions";

interface DeliveryCardProps {
  card:        OperationalCard;
  currentUserId: string;
  onAction:    (card: OperationalCard, action: ActionDefinition) => void;
}

const PRIORITY_BORDER: Record<string, string> = {
  CRITICAL: "#EF4444",
  HIGH:     "#F97316",
  MEDIUM:   "#FBBF24",
  LOW:      "#1E2530",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING:             "Pendente",
  AWAITING_ITEMS:      "Sep. itens",
  AWAITING_TRANSFER:   "Aguard. transf.",
  SEPARADO:            "Separado",
  AGUARDANDO_NF:       "Aguard. NF",
  NF_EMITIDA:          "NF emitida",
  NF_VINCULADA:        "NF vinculada",
  PRONTO_ROTEIRIZACAO: "Pronto roteirizar",
  ROTEIRIZADO:         "Roteirizado",
  DISPATCHED:          "Despachado",
  IN_TRANSIT:          "Em trânsito",
  OCORRENCIA:          "Ocorrência",
};

function formatMinutes(min: number) {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

function formatRef(card: OperationalCard) {
  if (card.orderNumber) return `PD ${card.orderNumber}`;
  if (card.invoiceNumber) return `NF ${card.invoiceNumber}`;
  return `#${card.id.slice(-6).toUpperCase()}`;
}

export function DeliveryCard({ card, currentUserId, onAction }: DeliveryCardProps) {
  const borderColor    = PRIORITY_BORDER[card.priority] ?? PRIORITY_BORDER.LOW;
  const isCritical     = card.priority === "CRITICAL";
  const isExpress      = card.slaType === "EXPRESS";
  const isUrgent       = card.deliveryType === "URGENT";
  const isLockedByMe   = card.lockedBy === currentUserId && card.lockMinutesLeft !== null;
  const isLockedByOther = card.lockedBy && card.lockedBy !== currentUserId && card.lockMinutesLeft !== null;
  const actions        = ACTIONS_BY_STATUS[card.status] ?? [];
  const primaryActions = actions.filter((a) => a.variant === "primary" || a.variant === "warning");
  const dangerActions  = actions.filter((a) => a.variant === "danger");

  return (
    <div
      className={isCritical ? "animate-pulse" : ""}
      style={{
        backgroundColor: "#12151C",
        border:          `1px solid ${borderColor}`,
        borderRadius:    "8px",
        padding:         "10px 12px",
        position:        "relative",
        cursor:          "default",
        animationDuration: isCritical ? "2s" : undefined,
      }}
    >
      {/* Linha topo: ref + badges */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <span
          className="text-[12px] font-bold tabular-nums"
          style={{ color: "#E5E7EB", fontFamily: "var(--font-mono, monospace)" }}
        >
          {formatRef(card)}
        </span>

        {isExpress && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
            style={{ backgroundColor: "#7C3AED33", color: "#A78BFA", border: "1px solid #7C3AED44" }}
          >
            EXPRESS
          </span>
        )}
        {isUrgent && !isExpress && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase flex items-center gap-0.5"
            style={{ backgroundColor: "#EF444433", color: "#F87171", border: "1px solid #EF444444" }}
          >
            <Zap className="w-2.5 h-2.5" />
            URG
          </span>
        )}
        {card.pendingTransfers > 0 && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
            style={{ backgroundColor: "#2563EB22", color: "#60A5FA", border: "1px solid #2563EB33" }}
          >
            <ArrowLeftRight className="w-2.5 h-2.5" />
            {card.pendingTransfers}
          </span>
        )}
        {card.status === "OCORRENCIA" && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
            style={{ backgroundColor: "#F59E0B22", color: "#FCD34D", border: "1px solid #F59E0B33" }}
          >
            <AlertTriangle className="w-2.5 h-2.5" />
            {card.occurrenceType ?? "OCO"}
          </span>
        )}
      </div>

      {/* Lock indicator */}
      {isLockedByOther && (
        <div
          className="flex items-center gap-1 px-1.5 py-0.5 rounded mb-1.5 text-[10px] font-medium"
          style={{ backgroundColor: "#EF444415", color: "#FCA5A5", border: "1px solid #EF444430" }}
        >
          <Lock className="w-2.5 h-2.5 flex-shrink-0" />
          <span className="truncate">{card.lockedByName}</span>
          {card.lockMinutesLeft !== null && (
            <span className="ml-auto flex-shrink-0 tabular-nums" style={{ color: "#EF4444" }}>
              {card.lockMinutesLeft}m
            </span>
          )}
        </div>
      )}
      {isLockedByMe && (
        <div
          className="flex items-center gap-1 px-1.5 py-0.5 rounded mb-1.5 text-[10px] font-medium"
          style={{ backgroundColor: "#16A34A15", color: "#86EFAC", border: "1px solid #16A34A30" }}
        >
          <Lock className="w-2.5 h-2.5 flex-shrink-0" />
          <span>Seu claim</span>
          {card.lockMinutesLeft !== null && (
            <span className="ml-auto flex-shrink-0 tabular-nums" style={{ color: "#4ADE80" }}>
              {card.lockMinutesLeft}m
            </span>
          )}
        </div>
      )}

      {/* Cliente */}
      <p className="text-[11px] font-medium truncate mb-0.5" style={{ color: "#9CA3AF" }}>
        {card.customerName}
      </p>

      {/* Endereço */}
      {card.deliveryAddress && (
        <p className="text-[10px] truncate flex items-center gap-1" style={{ color: "#4B5563" }}>
          <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
          {card.deliveryAddress}
        </p>
      )}

      {/* Status + loja + tempo */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1.5">
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{ backgroundColor: "#1E2530", color: "#6B7280" }}
          >
            {card.storeCode}
          </span>
          <span className="text-[10px]" style={{ color: "#374151" }}>
            {STATUS_LABEL[card.status] ?? card.status}
          </span>
        </div>
        <div className="flex items-center gap-0.5" style={{ color: "#374151" }}>
          <Clock className="w-2.5 h-2.5" />
          <span className="text-[9px] tabular-nums">{formatMinutes(card.minutesInStatus)}</span>
        </div>
      </div>

      {/* Ações */}
      {actions.length > 0 && (
        <div className="flex gap-1.5 mt-2.5 flex-wrap">
          {primaryActions.map((action) => (
            <button
              key={action.toStatus}
              onClick={() => onAction(card, action)}
              className="text-[10px] font-semibold px-2 py-1 rounded transition-colors"
              style={{
                backgroundColor: action.variant === "warning" ? "#F59E0B22" : "#16A34A22",
                color:           action.variant === "warning" ? "#FCD34D"   : "#86EFAC",
                border:          action.variant === "warning" ? "1px solid #F59E0B33" : "1px solid #16A34A33",
              }}
            >
              {action.label}
            </button>
          ))}
          {dangerActions.map((action) => (
            <button
              key={action.toStatus}
              onClick={() => onAction(card, action)}
              className="text-[10px] font-semibold px-2 py-1 rounded transition-colors"
              style={{
                backgroundColor: "#EF444422",
                color:           "#F87171",
                border:          "1px solid #EF444433",
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
