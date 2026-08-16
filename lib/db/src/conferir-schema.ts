import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { readMigrations } from "./migrate";
import * as schema from "./schema";

/**
 * Comparar o schema declarado com o schema que está no banco.
 *
 * É a ação `CONFERIR_SCHEMA` do `diagnostico.ts`, que até aqui era só uma
 * frase: o diagnóstico dizia "compare o schema deste banco com o que as
 * migrations criam" e não havia com o quê.
 *
 * **O estado que isto existe para achar.** `SCHEMA_DIVERGENTE`: o registro de
 * migrations diz que todas rodaram e um objeto que elas criam não está lá.
 * Nenhuma contagem o revela — pela contagem está tudo em dia, e o `/healthz`
 * responde SAUDAVEL —, então a única forma de vê-lo é perguntar ao
 * `information_schema` o que existe de verdade e comparar com o que o
 * repositório declara. Foi assim que a fila de curadoria caiu com o resumo
 * intacto: faltava `attribute.definition`, e só ela a lia.
 *
 * Separado do `conferir-schema-cli.ts` pelo mesmo motivo de `migrate.ts`: um
 * módulo que só é importado por quem quer a função, e um módulo que só roda
 * quando alguém o executa.
 */

/** Uma coluna que o repositório declara e o banco não tem. */
export interface ColunaAusente {
  tabela: string;
  coluna: string;
}

export interface Divergencia {
  /** Tabelas declaradas que não existem no banco. */
  tabelasAusentes: string[];
  colunasAusentes: ColunaAusente[];
  /** Quantas tabelas este build declara — o denominador do "está em dia". */
  tabelasDeclaradas: number;
}

/**
 * O que o repositório declara, lido do próprio schema do drizzle.
 *
 * A fonte é `schema/index.ts` e não uma lista à parte: uma lista precisaria ser
 * lembrada a cada tabela nova, e a primeira vez que alguém esquecesse de
 * atualizá-la este módulo passaria a responder "tudo certo" sobre um banco a
 * que faltasse justamente a tabela nova.
 */
export function tabelasDeclaradas(): Map<string, Set<string>> {
  const tabelas = new Map<string, Set<string>>();
  for (const valor of Object.values(schema)) {
    if (!is(valor, PgTable)) continue;
    const config = getTableConfig(valor as PgTable);
    tabelas.set(
      config.name,
      new Set(config.columns.map((coluna) => coluna.name)),
    );
  }
  return tabelas;
}

/** O que o banco tem de verdade, como o `information_schema` o descreve. */
export function compararSchema(
  declaradas: Map<string, Set<string>>,
  reais: Map<string, Set<string>>,
): Divergencia {
  const tabelasAusentes: string[] = [];
  const colunasAusentes: ColunaAusente[] = [];

  for (const [tabela, colunas] of declaradas) {
    const real = reais.get(tabela);
    if (!real) {
      tabelasAusentes.push(tabela);
      continue;
    }
    for (const coluna of colunas) {
      if (!real.has(coluna)) colunasAusentes.push({ tabela, coluna });
    }
  }

  return { tabelasAusentes, colunasAusentes, tabelasDeclaradas: declaradas.size };
}

const ADD_COLUMN =
  /^alter\s+table\s+"?([a-z_][a-z0-9_]*)"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/i;

/**
 * O comando sem o que vem antes dele.
 *
 * As migrations deste repositório abrem com o porquê escrito por extenso, e o
 * primeiro trecho de um arquivo é comentário seguido de SQL — não há
 * `--> statement-breakpoint` entre os dois. Sem tirar as linhas de `--`, o
 * casamento ancorado falha exatamente nas migrations mais bem documentadas, e
 * a `0022_significado` — a que produziu o caso vivido — foi a primeira a
 * provar isso.
 */
export function semComentarioDeAbertura(comando: string): string {
  return comando.replace(/^(?:\s*--[^\n]*\n)+/, "").trim();
}

/**
 * O comando que repõe uma coluna, tirado da migration que a criou.
 *
 * Procura de trás para frente: se mais de uma migration mexeu na mesma coluna,
 * a última é a que descreve o estado que o build espera hoje.
 *
 * Só comandos que **são** um `ALTER TABLE … ADD COLUMN` inteiro entram. Um
 * `DO $$` que acrescente a coluna no meio de outra coisa é deliberadamente
 * ignorado: rodá-lo fora do seu contexto faria mais do que repor a coluna, e o
 * que isto promete é repor a coluna.
 *
 * **Por que não sintetizar o DDL a partir do schema do drizzle.** Seria
 * adivinhar tipo, default, `NOT NULL` e chave estrangeira — e uma coluna
 * reposta com o tipo quase certo é pior do que uma coluna ausente, porque para
 * de doer sem parar de estar errada.
 */
export function comandoQueRepoe(
  alvo: ColunaAusente,
  migrations = readMigrations(),
): string | undefined {
  for (let i = migrations.length - 1; i >= 0; i--) {
    for (const bruto of migrations[i]!.statements) {
      const comando = semComentarioDeAbertura(bruto);
      const achado = ADD_COLUMN.exec(comando);
      if (!achado) continue;
      if (achado[1] === alvo.tabela && achado[2] === alvo.coluna) {
        return comando.replace(/;\s*$/, "");
      }
    }
  }
  return undefined;
}
