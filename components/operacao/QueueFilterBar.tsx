"use client";

import { Lock, Unlock, User, LayoutGrid } from "lucide-react";
import type { FilterMode } from "./types";

interface QueueFilterBarProps {
  current:  FilterMode;
  onChange: (mode: FilterMode) => void;
  counts: {
    all:    number;
    mine:   number;
    free:   number;
    locked: number;
  };
}

const FILTERS: { mode: FilterMode; label: string; Icon: React.ElementType; color: string }[] = [
  { mode: "all",    label: "Todos",    Icon: LayoutGrid, color: "#9CA3AF" },
  { mode: "mine",   label: "Meus",     Icon: User,       color: "#34D399" },
  { mode: "free",   label: "Livres",   Icon: Unlock,     color: "#60A5FA" },
  { mode: "locked", label: "Travados", Icon: Lock,       color: "#F87171" },
];

export function QueueFilterBar({ current, onChange, counts }: QueueFilterBarProps) {
  return (
    <div className="flex items-center gap-1.5">
      {FILTERS.map(({ mode, label, Icon, color }) => {
        const isActive = current === mode;
        const count = counts[mode];
        return (
          <button
            key={mode}
            onClick={() => onChange(mode)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all"
            style={{
              backgroundColor: isActive ? `${color}22` : "transparent",
              color:           isActive ? color           : "#4B5563",
              border:          isActive ? `1px solid ${color}44` : "1px solid transparent",
            }}
          >
            <Icon className="w-3 h-3" style={{ color: isActive ? color : "#4B5563" }} />
            {label}
            {count > 0 && (
              <span
                className="text-[10px] font-bold px-1 py-0.5 rounded tabular-nums"
                style={{
                  backgroundColor: isActive ? `${color}33` : "#1E2530",
                  color:           isActive ? color           : "#6B7280",
                }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
