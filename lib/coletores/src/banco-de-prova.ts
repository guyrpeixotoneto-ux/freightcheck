import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  fechamentoCompetenciaTable,
  fechamentoCteTable,
  fechamentoDocumentoTable,
  unidadeTable,
  type Database,
} from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";
import {
  CTE_ATE_RECEBIMENTO,
  importarFluxo,
  lerFluxo,
} from "@workspace/fluxos";
import type { FluxoCompleto } from "@workspace/fluxos";

/**
 * O CENÁRIO DAS PROVAS — um banco descartável com o fluxo real e um extrato.
 *
 * Sai de `prova-cli.ts` porque agora são duas ferramentas de observação sobre o
 * mesmo cenário (a prova dos estados e o painel do fluxo), e duas cópias da
 * semeadura divergiriam na primeira coluna que alguém acrescentasse a uma só.
 *
 * Nada aqui é do produto: é a montagem que o `__tests__` faz, disponível também
 * para quem quer olhar com os olhos em vez de com `expect`.
 */

const ADMIN =
  process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5433/postgres";

export const CHAVE_DE_ACESSO = "3".repeat(44);

export interface BancoDeProva {
  db: Database;
  fechar(): Promise<void>;
}

function apontarPara(url: string, banco: string): string {
  const alvo = new URL(url);
  alvo.pathname = `/${banco}`;
  return alvo.toString();
}

/** Cria o banco, roda as migrations reais e devolve a conexão. */
export async function abrirBancoDeProva(sufixo: string): Promise<BancoDeProva> {
  const nome = `fc_${sufixo}_${process.pid}`;
  const admin = new pg.Pool({ connectionString: ADMIN });
  await admin.query(`DROP DATABASE IF EXISTS "${nome}"`);
  await admin.query(`CREATE DATABASE "${nome}"`);
  await admin.end();

  const url = apontarPara(ADMIN, nome);
  await runMigrations(url);
  const pool = new pg.Pool({ connectionString: url });

  return {
    db: drizzle(pool) as unknown as Database,
    async fechar() {
      await pool.end().catch(() => {});
      const limpeza = new pg.Pool({ connectionString: ADMIN });
      await limpeza.query(`DROP DATABASE IF EXISTS "${nome}"`);
      await limpeza.end();
    },
  };
}

export async function criarEmpresa(
  db: Database,
  nome: string,
  cnpj: string,
): Promise<string> {
  const [unidade] = await db
    .insert(unidadeTable)
    .values({ nome, cnpj })
    .returning();
  return unidade.id;
}

/** O fluxo CTe→Recebimento pelo caminho normal — `importarFluxo`, sem atalho. */
export async function cadastrarFluxoDoCte(
  db: Database,
  empresaId: string,
): Promise<FluxoCompleto> {
  const fluxo = await importarFluxo(db, empresaId, CTE_ATE_RECEBIMENTO, {
    email: "prova@exemplo.com",
  });
  const completo = await lerFluxo(db, empresaId, fluxo.id);
  if (!completo) throw new Error("o fluxo cadastrado sumiu");
  return completo;
}

/** Um 03.08.15 da quinzena, com as chaves de acesso que se pedir. */
export async function gravarExtrato(
  db: Database,
  opcoes: {
    empresaId: string;
    chave: string;
    inicio: string;
    enviadoEm: Date;
    controles: (string | null)[];
  },
): Promise<void> {
  const [competencia] = await db
    .insert(fechamentoCompetenciaTable)
    .values({
      chave: opcoes.chave,
      ano: Number(opcoes.chave.slice(0, 4)),
      mes: Number(opcoes.chave.slice(5, 7)),
      quinzena: opcoes.chave.endsWith("Q1") ? 1 : 2,
      inicio: opcoes.inicio,
      fim: opcoes.inicio,
      /* A chave única da competência é o código legado, e não a unidade
         canônica: duas empresas na mesma quinzena precisam de códigos
         diferentes para caberem no banco. */
      unidadeCodigo: opcoes.empresaId.slice(0, 8),
      unidadeId: opcoes.empresaId,
      transportadoraCodigo: "36",
    })
    .returning();
  const [documento] = await db
    .insert(fechamentoDocumentoTable)
    .values({
      competenciaId: competencia.id,
      tipo: "CTE",
      nomeDoArquivo: `03.08.15 ${opcoes.chave}.xlsx`,
      sha256: `${opcoes.chave}-${opcoes.empresaId}`,
      tamanhoEmBytes: 4096,
      enviadoEm: opcoes.enviadoEm,
    })
    .returning();
  await db.insert(fechamentoCteTable).values(
    opcoes.controles.map((controle, i) => ({
      documentoId: documento.id,
      competenciaId: competencia.id,
      linhaNoArquivo: i + 1,
      vbz: 5,
      verbaNome: "FRETE VARIAVEL",
      verbaNatureza: "VARIAVEL",
      canal: "ROTA",
      numero: String(90_000 + i),
      valorCte: "1234.56",
      controle,
    })),
  );
}
