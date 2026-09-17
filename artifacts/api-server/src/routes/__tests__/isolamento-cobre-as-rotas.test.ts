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
 *
 * ---------------------------------------------------------------------------
 * O eixo real é a **rota**, e não o arquivo
 * ---------------------------------------------------------------------------
 *
 * O arquivo sempre foi uma aproximação, e ela bastava enquanto todo arquivo era
 * inteiro de um lado ou do outro. `balance.ts` é o primeiro que não é: a
 * conservação de um arquivo importado é global por contrato — *"o balanço é
 * sobre o arquivo que chegou"* —, e a procedência de um recorte, que vive no
 * mesmo módulo porque é a pergunta inversa sobre os mesmos dados, recorta por
 * operação e exige ambiente.
 *
 * Com a régua por arquivo havia só duas respostas para ele, e as duas erradas:
 * tirar a exceção diria que `GET /balance` isola, e ele não isola; mantê-la
 * diria que `GET /balance/recorte` não isola, e ele é a rota que mais isola
 * deste servidor. Então {@link SEM_RECORTE_POR_ROTA} guarda a exceção **da
 * rota**, e todas as outras rotas do mesmo arquivo passam a ser conferidas uma a
 * uma, dentro do próprio handler.
 *
 * A régua por arquivo continua valendo para todo o resto, e de propósito: listar
 * as vinte rotas de `users.ts` uma a uma para dizer vinte vezes "é a casa" seria
 * ruído, e ruído é o que faz uma lista destas deixar de ser lida.
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
  "modulos-universais.ts":
    "o que a instalação liga e desliga — a casa, e a mais ampla delas: um módulo desligado sai do menu das quatro operações, porque a decisão é sobre que partes do produto esta casa usa, e não sobre um acervo.",
  "papeis.ts":
    "papéis de acesso — a casa, como usuários: um papel vale para o produto inteiro, e recortá-lo por operação daria quatro cadastros de acesso para a mesma pessoa.",
  "unidades.ts": "cadastro de unidades — vale para as quatro operações.",
  "cadastro.ts":
    "cargo, departamento e negócio — a casa, como o cadastro de unidades: o organograma da empresa é o mesmo nas quatro operações, e recortá-lo por canal daria quatro empresas.",
  "health.ts": "saúde do processo.",
  /*
    `escopo.ts` é a janela do escopo por **empresa e unidade**, que é o outro
    eixo — e o que ela mostra é a própria sessão, nunca acervo. Recortá-la por
    `?operacao=` diria a quem pergunta "o que eu alcanço?" uma resposta
    diferente conforme a auditoria aberta, quando o alcance de uma conta é o
    mesmo nas quatro. O isolamento dela é mais estreito, e não mais largo: as
    duas leituras respondem sobre `req.user`, então não há acervo alheio a
    vazar por aqui — ver `lib/escopo-efetivo.ts`.
  */
  "escopo.ts":
    "o escopo da própria sessão — não lê acervo, e o eixo dela é empresa e unidade, não operação.",
  "index.ts": "o índice das rotas.",
  "curation.ts": "vocabulário: atributo e significado são globais por código.",
  "versions.ts": "histórico de semântica — o mesmo vocabulário.",
  "book.ts": "o Book do Operador é população própria, sem unidade nem canal.",
  /*
    `tickets.ts` continua fora do eixo da **operação**, e a frase mudou porque
    metade dela deixou de ser verdade.

    Chamados passaram a ter **unidade**: ela sempre veio no export real (coluna
    `Unidade`, das 26), e até a `0087` ficava só em `payload`. Hoje é coluna, é
    a série por que o Monitoramento particiona as comparações, e é filtro de
    tela. Dizer "sem unidade" aqui viraria uma declaração falsa dois meses
    depois de alguém a ler.

    O que **não** mudou é o canal: um chamado não pertence a empurrada nem a
    rota, e não há em `ticket` nada que o ligue a uma vigência de um acervo. É
    por isso que estas rotas continuam sem `operacaoDaConsulta` — o eixo que
    este teste protege é o da operação, e chamados não estão nele.
  */
  "tickets.ts":
    "chamados são população própria: têm unidade (a série da `0087`), e não têm canal — nada em `ticket` os liga a uma operação.",
  "monitoramento-de-chamados.ts":
    "o monitoramento é derivado de `ticket`, e herda o mesmo eixo: recorta por série/unidade (`serieDaConsulta`, a autoridade única do arquivo) e não por operação, porque o chamado que ele compara não pertence a uma.",
  "fechamento.ts":
    "o Fechamento tem eixo próprio de operação — `competencia.tipo_de_operacao`, ver `OPERACAO_DO_AMBIENTE`.",
  "remuneracao.ts":
    "o cadastro de remuneração é lido pelo Fechamento, por unidade e canal da planilha.",
  "fleet-analysis.ts":
    "lê uma planilha do disco, e não o banco — não há vigência nem canal a recortar.",
  "integracoes.ts":
    "a gestão das integrações é a casa: chave de API e log de chamadas valem para o produto inteiro, e uma chave não pertence a uma operação. O que o sistema externo alcança **com** aquela chave é que é recortado — em `v1.ts`, pela mesma `operacaoDaConsulta` das telas.",
  "fluxos.ts":
    "o mapa dos processos é escopado por empresa (`resolverEmpresa`), e não toca em `snapshot`: um fluxo não pertence a uma vigência.",
};

/**
 * As **rotas** que não leem o acervo de uma operação, no arquivo que tem as duas
 * metades. A chave é `arquivo.ts:MÉTODO /caminho`, como o Express a declara.
 *
 * Só entra aqui rota de arquivo que **também** tem rota recortada: um arquivo
 * inteiro fora do eixo continua em {@link SEM_ACERVO}, que é onde ele se lê de
 * uma vez.
 */
const SEM_RECORTE_POR_ROTA: Record<string, string> = {
  "balance.ts:GET /balance":
    "a conservação é do arquivo importado, e é global por contrato: um arquivo é de uma importação só, e recortá-lo por unidade daria a impressão de que existe massa 'de outra unidade' explicando a que falta. Quem responde por recorte é GET /balance/recorte, na mesma rota-irmã.",
  "balance.ts:GET /balance/:importRunId":
    "o detalhe de uma importação, pedido pelo id dela — a mesma conta da lista, sobre um arquivo só. Um arquivo não pertence a uma operação, então não há recorte a conferir nem `exigirOperacaoDoRecurso` a chamar.",
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
  texto.includes("exigirOperacaoDoRecurso") ||
  /*
    `recorteDaAuditoria` é a quarta porta, e a mais estrita: ela **deriva** a
    operação do ambiente de trabalho em vez de aceitar a que o cliente mandou,
    e recusa o par incompatível. Ver `lib/ambiente-da-auditoria.ts`.
  */
  texto.includes("recorteDaAuditoria");

/**
 * As rotas declaradas num arquivo, com o corpo de cada uma.
 *
 * O corte é em `router.<método>(`, que é como toda rota deste servidor se
 * declara. O corpo de uma rota é o texto até a declaração seguinte — bruto, e
 * bruto basta: a pergunta é se **aquele handler** chama uma das quatro portas,
 * e nenhuma delas é chamada por acidente.
 */
function rotasDoArquivo(texto: string): { assinatura: string; corpo: string }[] {
  const declaracao = /router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g;
  const achadas: { assinatura: string; inicio: number }[] = [];
  for (const casado of texto.matchAll(declaracao)) {
    achadas.push({
      assinatura: `${casado[1]!.toUpperCase()} ${casado[2]!}`,
      inicio: casado.index!,
    });
  }

  return achadas.map((rota, i) => ({
    assinatura: rota.assinatura,
    corpo: texto.slice(rota.inicio, achadas[i + 1]?.inicio ?? texto.length),
  }));
}

/**
 * A chave partida no **primeiro** `:`, e não em todos.
 *
 * `balance.ts:GET /balance/:importRunId` tem dois: o que separa arquivo de rota
 * e o do parâmetro do Express. Partir em todos deixava o `:importRunId` de fora
 * da assinatura, e a rota passava a constar como fantasma.
 */
function partirChave(chave: string): { arquivo: string; assinatura: string } {
  const corte = chave.indexOf(":");
  return { arquivo: chave.slice(0, corte), assinatura: chave.slice(corte + 1) };
}

/** Os arquivos que têm exceção **de rota** — os de duas metades. */
const arquivosComExcecaoDeRota = () =>
  [...new Set(Object.keys(SEM_RECORTE_POR_ROTA).map((chave) => partirChave(chave).arquivo))];

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

  /*
    A régua por rota, aplicada onde o arquivo tem as duas metades. É este caso
    que impede a volta do defeito que motivou a mudança: uma rota nova dentro de
    `balance.ts` que esquecesse o recorte passaria pela régua do arquivo (ele lê
    a operação, em outra rota) e é pega aqui.
  */
  it("dentro de arquivo de duas metades, confere cada rota no próprio handler", () => {
    const semRecorte: string[] = [];

    for (const arquivo of arquivosComExcecaoDeRota()) {
      for (const rota of rotasDoArquivo(fonte(arquivo))) {
        const chave = `${arquivo}:${rota.assinatura}`;
        if (SEM_RECORTE_POR_ROTA[chave] !== undefined) continue;
        if (!leAOperacao(rota.corpo)) semRecorte.push(chave);
      }
    }

    expect(semRecorte).toEqual([]);
  });

  it("não guarda exceção de rota para rota que já recorta", () => {
    const desatualizadas = Object.entries(SEM_RECORTE_POR_ROTA)
      .filter(([chave]) => {
        const { arquivo, assinatura } = partirChave(chave);
        const rota = rotasDoArquivo(fonte(arquivo)).find(
          (r) => r.assinatura === assinatura,
        );
        return rota !== undefined && leAOperacao(rota.corpo);
      })
      .map(([chave]) => chave);

    expect(desatualizadas).toEqual([]);
  });

  it("não guarda exceção de rota para rota que não existe mais", () => {
    const fantasmas = Object.keys(SEM_RECORTE_POR_ROTA).filter((chave) => {
      const { arquivo, assinatura } = partirChave(chave);
      if (!arquivosDeRota().includes(arquivo)) return true;
      return !rotasDoArquivo(fonte(arquivo)).some((r) => r.assinatura === assinatura);
    });

    expect(fantasmas).toEqual([]);
  });

  /*
    E as duas listas não se sobrepõem: um arquivo inteiro fora do eixo não tem o
    que fazer na lista de rotas, e vice-versa. Sem este caso, uma exceção
    esquecida numa das duas passaria a ser lida como a decisão vigente.
  */
  it("as duas listas de exceção não se sobrepõem", () => {
    const nas_duas = arquivosComExcecaoDeRota().filter(
      (arquivo) => SEM_ACERVO[arquivo] !== undefined,
    );

    expect(nas_duas).toEqual([]);
  });

  it("não guarda exceção para arquivo que não existe mais", () => {
    const fantasmas = Object.keys(SEM_ACERVO).filter(
      (arquivo) => !arquivosDeRota().includes(arquivo),
    );

    expect(fantasmas).toEqual([]);
  });
});
