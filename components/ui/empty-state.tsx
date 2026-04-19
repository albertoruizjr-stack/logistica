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
      {Icon && <Icon className="w-10 h-10 text-slate-300 mb-3" />}
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {description && (
        <p className="text-sm text-slate-400 mt-1">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 px-4 py-2 rounded-md transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
