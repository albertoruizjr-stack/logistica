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
    <div className="flex items-start justify-between pb-4 mb-6 border-b border-slate-200">
      <div>
        {loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-5 bg-slate-100 rounded w-48" />
            <div className="h-3 bg-slate-100 rounded w-64" />
          </div>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
            {description && (
              <p className="text-sm text-slate-500 mt-0.5">{description}</p>
            )}
          </>
        )}
      </div>
      {!loading && actions && (
        <div className="flex items-center gap-2 ml-6">{actions}</div>
      )}
    </div>
  );
}
