import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DICIONARIO_CANONICO, NUCLEO_CANONICO } from "@workspace/db";

/**
 * A guarda da prova final — para que ela não vire ficção por decurso de prazo.
 *
 * `docs/PROVA-FINAL-DA-AUDITORIA.md` responde às sete perguntas que encerram a
 * auditoria citando teste e medição em cada resposta. É o documento mais fácil
 * de citar depois e o mais fácil de apodrecer: um teste renomeado, uma tabela
 * acrescentada ao núcleo canônico, um quinto estado de vazio — e o documento
 * continua afirmando, com a mesma confiança, o que deixou de ser verdade.
 *
 * Um documento que descreve garantias e não é conferido por nada é a forma
 * mais educada de "não há dados": ele responde à pergunta sem responder pelo
 * conteúdo.
 *
 * **O que esta guarda cobre e o que não cobre.** Ela confere as afirmações que
 * têm um referente verificável no código — os arquivos de teste citados, as
 * listas de tabelas, os estados do vazio, a contagem de consumidores e os elos
 * do diagnóstico. Ela **não** confere a prosa: nada aqui garante que a
 * explicação de por que a curadoria não alcança o núcleo continue verdadeira.
 * Isso é revisão humana, e é honesto dizer que é.
 */

const RAIZ = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const PROVA = readFileSync(
  path.join(RAIZ, "docs/PROVA-FINAL-DA-AUDITORIA.md"),
  "utf8",
);

/** Todo arquivo `*.test.ts` do repositório, indexado pelo nome-base. */
function testesDoRepositorio(): Map<string, string[]> {
  const indice = new Map<string, string[]>();
  const descer = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      const caminho = path.join(dir, entrada);
      if (statSync(caminho).isDirectory()) {
        if (entrada === "node_modules" || entrada === "dist") continue;
        descer(caminho);
        continue;
      }
      if (!entrada.endsWith(".test.ts") && !entrada.endsWith(".test.tsx")) continue;
      const lista = indice.get(entrada) ?? [];
      lista.push(path.relative(RAIZ, caminho));
      indice.set(entrada, lista);
    }
  };
  for (const grupo of ["lib", "artifacts", "scripts"]) {
    const dir = path.join(RAIZ, grupo);
    try {
      descer(dir);
    } catch {
      /* grupo ausente */
    }
  }
  return indice;
}

describe("a prova final cita testes que existem", () => {
  it("todo arquivo de teste citado no documento está no repositório", () => {
    const citados = [
      ...new Set(
        [...PROVA.matchAll(/`([^`]*?([\w.-]+\.test\.tsx?))`/g)].map((m) => m[2]),
      ),
    ];

    // Controle: uma varredura que não acha citação nenhuma passaria calada.
    expect(citados.length, "o documento deixou de citar testes").toBeGreaterThan(10);

    const indice = testesDoRepositorio();
    const ausentes = citados.filter((nome) => !indice.has(nome));
    expect(
      ausentes,
      "a prova final cita teste que não existe mais — renomeado ou apagado",
    ).toEqual([]);
  });
});

describe("a prova final descreve o canônico que existe", () => {
  it("as nove tabelas do núcleo são as que a autoridade protege", () => {
    /*
      A lista sai do documento e é conferida contra `autoridade.ts`, e não o
      contrário: o risco é o documento envelhecer, não a autoridade.
    */
    const bloco = PROVA.split("**Núcleo canônico (9 tabelas):**")[1]?.split(
      "**Dicionário",
    )[0];
    expect(bloco, "a seção do núcleo canônico sumiu do documento").toBeDefined();

    const citadas = [...bloco!.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).sort();
    expect(citadas).toEqual([...NUCLEO_CANONICO].sort());
    // E o título tem de dizer o número certo, porque é ele que se lê de relance.
    expect(PROVA).toContain(`**Núcleo canônico (${NUCLEO_CANONICO.length} tabelas):**`);
  });

  it("as três tabelas do dicionário são as que a autoridade separa", () => {
    const bloco = PROVA.split("**Dicionário (3):**")[1]?.split("\n\n")[0];
    expect(bloco, "a seção do dicionário sumiu do documento").toBeDefined();

    const citadas = [...bloco!.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).sort();
    expect(citadas).toEqual([...DICIONARIO_CANONICO].sort());
    expect(PROVA).toContain(`**Dicionário (${DICIONARIO_CANONICO.length}):**`);
  });
});

describe("a prova final descreve o vocabulário que existe", () => {
  it("os quatro estados do vazio são os quatro que `vazio.ts` declara", () => {
    const vazio = readFileSync(
      path.join(RAIZ, "lib/availability/src/vazio.ts"),
      "utf8",
    );
    const declarados = [
      ...new Set([...vazio.matchAll(/estado:\s*"([A-Z_]+)"/g)].map((m) => m[1])),
    ].sort();

    // Controle: se a extração parar de achar estados, ela não prova nada.
    expect(declarados.length).toBe(4);

    for (const estado of declarados) {
      expect(PROVA, `a prova final não menciona ${estado}`).toContain(estado);
    }

    /*
      E a regra de ouro, literal. É a única frase do documento que vale como
      contrato — as outras explicam, esta obriga.
    */
    expect(PROVA).toContain(
      'um módulo só pode dizer "não há dados" quando `NAO_EXISTE`',
    );
  });
});

describe("a prova final conta o que a matriz mede", () => {
  const matriz = () =>
    readFileSync(
      path.join(RAIZ, "artifacts/api-server/src/routes/__tests__/matriz-de-propagacao.test.ts"),
      "utf8",
    );

  const consumidoresDe = (fonte: string, constante: string) => {
    const bloco = fonte.split(`const ${constante}: Consumidor[] = [`)[1];
    expect(bloco, `${constante} sumiu da matriz`).toBeDefined();
    return [...bloco!.split("\n];")[0].matchAll(/^\s{4}modulo:/gm)].length;
  };

  it("as duas portas listam tantos consumidores quantos a matriz exercita", () => {
    const fonte = matriz();
    const daVigencia = consumidoresDe(fonte, "CONSUMIDORES_DA_VIGENCIA");
    const doChamado = consumidoresDe(fonte, "CONSUMIDORES_DO_CHAMADO");

    expect(daVigencia).toBeGreaterThan(0);
    expect(doChamado).toBeGreaterThan(0);

    expect(
      PROVA,
      `a matriz exercita ${daVigencia} consumidores na porta 1 e o documento diz outro número`,
    ).toContain(`### Porta 1 — Importações: ${daVigencia} consumidores`);
    expect(
      PROVA,
      `a matriz exercita ${doChamado} consumidores na porta 2 e o documento diz outro número`,
    ).toContain(`### Porta 2 — Alterações · Chamados: ${doChamado} consumidores`);

    // E o total da pergunta 4, que é a soma e por isso a mais fácil de esquecer.
    expect(PROVA).toContain(
      `${porExtenso(daVigencia + doChamado)} leituras, medidas pela matriz`,
    );
  });

  it("os seis elos do diagnóstico são os que o documento tabela", () => {
    const fonte = matriz();
    const uniao = fonte.split("type Elo =")[1]?.split(";")[0];
    expect(uniao, "o tipo `Elo` sumiu da matriz").toBeDefined();

    const elos = [...uniao!.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(elos.length).toBe(6);

    for (const elo of elos) {
      expect(PROVA, `a prova final não tabela o elo ${elo}`).toContain(`\`${elo}\``);
    }
  });
});

/**
 * O número por extenso, para os poucos lugares em que o texto o escreve assim.
 *
 * Existe porque a alternativa era o documento escrever "23 leituras" no meio de
 * uma frase — e a prosa desta auditoria não faz isso. Cobre só a faixa em que a
 * matriz pode plausivelmente estar; fora dela, devolve o algarismo, que é feio
 * e faz o teste falhar em vez de passar por engano.
 */
function porExtenso(n: number): string {
  const nomes: Record<number, string> = {
    20: "Vinte", 21: "Vinte e uma", 22: "Vinte e duas", 23: "Vinte e três",
    24: "Vinte e quatro", 25: "Vinte e cinco", 26: "Vinte e seis",
  };
  return nomes[n] ?? String(n);
}
