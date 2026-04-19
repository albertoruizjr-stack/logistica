import { cn } from "@/lib/utils";

interface KeyValueItem {
  label: string;
  value: React.ReactNode;
  fullWidth?: boolean;
}

interface KeyValueListProps {
  items: KeyValueItem[];
  columns?: 1 | 2;
}

export function KeyValueList({ items, columns = 2 }: KeyValueListProps) {
  return (
    <dl
      className={cn(
        "grid gap-0 divide-y divide-slate-100",
        columns === 2 ? "grid-cols-2" : "grid-cols-1"
      )}
    >
      {items.map((item, i) => (
        <div key={i} className={cn("py-2.5 px-1", item.fullWidth && "col-span-2")}>
          <dt className="text-xs text-slate-500 uppercase tracking-wide">
            {item.label}
          </dt>
          <dd className="text-sm font-medium text-slate-900 mt-0.5">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
