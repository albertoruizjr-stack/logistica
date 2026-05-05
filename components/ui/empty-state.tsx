import { type LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {Icon && (
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
          style={{ backgroundColor: "var(--color-background)", border: "1px solid var(--color-border)" }}
        >
          <Icon className="w-5 h-5" style={{ color: "#C4C0B8" }} />
        </div>
      )}
      <p
        className="text-[14px] font-semibold"
        style={{ fontFamily: "var(--font-display)", color: "var(--color-body-text)" }}
      >
        {title}
      </p>
      {description && (
        <p className="text-[13px] mt-1" style={{ color: "var(--color-muted-text)" }}>
          {description}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 text-[13px] font-semibold text-white px-4 py-2 rounded-lg transition-colors"
          style={{ backgroundColor: "var(--color-primary)" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-primary-dark)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-primary)")}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
