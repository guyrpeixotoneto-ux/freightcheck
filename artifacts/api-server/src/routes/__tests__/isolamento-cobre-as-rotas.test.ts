import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **O guarda do recorte: nenhuma rota nova pode esquecer a operação.**
 *
 * `isolamento-por-operacao.test.ts` prova, contra um banco misturado, que a
 * cadeia da auditoria não vaza. Este arquivo protege o **futuro** dela: a rota
 * escrita amanhã não estará naquele teste, e é assim que um recorte se perde —
 * não por alguém removê-lo, mas por alguém acrescentar uma tela e não saber que
 * ele existia.
 *
 * A regra é uma só, e é declarativa: **todo arquivo de rota lê a operação, ou
 * está listado abaixo com o motivo de não ler.** Quem cria uma rota nova cai
 * numa das duas — e a segunda obriga a escrever por que aquele endpoint não fala
 * do acervo de uma operação. Não é uma prova de que o recorte está correto (essa
 * é a suíte de isolamento, contra dados de verdade); é a prova de que ninguém
 * passou por aqui sem decidir.
 */

const ROTAS = path.resolve(import.meta.dirname, "..");

/**
 * As rotas que **não** leem o acervo de uma operação — e por que cada uma.
 *
 * Não é uma lista de dispensas: é o inventário do que, neste produto, existe
 * fora do eixo da operação. Duas famílias e uma exceção velha:
 *
 * - **a casa** — sessão, usuários, unidades, saúde do processo: valem para o
 *   produto inteiro, e é por isso que a Administração fica fora das bases de
 *   ambiente também na lateral (`nav-administracao.ts`);
 * - **o vocabulário** — curadoria, categorias, significados, versões: o atributo
 *   `carreta.custo_fixo` é o mesmo na empurrada e na rota, e a fila de curadoria
 *   é uma só. Recortá-la por operação inventaria uma partição que o modelo não
 *   tem e faria a mesma pendência aparecer quatro vezes;
 * - **as populações próprias** — chamados e o Book: nenhuma delas tem unidade
 *   nem canal em lugar nenhum deste produto (ver `chamados.ts`).
 */
const SEM_ACERVO: Record<string, string> = {
  "auth.ts": "sessão e senha — a casa, não o acervo.",
  "users.ts": "usuários — a casa.",
  "unidades.ts": "cadastro de unidades — vale para as quatro operações.",
  "health.ts": "saúde do processo.",
  "index.ts": "o índice das rotas.",
  "curation.ts": "vocabulário: atributo e significado são globais por código.",
  "versions.ts": "histórico de semântica — o mesmo vocabulário.",
  "book.ts": "o Book do Operador é população própria, sem unidade nem canal.",
  "tickets.ts": "chamados são população própria, sem unidade nem canal.",
  "balance.ts": "balanço de massa: a conferência de um arquivo, por importação.",
  "fechamento.ts":
    "o Fechamento tem eixo próprio de operação — `competencia.tipo_de_operacao`, ver `OPERACAO_DO_AMBIENTE`.",
  "remuneracao.ts":
    "o cadastro de remuneração é lido pelo Fechamento, por unidade e canal da planilha.",
  "fleet-analysis.ts":
    "lê uma planilha do disco, e não o banco — não há vigência nem canal a recortar.",
  "fluxos.ts":
    "o mapa dos processos é escopado por empresa (`resolverEmpresa`), e não toca em `snapshot`: um fluxo não pertence a uma vigência.",
};

const arquivosDeRota = () =>
  readdirSync(ROTAS)
    .filter((f) => f.endsWith(".ts"))
    .sort();

const fonte = (arquivo: string) => readFileSync(path.join(ROTAS, arquivo), "utf8");

/**
 * Lê a operação quem chama o parser compartilhado (que a embute) ou quem a pede
 * diretamente. As duas portas são as únicas — e é de propósito que sejam duas
 * funções nomeadas, e não um padrão de texto: uma rota que montasse o recorte à
 * mão passaria despercebida aqui, e é justamente essa cópia que
 * `lib/contexto.ts` existe para não haver.
 */
const leAOperacao = (texto: string) =>
  texto.includes("operacaoDaConsulta") ||
  texto.includes('from "../lib/contexto"') ||
  texto.includes("exigirOperacaoDoRecurso");

describe("o recorte por operação", () => {
  it("alcança toda rota que lê o acervo — ou a exceção está escrita", () => {
    const semRecorte = arquivosDeRota().filter(
      (arquivo) => !leAOperacao(fonte(arquivo)) && SEM_ACERVO[arquivo] === undefined,
    );

    expect(semRecorte).toEqual([]);
  });

  /*
    A lista de exceções envelhece do outro lado também: uma rota que passe a
    recortar por operação e continue listada aqui deixa a próxima pessoa achando
    que ela não recorta. O caso guarda as duas metades.
  */
  it("não guarda exceção para rota que já recorta", () => {
    const desatualizadas = Object.keys(SEM_ACERVO).filter(
      (arquivo) => arquivosDeRota().includes(arquivo) && leAOperacao(fonte(arquivo)),
    );

    expect(desatualizadas).toEqual([]);
  });

  it("não guarda exceção para arquivo que não existe mais", () => {
    const fantasmas = Object.keys(SEM_ACERVO).filter(
      (arquivo) => !arquivosDeRota().includes(arquivo),
    );

    expect(fantasmas).toEqual([]);
  });
});
