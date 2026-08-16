import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { filtroDeVigenciaDisponivel } from "../predicados";

/**
 * A fronteira da disponibilidade — uma definição de "vigência disponível".
 *
 * O contrato que este arquivo transforma em máquina:
 *
 *   > Nenhuma leitura do produto decide sozinha o que é uma vigência
 *   > disponível. Quem responde é `filtroDeVigenciaDisponivel`.
 *
 * A auditoria contou o predicado `status <> 'SUPERSEDED'` copiado à mão em
 * quarenta e seis lugares de leitura, e mediu o custo da cópia: `getOverview`
 * esqueceu-o em cinco contadores, e o Painel passou a contar os fatos de
 * revisões substituídas. Quarenta e seis cópias de uma regra são quarenta e
 * seis chances de esquecer uma — e a quadragésima sétima é escrita por quem
 * nunca leu esta frase.
 *
 * **Esta prova é a rede, e aqui não há prisão em runtime.** Diferente da
 * fronteira de escrita, que tem a autoridade conferindo o statement no driver,
 * um predicado ausente não é um erro que dê para recusar: é um `WHERE` que
 * simplesmente traz linhas a mais. Ninguém percebe, porque o número continua
 * aparecendo — só está errado. Por isso a varredura é a defesa, e por isso ela
 * roda no CI e **nomeia o arquivo e a linha**.
 *
 * A varredura vem com caso de controle: uma asserção de ausência que não sabe
 * encontrar presença não prova nada.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * O que a varredura procura: a comparação por exclusão, em qualquer forma.
 *
 * `s.status <> 'SUPERSEDED'`, `status <> 'SUPERSEDED'`, o mesmo em aspas duplas
 * e a forma drizzle `${snapshotTable.status} <> 'SUPERSEDED'`. Não procura
 * `= 'CLOSED'`: escrever a forma afirmativa à mão também é uma segunda
 * definição, mas ela é rara e legível, e alargar o padrão a ponto de pegá-la
 * traria os índices parciais do schema junto.
 */
const COMPARACAO_POR_EXCLUSAO = /<>\s*['"]SUPERSEDED['"]/;

/**
 * Onde o predicado **pode** aparecer literal, e por quê.
 *
 * Não é lista de dispensa: cada linha é um lugar onde a autoridade não serve,
 * e serve por um motivo diferente.
 */
const ONDE_A_AUTORIDADE_NAO_ALCANCA = [
  {
    // O predicado de um índice parcial e o DDL da ponte de publicação. É
    // definição de estrutura, avaliada pelo Postgres na hora de manter o
    // índice — não há consulta aqui para delegar.
    prefixo: "lib/db/src/",
  },
  {
    // O caminho de escrita. Durante o `promote`, a vigência nova é DRAFT e a
    // busca pela viva que ela substitui precisa enxergar os dois estados:
    // `= 'CLOSED'` ali mudaria a promoção, não a leitura. É o único lugar do
    // produto em que `<> 'SUPERSEDED'` e `= 'CLOSED'` **não** são a mesma
    // pergunta.
    prefixo: "lib/ingest/src/",
  },
  {
    // A própria autoridade, que explica a diferença entre as duas formas.
    prefixo: "lib/availability/src/",
  },
];

function arquivosDeFonte(dir: string, saida: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const caminho = path.join(dir, entrada);
    if (statSync(caminho).isDirectory()) {
      if (entrada === "__tests__" || entrada === "node_modules" || entrada === "dist") {
        continue;
      }
      arquivosDeFonte(caminho, saida);
      continue;
    }
    if (entrada.endsWith(".ts") || entrada.endsWith(".tsx")) saida.push(caminho);
  }
  return saida;
}

/** Todo `src/` de produção do workspace: os pacotes e os artefatos. */
function fontesDoWorkspace(): string[] {
  const raizes: string[] = [];
  for (const grupo of ["lib", "artifacts"]) {
    const dir = path.join(RAIZ, grupo);
    for (const pacote of readdirSync(dir)) {
      const src = path.join(dir, pacote, "src");
      try {
        if (statSync(src).isDirectory()) raizes.push(src);
      } catch {
        /* pacote sem src */
      }
    }
  }
  raizes.push(path.join(RAIZ, "scripts/src"));
  return raizes.flatMap((r) => arquivosDeFonte(r));
}

/** As linhas de um arquivo que comparam por exclusão, fora de comentário. */
function linhasComOPredicado(caminho: string): { linha: number; texto: string }[] {
  return readFileSync(caminho, "utf8")
    .split("\n")
    .map((texto, i) => ({ linha: i + 1, texto }))
    .filter(({ texto }) => {
      const t = texto.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return false;
      return COMPARACAO_POR_EXCLUSAO.test(texto);
    });
}

describe("a fronteira da disponibilidade", () => {
  it("nenhuma leitura do produto define vigência disponível por conta própria", () => {
    const infratores: string[] = [];

    for (const caminho of fontesDoWorkspace()) {
      const relativo = path.relative(RAIZ, caminho);
      if (ONDE_A_AUTORIDADE_NAO_ALCANCA.some((e) => relativo.startsWith(e.prefixo))) {
        continue;
      }
      for (const { linha } of linhasComOPredicado(caminho)) {
        infratores.push(`${relativo}:${linha}`);
      }
    }

    expect(
      infratores,
      `Estas leituras decidem sozinhas o que é uma vigência disponível:\n` +
        `${infratores.join("\n")}\n\n` +
        `Use \`filtroDeVigenciaDisponivel(alias)\` de @workspace/availability. ` +
        `Se este lugar for mesmo uma exceção — DDL ou caminho de escrita —, ` +
        `declare-a em ONDE_A_AUTORIDADE_NAO_ALCANCA, com o motivo.`,
    ).toEqual([]);
  });

  it("controle: a varredura sabe encontrar o predicado onde ele legitimamente está", () => {
    /*
      Sem este caso, a asserção acima passaria também se o padrão estivesse
      errado — e uma varredura que não encontra nada em lugar nenhum é
      indistinguível de um repositório limpo. O caminho de escrita tem o
      predicado de propósito, e é ele que prova que a rede tem malha.
    */
    const encontrados = fontesDoWorkspace()
      .filter((c) => path.relative(RAIZ, c).startsWith("lib/ingest/src/"))
      .flatMap((c) => linhasComOPredicado(c));

    expect(encontrados.length).toBeGreaterThan(0);
  });

  it("o predicado da autoridade é a forma afirmativa, e afirma sobre o alias pedido", () => {
    // A varredura garante que ninguém escreva o predicado; este caso garante
    // que o que ela manda usar continua sendo o predicado certo.
    const { queryChunks } = filtroDeVigenciaDisponivel("abc") as unknown as {
      queryChunks: unknown[];
    };
    const texto = JSON.stringify(queryChunks);
    expect(texto).toContain("abc.status");
    expect(texto).toContain("CLOSED");
    expect(texto).not.toContain("SUPERSEDED");
  });
});
