import { cn } from "@/lib/utils";

interface CardProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  padding?: "sm" | "md" | "lg";
  loading?: boolean;
  children: React.ReactNode;
  className?: string;
}

const paddingMap: Record<string, string> = {
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
};

export function Card({
  title,
  description,
  actions,
  padding = "md",
  loading = false,
  children,
  className,
}: CardProps) {
  return (
    <div className={cn("bg-white rounded-lg border border-slate-200 shadow-sm", className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between px-4 py-3 border-b border-slate-200">
          <div>
            {title && <p className="text-sm font-semibold text-slate-900">{title}</p>}
            {description && (
              <p className="text-xs text-slate-500 mt-0.5">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 ml-4">{actions}</div>
          )}
        </div>
      )}
      <div className={paddingMap[padding]}>
        {loading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-4 bg-slate-100 rounded w-full" />
            <div className="h-4 bg-slate-100 rounded w-3/4" />
            <div className="h-4 bg-slate-100 rounded w-1/2" />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
