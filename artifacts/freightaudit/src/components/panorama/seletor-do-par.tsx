import { ArrowLeftRight, Info } from "lucide-react";
import { periodicitySuffix } from "@workspace/comparison/labels";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBrlShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ParEmTela } from "@/lib/par-do-panorama";

/** Uma vigência do histórico, como a caixa a oferece. */
export interface VigenciaDoPar {
  /** A data, que é o valor guardado no endereço. */
  data: string;
  /** Como ela se chama em toda a casa — `agosto/2026 · 2ª quinzena`. */
  rotulo: string;
  /** Quantas alterações ela trouxe, quando isso é pergunta com resposta. */
  alteracoes: number | null;
  /** O líquido dela na periodicidade abaixo. */
  impacto: number | null;
  /**
   * Por que esta vigência não tem números — ver `motivoSemNumeros`.
   *
   * A linha sem números e sem nota era lida como "esse mês não teve
   * importação", que é a única explicação impossível: uma vigência não
   * importada não chega a esta lista. A nota diz qual das explicações
   * possíveis é — sem comparação calculada, ou primeira do histórico.
   */
  nota?: { curto: string; porque: string } | null;
  /**
   * A grandeza que a coluna não publica — ver `tambemEmOutraPeriodicidade`.
   *
   * Vai **abaixo** do número, em corpo menor: a coluna continua sendo de uma
   * periodicidade só, e esta linha existe para que a outra não desapareça da
   * tela sem que nada diga que ela existe.
   */
  tambem?: { curto: string; porque: string } | null;
}

/**
 * O PAR DO PANORAMA — De, Para, e o botão que os troca de lado.
 *
 * ---------------------------------------------------------------------------
 * Por que ele existe aqui, se já havia um "Trocar vigência" no cabeçalho
 * ---------------------------------------------------------------------------
 * Porque aquele botão escolhia **uma** ponta e escondia a outra. O Panorama
 * publica uma diferença — quanto custou esta vigência —, e uma diferença tem
 * duas pontas; com uma só na tela, a outra era uma regra que quem lê precisava
 * conhecer de cor ("é sempre a anterior"). As duas caixas dizem, sem texto, o
 * que está sendo comparado com o quê.
 *
 * Ele substitui o seletor do cabeçalho em vez de conviver com ele: dois
 * controles que escolhem a mesma vigência, na mesma tela, são duas perguntas
 * disputando o mesmo gesto — e a coluna de números que fazia aquele menu valer
 * a abertura veio junto, dentro destas listas.
 *
 * ---------------------------------------------------------------------------
 * Inverter não é trocar o sinal
 * ---------------------------------------------------------------------------
 * Ir de 100 para 110 é +10,0%; voltar de 110 para 100 é −9,09%, e não −10,0% —
 * a base do percentual passou a ser a outra ponta. Uma tela que negasse o
 * número que já tem mostraria, na volta, um número que não existe.
 *
 * Então o botão troca as duas pontas e **pede o par invertido ao motor**
 * (`/changes/families/par`), que calcula B×A de verdade. É mais uma consulta, e
 * é a única forma de o número da volta ser verdadeiro. O aviso embaixo das
 * caixas é o mesmo das auditorias de rubrica, palavra por palavra, porque é a
 * mesma decisão — e o que menos pode existir em duas versões.
 *
 * ---------------------------------------------------------------------------
 * Uma ponta por gesto — e o Para não sai do lugar
 * ---------------------------------------------------------------------------
 * **Para** é a vigência de referência que se está analisando; **De** é a origem
 * contra a qual se quer compará-la. Mexer numa não recalcula a outra, e é esse
 * o contrato inteiro (ver `aoEscolherDe`/`aoEscolherPara`) — o mesmo das
 * dezesseis auditorias de rubrica.
 *
 * Até 17/09/2026 não era assim: as duas caixas ofereciam o histórico inteiro e
 * a outra ponta **seguia atrás**, porque o servidor recusava par que não fosse
 * de vigências vizinhas e o arrasto era o que impedia um clique de montar um
 * par recusado. Com setembro em Para, escolher agosto/1ª quinzena em De punha
 * agosto/2ª quinzena em Para — a referência fixada saía debaixo de quem a tinha
 * fixado, sem uma palavra. A trava saiu do servidor e o arrasto saiu daqui: o
 * par salteado (junho contra setembro) é uma comparação que o motor calcula,
 * como já calculava para a Auditoria de FINAME.
 *
 * Quem quer o caminho inteiro somado, movimento a movimento, continua tendo a
 * Linha do Tempo — que é outra leitura, e diz que é essa que está fazendo.
 */
export function SeletorDoParDoPanorama({
  opcoes,
  par,
  periodicidade,
  carregando = false,
  onEscolherDe,
  onEscolherPara,
  onInverter,
  idPrefixo = "panorama",
}: {
  /** O histórico do contexto, mais recente primeiro. */
  opcoes: VigenciaDoPar[];
  par: ParEmTela;
  /** A periodicidade em que a coluna de impacto está escrita. */
  periodicidade?: string | null;
  /** Há leitura em voo: as caixas continuam em tela e o botão não aceita clique. */
  carregando?: boolean;
  onEscolherDe: (data: string) => void;
  onEscolherPara: (data: string) => void;
  onInverter: () => void;
  idPrefixo?: string;
}) {
  const rotuloDe = (data: string | null) =>
    data === null ? null : (opcoes.find((o) => o.data === data)?.rotulo ?? data);

  /*
    A linha do menu: a vigência à esquerda, o que ela custou à direita.

    É a mesma coluna do seletor que este controle substituiu, e ela é o que faz
    a lista valer a abertura: entre seis datas iguais, "714 alterações" e "6
    alterações" separam a vigência que mudou o contrato da que corrigiu um
    cadastro. Sem número apurado, a linha diz **por que** não há número — nada
    aqui inventa "R$ 0" nem "0 alterações" para preencher coluna, e nada fica
    em branco deixando a ausência ser interpretada (ver `motivoSemNumeros`).

    A coluna é sempre a leitura **de ida** de cada vigência (o que ela trouxe
    contra a anterior dela), inclusive quando o par em tela está invertido: ela
    descreve a vigência, e não o par aberto. O par aberto está publicado em
    tamanho grande no andar de cima, que é onde ele deve ser lido.
  */
  const linha = (opcao: VigenciaDoPar) => (
    <span className="flex w-full items-center justify-between gap-6">
      <span>{opcao.rotulo}</span>
      {opcao.impacto == null && opcao.alteracoes === null && opcao.nota && (
        <span
          title={opcao.nota.porque}
          className="shrink-0 text-xs italic text-muted-foreground"
        >
          {opcao.nota.curto}
        </span>
      )}
      {(opcao.impacto != null || opcao.alteracoes !== null) && (
        <span className="flex shrink-0 flex-col items-end text-xs leading-tight">
          {opcao.impacto != null && (
            <span
              className={cn(
                "font-semibold tabular-nums",
                /* Zero não é ganho: um saldo em que ganhos e perdas se
                   anularam é empate, e pintá-lo de verde afirmaria uma
                   vigência que subiu a remuneração onde ela não mexeu no
                   total. É a mesma régua do menu que este controle substituiu. */
                opcao.impacto === 0
                  ? "text-muted-foreground"
                  : opcao.impacto < 0
                    ? "text-red-700"
                    : "text-emerald-700",
              )}
              title={`${formatBrlShort(opcao.impacto)}${
                periodicidade ? periodicitySuffix(periodicidade) : ""
              } em relação à vigência anterior a esta`}
            >
              {formatBrlShort(opcao.impacto)}
              {periodicidade && (
                <span className="font-normal text-muted-foreground">
                  {periodicitySuffix(periodicidade)}
                </span>
              )}
            </span>
          )}
          {opcao.tambem && (
            <span
              title={opcao.tambem.porque}
              className="text-[0.65rem] italic text-muted-foreground"
            >
              {opcao.tambem.curto}
            </span>
          )}
          {/* Ver a mesma nota no seletor do cabeçalho: a linha com contagem e
              sem dinheiro na régua da coluna diz por que o dinheiro não está
              ali, em vez de deixar o espaço vazio responder por ela. */}
          {opcao.impacto == null && opcao.nota && (
            <span title={opcao.nota.porque} className="italic text-muted-foreground">
              {opcao.nota.curto}
            </span>
          )}
          {opcao.alteracoes !== null && (
            <span className="text-muted-foreground tabular-nums">
              {opcao.alteracoes.toLocaleString("pt-BR")}{" "}
              {opcao.alteracoes === 1 ? "alteração" : "alterações"}
            </span>
          )}
        </span>
      )}
    </span>
  );

  /* O `ItemText` do Radix encolhe, e é ele que desalinharia a coluna direita:
     o `w-full` da linha resolve contra ele, não contra a largura do item.
     Esticar o último `span` devolve a régua comum — a mesma nota mora no
     seletor das auditorias de rubrica. */
  const ITEM_LARGO = "[&>span:last-child]:w-full";

  const caixa = (papel: "de" | "para") => {
    const valor = papel === "de" ? par.de : par.para;
    const aoEscolher = papel === "de" ? onEscolherDe : onEscolherPara;
    const id = `${idPrefixo}-${papel}`;
    return (
      <div className="flex flex-col gap-1.5 sm:min-w-[15rem] sm:flex-1">
        <label
          htmlFor={id}
          className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-muted-foreground"
        >
          {papel === "de" ? "De" : "Para"}
        </label>
        {opcoes.length === 0 && carregando ? (
          <Skeleton className="h-10 w-full rounded-md" />
        ) : (
          <Select
            value={valor ?? ""}
            onValueChange={aoEscolher}
            /*
              Uma vigência só no histórico: não há par, e a caixa diz isso
              ficando quieta — com a frase do `problema` logo abaixo. Em todo o
              resto ela aceita clique, inclusive quando o par em tela está
              recusado: desabilitar as caixas no estado de erro tiraria da
              pessoa justamente o controle que desfaz o erro.
            */
            disabled={opcoes.length <= 1}
          >
            <SelectTrigger
              id={id}
              aria-label={
                papel === "de" ? "De (vigência de origem)" : "Para (vigência de destino)"
              }
            >
              {/*
                O campo fechado mostra **só a vigência**, e não a linha inteira
                da lista: o número que faz escolher já está publicado, maior e
                com rótulo, nos andares abaixo. Número repetido não confirma
                nada — só divide a atenção.
              */}
              <SelectValue
                placeholder={
                  papel === "de" ? "Escolha a vigência de origem" : "Escolha a vigência de destino"
                }
              >
                {rotuloDe(valor)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {/*
                O cabeçalho da lista diz **de que recorte** a coluna é.

                Sem esta linha, o número ao lado de cada vigência era lido como
                o impacto do par aberto logo acima — e as duas coisas não são a
                mesma: a coluna é sempre a leitura de ida de cada vigência
                (contra a anterior dela), e o par aberto pode ser salteado ou
                invertido. Foi exatamente essa leitura cruzada que produziu, em
                18/09/2026, um seletor com R$ 43.556 ao lado de um cartão
                dizendo "nenhum valor apurado": os dois estavam certos, sobre
                pares diferentes, e nada na tela dizia isso.
              */}
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                {periodicidade ? (
                  <>
                    Impacto líquido em R${periodicitySuffix(periodicidade)}{" "}
                    <span className="font-semibold">vs. vigência anterior</span> — não é o
                    resultado do par aberto.
                  </>
                ) : (
                  <>
                    Cada linha é a leitura da vigência{" "}
                    <span className="font-semibold">vs. a anterior dela</span> — não é o
                    resultado do par aberto.
                  </>
                )}
              </p>
              {opcoes.map((opcao) => (
                <SelectItem key={opcao.data} value={opcao.data} className={ITEM_LARGO}>
                  {linha(opcao)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    );
  };

  return (
    <section className="superficie px-4 py-3" aria-label="Par de vigências do Panorama">
      {/*
        Uma coluna no celular, uma linha a partir de `sm`. Empilhado de
        propósito, e não com `flex-wrap` solto: com ele, "De" e Inverter cabiam
        juntos na primeira linha e o "Para" descia sozinho, desalinhado do
        campo que ele emparelha. A ordem é a da frase — de X para Y — e também
        a do foco.
      */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {caixa("de")}

        <Button
          type="button"
          variant="outline"
          onClick={onInverter}
          disabled={
            carregando ||
            par.de === null ||
            par.para === null ||
            par.problema !== null
          }
          aria-label="Inverter: trocar a vigência de origem com a de destino"
          className="w-full gap-2 sm:w-auto"
        >
          <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          Inverter
        </Button>

        {caixa("para")}
      </div>

      {/*
        O par que não dá para ler — e as duas escolhas continuam onde estão.

        A frase fica **fora** do menu de propósito: quem abre a tela num par
        recusado precisa ler o motivo sem abrir nada. `role="status"` porque o
        texto troca sem a página navegar.

        Ela substituiu um `indisponivel` que só sabia dizer uma coisa ("esta
        unidade tem uma vigência só") — os outros dois estados que chegavam aqui,
        a mesma vigência dos dois lados e a ponta de outra unidade, não eram
        ditos: o par era trocado por um vizinho e a tela seguia como se nada
        tivesse acontecido.
      */}
      {par.problema && (
        <p
          role="status"
          className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
          <span>{par.problema.mensagem}</span>
        </p>
      )}

      {/*
        O sentido da leitura, escrito.

        Ele deixou de ser dedutível no dia em que o par salteado passou a ser
        possível: com as duas caixas livres, "Para − De" é a única frase que diz
        de qual ponta para qual ponta o número da tela anda. A linha da volta
        aparece junto quando a partida é a mais recente — que é um par legítimo,
        e não um engano a corrigir.
      */}
      {par.de !== null && par.para !== null && par.problema === null && (
        <p className="mt-3 flex items-start gap-2 border-l-2 border-border pl-2.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
          <span>
            A leitura é{" "}
            <strong className="font-semibold">
              {rotuloDe(par.para)} − {rotuloDe(par.de)}
            </strong>
            : o que a vigência de destino tem a mais, ou a menos, que a de origem.
            {par.invertido && (
              <>
                {" "}
                Esta é a <strong className="font-semibold">volta</strong> — a partida é
                posterior à chegada.
              </>
            )}
          </span>
        </p>
      )}

      <p className="mt-3 flex items-start gap-2 border-l-2 border-border pl-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
        <span>
          Inverter troca o par pedido ao motor: a diferença muda de sinal, e a variação
          muda de sinal <strong className="font-semibold">mas não de magnitude</strong> —
          a base do percentual passa a ser a outra vigência.
        </span>
      </p>
    </section>
  );
}
