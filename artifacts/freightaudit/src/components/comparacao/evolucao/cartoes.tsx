import { ArrowLeftRight, CalendarRange, Truck, Undo2 } from "lucide-react";
import type { EvolucaoPorPlaca } from "@/lib/evolucao-por-placa";
import type { PontaAPonta } from "@/lib/analise";
import { formatBrlShort, formatNumber, periodicitySuffix } from "@/lib/format";

/**
 * OS QUATRO CARTÕES DA EVOLUÇÃO ANUAL — os mesmos nas quatro rubricas.
 *
 * ---------------------------------------------------------------------------
 * Por que os dois primeiros são dois, e não um
 * ---------------------------------------------------------------------------
 * Porque são contas diferentes, e a diferença entre elas é informação.
 *
 * **O líquido dos movimentos** soma o que se moveu em cada vigência do ano. Um
 * valor que subiu em março e voltou em setembro aparece nas duas colunas e sai
 * zero no acumulado — mas as duas alterações existiram, e alguém teve de
 * explicá-las.
 *
 * **A variação ponta a ponta** compara a primeira vigência com a última e
 * responde outra pergunta: o que continua diferente hoje. O que mexeu no
 * caminho e voltou some daqui, e os veículos que entraram ou saíram da frota no
 * meio do ano não entram — ela só fala de quem está nas duas pontas.
 *
 * Um cartão só, chamado "impacto do ano", teria de escolher uma das duas e
 * calar a outra. Seriam dois números certos disputando um rótulo, que é
 * exatamente como este produto ganha uma resposta a mais para a mesma pergunta.
 *
 * ---------------------------------------------------------------------------
 * A rubrica entra por parâmetro, e é a única coisa que muda
 * ---------------------------------------------------------------------------
 * Nasceu no FINAME e serve às quatro auditorias de custo fixo. O que varia de
 * uma para a outra é o nome na frase — "Toda alteração de IPVA do intervalo" —
 * e as variáveis que ela cita como exemplo de "sem valoração". Nenhum número
 * muda, nenhuma régua muda, e nenhum rótulo de cartão muda: a pergunta é a
 * mesma, e telas irmãs respondendo-a com palavras diferentes seria diferença sem
 * motivo.
 *
 * ---------------------------------------------------------------------------
 * Nenhuma conta mora aqui
 * ---------------------------------------------------------------------------
 * `liquido`, `ganho` e `perda` vêm de `evolucaoPorPlaca`; a ponta a ponta vem
 * de `/changes/end-to-end`. Este arquivo escolhe palavra, cor e ordem — e nada
 * mais. Somar aqui seria a segunda régua que o portão desta tela existe para
 * impedir (ver `docs/ACHADO-FINAME-TOTAL-COMPOSTO.md`).
 */

export function CartoesDaEvolucao({
  evolucao,
  ponta,
  carregandoPonta,
  rubrica,
  semValoracao,
}: {
  evolucao: EvolucaoPorPlaca;
  ponta: PontaAPonta | null;
  carregandoPonta: boolean;
  /** O nome da rubrica, como a frase a diz: "FINAME", "IPVA", "lucro fixo". */
  rubrica: string;
  /** As variáveis que a rubrica tem sem preço, citadas por extenso na dica. */
  semValoracao: string;
}) {
  const { totais } = evolucao;
  const sufixo = periodicitySuffix(evolucao.periodicidade);

  /*
    A ponta a ponta é lida **na mesma grandeza** em que a matriz está desenhada.
    Somar o balde mensal com o anual daria o número mais lido e menos verdadeiro
    da tela, e é a mesma recusa que `evolucaoPorPlaca` já faz do outro lado.
  */
  const daPonta = ponta?.impact.byPeriodicity[evolucao.periodicidade] ?? null;

  /*
    Nenhuma alteração do intervalo tem preço — e então R$ 0,00 seria mentira.

    Descoberto na prova no navegador das telas de Seguro e de Manutenção: as duas
    fecham o ano com "0 valoradas · 118 sem valoração" no terceiro cartão e um
    "R$ 0" enorme no primeiro. Os dois números estão certos e juntos dizem a
    coisa errada — o R$ 0 lê-se como "nada se moveu", quando o que houve foram
    118 movimentos que o motor não sabe precificar.
    
    A distinção é a mesma que os cartões da comparação já fazem entre "sem
    impacto precificável" e "R$ 0,00". Vale para toda rubrica: o recorte Carreta
    do IPVA cai no mesmo caso.
  */
  const nadaValorado =
    totais.alteracoes > 0 &&
    totais.alteracoes === totais.alteracoesSemValoracao + totais.alteracoesEmOutraPeriodicidade;

  const revertidas = ponta?.reverted.length ?? 0;
  const saiu = ponta?.fleet.removed ?? 0;
  const entrou = ponta?.fleet.added ?? 0;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Cartao
        icon={ArrowLeftRight}
        titulo="Impacto líquido dos movimentos"
        regua={nadaValorado ? "nada precificado" : "soma das células"}
        valor={
          nadaValorado ? (
            <span className="text-base font-semibold text-muted-foreground">
              sem impacto precificável
            </span>
          ) : (
            <Dinheiro valor={totais.liquido} sufixo={sufixo} />
          )
        }
        nota={
          nadaValorado ? (
            <>
              As <b className="text-foreground">{formatNumber(totais.alteracoes, 0)}</b>{" "}
              {totais.alteracoes === 1 ? "alteração do ano" : "alterações do ano"} são de
              variáveis que não viram reais — {semValoracao}.
            </>
          ) : (
            <>
              Positivo <b className="text-foreground">+{formatBrlShort(totais.ganho)}</b> · negativo{" "}
              <b className="text-foreground">−{formatBrlShort(Math.abs(totais.perda))}</b>
            </>
          )
        }
        dica={
          nadaValorado
            ? "Nenhuma alteração deste intervalo tem preço, então não há soma a fazer. " +
              "R$ 0,00 aqui seria um número diferente: diria que houve movimento e ele " +
              "foi nulo, quando o que houve foi movimento sem valoração."
            : "Tudo que se moveu no ano, vigência a vigência — inclusive o que depois " +
              "voltou ao ponto de partida. É a soma das células da matriz, e fecha com " +
              "ela ao centavo."
        }
      />

      <Cartao
        icon={Undo2}
        titulo="Variação ponta a ponta"
        regua={ponta ? `${ponta.fromLabel} → ${ponta.toLabel}` : "carregando"}
        valor={
          carregandoPonta ? (
            <span className="text-muted-foreground">—</span>
          ) : daPonta === null ? (
            <span className="text-base font-semibold text-muted-foreground">
              sem valor nesta grandeza
            </span>
          ) : (
            <Dinheiro valor={daPonta} sufixo={sufixo} />
          )
        }
        nota={
          ponta === null ? (
            "Comparando as duas pontas do ano…"
          ) : (
            <>
              O que continua diferente hoje.{" "}
              {revertidas > 0 && (
                <>
                  <b className="text-foreground">{formatNumber(revertidas, 0)}</b>{" "}
                  {revertidas === 1 ? "rubrica voltou" : "rubricas voltaram"} ao ponto de partida
                  {saiu + entrou > 0 ? "; " : "."}
                </>
              )}
              {saiu + entrou > 0 && (
                <>
                  <b className="text-foreground">{formatNumber(saiu, 0)}</b> saíram e{" "}
                  <b className="text-foreground">{formatNumber(entrou, 0)}</b> entraram na frota, e
                  não entram nesta conta.
                </>
              )}
              {revertidas === 0 && saiu + entrou === 0 && " Nada se moveu e voltou no caminho."}
            </>
          )
        }
        dica={
          "A primeira vigência do intervalo contra a última, veículo a veículo, " +
          "sobre quem está nas duas pontas. Não é a soma dos movimentos e não pode " +
          "ser derivada dela: o que subiu e voltou some aqui e continua contado lá."
        }
      />

      <Cartao
        icon={CalendarRange}
        titulo="Alterações no ano"
        regua={`${evolucao.colunas.length} ${evolucao.colunas.length === 1 ? "vigência" : "vigências"}`}
        valor={
          <span className="font-mono text-3xl font-bold tabular-nums">
            {formatNumber(totais.alteracoes, 0)}
          </span>
        }
        nota={
          <>
            {formatNumber(
              totais.alteracoes -
                totais.alteracoesSemValoracao -
                totais.alteracoesEmOutraPeriodicidade,
              0,
            )}{" "}
            valoradas · {formatNumber(totais.alteracoesSemValoracao, 0)} sem valoração ·{" "}
            {formatNumber(totais.alteracoesEmOutraPeriodicidade, 0)} em outra grandeza
          </>
        }
        dica={
          `Toda alteração de ${rubrica} do intervalo. As sem valoração — ${semValoracao} ` +
          "— são contadas e nunca viram R$ 0; as de outra grandeza têm preço, mas não " +
          "nesta periodicidade."
        }
      />

      <Cartao
        icon={Truck}
        titulo="Veículos impactados"
        regua={
          totais.frota > 0
            ? `${Math.round((totais.ativos / totais.frota) * 100)}% da frota`
            : "sem frota lida"
        }
        valor={
          <span className="font-mono text-3xl font-bold tabular-nums">
            {formatNumber(totais.ativos, 0)}
          </span>
        }
        nota={
          <>
            de <b className="text-foreground">{formatNumber(totais.frota, 0)}</b> no período
            {totais.comPendencia > 0 && (
              <>
                {" "}
                · <b className="text-foreground">{formatNumber(totais.comPendencia, 0)}</b> com
                alteração sem preço
              </>
            )}
          </>
        }
        dica={
          `Veículos com ao menos uma variável de ${rubrica} alterada no intervalo. A ` +
          "diferença para a frota são os que não mudaram — e não os que sumiram."
        }
      />
    </div>
  );
}

/**
 * O número, com o sinal dito pela cor e pelo símbolo — nunca só pela cor.
 *
 * Negativo é vermelho e positivo é verde, como em toda tela do produto: o que
 * está medido aqui é a tabela de frete que a transportadora recebe, e uma
 * rubrica menor é menos dinheiro entrando. A cor invertida que já houve aqui
 * vinha de ler o FINAME como despesa da casa, que ele não é.
 */
function Dinheiro({ valor, sufixo }: { valor: number; sufixo: string }) {
  const cor =
    valor < 0 ? "text-brand-red" : valor > 0 ? "text-success" : "text-muted-foreground";
  const sinal = valor > 0 ? "+" : valor < 0 ? "−" : "";
  return (
    <span className={`font-mono text-3xl font-bold tabular-nums ${cor}`}>
      {sinal}
      {formatBrlShort(Math.abs(valor))}
      <span className="text-base font-semibold">{sufixo}</span>
    </span>
  );
}

function Cartao({
  icon: Icone,
  titulo,
  regua,
  valor,
  nota,
  dica,
}: {
  icon: typeof Truck;
  titulo: string;
  regua: string;
  valor: React.ReactNode;
  nota: React.ReactNode;
  dica: string;
}) {
  return (
    <article className="superficie flex flex-col gap-1.5 p-4" title={dica}>
      <h3 className="flex flex-wrap items-center gap-2 text-xs font-bold text-muted-foreground">
        <Icone className="h-4 w-4 shrink-0" aria-hidden="true" />
        {titulo}
        {/* A régua fica no cartão, e não numa nota de rodapé: quem lê o número
            precisa saber qual conta o produziu no mesmo olhar. */}
        <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide">
          {regua}
        </span>
      </h3>
      <div className="leading-none">{valor}</div>
      <p className="text-xs text-muted-foreground">{nota}</p>
    </article>
  );
}
