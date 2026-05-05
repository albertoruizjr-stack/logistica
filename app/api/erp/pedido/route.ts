import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { fetchOrderFromERP } from "@/services/erp.service";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { searchParams } = new URL(req.url);
    const number = searchParams.get("number")?.trim();
    const storeCode = searchParams.get("storeCode")?.trim();

    if (!number || !storeCode) {
      return NextResponse.json(
        apiError("Informe o número do pedido e o código da loja", "VALIDATION_ERROR"),
        { status: 400 }
      );
    }

    const order = await fetchOrderFromERP(number, storeCode);

    if (!order) {
      return NextResponse.json(
        apiError(`Pedido ${number} não encontrado no ERP para a loja ${storeCode}`, "NOT_FOUND"),
        { status: 404 }
      );
    }

    return NextResponse.json(apiSuccess({
      customerName: order.customer.name,
      customerPhone: order.customer.phone ?? "",
      deliveryAddress: order.deliveryAddress.city
        ? `${order.deliveryAddress.street}${order.deliveryAddress.complement ? `, ${order.deliveryAddress.complement}` : ""}, ${order.deliveryAddress.city}`
        : order.deliveryAddress.street,
      totalValue: order.totalValue,
      itemCount: order.items.length,
    }));
  } catch (error) {
    console.error("[GET /api/erp/pedido]", error);
    return NextResponse.json(apiError("Erro ao consultar ERP"), { status: 500 });
  }
}
