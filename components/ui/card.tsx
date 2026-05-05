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
    <div
      className={cn("bg-white rounded-xl", className)}
      style={{ border: "1px solid var(--color-border)" }}
    >
      {(title || actions) && (
        <div
          className="flex items-start justify-between px-4 py-3 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            {title && (
              <p
                className="text-[13px] font-semibold"
                style={{ color: "var(--color-body-text)", fontFamily: "var(--font-display)" }}
              >
                {title}
              </p>
            )}
            {description && (
              <p className="text-xs mt-0.5" style={{ color: "var(--color-muted-text)" }}>
                {description}
              </p>
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
            <div className="h-4 rounded-lg w-full" style={{ backgroundColor: "#EBEBEB" }} />
            <div className="h-4 rounded-lg w-3/4" style={{ backgroundColor: "#EBEBEB" }} />
            <div className="h-4 rounded-lg w-1/2" style={{ backgroundColor: "#EBEBEB" }} />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
