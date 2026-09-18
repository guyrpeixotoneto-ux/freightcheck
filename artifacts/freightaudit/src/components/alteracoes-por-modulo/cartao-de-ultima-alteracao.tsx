import { ArrowDown, ArrowRight, ArrowUp, ExternalLink, History, Minus } from "lucide-react";
import { Link } from "wouter";
import type {
  AssuntoDoCartao,
  BaldeDoCartao,
  CartaoDeUltimaAlteracao,
} from "@workspace/comparison/ultima-alteracao-financeira";
import { Superficie } from "@/components/ui/superficie";
import { Button } from "@/components/ui/button";
import { formatBrl, formatNumber } from "@/lib/format";
import { corDoValor, SUFIXO_DA_PERIODICIDADE } from "@/lib/monitor-custo-fixo";
import { nomeDaCobertura, nomeDoCartao } from "@/lib/alteracoes-por-modulo";
import { escreverModulo } from "@/lib/monitor-equipe";
import { cn } from "@/lib/utils";

/**
 * O CARTÃO DE ÚLTIMA ALTERAÇÃO — cinco cartões diferentes, e não um com campos
 * vazios.
 *
 * ---------------------------------------------------------------------------
 * Por que o cartão muda de forma conforme o módulo
 * ---------------------------------------------------------------------------
 * A tentação óbvia é um cartão só, com os campos monetários em branco onde não
 * há dinheiro — todos alinhados, todos da mesma altura. É exatamente o que esta
 * tela não faz, e o motivo é o mesmo que o produto inteiro repete: **um campo
 * vazio afirma que houve medição e ela deu nada.**
 *
 * "R$ —" no cartão da Manutenção diria que o impacto dela foi apurado e não
 * existe. O que houve foi outra coisa: a manutenção é medida em R$/km, e R$/km
 * não é montante do período. O cartão dela, então, não tem linha de impacto — tem
 * a grandeza em que ela mede, o movimento que houve, e a frase que explica.
 *
 * Os cinco formatos, que são os cinco estados do servidor:
 *
 * | estado | o que o cartão mostra |
 * |---|---|
 * | `COM_MOVIMENTO_FINANCEIRO` | antes, depois, impacto, variação, afetados |
 * | `SEM_MOVIMENTO_FINANCEIRO` | a frase, os pares varridos e o intervalo |
 * | `SEM_MONTANTE_APURAVEL` | o motivo do domínio, a grandeza e o movimento |
 * | `LACUNA_DE_CALCULO` | a lacuna nomeada e a ação de calcular |
 * | `SEM_COBERTURA` | a frase do domínio sobre por que não há par |
 *
 * ---------------------------------------------------------------------------
 * O par mora no topo
 * ---------------------------------------------------------------------------
 * No catálogo por par ele fica no pé, em cinza: lá há um par por cobertura, dito
 * no seletor acima, e o pé só desfaz ambiguidade. Aqui o par é **a resposta** —
 * "a última vez que este módulo se moveu foi de junho para julho" —, e uma
 * resposta não se escreve em cinza no rodapé.
 */

/** O contexto que os dois botões precisam para montar os endereços. */
export interface AcoesDoCartao {
  /** A auditoria do módulo, com o par do cartão. */
  verAlteracoes: (cartao: CartaoDeUltimaAlteracao) => string;
  /** A Linha do Tempo recortada neste módulo. */
  verHistorico: (cartao: CartaoDeUltimaAlteracao) => string;
  /** A Linha do Tempo recortada num assunto do quadro. */
  verHistoricoDoAssunto: (
    cartao: CartaoDeUltimaAlteracao,
    assunto: AssuntoDoCartao,
  ) => string;
  /** Calcular a comparação de uma lacuna. `null` enquanto não há permissão. */
  calcular: ((baseId: string, comparadaId: string) => void) | null;
  calculando: boolean;
}

export function CartaoDeUltimaAlteracaoView({
  cartao,
  acoes,
  /**
   * A ponta mais recente da aba — a régua da defasagem.
   *
   * O âmbar aqui significa **atraso no tempo**, e nada mais: nem erro, nem
   * alerta financeiro. Um cartão âmbar pode estar com um ganho enorme; ele só
   * não é do período mais recente da aba. O `title` diz isso por extenso, porque
   * âmbar é a cor que este produto usa para "olhe aqui" em outras telas.
   */
  maisRecenteDaAba,
}: {
  cartao: CartaoDeUltimaAlteracao;
  acoes: AcoesDoCartao;
  maisRecenteDaAba: string | null;
}) {
  const defasado =
    cartao.par?.comparadaData != null &&
    maisRecenteDaAba != null &&
    cartao.par.comparadaData < maisRecenteDaAba;

  return (
    <Superficie
      className={cn(
        "flex flex-col gap-3 px-4 py-4",
        defasado && "border-amber-300 dark:border-amber-800",
      )}
    >
      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight">{nomeDoCartao(cartao)}</h3>
            <p className="text-xs text-muted-foreground">
              {nomeDaCobertura(cartao.cobertura)}
            </p>
          </div>
        </div>

        <PastilhaDoPar cartao={cartao} defasado={defasado} />
      </header>

      <Corpo cartao={cartao} acoes={acoes} />

      {cartao.assuntos && (
        <QuebraPorAssunto cartao={cartao} acoes={acoes} />
      )}

      <footer className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2.5 text-xs">
        <Link href={acoes.verAlteracoes(cartao)} className="font-semibold text-brand hover:underline">
          <span className="inline-flex items-center gap-1">
            <ExternalLink className="h-3 w-3" aria-hidden />
            Ver alterações
          </span>
        </Link>
        <Link href={acoes.verHistorico(cartao)} className="font-semibold text-brand hover:underline">
          <span className="inline-flex items-center gap-1">
            <History className="h-3 w-3" aria-hidden />
            Ver histórico
          </span>
        </Link>
      </footer>
    </Superficie>
  );
}

/**
 * O par contra o qual **este** cartão foi apurado — a pastilha do topo.
 *
 * Sem par, ela não vira um traço: ela diz o que há no lugar dele, que é
 * diferente de uma comparação vazia.
 */
function PastilhaDoPar({
  cartao,
  defasado,
}: {
  cartao: CartaoDeUltimaAlteracao;
  defasado: boolean;
}) {
  if (!cartao.par?.comparadaData) {
    return (
      <span className="w-fit rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground">
        Sem comparação neste cartão
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold",
        defasado
          ? "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
          : "bg-accent",
      )}
      title={
        defasado
          ? "Este cartão compara um período anterior ao mais recente desta aba — " +
            "é a última vez que ESTE módulo se moveu. Âmbar indica defasagem no " +
            "tempo, e não erro nem alerta financeiro."
          : undefined
      }
    >
      {cartao.par.baseData}
      <ArrowRight className="h-3 w-3" aria-hidden />
      {cartao.par.comparadaData}
    </span>
  );
}

function Corpo({
  cartao,
  acoes,
}: {
  cartao: CartaoDeUltimaAlteracao;
  acoes: AcoesDoCartao;
}) {
  switch (cartao.estado) {
    case "COM_MOVIMENTO_FINANCEIRO":
      return <Financeiro cartao={cartao} />;
    case "SEM_MOVIMENTO_FINANCEIRO":
      return <SemMovimento cartao={cartao} />;
    case "SEM_MONTANTE_APURAVEL":
      return <SemMontante cartao={cartao} />;
    case "LACUNA_DE_CALCULO":
      return <Lacuna cartao={cartao} acoes={acoes} />;
    case "SEM_COBERTURA":
      return (
        <p className="text-xs text-muted-foreground">{cartao.motivo}</p>
      );
  }
}

/** O cartão financeiro — um bloco por balde, e os baldes nunca se somam. */
function Financeiro({ cartao }: { cartao: CartaoDeUltimaAlteracao }) {
  return (
    <div className="flex flex-col gap-3">
      {cartao.baldes.map((balde) => (
        <BlocoDoBalde key={balde.periodicidade} balde={balde} />
      ))}

      <p className="text-xs text-muted-foreground">
        {formatNumber(cartao.movimento.entidades)}{" "}
        {cartao.movimento.rotuloDaEntidade.toLowerCase()} afetad
        {cartao.movimento.entidades === 1 ? "o" : "os"} ·{" "}
        {formatNumber(cartao.movimento.alteracoes)} alteraç
        {cartao.movimento.alteracoes === 1 ? "ão" : "ões"}
      </p>
    </div>
  );
}

function BlocoDoBalde({ balde }: { balde: BaldeDoCartao }) {
  const Seta = balde.impacto > 0 ? ArrowUp : balde.impacto < 0 ? ArrowDown : Minus;
  const sufixo = SUFIXO_DA_PERIODICIDADE[balde.periodicidade] ?? "";

  return (
    <div className="flex flex-col gap-1.5">
      <div className={cn("flex items-baseline gap-2", corDoValor(balde.impacto))}>
        <Seta className="h-4 w-4 self-center" aria-hidden />
        <span className="text-lg font-semibold tabular-nums">
          {balde.impacto > 0 ? "+" : ""}
          {formatBrl(balde.impacto)}
          {sufixo}
        </span>
        <span className="text-xs font-semibold tabular-nums">
          {/*
            Sem base anterior não há percentual — e nunca infinito. Uma rubrica
            que sai de zero teve um começo, não um aumento de mil por cento.
          */}
          {balde.variacao === null
            ? "Sem base anterior para percentual"
            : `${balde.variacao > 0 ? "+" : ""}${(balde.variacao * 100).toFixed(1)}%`}
        </span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs">
        <dt className="text-muted-foreground">Antes — itens alterados</dt>
        <dd className="text-right tabular-nums">
          {formatBrl(balde.antes)}
          {sufixo}
        </dd>
        <dt className="text-muted-foreground">Depois — itens alterados</dt>
        <dd className="text-right tabular-nums">
          {formatBrl(balde.depois)}
          {sufixo}
        </dd>
      </dl>

      {/*
        O rótulo que impede a leitura errada. Sem ele, "R$ 42.756,51 → R$
        61.420,40, +43,7%" parece o FINAME da frota inteira reajustando em
        quarenta e quatro por cento — e é a fatia que se moveu, em dez placas.
      */}
      <p className="text-[0.6875rem] leading-snug text-muted-foreground">
        Considera somente as linhas que mudaram neste período.
      </p>
    </div>
  );
}

/** O módulo financeiro que não se moveu — com o que torna a frase verificável. */
function SemMovimento({ cartao }: { cartao: CartaoDeUltimaAlteracao }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm">Sem alteração financeira nas vigências disponíveis.</p>
      <p className="text-xs text-muted-foreground">
        {cartao.varredura.pares === 0
          ? "Nenhum par consecutivo foi verificado."
          : `${formatNumber(cartao.varredura.pares)} ${
              cartao.varredura.pares === 1 ? "par verificado" : "pares verificados"
            }${
              cartao.varredura.de && cartao.varredura.ate
                ? ` · ${cartao.varredura.de} a ${cartao.varredura.ate}`
                : ""
            }`}
      </p>
    </div>
  );
}

/**
 * O módulo cuja natureza não permite apurar montante.
 *
 * A frase de topo é fixa e neutra; o motivo específico é o do domínio, e o
 * movimento que houve vem logo abaixo — é ele que impede "não vira dinheiro" de
 * ser lido como "nada aconteceu".
 */
function SemMontante({ cartao }: { cartao: CartaoDeUltimaAlteracao }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm">Impacto financeiro não calculável para este módulo.</p>
      <p className="text-xs leading-snug text-muted-foreground">{cartao.motivo}</p>

      {cartao.movimento.alteracoes > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 pt-1 text-xs">
          <dt className="text-muted-foreground">Movimento</dt>
          <dd className="text-right tabular-nums">
            {formatNumber(cartao.movimento.alteracoes)} alteraç
            {cartao.movimento.alteracoes === 1 ? "ão" : "ões"}
            {cartao.movimento.unidade ? ` em ${cartao.movimento.unidade}` : ""}
          </dd>
          <dt className="text-muted-foreground">{cartao.movimento.rotuloDaEntidade}</dt>
          <dd className="text-right tabular-nums">
            {formatNumber(cartao.movimento.entidades)}
          </dd>
        </dl>
      ) : (
        <p className="pt-1 text-xs text-muted-foreground">
          Nenhum movimento nas vigências verificadas
          {cartao.varredura.de && cartao.varredura.ate
            ? ` (${cartao.varredura.de} a ${cartao.varredura.ate})`
            : ""}
          .
        </p>
      )}
    </div>
  );
}

/**
 * A lacuna — e ela é o oposto de "sem alteração".
 *
 * Um intervalo que não foi todo apurado não sustenta a afirmação "não houve
 * alteração". O cartão diz o que falta e oferece o cálculo, em vez de calcular
 * sozinho: a varredura olha até doze pares por cobertura, e calcular na abertura
 * transformaria um clique no menu em minutos de motor.
 */
function Lacuna({
  cartao,
  acoes,
}: {
  cartao: CartaoDeUltimaAlteracao;
  acoes: AcoesDoCartao;
}) {
  const [primeira] = cartao.varredura.lacunas;
  if (!primeira) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">Comparação ainda não calculada.</p>
      <p className="text-xs leading-snug text-muted-foreground">
        {primeira.baseData} → {primeira.comparadaData}
        {cartao.varredura.lacunas.length > 1 &&
          ` e mais ${cartao.varredura.lacunas.length - 1} ${
            cartao.varredura.lacunas.length - 1 === 1 ? "par" : "pares"
          }`}
        . Enquanto ela não existir, esta tela não afirma que o módulo não se moveu.
      </p>
      {acoes.calcular && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit"
          disabled={acoes.calculando}
          onClick={() => acoes.calcular?.(primeira.baseId, primeira.comparadaId)}
        >
          {acoes.calculando ? "Calculando…" : "Calcular"}
        </Button>
      )}
    </div>
  );
}

/**
 * Os dezesseis assuntos de um quadro — cada um com o par **dele**.
 *
 * É aqui que a aba Equipe cumpre a promessa da tela. Um assunto que se moveu em
 * junho fica ao lado de um que se moveu em agosto, os dois dizendo a sua data, e
 * nenhum período é eleito para representar os outros. O âmbar da linha é o mesmo
 * do cartão: defasagem no tempo, e não erro.
 */
function QuebraPorAssunto({
  cartao,
  acoes,
}: {
  cartao: CartaoDeUltimaAlteracao;
  acoes: AcoesDoCartao;
}) {
  const assuntos = cartao.assuntos ?? [];
  const maisRecente = cartao.par?.comparadaData ?? null;
  const distintos = new Set(
    assuntos.map((a) => a.par?.comparadaData).filter((d): d is string => !!d),
  );

  return (
    <div className="flex flex-col gap-1.5 border-t pt-2.5">
      <p className="text-xs font-semibold">
        {assuntos.length} assuntos
        {distintos.size > 1 && (
          <span className="font-normal text-muted-foreground">
            {" "}
            · {distintos.size} períodos distintos
          </span>
        )}
      </p>

      <ul className="flex flex-col divide-y">
        {assuntos.map((assunto) => {
          const defasado =
            assunto.par?.comparadaData != null &&
            maisRecente != null &&
            assunto.par.comparadaData < maisRecente;
          return (
            <li
              key={assunto.modulo}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1 text-xs"
            >
              <span className="font-medium">{escreverModulo(assunto.modulo)}</span>

              {assunto.par?.comparadaData ? (
                <span
                  className={cn(
                    "rounded px-1 tabular-nums",
                    defasado
                      ? "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
                      : "text-muted-foreground",
                  )}
                  title={
                    defasado
                      ? "Este assunto se moveu por último num período anterior ao dos " +
                        "demais deste quadro. Âmbar indica defasagem no tempo."
                      : undefined
                  }
                >
                  {assunto.par.baseData} → {assunto.par.comparadaData}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {assunto.estado === "SEM_COBERTURA"
                    ? "sem cobertura"
                    : "sem movimento nas vigências disponíveis"}
                </span>
              )}

              {assunto.movimento.alteracoes > 0 && (
                <span className="text-muted-foreground tabular-nums">
                  {formatNumber(assunto.movimento.alteracoes)} alt. ·{" "}
                  {formatNumber(assunto.movimento.entidades)}{" "}
                  {assunto.movimento.rotuloDaEntidade.toLowerCase()}
                  {assunto.movimento.unidade ? ` · ${assunto.movimento.unidade}` : ""}
                </span>
              )}

              <Link
                href={acoes.verHistoricoDoAssunto(cartao, assunto)}
                className="ml-auto font-semibold text-brand hover:underline"
              >
                Ver alterações
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
