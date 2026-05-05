import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const info: Record<string, unknown> = {
    POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL
      ? process.env.POSTGRES_PRISMA_URL.replace(/:([^:@]+)@/, ":***@")
      : "NOT SET",
    POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING
      ? process.env.POSTGRES_URL_NON_POOLING.replace(/:([^:@]+)@/, ":***@")
      : "NOT SET",
    DATABASE_URL: process.env.DATABASE_URL
      ? process.env.DATABASE_URL.replace(/:([^:@]+)@/, ":***@")
      : "NOT SET",
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    info.db = "OK";
  } catch (e) {
    info.db = "ERROR";
    info.dbError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(info);
}
