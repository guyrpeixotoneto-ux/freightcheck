/**
 * Seed script — dados demo FreightAudit
 * Dois snapshots Ambev/Freightec + diff + embarques Recife/Jaboatão
 *
 * Run: pnpm --filter @workspace/api-server run seed
 */
import { db, pool } from "@workspace/db";
import {
  snapshotsTable,
  parametersTable,
  snapshotDiffsTable,
  diffItemsTable,
  importJobsTable,
  shipmentsTable,
  alertsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("Limpando dados existentes...");
  await db.delete(alertsTable);
  await db.delete(diffItemsTable);
  await db.delete(snapshotDiffsTable);
  await db.delete(shipmentsTable);
  await db.delete(parametersTable);
  await db.delete(snapshotsTable);
  await db.delete(importJobsTable);

  console.log("Criando importações...");
  const [importA] = await db.insert(importJobsTable).values({
    sourceType: "EXCEL",
    filename: "tabela_remuneracao_jan2025.xlsx",
    status: "DONE",
    rowCount: 48,
    validCount: 48,
    warningCount: 0,
    errorCount: 0,
    notes: "Importação inicial — vigência Jan/2025",
  }).returning();

  const [importB] = await db.insert(importJobsTable).values({
    sourceType: "EXCEL",
    filename: "tabela_remuneracao_abr2025_revisada.xlsx",
    status: "DONE",
    rowCount: 48,
    validCount: 46,
    warningCount: 2,
    errorCount: 0,
    notes: "Revisão contratual Abril/2025 — redução diária, aumento espera",
  }).returning();

  console.log("Criando snapshots...");
  const [snapA] = await db.insert(snapshotsTable).values({
    label: "Contrato Jan/2025",
    snapshotDate: "2025-01-01",
    importJobId: importA.id,
    status: "ARCHIVED",
    isCurrent: false,
    parameterCount: 0,
    notes: "Modelo vigente de Janeiro a Março/2025. Versão base para comparação.",
  }).returning();

  const [snapB] = await db.insert(snapshotsTable).values({
    label: "Revisão Abr/2025",
    snapshotDate: "2025-04-01",
    importJobId: importB.id,
    status: "ACTIVE",
    isCurrent: true,
    parameterCount: 0,
    notes: "Revisão contratual vigente desde 01/04/2025. Redução de diária e KM, aumento do valor de espera.",
  }).returning();

  console.log("Criando parâmetros — Snapshot A (Jan/2025)...");
  const paramsAData = [
    // Operação Recife — Truck
    { key: "DIARIA_RECIFE_TRUCK",      name: "Diária — Recife / Truck",          cat: "TARIFF",    dt: "NUMERIC", unit: "BRL",        val: "850.00",  scope: "Recife / Truck" },
    { key: "KM_RECIFE_TRUCK",          name: "KM Rodado — Recife / Truck",       cat: "TARIFF",    dt: "NUMERIC", unit: "BRL_PER_KM", val: "2.80",    scope: "Recife / Truck" },
    { key: "ESPERA_RECIFE_TRUCK",      name: "Hora de Espera — Recife / Truck",  cat: "SURCHARGE", dt: "NUMERIC", unit: "BRL",        val: "45.00",   scope: "Recife / Truck" },
    { key: "AJUDANTE_RECIFE_TRUCK",    name: "Ajudante por Viagem — Recife/Truck", cat: "SURCHARGE", dt: "NUMERIC", unit: "BRL",     val: "120.00",  scope: "Recife / Truck" },
    // Operação Recife — Carreta
    { key: "DIARIA_RECIFE_CARRETA",    name: "Diária — Recife / Carreta",         cat: "TARIFF",    dt: "NUMERIC", unit: "BRL",       val: "1250.00", scope: "Recife / Carreta" },
    { key: "KM_RECIFE_CARRETA",        name: "KM Rodado — Recife / Carreta",      cat: "TARIFF",    dt: "NUMERIC", unit: "BRL_PER_KM", val: "3.40",   scope: "Recife / Carreta" },
    { key: "ESPERA_RECIFE_CARRETA",    name: "Hora de Espera — Recife/Carreta",   cat: "SURCHARGE", dt: "NUMERIC", unit: "BRL",       val: "45.00",   scope: "Recife / Carreta" },
    // Operação Jaboatão — Truck
    { key: "DIARIA_JABOTAO_TRUCK",     name: "Diária — Jaboatão / Truck",         cat: "TARIFF",    dt: "NUMERIC", unit: "BRL",       val: "820.00",  scope: "Jaboatão / Truck" },
    { key: "KM_JABOTAO_TRUCK",         name: "KM Rodado — Jaboatão / Truck",      cat: "TARIFF",    dt: "NUMERIC", unit: "BRL_PER_KM", val: "2.75",   scope: "Jaboatão / Truck" },
    { key: "ESPERA_JABOTAO_TRUCK",     name: "Hora de Espera — Jaboatão/Truck",   cat: "SURCHARGE", dt: "NUMERIC", unit: "BRL",       val: "45.00",   scope: "Jaboatão / Truck" },
    // Operação Jaboatão — Carreta
    { key: "DIARIA_JABOTAO_CARRETA",   name: "Diária — Jaboatão / Carreta",       cat: "TARIFF",    dt: "NUMERIC", unit: "BRL",       val: "1220.00", scope: "Jaboatão / Carreta" },
    { key: "KM_JABOTAO_CARRETA",       name: "KM Rodado — Jaboatão / Carreta",    cat: "TARIFF",    dt: "NUMERIC", unit: "BRL_PER_KM", val: "3.30",   scope: "Jaboatão / Carreta" },
    { key: "ESPERA_JABOTAO_CARRETA",   name: "Hora de Espera — Jaboatão/Carreta", cat: "SURCHARGE", dt: "NUMERIC", unit: "BRL",       val: "45.00",   scope: "Jaboatão / Carreta" },
    // Políticas gerais
    { key: "PEDAGIO_REEMBOLSO",        name: "Reembolso de Pedágio",              cat: "SURCHARGE", dt: "BOOLEAN", unit: null,        val: null,  scope: null, valText: "SIM" },
    { key: "SEGURO_CARGA_PERC",        name: "Seguro de Carga (%)",               cat: "SURCHARGE", dt: "PERCENTAGE", unit: null,     val: "0.30",   scope: null },
    { key: "BONUS_PONTUALIDADE",       name: "Bônus de Pontualidade",             cat: "BONUS",     dt: "NUMERIC", unit: "BRL",       val: "200.00",  scope: null },
    { key: "MULTA_AVARIA",             name: "Multa por Avaria",                  cat: "PENALTY",   dt: "NUMERIC", unit: "BRL",       val: "500.00",  scope: null },
  ];

  const insertedParamsA = await Promise.all(paramsAData.map((p) =>
    db.insert(parametersTable).values({
      snapshotId: snapA.id,
      parameterKey: p.key,
      parameterName: p.name,
      category: p.cat,
      dataType: p.dt,
      unit: p.unit ?? null,
      scopeLabel: p.scope ?? null,
      valueNumeric: p.val ?? null,
      valueText: (p as any).valText ?? null,
      effectiveFrom: "2025-01-01",
      effectiveUntil: "2025-03-31",
      version: 1,
    }).returning()
  ));

  await db.update(snapshotsTable)
    .set({ parameterCount: paramsAData.length })
    .where(eq(snapshotsTable.id, snapA.id));

  console.log("Criando parâmetros — Snapshot B (Abr/2025)...");
  const paramsBData = [
    // Recife — Truck (diária e km reduzidos, espera aumentada)
    { key: "DIARIA_RECIFE_TRUCK",      name: "Diária — Recife / Truck",          cat: "TARIFF",    dt: "NUMERIC", unit: "BRL",        val: "810.00",  scope: "Recife / Truck" },
    { key: "KM_RECIFE_TRUCK",          name: "KM Rodado — Recife / Truck",       cat: "TARIFF",    dt: "NUMERIC", unit: "BRL_PER_KM", val: "2.65",    scope: "Recife / Truck" },
    { key: "ESPERA_RECIFE_TRUCK",      name: "Hora de Espera — Recife / Truck",  cat: "SURCHARGE", dt: "NUMERIC", unit: "BRL",        val: "55.00",   scope: "Recife / Truck" },
    { key: "AJUDANTE_RECIFE_TRUCK",    name: "Ajudante por Viagem — Recife/Truck", cat: "SURCHARGE", dt: "NUMERIC", unit: "BRL",     val: "120.00",  scope: "Recife / Truck" },
    // Recife — Carreta
    { key: "DIARIA_RECIFE_CARRETA",    name: "Diária — Recife / Carreta",         cat: "TARIFF",    dt: "NUMERIC", unit: "BRL",       val: "1190.00", scope: "Recife / Carreta" },
    { key: "KM_RECIFE_CARRETA",        name: "KM Rodado — Recife / Carreta",      cat: "TARIFF",    dt: "NUMERIC", unit: "BRL_PER_KM", val: "3.20",   scope: "Recife / Carreta" },
    { key: "ESPERA_RECIFE_CARRETA",    name: "Hora de Espera — Recife/Carreta",   cat: "SURCHARGE", dt: "NUMERIC", unit: "BRL",       val: "55.00",   scope: "Recife / Carreta" },
    // Jaboatão — Truck (mesmos ajustes)
    { key: "DIARIA_JABOTAO_TRUCK",     name: "Diária — Jaboatão / Truck",         cat: "TARIFF",    dt: "NUMERIC", unit: "BRL",       val: "780.00",  scope: "Jaboatão / Truck" },
    { key: "KM_JABOTAO_TRUCK",         name: "KM Rodado — Jaboatão / Truck",      cat: "TARIFF",    dt: "NUMERIC", unit: "BRL_PER_KM", val: "2.60",   scope: "Jaboatão / Truck" },
    { key: "ESPERA_JABOTAO_TRUCK",     name: "Hora de Espera — Jaboatão/Truck",   cat: "SURCHARGE", dt: "NUMERIC", unit: "BRL",       val: "55.00",   scope: "Jaboatão / Truck" },
    // Jaboatão — Carreta
    { key: "DIARIA_JABOTAO_CARRETA",   name: "Diária — Jaboatão / Carreta",       cat: "TARIFF",    dt: "NUMERIC", unit: "BRL",       val: "1160.00", scope: "Jaboatão / Carreta" },
    { key: "KM_JABOTAO_CARRETA",       name: "KM Rodado — Jaboatão / Carreta",    cat: "TARIFF",    dt: "NUMERIC", unit: "BRL_PER_KM", val: "3.10",   scope: "Jaboatão / Carreta" },
    { key: "ESPERA_JABOTAO_CARRETA",   name: "Hora de Espera — Jaboatão/Carreta", cat: "SURCHARGE", dt: "NUMERIC", unit: "BRL",       val: "55.00",   scope: "Jaboatão / Carreta" },
    // Políticas (sem alteração)
    { key: "PEDAGIO_REEMBOLSO",        name: "Reembolso de Pedágio",              cat: "SURCHARGE", dt: "BOOLEAN", unit: null,        val: null,  scope: null, valText: "SIM" },
    { key: "SEGURO_CARGA_PERC",        name: "Seguro de Carga (%)",               cat: "SURCHARGE", dt: "PERCENTAGE", unit: null,     val: "0.30",   scope: null },
    { key: "BONUS_PONTUALIDADE",       name: "Bônus de Pontualidade",             cat: "BONUS",     dt: "NUMERIC", unit: "BRL",       val: "200.00",  scope: null },
    { key: "MULTA_AVARIA",             name: "Multa por Avaria",                  cat: "PENALTY",   dt: "NUMERIC", unit: "BRL",       val: "500.00",  scope: null },
  ];

  await Promise.all(paramsBData.map((p) =>
    db.insert(parametersTable).values({
      snapshotId: snapB.id,
      parameterKey: p.key,
      parameterName: p.name,
      category: p.cat,
      dataType: p.dt,
      unit: p.unit ?? null,
      scopeLabel: p.scope ?? null,
      valueNumeric: p.val ?? null,
      valueText: (p as any).valText ?? null,
      effectiveFrom: "2025-04-01",
      effectiveUntil: null,
      version: 2,
    }).returning()
  ));

  await db.update(snapshotsTable)
    .set({ parameterCount: paramsBData.length })
    .where(eq(snapshotsTable.id, snapB.id));

  console.log("Calculando diff...");
  const mapA = new Map(paramsAData.map((p) => [p.key, p]));
  const mapB = new Map(paramsBData.map((p) => [p.key, p]));
  const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

  const diffItemsData: any[] = [];
  let totalAdded = 0, totalRemoved = 0, totalChanged = 0, totalUnchanged = 0;

  for (const key of allKeys) {
    const a = mapA.get(key);
    const b = mapB.get(key);
    const nameA = a?.name ?? b?.name ?? key;

    if (!a && b) {
      totalAdded++;
      diffItemsData.push({ key, name: nameA, changeType: "ADDED", changeNature: "NEW_RULE", severity: "MEDIUM", valBefore: null, valAfter: b.val });
    } else if (a && !b) {
      totalRemoved++;
      diffItemsData.push({ key, name: nameA, changeType: "REMOVED", changeNature: "REMOVED_RULE", severity: "HIGH", valBefore: a.val, valAfter: null });
    } else if (a && b) {
      if (a.val === b.val && (a as any).valText === (b as any).valText) {
        totalUnchanged++;
        diffItemsData.push({ key, name: nameA, changeType: "UNCHANGED", changeNature: null, severity: "UNKNOWN", valBefore: a.val, valAfter: b.val, unit: a.unit });
      } else {
        totalChanged++;
        const numA = a.val ? Number(a.val) : null;
        const numB = b.val ? Number(b.val) : null;
        const delta = numA !== null && numB !== null ? numB - numA : null;
        const deltaPerc = numA !== null && numB !== null && numA !== 0 ? ((numB - numA) / Math.abs(numA)) * 100 : null;
        const sev = deltaPerc ? Math.abs(deltaPerc) >= 10 ? "HIGH" : Math.abs(deltaPerc) >= 5 ? "MEDIUM" : "LOW" : "UNKNOWN";
        diffItemsData.push({ key, name: nameA, changeType: "CHANGED", changeNature: "PRICE_CHANGE", severity: sev, valBefore: a.val, valAfter: b.val, delta, deltaPerc, unit: a.unit });
      }
    }
  }

  // Estimated total monthly impact (simplified: sum of diária changes × 200 trips/month)
  const estimatedImpact = diffItemsData
    .filter((d) => d.changeType === "CHANGED" && d.delta !== undefined)
    .reduce((acc, d) => acc + (d.delta ?? 0) * 200, 0);

  const [diff] = await db.insert(snapshotDiffsTable).values({
    snapshotAId: snapA.id,
    snapshotBId: snapB.id,
    status: "DONE",
    totalAdded,
    totalRemoved,
    totalChanged,
    totalUnchanged,
    estimatedMonthlyImpact: estimatedImpact.toFixed(2),
    notes: "Comparativo automático gerado durante o seed.",
  }).returning();

  // Insert diff items
  for (const d of diffItemsData) {
    await db.insert(diffItemsTable).values({
      diffId: diff.id,
      entityType: "PARAMETER",
      entityKey: d.key,
      entityName: d.name,
      changeType: d.changeType,
      changeNature: d.changeNature ?? null,
      severity: d.severity,
      valueBefore: d.valBefore ?? null,
      valueAfter: d.valAfter ?? null,
      deltaAbsolute: d.delta?.toString() ?? null,
      deltaPercent: d.deltaPerc?.toFixed(4) ?? null,
      estimatedMonthlyImpact: d.delta ? (d.delta * 200).toFixed(2) : null,
      unit: d.unit ?? null,
    });
  }

  console.log("Criando embarques demo...");
  const shipmentRows = [];
  const ops = [
    { op: "REC-TRUCK",  origin: "PE-REC", dest: "PE-REC-CD1", vehicle: "TRUCK",   km: 85,  weight: 8000,  delivers: 18, wait: 1.5,  paid: 1234.50 },
    { op: "REC-CARRETA", origin: "PE-REC", dest: "PE-REC-CD2", vehicle: "CARRETA", km: 120, weight: 22000, delivers: 8,  wait: 2.0,  paid: 1880.00 },
    { op: "JAB-TRUCK",  origin: "PE-JAB", dest: "PE-JAB-CD1", vehicle: "TRUCK",   km: 72,  weight: 7500,  delivers: 15, wait: 1.0,  paid: 1085.00 },
    { op: "JAB-CARRETA", origin: "PE-JAB", dest: "PE-JAB-CD2", vehicle: "CARRETA", km: 95,  weight: 20000, delivers: 7,  wait: 1.5,  paid: 1640.00 },
  ];

  // Generate 90 shipments over last 3 months
  for (let i = 0; i < 90; i++) {
    const daysAgo = Math.floor(Math.random() * 90);
    const d = new Date("2025-06-01");
    d.setDate(d.getDate() - daysAgo);
    const dateStr = d.toISOString().split("T")[0];
    const op = ops[i % ops.length];
    const jitter = (min: number, max: number) => +(min + Math.random() * (max - min)).toFixed(2);

    shipmentRows.push({
      externalId: `EXP-2025-${String(i + 1).padStart(5, "0")}`,
      shipmentDate: dateStr,
      operationCode: op.op,
      originCode: op.origin,
      destinationCode: op.dest,
      vehicleType: op.vehicle,
      vehicleId: `${op.vehicle.slice(0, 3)}-${String(i + 1).padStart(3, "0")}`,
      distanceKm: jitter(op.km * 0.9, op.km * 1.1).toString(),
      weightKg: jitter(op.weight * 0.8, op.weight * 1.2).toString(),
      deliveriesCount: op.delivers,
      waitingTimeHours: jitter(op.wait * 0.8, op.wait * 1.5).toString(),
      actualAmountPaid: jitter(op.paid * 0.9, op.paid * 1.1).toString(),
      importJobId: importA.id,
    });
  }

  for (const row of shipmentRows) {
    await db.insert(shipmentsTable).values(row);
  }

  console.log("Criando alertas...");
  await db.insert(alertsTable).values([
    {
      alertType: "PARAMETER_CHANGE",
      severity: "HIGH",
      title: "Redução de diária — Recife / Truck",
      body: "A diária da operação Recife / Truck foi reduzida de R$ 850,00 para R$ 810,00 (-4,7%). Impacto mensal estimado: R$ -8.000,00.",
      sourceDiffId: diff.id,
      estimatedImpact: "-8000.00",
      isRead: false,
      isDismissed: false,
    },
    {
      alertType: "PARAMETER_CHANGE",
      severity: "HIGH",
      title: "Redução de KM rodado — múltiplas operações",
      body: "O valor por KM rodado foi reduzido em 5,4% (Recife/Truck: R$ 2,80→R$ 2,65) e 5,9% (Recife/Carreta: R$ 3,40→R$ 3,20). Revise o impacto nos trajetos mais longos.",
      sourceDiffId: diff.id,
      estimatedImpact: "-12000.00",
      isRead: false,
      isDismissed: false,
    },
    {
      alertType: "PARAMETER_CHANGE",
      severity: "MEDIUM",
      title: "Aumento da hora de espera — todas as operações",
      body: "O valor de espera aumentou de R$ 45,00 para R$ 55,00/hora (+22,2%) em todas as operações. Pode compensar parcialmente a redução na diária em rotas com alta espera.",
      sourceDiffId: diff.id,
      estimatedImpact: "6000.00",
      isRead: false,
      isDismissed: false,
    },
    {
      alertType: "NEW_SNAPSHOT",
      severity: "LOW",
      title: "Novo snapshot ativo: Revisão Abr/2025",
      body: "O snapshot Revisão Abr/2025 foi marcado como modelo atual. Vigência: a partir de 01/04/2025.",
      estimatedImpact: null,
      isRead: true,
      isDismissed: false,
    },
  ]);

  console.log("Seed concluído.");
  console.log(`  Snapshots: 2 (${snapA.id.slice(0, 8)}…, ${snapB.id.slice(0, 8)}…)`);
  console.log(`  Parâmetros: ${paramsAData.length + paramsBData.length}`);
  console.log(`  Diff: 1 (${diff.id.slice(0, 8)}…) — +${totalAdded} −${totalRemoved} ~${totalChanged} =${totalUnchanged}`);
  console.log(`  Embarques: ${shipmentRows.length}`);
  console.log(`  Alertas: 4`);

  await pool.end();
}

seed().catch((err) => {
  console.error("Seed falhou:", err);
  process.exit(1);
});
