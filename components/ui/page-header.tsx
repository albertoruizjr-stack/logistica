interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  loading?: boolean;
}

export function PageHeader({
  title,
  description,
  actions,
  loading = false,
}: PageHeaderProps) {
  return (
    <div
      className="flex items-start justify-between pb-5 mb-6 border-b"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div>
        {loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-7 rounded-lg w-52" style={{ backgroundColor: "#EBEBEB" }} />
            <div className="h-3.5 rounded-lg w-72" style={{ backgroundColor: "#EBEBEB" }} />
          </div>
        ) : (
          <>
            <h1
              className="text-[22px] font-bold leading-tight"
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--color-body-text)",
              }}
            >
              {title}
            </h1>
            {description && (
              <p
                className="text-[13px] mt-1"
                style={{ color: "var(--color-muted-text)" }}
              >
                {description}
              </p>
            )}
          </>
        )}
      </div>
      {!loading && actions && (
        <div className="flex items-center gap-2 ml-8 flex-shrink-0">{actions}</div>
      )}
    </div>
  );
}
