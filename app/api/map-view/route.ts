import { NextRequest, NextResponse } from "next/server";
import { getSession }               from "@/lib/auth";
import { getMapViewData }           from "@/services/map-view.service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const storeId = req.nextUrl.searchParams.get("storeId") || null;

  try {
    const data = await getMapViewData(storeId);
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[map-view]", err);
    return NextResponse.json({ error: "Erro ao carregar mapa" }, { status: 500 });
  }
}
