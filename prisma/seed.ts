import { PrismaClient, Role, TransferPriority, TransferStatus } from "@prisma/client";
import { createHash } from "crypto";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

async function main() {
  console.log("🌱 Iniciando seed...");

  // ──────────────────────────────────────
  // LOJAS (5 unidades da Atual Tintas)
  // ──────────────────────────────────────
  // Coordenadas estimadas por bairro — refinar após configurar Google Maps API
  const storeData = [
    {
      code: "067",
      name: "Loja Morumbi (067)",
      address: "Av. Mal. Juarez Távora, 22 - Morumbi, São Paulo - SP, 05750-000",
      lat: -23.6053,
      lng: -46.7290,
      phone: "(11) 3333-0067",
    },
    {
      code: "131",
      name: "Loja Chácara Sto Antônio (131)",
      address: "R. Américo Brasiliense, 1178 - Chácara Santo Antônio, São Paulo - SP, 04715-002",
      lat: -23.6256,
      lng: -46.7034,
      phone: "(11) 3333-0131",
    },
    {
      code: "132",
      name: "Loja Vila Andrade (132)",
      address: "R. Nelson Gama de Oliveira, 274 - Vila Andrade, São Paulo - SP, 05734-150",
      lat: -23.6175,
      lng: -46.7395,
      phone: "(11) 3333-0132",
    },
    {
      code: "173",
      name: "Loja Vila Progredior (173)",
      address: "Rua José Jannarelli, 687 - Vila Progredior, São Paulo - SP, 05615-001",
      lat: -23.5887,
      lng: -46.7524,
      phone: "(11) 3333-0173",
    },
    {
      code: "191",
      name: "Loja Vila Alexandria (191)",
      address: "Av. Santa Catarina, 670 - Vila Alexandria, São Paulo - SP, 04635-001",
      lat: -23.6278,
      lng: -46.6717,
      phone: "(11) 3333-0191",
    },
  ];

  const stores = await Promise.all(
    storeData.map(({ code, name, address, lat, lng, phone }) =>
      prisma.store.upsert({
        where: { code },
        update: { name, address, lat, lng, phone },
        create: { code, name, address, lat, lng, phone },
      })
    )
  );

  const [store067, store131, store132, store173, store191] = stores;
  console.log("✅ Lojas criadas:", stores.map((s) => s.code).join(", "));

  // ──────────────────────────────────────
  // TABELA DE FRETE POR ZONAS
  // ──────────────────────────────────────
  await prisma.freightZone.deleteMany(); // limpa para re-seed limpo

  const zones = await prisma.freightZone.createMany({
    data: [
      {
        name: "Zona 1 — Até 3 km",
        minKm: 0,
        maxKm: 3,
        basePrice: 15.0,
        urgentFactor: 1.8,
        underConsultation: false,
      },
      {
        name: "Zona 2 — 3 a 7 km",
        minKm: 3,
        maxKm: 7,
        basePrice: 25.0,
        urgentFactor: 1.8,
        underConsultation: false,
      },
      {
        name: "Zona 3 — 7 a 12 km",
        minKm: 7,
        maxKm: 12,
        basePrice: 40.0,
        urgentFactor: 1.8,
        underConsultation: false,
      },
      {
        name: "Zona 4 — 12 a 20 km",
        minKm: 12,
        maxKm: 20,
        basePrice: 60.0,
        urgentFactor: 1.8,
        underConsultation: false,
      },
      {
        name: "Zona 5 — Acima de 20 km",
        minKm: 20,
        maxKm: null,
        basePrice: 0,
        urgentFactor: 1.0,
        underConsultation: true, // requer cotação manual
      },
    ],
  });
  console.log("✅ Zonas de frete criadas:", zones.count);

  // ──────────────────────────────────────
  // CONFIGURAÇÕES DO SISTEMA
  // ──────────────────────────────────────
  const configs = [
    { key: "URGENT_MULTIPLIER", value: "1.8", type: "number", label: "Multiplicador urgente" },
    { key: "LALAMOVE_API_KEY", value: "", type: "string", label: "Chave API Lalamove" },
    { key: "LALAMOVE_API_SECRET", value: "", type: "string", label: "Secret API Lalamove" },
    { key: "LALAMOVE_MARKET", value: "BR", type: "string", label: "Mercado Lalamove" },
    { key: "GOOGLE_MAPS_KEY", value: "", type: "string", label: "Chave Google Maps" },
    { key: "ERP_API_URL", value: "", type: "string", label: "URL da API do ERP" },
    { key: "ERP_API_KEY", value: "", type: "string", label: "Chave API ERP" },
    { key: "MAX_STANDARD_DELIVERY_KM", value: "20", type: "number", label: "Distância máxima entrega padrão (km)" },
    { key: "INTERNAL_ROUTE_CUTOFF_HOUR", value: "16", type: "number", label: "Hora de corte para rota do dia (h)" },
    { key: "SPOKE_API_URL", value: "", type: "string", label: "URL da API Spoke" },
    { key: "SPOKE_API_KEY", value: "", type: "string", label: "Chave API Spoke" },
  ];

  for (const config of configs) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: {},
      create: config,
    });
  }
  console.log("✅ Configurações criadas:", configs.length);

  // ──────────────────────────────────────
  // USUÁRIOS
  // ──────────────────────────────────────
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@mestredapintura.com.br" },
    update: {},
    create: {
      name: "Alberto Ruiz",
      email: "admin@mestredapintura.com.br",
      password: hashPassword("admin123"),
      role: Role.ADMIN,
      storeId: store067.id,
    },
  });

  const operatorUser = await prisma.user.upsert({
    where: { email: "logistica@mestredapintura.com.br" },
    update: {},
    create: {
      name: "Operador Logística",
      email: "logistica@mestredapintura.com.br",
      password: hashPassword("logistica123"),
      role: Role.OPERATOR,
      storeId: store067.id,
    },
  });

  // vendedores por loja
  const sellers = await Promise.all(
    stores.map((store, i) =>
      prisma.user.upsert({
        where: { email: `vendedor${store.code}@mestredapintura.com.br` },
        update: {},
        create: {
          name: `Vendedor Loja ${store.code}`,
          email: `vendedor${store.code}@mestredapintura.com.br`,
          password: hashPassword("vendedor123"),
          role: Role.SELLER,
          storeId: store.id,
        },
      })
    )
  );

  // motoristas
  const drivers = await Promise.all(
    stores.slice(0, 3).map((store) =>
      prisma.driver.upsert({
        where: { id: `driver_${store.code}` },
        update: {},
        create: {
          id: `driver_${store.code}`,
          name: `Motorista Loja ${store.code}`,
          phone: `(11) 9${store.code}00-0000`,
          storeId: store.id,
          vehicleType: "van",
          licensePlate: `ABC-${store.code}0`,
          active: true,
          available: true,
        },
      })
    )
  );

  console.log("✅ Usuários criados:", 2 + sellers.length, "— Motoristas:", drivers.length);
  console.log("\n🎉 Seed concluído com sucesso!");
  console.log("\n📋 Credenciais de acesso:");
  console.log("   Admin:    admin@mestredapintura.com.br / admin123");
  console.log("   Operador: logistica@mestredapintura.com.br / logistica123");
  console.log("   Vendedor: vendedor067@mestredapintura.com.br / vendedor123");
}

main()
  .catch((e) => {
    console.error("❌ Erro no seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
