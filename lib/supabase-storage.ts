// Cliente do Supabase Storage para upload de comprovantes de entrega.
// Usa service_role key (server-side only) — bypassa RLS, controle de acesso fica no app.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL              = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BUCKET                    = process.env.SUPABASE_PROOFS_BUCKET ?? "delivery-proofs";

let _client: SupabaseClient | null = null;

export function isStorageConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function getClient(): SupabaseClient {
  if (!_client) {
    if (!isStorageConfigured()) {
      throw new Error("Supabase Storage não configurado — defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local");
    }
    _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

export interface UploadResult {
  path:     string;  // path interno do bucket (pra gerar URLs assinadas depois)
  publicUrl: string; // URL pública (bucket privado: vira URL assinada de 30 dias por padrão)
}

// Upload de uma foto de comprovante. path: "{deliveryRequestId}/{type}_{timestamp}.{ext}"
export async function uploadProofPhoto(args: {
  deliveryRequestId: string;
  type:              "RECEIPT" | "MATERIAL" | "OCCURRENCE";
  buffer:            Buffer;
  contentType:       string;
  extension:         string;          // "jpg", "png", "webp"
}): Promise<UploadResult> {
  const client = getClient();
  const path = `${args.deliveryRequestId}/${args.type}_${Date.now()}.${args.extension}`;

  const { error: upErr } = await client.storage.from(BUCKET).upload(path, args.buffer, {
    contentType: args.contentType,
    upsert:      false,
  });
  if (upErr) throw new Error(`Upload Storage falhou: ${upErr.message}`);

  // Bucket privado: gera URL assinada com validade longa (30 dias). Em consultas administrativas,
  // a app pode regerar URL nova via /api admin se precisar.
  const { data: signed, error: urlErr } = await client.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 30);
  if (urlErr || !signed) throw new Error(`URL assinada falhou: ${urlErr?.message ?? "sem dados"}`);

  return { path, publicUrl: signed.signedUrl };
}

// Upload da foto de início de rota (veículo carregado ao sair da loja).
// path: "route_{routeId}/START_{timestamp}.{ext}" — mesmo bucket dos comprovantes.
export async function uploadRouteStartPhoto(args: {
  routeId:     string;
  buffer:      Buffer;
  contentType: string;
  extension:   string;          // "jpg", "png", "webp"
}): Promise<UploadResult> {
  const client = getClient();
  const path = `route_${args.routeId}/START_${Date.now()}.${args.extension}`;

  const { error: upErr } = await client.storage.from(BUCKET).upload(path, args.buffer, {
    contentType: args.contentType,
    upsert:      false,
  });
  if (upErr) throw new Error(`Upload Storage falhou: ${upErr.message}`);

  const { data: signed, error: urlErr } = await client.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 30);
  if (urlErr || !signed) throw new Error(`URL assinada falhou: ${urlErr?.message ?? "sem dados"}`);

  return { path, publicUrl: signed.signedUrl };
}

// Upload da foto de coleta de uma transferência (motorista coleta o material na loja de origem).
// path: "transfer_{transferId}/COLLECT_{timestamp}.{ext}" — mesmo bucket dos comprovantes.
export async function uploadTransferCollectPhoto(args: {
  transferId:  string;
  buffer:      Buffer;
  contentType: string;
  extension:   string;          // "jpg", "png", "webp"
}): Promise<UploadResult> {
  const client = getClient();
  const path = `transfer_${args.transferId}/COLLECT_${Date.now()}.${args.extension}`;

  const { error: upErr } = await client.storage.from(BUCKET).upload(path, args.buffer, {
    contentType: args.contentType,
    upsert:      false,
  });
  if (upErr) throw new Error(`Upload Storage falhou: ${upErr.message}`);

  const { data: signed, error: urlErr } = await client.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 30);
  if (urlErr || !signed) throw new Error(`URL assinada falhou: ${urlErr?.message ?? "sem dados"}`);

  return { path, publicUrl: signed.signedUrl };
}

// Regera URL assinada pra uma foto já armazenada (usado em telas admin/auditoria)
export async function getSignedProofUrl(path: string, expirySeconds = 3600): Promise<string> {
  const client = getClient();
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, expirySeconds);
  if (error || !data) throw new Error(`URL assinada falhou: ${error?.message ?? "sem dados"}`);
  return data.signedUrl;
}
