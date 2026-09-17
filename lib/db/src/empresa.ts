import { asc, eq } from "drizzle-orm";
import type { Database } from "./index";
import { empresaTable } from "./schema/empresa";

/**
 * A EMPRESA — leitura, e o atalho que só os testes e a instalação única usam.
 *
 * A autoridade sobre "de qual empresa é esta requisição" **não está aqui**: ela
 * está na sessão, em `app_user.empresa_id`, lida por `escopoEfetivo` no
 * api-server. Este módulo existe para o que precisa falar de empresa sem ter
 * uma sessão em mãos — a criação da primeira conta pelo terminal, os testes, e
 * a migração de uma instalação que só tem uma.
 */

export interface Empresa {
  id: string;
  nome: string;
  cnpjRaiz: string | null;
  ativa: boolean;
}

const COLUNAS = {
  id: empresaTable.id,
  nome: empresaTable.nome,
  cnpjRaiz: empresaTable.cnpjRaiz,
  ativa: empresaTable.ativa,
};

/** As empresas cadastradas, da mais antiga para a mais nova. */
export async function listarEmpresas(db: Database): Promise<Empresa[]> {
  return db.select(COLUNAS).from(empresaTable).orderBy(asc(empresaTable.criadaEm));
}

export async function empresaPorId(db: Database, id: string): Promise<Empresa | null> {
  const [linha] = await db.select(COLUNAS).from(empresaTable).where(eq(empresaTable.id, id)).limit(1);
  return linha ?? null;
}

/**
 * A empresa da instalação — a primeira, e um erro quando há mais de uma.
 *
 * **O erro é o ponto.** Enquanto a instalação tem uma empresa só, "a empresa"
 * é uma pergunta com resposta, e é assim que a `0101` deixou o banco. No dia em
 * que a segunda existir, toda chamada que ainda depender desta função está
 * escolhendo tenant por sorte — e é muito melhor que ela pare com uma frase do
 * que devolva a primeira linha e siga em frente. Uma função que "funciona" em
 * multi-tenant devolvendo a mais antiga seria exatamente o atalho que o
 * isolamento não sobrevive.
 *
 * Por isso ela não é caminho de produção para nada que tenha sessão: quem tem
 * sessão usa a empresa da sessão.
 */
export async function empresaPrincipal(db: Database): Promise<Empresa> {
  const todas = await listarEmpresas(db);
  if (todas.length === 0) {
    throw new Error(
      "não há empresa cadastrada — a `0101` cria a primeira, então um banco sem " +
        "nenhuma é um banco que não passou pela fila de migrations",
    );
  }
  if (todas.length > 1) {
    throw new Error(
      `há ${todas.length} empresas cadastradas e esta chamada não disse de qual ela fala. ` +
        "Quem tem sessão usa a empresa da sessão (`escopoEfetivo`); quem não tem precisa " +
        "escolher explicitamente.",
    );
  }
  return todas[0]!;
}
