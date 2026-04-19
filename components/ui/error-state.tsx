import { AlertCircle } from "lucide-react";

export type ErrorSource = "ERP" | "Maps" | "Lalamove" | "Database" | "Unknown";

interface ErrorStateProps {
  source: ErrorSource;
  title?: string;
  description?: string;
  onRetry?: () => void;
}

const DEFAULT_TITLES: Record<ErrorSource, string> = {
  ERP:      "Erro ao buscar dados do ERP",
  Maps:     "Erro ao calcular rota",
  Lalamove: "Cotação Lalamove indisponível",
  Database: "Erro ao carregar dados",
  Unknown:  "Algo deu errado",
};

export function ErrorState({ source, title, description, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
      <p className="text-sm font-medium text-slate-700">
        {title ?? DEFAULT_TITLES[source]}
      </p>
      {description && (
        <p className="text-sm text-slate-400 mt-1">{description}</p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 text-sm font-medium text-slate-700 border border-slate-300 hover:border-slate-400 px-4 py-2 rounded-md transition-colors"
        >
          Tentar novamente
        </button>
      )}
    </div>
  );
}
