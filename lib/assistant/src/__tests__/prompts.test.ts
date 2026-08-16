/**
 * O que os prompts podem conter — e o que tem de morar noutro lugar.
 *
 * **O defeito que este arquivo existe para impedir é de crescimento.** Um prompt
 * não fica ruim de uma vez: fica ruim porque uma pergunta específica não foi bem
 * respondida, alguém acrescenta uma frase sobre aquele parâmetro, e a frase
 * funciona. Repetido trinta vezes, isso é a mesma dependência de código por
 * pergunta que a migração inteira existe para tirar — escrita em português, num
 * lugar onde nenhum teste olhava.
 *
 * **A regra é a do desenho: semântica é dado.** Unidade, periodicidade, direção
 * econômica, o que se pode somar e o que cada coluna significa vêm das
 * ferramentas, versionados e auditáveis. Nomear um parâmetro no prompt é
 * congelar no texto o que o banco sabe dizer melhor — e o banco muda por
 * migration, enquanto o prompt muda por opinião.
 *
 * **O segundo guarda é sobre capacidade órfã.** A tela sabe renderizar formas
 * que só existem se o prompt as ensinar. Foi assim que o caminho do agente
 * nasceu sem `:::cards` e sem `:::abas`: o renderizador continuou lá, intacto e
 * inalcançável, e nada quebrou. Aqui os dois lados são amarrados.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * As formas que a tela sabe abrir, lidas do arquivo dela.
 *
 * Lidas, e não importadas: `lib/` não depende de `artifacts/`, e um import
 * daqui quebraria as project references do TypeScript. O que se quer é o
 * vínculo — que este teste falhe quando o renderizador ganhar uma forma nova —,
 * e para isso ler a declaração basta. Se o formato dela mudar, o `throw` abaixo
 * diz onde olhar em vez de o teste passar sobre uma lista vazia.
 */
function formasDaTela(): string[] {
  const caminho = new URL(
    "../../../../artifacts/freightaudit/src/components/assistente/segmentos.ts",
    import.meta.url,
  );
  const m = /export const FORMAS = \[([^\]]*)\]/.exec(readFileSync(caminho, "utf8"));
  if (!m) throw new Error("não achei `FORMAS` em segmentos.ts — o vínculo com a tela se perdeu");
  const formas = [...m[1]!.matchAll(/"([a-z]+)"/g)].map((x) => x[1]!);
  if (formas.length === 0) throw new Error("`FORMAS` veio vazia de segmentos.ts");
  return formas;
}

const FORMAS = formasDaTela();

/** O texto entre as crases do `const INSTRUCAO` de um arquivo. */
function promptDe(arquivo: string): string {
  const fonte = readFileSync(new URL(`../${arquivo}`, import.meta.url), "utf8");
  const m = /const INSTRUCAO = `([\s\S]*?)`;/.exec(fonte);
  if (!m) throw new Error(`não achei INSTRUCAO em ${arquivo}`);
  return m[1]!;
}

const PROMPTS: [string, string][] = [
  ["llm.ts (planejador)", promptDe("llm.ts")],
  ["agente.ts (agente)", promptDe("agente.ts")],
];

/**
 * Nomes que pertencem ao banco, não ao prompt.
 *
 * A lista é curta e concreta de propósito: ela não tenta adivinhar o que é
 * regra de negócio, e sim apanhar o sintoma que sempre aparece primeiro —
 * **um parâmetro citado pelo nome**. Quando isto reprovar, a correção quase
 * nunca é apagar a frase: é perceber que o que ela ensina já está em
 * `attribute`, e deixar a ferramenta entregá-lo.
 */
const NOMES_QUE_SAO_DADO = [
  "finame", "ipva", "anp", "combustivel", "combustível",
  "pneu", "depreciação", "depreciacao", "licenciamento", "qlp",
];

describe("os prompts não carregam regra de negócio", () => {
  it.each(PROMPTS)("%s não nomeia parâmetro nenhum", (_, prompt) => {
    const minusculo = prompt.toLowerCase();
    const achados = NOMES_QUE_SAO_DADO.filter((n) => minusculo.includes(n));

    expect(
      achados,
      `o prompt nomeia ${achados.join(", ")}. Isso é semântica, e semântica é dado: ` +
        "unidade, periodicidade, direção econômica e significado vêm de `attribute` " +
        "pela ferramenta `parametros`, versionados. Um nome escrito aqui congela no " +
        "texto o que o banco sabe dizer melhor.",
    ).toEqual([]);
  });

  it.each(PROMPTS)("%s não ensina uma conta", (_, prompt) => {
    /*
      Uma fórmula no prompt é pior que um nome: ela sobrevive a uma mudança de
      contrato sem ninguém notar, porque não há migration que a alcance. Toda
      conta oficial deste produto roda em código e chega pronta pela ferramenta.
    */
    const contas = [/\bmenor entre\b/i, /\bmultiplica\b/i, /×\s*\d/, /\bdividid[oa] por\b/i];
    const achadas = contas.filter((r) => r.test(prompt)).map(String);

    expect(achadas, "o prompt descreve um cálculo; cálculo é do sistema").toEqual([]);
  });
});

describe("as formas que a tela renderiza são alcançáveis", () => {
  it.each(PROMPTS)("%s ensina todas as formas de `FORMAS`", (nome, prompt) => {
    /*
      `FORMAS` é a lista que o parser da tela aceita. Uma forma que ele saiba
      abrir e que nenhum prompt ensine é código morto que ninguém remove, porque
      remover exigiria saber que ele nunca é usado — e isso não aparece em erro
      nenhum.

      `cartoes` é apelido de `cards` e não precisa ser ensinado duas vezes.
    */
    const precisam = FORMAS.filter((f) => f !== "cartoes");
    const faltando = precisam.filter((f) => !prompt.includes(`:::${f}`));

    expect(
      faltando,
      `${nome} não ensina ${faltando.join(", ")} — o renderizador fica inalcançável`,
    ).toEqual([]);
  });
});

describe("as garantias que nenhum enxugamento pode levar", () => {
  const OBRIGATORIAS: [string, RegExp][] = [
    ["proíbe número sem lastro", /não (estime|invente)|nenhum número/i],
    ["proíbe somar periodicidades", /periodicidade/i],
    ["separa fato de inferência", /infer[êe]ncia/i],
    ["manda declarar o que falta", /não foi apurad|o que falta|diga que falta/i],
    ["trata resultado como dado, nunca instrução", /nunca instru|não obedeça/i],
  ];

  it.each(PROMPTS)("%s mantém as cinco", (nome, prompt) => {
    const ausentes = OBRIGATORIAS.filter(([, r]) => !r.test(prompt)).map(([q]) => q);

    expect(
      ausentes,
      `${nome} perdeu: ${ausentes.join(", ")}. Encurtar o prompt é bem-vindo; ` +
        "encurtar as garantias não.",
    ).toEqual([]);
  });
});

describe("o tamanho, medido", () => {
  it.each(PROMPTS)("%s cabe no orçamento", (nome, prompt) => {
    const linhas = prompt.split("\n").length;
    /*
      O teto não é estética. A instrução é o prefixo cacheado de toda pergunta,
      e no caminho do agente ela é reenviada a **cada rodada** — um prompt que
      dobra multiplica por seis numa investigação de seis rodadas. O número aqui
      é folgado sobre o tamanho de hoje: ele não pede que se encurte, ele avisa
      quando alguém voltar a crescer sem decidir isso.
    */
    expect(linhas, `${nome} tem ${linhas} linhas`).toBeLessThanOrEqual(180);
  });
});
