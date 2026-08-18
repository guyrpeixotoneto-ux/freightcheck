import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import fleetAnalysisRouter from "../fleet-analysis";

/**
 * A escolha da planilha de frota, sobre os arquivos reais de `attached_assets`.
 *
 * O defeito que este arquivo guarda não derrubava nada: a tela de Análise de
 * Equipamentos abria inteira, com "0 vigências analisadas" no subtítulo e todos
 * os gráficos em branco. A rota escolhia o primeiro `.xlsx` que `readdirSync`
 * entregasse, e a pasta tem três — os dois modelos de importação chegam antes
 * da planilha de remuneração. Sem as abas `carretas` e `cavalos`,
 * `sheet_to_json` devolve `[]` em vez de reclamar, e o 200 com listas vazias
 * atravessa a API, o React Query e o React sem que ninguém tenha por onde
 * perceber que o arquivo lido era outro.
 *
 * Por isso a asserção central aqui é a que parece boba: **veio vigência**. Um
 * teste que só checasse o formato da resposta passaria com a rota quebrada.
 */

let servidor: Server;
let base: string;

async function get(caminho: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  const app = express();
  app.use(fleetAnalysisRouter);
  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = servidor.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
});

describe("/fleet-analysis", () => {
  it("lê a planilha que tem as abas carretas e cavalos, não a primeira do diretório", async () => {
    const { status, body } = await get("/fleet-analysis/summary");
    expect(status).toBe(200);

    expect(body.vigencias.length).toBeGreaterThan(0);
    expect(body.summary.length).toBe(body.vigencias.length);

    // As vigências vêm em ordem cronológica, e cada uma tem rótulo legível.
    for (const v of body.vigencias as string[]) {
      expect(body.vigenciaLabels[v]).toMatch(/^\w{3}\/\d{4}$/);
    }

    // Frota contada de verdade: alguma vigência tem carreta e cavalo.
    expect(body.summary.some((s: any) => s.totalCarretas > 0)).toBe(true);
    expect(body.summary.some((s: any) => s.totalCavalos > 0)).toBe(true);

    // E os valores somados saíram das colunas certas da planilha.
    expect(body.summary.some((s: any) => s.custoFixoCarretas > 0)).toBe(true);
    expect(body.summary.some((s: any) => s.valorFrotaCavalos > 0)).toBe(true);
  });

  it("recorta carretas e cavalos pela vigência pedida", async () => {
    const { body: summary } = await get("/fleet-analysis/summary");
    const vigencia: string = summary.vigencias[summary.vigencias.length - 1];
    const alvo = encodeURIComponent(vigencia);

    const { body: carretas } = await get(`/fleet-analysis/carretas?vigencia=${alvo}`);
    const { body: cavalos } = await get(`/fleet-analysis/cavalos?vigencia=${alvo}`);

    expect(carretas.length + cavalos.length).toBeGreaterThan(0);
    for (const linha of [...carretas, ...cavalos]) {
      expect(linha.Vigencia).toBe(vigencia);
    }
  });
});
