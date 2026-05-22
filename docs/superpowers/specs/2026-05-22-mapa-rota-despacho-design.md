# Mapa da rota no Despacho (linha nas ruas, igual Spoke) — Design (v2)

**Data:** 2026-05-22
**Status:** Design para aprovação — Alberto escolheu o v2 (trajeto real nas vias).

## Objetivo
Na página `/despacho`, **substituir o painel "Motoristas disponíveis"** por um **mapa da rota selecionada** mostrando as paradas numeradas + a **linha do trajeto nas ruas** (como o Spoke). Clica num card de rota à esquerda → o mapa à direita mostra aquela rota.

## Base que já existe
- `components/rastreamento/route-mini-map.tsx` — mapa Leaflet/OpenStreetMap (grátis) que plota loja + paradas + motorista como marcadores. **Não desenha linha de trajeto** (sem `Polyline`).
- `services/maps/google-routes.provider.ts` `computeRoutes(originLat,lng,destLat,lng)` → retorna `polyline?: string` (encoded). **Só origem→destino hoje** (sem waypoints).
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` existe. Quota guard em `checkMapsQuota`.
- Rotas têm `sequenceJson` (paradas com lat/lng) + `manifestJson`. O **Spoke NÃO traz geometria**.

## Design

### 1. Geometria via Google Routes com waypoints
- Estender `computeRoutes` (ou novo `computeRoutePolyline(stops: {lat,lng}[])`) pra mandar `intermediates: [{location:{latLng}}]` na chamada (origem = loja, destino = loja/última, intermediários = paradas na ordem do `sequenceJson`). `optimizeWaypointOrder: false` (a ordem já vem otimizada do Spoke). FieldMask já pede `routes.polyline.encodedPolyline`.
- Respeitar a quota (`checkMapsQuota`); se estourar, cair pra linha reta entre paradas (fallback sem custo).

### 2. Decoder de polyline (novo)
- `lib/polyline.ts` `decodePolyline(encoded: string): [number, number][]` — algoritmo padrão do Google (precisão 5), função pura, testável. Sem dependência nova.

### 3. Cache (evitar custo de API repetido)
- **Campo novo `Route.geometryPolyline String?`** (encoded). Calcula **uma vez** (lazy: na 1ª vez que o despacho renderiza o mapa daquela rota e o campo está vazio) e persiste. Próximas visualizações usam o cache. Recalcular se o `sequenceJson` mudar (ex.: incluir coleta) — invalidar `geometryPolyline` quando a sequência muda.
- Schema → **uma migration consolidada** (regra de dev).

### 4. Mapa com trajeto
- Estender `RouteMiniMap` (ou um novo `RouteMapPanel`) pra aceitar `polyline: [lat,lng][]` e desenhar `<Polyline>` (verde) + marcadores **numerados** (1,2,3…) nas paradas, loja destacada.
- Tamanho maior que o mini-map (é o painel principal à direita).

### 5. Layout do Despacho
- Remover o painel "Motoristas" (no despacho as rotas já vêm com motorista).
- Estado de **rota selecionada** (clicar num card "Rota pronta" seleciona). O painel direito vira o **mapa da rota selecionada** (paradas + trajeto). Default: primeira rota.
- (Se um dia precisar de "quem está livre" no despacho, indicador compacto — fora de escopo.)

## Decisões em aberto
1. **Quando calcular a geometria:** lazy na 1ª visualização (recomendado — cobre rotas existentes, custo só quando olha) vs no momento da otimização/distribuição da wave.
2. **Endpoint vs server component:** o cálculo+cache pode ser num endpoint `GET /api/despacho/rotas/[id]/geometria` (chamado pelo client ao selecionar) ou no server component do despacho. Endpoint é mais simples pro padrão "seleciona → carrega".
3. **Incluir o retorno à loja** no trajeto (loop), como o Spoke? (Recomendado sim — origem→paradas→origem.)

## Esboço de tarefas
1. Schema `Route.geometryPolyline String?` + invalidação ao mudar `sequenceJson` → migration consolidada.
2. `lib/polyline.ts` `decodePolyline` + teste.
3. `computeRoutePolyline(stops)` em `google-routes.provider.ts` (waypoints) + quota/fallback.
4. Endpoint `GET /api/despacho/rotas/[id]/geometria` (calcula se vazio, persiste, retorna encoded).
5. `RouteMapPanel` (Leaflet + Polyline + marcadores numerados).
6. `/despacho`: remover painel de motoristas, estado de rota selecionada, render do mapa.

## Riscos
- **Custo Google Routes:** mitigado por cache no `Route` + quota guard + fallback linha reta.
- **Leaflet SSR:** o mapa é client-only (`"use client"` + dynamic import com `ssr:false` se necessário) — o route-mini-map já lida com isso, seguir o padrão.
- **Sequência muda (coleta incluída):** invalidar `geometryPolyline` pra recalcular.
