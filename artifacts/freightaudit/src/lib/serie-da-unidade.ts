/**
 * A UNIDADE DA LATERAL E A SÉRIE DO ARQUIVO — dois vocabulários, um recorte.
 *
 * O Monitoramento de Chamados recorta por **série**: a unidade que o próprio
 * export da Ambev nomeia, gravada em `ticket_import.serie` (ver o cabeçalho de
 * `lib/db/src/schema/tickets.ts`). A lateral recorta por **unidade**: o escopo
 * `UNIDADE` de um contexto que já entregou vigência (`lib/contextos.ts`). São
 * duas populações diferentes — uma nasce do `Chamados_<unidade>.xlsx`, a outra
 * da planilha de vigência — e não existe chave ligando as duas no banco.
 *
 * O que existe é o nome, e é sobre ele que este módulo casa as duas. A
 * reclamação que trouxe o arquivo, nas palavras de quem a fez: *"eu mudo de
 * PERNAMBUCO para CAMAÇARI e muda o módulo, mas eu quero ver justamente os
 * chamados que importei de Camaçari"* — trocar de unidade jogava para
 * Parâmetros, porque a tela estava fora de `TELAS_QUE_HONRAM_ESCOPO`, e antes
 * disso nem havia o que honrar: o recorte da tela só existia no seletor dela.
 *
 * ---------------------------------------------------------------------------
 * Por que a comparação é normalizada, e por que ela é só igualdade
 * ---------------------------------------------------------------------------
 *
 * Normalizada porque os dois nomes são digitados por gente diferente em
 * sistemas diferentes: o escopo vem do export de remuneração (`CAMAÇARI`), a
 * série vem da coluna `Unidade` do export de chamados (`Camaçari`, `camacari `).
 * Comparar cru faria a tela abrir vazia sobre um acervo cheio — o pior jeito de
 * um recorte falhar, porque parece dado e é grafia. É a mesma razão de
 * `normalizarOperacao`, em `lib/comparison/src/series.ts`.
 *
 * **Só igualdade**, e nunca "contém": `CDD CEBRASA` e `CEBRASA` podem ser a
 * mesma unidade e podem não ser, e uma tela que decide isso sozinha atribui
 * chamados de uma unidade a outra sem dizer. Quando o nome não bate, este
 * módulo não inventa parentesco — devolve `null`, e a tela **diz** que aquela
 * unidade não tem envio, com o caminho para ver todas. Um recorte que não achou
 * é uma resposta; um que se alarga sozinho é uma mentira.
 *
 * A exceção é o acervo em que **nenhum** envio nomeia unidade: ali não há nome
 * do outro lado para bater, nenhuma unidade jamais casaria, e recortar por
 * unidade abriria a tela em zeros para todas elas sobre um acervo cheio. Ver
 * `ACERVO_SEM_SERIE`, em `recorteDeChamados` — a soma passa a ser o padrão, e a
 * tela **diz** que é a soma que está mostrando.
 */

import { normalizarUnidade } from "@workspace/comparison/nome-de-unidade";

/** O mínimo de que o casamento precisa de uma série. */
export interface SerieConhecida {
  /** `null` é a série indeterminada — o envio sem unidade no arquivo. */
  serie: string | null;
}

/**
 * O nome em forma comparável — a mesma régua dos dois lados.
 *
 * Ela morava aqui, e passou a morar em `@workspace/comparison/nome-de-unidade`
 * quando o motor precisou dela para ler a unidade dentro do nome do arquivo.
 * Duas cópias de uma regra de igualdade é a doença que este módulo existe para
 * tratar, um nível acima: nada obriga as duas a concordarem, e no dia em que
 * divergissem a série gravada deixaria de casar com a unidade da tela sem que
 * nada tivesse mudado. Reexportada para que quem já a importava daqui continue
 * a importá-la daqui.
 */
export { normalizarUnidade } from "@workspace/comparison/nome-de-unidade";

/**
 * A série que corresponde a uma unidade — como o arquivo a escreveu.
 *
 * Devolve o texto **da série**, e não o da unidade: é ele que a rota compara
 * por igualdade, e devolver o nosso faria a consulta não achar nada justamente
 * quando o casamento deu certo.
 *
 * A série indeterminada (`null`) nunca casa com unidade nenhuma: ela é o envio
 * que não disse de onde veio, e atribuí-la à unidade aberta seria afirmar uma
 * origem que o dado não tem — a mesma regra que as Justificativas aplicam à
 * comparação sem `scopeHash`.
 */
export function serieDaUnidade(
  unidade: string | null,
  series: SerieConhecida[],
): string | null {
  const alvo = normalizarUnidade(unidade);
  if (alvo === null) return null;
  const achada = series.find(
    (s) => s.serie !== null && normalizarUnidade(s.serie) === alvo,
  );
  return achada?.serie ?? null;
}

/**
 * Por que a tela está lendo o que está lendo.
 *
 * TODAS               a soma escolhida — a Visão Geral da lateral, ou uma
 *                     instalação sem contexto nenhum para recortar.
 * ESCOLHA             a série escrita na URL, que é o seletor da própria tela.
 * UNIDADE             a unidade que a lateral nomeia, e o envio que casa com ela.
 * UNIDADE_SEM_ENVIO   a unidade que a lateral nomeia, e nenhum envio com esse
 *                     nome, **havendo envios nomeados**. A consulta sai assim
 *                     mesmo, com o nome da unidade: série desconhecida devolve
 *                     nada, nunca tudo (ver `serieDaConsulta`, na rota).
 * ACERVO_SEM_SERIE    a unidade que a lateral nomeia, e nenhum envio do acervo
 *                     diz de que unidade veio. Não é recorte que não achou — é
 *                     recorte que não existe; ver `recorteDeChamados`.
 */
export type MotivoDoRecorte =
  | "TODAS"
  | "ESCOLHA"
  | "UNIDADE"
  | "UNIDADE_SEM_ENVIO"
  | "ACERVO_SEM_SERIE";

export interface RecorteDeChamados {
  /** O que vai para as consultas. `undefined` é todas as séries. */
  serie: string | null | undefined;
  motivo: MotivoDoRecorte;
  /** A unidade que a lateral nomeia, quando há uma. */
  unidade: string | null;
  /**
   * Já dá para consultar.
   *
   * `false` só enquanto a lista de séries não chegou **e** há unidade aberta:
   * é o único caso em que consultar agora significaria consultar com um recorte
   * que ainda pode mudar — duas requisições por tela, e a primeira delas
   * pintando "nenhuma movimentação" sobre um dia que tem. Ver o `habilitado`
   * das consultas, em `lib/monitoramento-de-chamados.ts`.
   */
  pronto: boolean;
}

/** O rótulo com que a série indeterminada viaja na URL. Igual ao da rota. */
const SEM_SERIE = "@sem-serie";

/**
 * O recorte da tela, decidido num lugar só.
 *
 * A ordem é a da autoridade, da mais explícita para a mais implícita:
 *
 * 1. **A série na URL** — o seletor da própria tela, e o link que alguém colou.
 *    Vence tudo, inclusive a lateral: quem escreveu o recorte no endereço
 *    escolheu, e a tela avisa quando a escolha diverge da unidade aberta.
 * 2. **A Visão Geral** — a soma de todas as unidades, que é escolha e não
 *    ausência de escolha (ver `visaoGeralAtiva`, em `lib/navegacao-do-escopo.ts`).
 * 3. **A unidade da lateral** — o padrão, e a razão deste arquivo existir. Sem
 *    ele a tela somava as unidades embaixo da palavra PERNAMBUCO, que é o mesmo
 *    desencontro que a Cobertura de dados tinha antes de ler o par.
 * 4. **Nada disso** — sem contexto nenhum não há o que recortar, e a soma é a
 *    resposta honesta.
 */
export function recorteDeChamados({
  serieNaUrl,
  visaoGeral,
  unidade,
  series,
}: {
  serieNaUrl: string | null;
  visaoGeral: boolean;
  unidade: string | null;
  /** `undefined` é "a lista ainda não chegou" — diferente de "não há série". */
  series: SerieConhecida[] | undefined;
}): RecorteDeChamados {
  if (serieNaUrl !== null) {
    return {
      serie: serieNaUrl === SEM_SERIE ? null : serieNaUrl,
      motivo: "ESCOLHA",
      unidade,
      pronto: true,
    };
  }
  if (visaoGeral || unidade === null) {
    return { serie: undefined, motivo: "TODAS", unidade, pronto: true };
  }
  if (series === undefined) {
    return { serie: undefined, motivo: "UNIDADE", unidade, pronto: false };
  }
  const casada = serieDaUnidade(unidade, series);
  if (casada !== null) {
    return { serie: casada, motivo: "UNIDADE", unidade, pronto: true };
  }
  /*
    O acervo em que nenhum envio diz de que unidade veio.

    Recortar por unidade aqui não é rigor, é beco: `serieDaUnidade` filtra as
    séries nulas antes de comparar, então com o acervo inteiro indeterminado ela
    devolve `null` para **toda** unidade — e a tela abriria em três zeros para
    CAMAÇARI, para PERNAMBUCO e para qualquer outra que a lateral nomeasse, com
    a mesma frase e sobre o mesmo acervo cheio. Nove dias cinza repetidos em
    cada unidade somam a mentira que a régua existe para não contar.

    O `UNIDADE_SEM_ENVIO` abaixo continua sendo a resposta certa quando **há**
    séries nomeadas e a unidade aberta não é uma delas: ali o recorte procurou e
    não achou, e dizer isso é honesto — o nome pode estar escrito de outro jeito
    no arquivo, e a tela oferece o seletor. Aqui não há o que procurar: nenhum
    envio nomeia unidade nenhuma, e a soma é o único recorte que esse acervo
    comporta. A tira da tela diz que é isso que está acontecendo, para que a
    soma não passe por recorte da unidade.

    O acervo vazio não entra: sem nenhum envio lido, `series` chega vazia e a
    frase certa continua sendo "nenhum arquivo foi importado ainda", que é o que
    `UNIDADE_SEM_ENVIO` já diz.
  */
  const nenhumEnvioNomeaUnidade =
    series.length > 0 && series.every((s) => s.serie === null);
  if (nenhumEnvioNomeaUnidade) {
    return { serie: undefined, motivo: "ACERVO_SEM_SERIE", unidade, pronto: true };
  }
  return { serie: unidade, motivo: "UNIDADE_SEM_ENVIO", unidade, pronto: true };
}
