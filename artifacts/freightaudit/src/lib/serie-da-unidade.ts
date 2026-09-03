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
 */

/** O mínimo de que o casamento precisa de uma série. */
export interface SerieConhecida {
  /** `null` é a série indeterminada — o envio sem unidade no arquivo. */
  serie: string | null;
}

/**
 * O nome em forma comparável: caixa alta, sem acento, sem pontuação.
 *
 * `Camaçari`, `CAMAÇARI` e `camacari ` viram a mesma palavra; `CDD CEBRASA`
 * continua diferente de `CEBRASA`, que é o que o cabeçalho promete.
 */
export function normalizarUnidade(bruto: string | null | undefined): string | null {
  if (bruto === null || bruto === undefined) return null;
  const normalizada = bruto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  return normalizada === "" ? null : normalizada;
}

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
 *                     nome. A consulta sai assim mesmo, com o nome da unidade:
 *                     série desconhecida devolve nada, nunca tudo (ver
 *                     `serieDaConsulta`, na rota).
 */
export type MotivoDoRecorte =
  | "TODAS"
  | "ESCOLHA"
  | "UNIDADE"
  | "UNIDADE_SEM_ENVIO";

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
  return casada === null
    ? { serie: unidade, motivo: "UNIDADE_SEM_ENVIO", unidade, pronto: true }
    : { serie: casada, motivo: "UNIDADE", unidade, pronto: true };
}
