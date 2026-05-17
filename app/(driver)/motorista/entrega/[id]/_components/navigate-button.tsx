"use client";

import { useState } from "react";
import { Navigation, X } from "lucide-react";

interface Props {
  address: string;
}

export default function NavigateButton({ address }: Props) {
  const [open, setOpen] = useState(false);

  const q       = encodeURIComponent(address);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${q}`;
  const wazeUrl = `https://waze.com/ul?q=${q}&navigate=yes`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold bg-blue-500 text-white py-3 rounded-lg active:bg-blue-600"
      >
        <Navigation className="w-4 h-4" />
        Navegar
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[80] bg-black/60" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-0 bottom-0 z-[81] bg-white rounded-t-2xl shadow-2xl">
            <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-900">Abrir navegação</h2>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{address}</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-2">
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 active:bg-gray-50"
              >
                <span className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-base font-bold">G</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900">Google Maps</p>
                  <p className="text-[11px] text-gray-500">Trânsito ao vivo</p>
                </div>
              </a>

              <a
                href={wazeUrl}
                target="_blank"
                rel="noopener"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 active:bg-gray-50"
              >
                <span className="w-9 h-9 rounded-full bg-sky-100 flex items-center justify-center text-sky-700 text-base font-bold">W</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900">Waze</p>
                  <p className="text-[11px] text-gray-500">Alertas da comunidade</p>
                </div>
              </a>
            </div>

            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
              <button
                onClick={() => setOpen(false)}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-medium text-gray-700 bg-white border border-gray-200"
              >
                Cancelar
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
