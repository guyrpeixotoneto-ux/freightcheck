import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A fronteira do contexto na interface — um seletor, e não quatro.
 *
 * O contrato que este arquivo transforma em máquina:
 *
 *   > Nenhuma tela escreve o próprio seletor de unidade, canal ou vigência.
 *   > Quem escolhe contexto é `BarraDeContexto`, e a regra da troca é
 *   > `aplicarContexto`.
 *
 * A auditoria gastou treze PRs tirando de circulação as definições concorrentes
 * de contexto no banco e nos módulos de leitura. Enquanto isso, a interface
 * tinha **três**: `ContextBar`, escrita, completa e montada em tela nenhuma; o
 * dropdown "Trocar unidade" de Início; e a barra de filtro de Parâmetros, com
 * botão FILTRAR. Três formas de escolher a mesma unidade divergem no dia em que
 * uma aprende algo que as outras não — e uma já tinha aprendido: só Início
 * apagava a vigência ao trocar de unidade, e as outras levavam a data de
 * Camaçari para Juiz de Fora.
 *
 * A varredura é de texto, no estilo de `sidebar.test.ts`, e pelo mesmo motivo:
 * importar uma tela traria React, o roteador e o Tanstack Query para uma suíte
 * que roda em Node sem DOM, e o que se verifica aqui não é o comportamento de
 * nenhum dos três — é que as telas montem o mesmo componente.
 */

const RAIZ = path.resolve(import.meta.dirname, "../../..");
const fonte = (relativo: string) => readFileSync(path.join(RAIZ, relativo), "utf8");

/**
 * As telas que recortam por contexto, e o que cada uma faz com a barra.
 *
 * A lista é declarada, e não descoberta por varredura, porque as três últimas
 * são o ponto: uma tela pode legitimamente **não** ter a barra, e a razão tem
 * de estar escrita em algum lugar que alguém leia. Aqui.
 */
const TELAS: { arquivo: string; monta: boolean; porque: string }[] = [
  {
    arquivo: "pages/inicio.tsx",
    monta: true,
    porque: "abre no contexto mais recente e oferece a troca",
  },
  { arquivo: "pages/vigencia.tsx", monta: true, porque: "Acompanhamento recorta por contexto" },
  { arquivo: "pages/parametros.tsx", monta: true, porque: "a grade é do contexto escolhido" },
  { arquivo: "pages/dre.tsx", monta: true, porque: "a apuração é da unidade e da vigência" },
  { arquivo: "pages/composicao.tsx", monta: true, porque: "a composição é da vigência" },
  {
    arquivo: "pages/unidades.tsx",
    monta: false,
    porque:
      "esta tela **é** a lista de contextos. Um seletor de contexto aqui escolheria " +
      "dentro do que a própria tela está listando",
  },
  {
    arquivo: "pages/dre-veiculo.tsx",
    monta: false,
    porque:
      "é a apuração de um veículo, e o veículo existe numa unidade só. Trocar a " +
      "unidade aqui não mostraria outro recorte: quebraria a consulta do ativo",
  },
  {
    arquivo: "pages/composicao-equipamento.tsx",
    monta: false,
    porque: "mesma razão da DRE do veículo — o equipamento pertence a um contexto",
  },
];

/**
 * O que caracteriza um seletor de contexto escrito à mão.
 *
 * A marca é **escrever o recorte na navegação** — trocar a unidade ou o canal
 * do endereço do navegador. Não é ler o recorte da URL para montar a consulta
 * da API: isso toda tela faz, e tem de fazer.
 *
 * A primeira versão desta varredura não distinguia as duas coisas e acusou três
 * telas inocentes, que apenas repassavam ao servidor o recorte que receberam.
 * Uma rede que pega o que não deve treina quem a lê a ignorá-la.
 */
const SELETOR_PROPRIO = [
  /onValueChange=\{[^}]*scopeHash/,
  /onSelect=\{[^}]*scopeHash/,
  /navigate\(`[^`]*scopeHash/,
  /navegar\(`[^`]*scopeHash/,
  /\bnext\.set\("scopeHash"/,
];

describe("a fronteira do contexto na interface", () => {
  it("toda tela que recorta por contexto monta a barra — ou diz por que não", () => {
    for (const tela of TELAS) {
      const texto = fonte(tela.arquivo);
      const monta = texto.includes("<BarraDeContexto");
      expect(
        monta,
        tela.monta
          ? `${tela.arquivo} deveria montar <BarraDeContexto> (${tela.porque})`
          : `${tela.arquivo} não deveria montar a barra: ${tela.porque}`,
      ).toBe(tela.monta);
    }
  });

  it("nenhuma tela escreve o próprio seletor de unidade ou canal", () => {
    const infratores: string[] = [];
    for (const tela of TELAS) {
      const texto = fonte(tela.arquivo);
      for (const padrao of SELETOR_PROPRIO) {
        if (padrao.test(texto)) infratores.push(`${tela.arquivo} — ${padrao}`);
      }
    }
    expect(
      infratores,
      `Estas telas escrevem o próprio recorte:\n${infratores.join("\n")}\n\n` +
        `Use <BarraDeContexto>, que já sabe a regra: trocar de unidade apaga a ` +
        `vigência. Uma tela que escreve o recorte à mão não sabe disso, e leva a ` +
        `data de uma unidade para outra.`,
    ).toEqual([]);
  });

  it("controle: a varredura reconhece um seletor próprio quando existe", () => {
    /*
      Sem este caso, a asserção acima passaria também com os padrões errados — e
      uma varredura que não encontra nada em lugar nenhum é indistinguível de um
      repositório limpo. O componente da barra escreve `scopeHash` de propósito:
      é ele que tem o direito de fazê-lo.
    */
    const barra = fonte("components/contexto/context-bar.tsx");
    expect(SELETOR_PROPRIO.some((p) => p.test(barra))).toBe(true);

    // E o contrário: ler o recorte da URL para chamar a API **não** é seletor.
    // Sem esta metade, a varredura voltaria a acusar quem só repassa.
    const leituraLegitima = `if (scopeHash) q.set("scopeHash", scopeHash);`;
    expect(SELETOR_PROPRIO.some((p) => p.test(leituraLegitima))).toBe(false);
  });

  it("a barra é a única que decide o que a troca faz com a URL", () => {
    // `aplicarContexto` é onde mora a regra. Quem monta a barra não a
    // reimplementa: o invólucro chama `enderecoComContexto` e pronto.
    const invólucro = fonte("components/contexto/barra-de-contexto.tsx");
    expect(invólucro).toContain("enderecoComContexto");

    // A **chamada**, e não a menção: Parâmetros cita `aplicarContexto` num
    // comentário que explica por que o cartão aberto sobrevive à troca, e um
    // teste que proíbe falar do assunto empurra a explicação para fora do
    // código.
    for (const tela of TELAS.filter((t) => t.monta)) {
      const texto = fonte(tela.arquivo);
      expect(
        /\baplicarContexto\(/.test(texto),
        `${tela.arquivo} não deve chamar aplicarContexto: quem faz isso é a barra`,
      ).toBe(false);
    }
  });
});
