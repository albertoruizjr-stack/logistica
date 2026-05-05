# Checklist de Deploy Staging — Pilar 1

## Pré-requisitos

- [ ] `.env.local` de staging configurado com `DATABASE_URL` (pooler porta 6543) e `DIRECT_URL` (porta 5432)
- [ ] Acesso VPN/rede ao Citel confirmado: `curl -s $CITEL_API_URL` retorna resposta
- [ ] Backup do banco staging tirado antes de qualquer migrate

## 1. Gerar o baseline de migrations (executar uma única vez)

O projeto usava `prisma db push` sem migrations. Antes de `migrate deploy`, é preciso
criar o baseline para que o Prisma saiba que as tabelas já existem.

```bash
# Na máquina local com DIRECT_URL apontando para staging:
npx prisma migrate dev --name baseline_pilar1
```

> O Prisma vai detectar que o banco já tem as tabelas e perguntará se quer
> criar um drift. Responda `y` — ele gera a migration SQL do estado atual.

Resultado esperado: pasta `prisma/migrations/YYYYMMDDHHMMSS_baseline_pilar1/` criada.

## 2. Aplicar em staging

```bash
npx prisma migrate deploy
```

Resultado esperado:
```
1 migration found in prisma/migrations
Applying migration `YYYYMMDDHHMMSS_baseline_pilar1`
The following migration(s) have been applied:
  migrations/YYYYMMDDHHMMSS_baseline_pilar1/migration.sql
```

## 3. Gerar cliente Prisma

```bash
npx prisma generate
```

Resultado esperado: `✔ Generated Prisma Client`

## 4. Validar tabelas criadas

Conectar no Supabase Studio (ou psql) e verificar:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('stock_ledgers','stock_ledger_entries','transfer_divergences');
```

Resultado esperado: 3 linhas retornadas.

Verificar colunas do StockLedger:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'stock_ledgers'
ORDER BY ordinal_position;
```

Resultado esperado: `id, store_id, product_code, product_name, qtd_fisica,
qtd_comprometida, qtd_em_transito, version, synced_at, created_at, updated_at`

## 5. Seed do StockLedger

```bash
npm run db:seed-ledger
```

Resultado esperado: cada loja com `codigoEmpresaCitel` sincronizada, `errors: 0`.

## 6. Smoke test da API

```bash
curl -s http://localhost:3000/api/health | jq .
```

Resultado esperado: `{"status":"ok"}`

## 7. Teste E2E de staging

```bash
E2E_STAGING=true \
E2E_STORE_A_ID=<id-loja-origem> \
E2E_STORE_B_ID=<id-loja-destino> \
E2E_OPERATOR_ID=<id-operador> \
E2E_PRODUCT_CODE=TINT-001 \
E2E_PRODUCT_NAME="Tinta Branca 18L (E2E)" \
npx vitest run __tests__/e2e/pilar1-staging.e2e.test.ts
```

Resultado esperado: 7 testes passando.

## 8. Verificar cron de divergências

```bash
npm run cron:divergencias
```

Resultado esperado: `Nenhuma divergência vencida. Tudo em dia.` (exit code 0)

---

## Nota: citelTakesOver — entrada manual de NF

O webhook de NF do Citel **NÃO** está ativo neste ciclo.
O operador deve informar manualmente o número da NF no campo "NF Citel" ao
avançar a transferência para IN_TRANSIT na interface.

O sistema **rejeita** a transição se o campo estiver vazio (erro claro ao operador):
> "Informe o número da NF emitida no Citel para colocar a transferência em trânsito."

O webhook é a evolução futura — quando implementado, substituirá o campo manual
sem alteração de regra de negócio.

---

## Plano de rollback

Se qualquer etapa falhar, o rollback é seguro porque:
- As novas tabelas (`stock_ledgers`, `stock_ledger_entries`, `transfer_divergences`) são
  **aditivas** — não alteram nenhuma tabela existente.
- Nenhuma coluna de tabela existente foi removida ou alterada neste ciclo.

**Para reverter completamente:**

```sql
-- Executar no banco staging via Supabase SQL Editor
DROP TABLE IF EXISTS transfer_divergences;
DROP TABLE IF EXISTS stock_ledger_entries;
DROP TABLE IF EXISTS stock_ledgers;
```

Depois remover a pasta `prisma/migrations/` para voltar ao fluxo `db push`.

> O rollback não afeta dados de transferências existentes. O Citel continua
> como fonte de verdade para estoque físico sem interrupção.
