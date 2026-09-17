import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CircleDollarSign,
  CircleHelp,
  Download,
  FileText,
  HandCoins,
  ReceiptText,
  Scale,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Truck,
} from "lucide-react";

import type { Competencia } from "@workspace/comparison/competencia-de-finame";
import type { AlertaDoConfronto } from "@workspace/comparison/alertas-do-confronto";
import type { CoberturaDoConfronto } from "@workspace/comparison/confronto-de-finame";
import { TITULOS_DO_REAL } from "@workspace/comparison/fonte-de-finame";
import type { RecorteDeTipo } from "@/components/comparacao/recorte-de-equipamento";
import { ApiErrorNotice } from "@/components/api-error";
import { Button } from "@/components/ui/button";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Paginacao } from "@/components/ui/paginacao";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import {
  COR_DO_RESULTADO,
  ROTULO_CURTO_DO_RESULTADO,
  ROTULO_DA_COBERTURA,
  escreverCobertura,
  escreverDinheiro,
  escreverVariacao,
  frasesDaCobertura,
  linhasDoCsvDoConfronto,
  TRACO,
  type RespostaDasCompetencias,
  type RespostaDoConfronto,
} from "@/lib/confronto-de-finame";
import { consultaDoConfronto } from "@/lib/fonte-de-finame";
import { cn } from "@/lib/utils";

/**
 * A FONTE REAL EM TELA — remunerado contra realizado, numa competência.
 *
 * ---------------------------------------------------------------------------
 * Um seletor, e não dois
 * ---------------------------------------------------------------------------
 * O modo Remunerado escolhe **duas** pontas porque compara duas entregas. Este
 * escolhe **uma** competência, porque as duas pontas dele não são dois momentos:
 * são duas naturezas do mesmo mês. Manter "De" e "Para" aqui ofereceria a quem
 * lê uma escolha que não existe — e a primeira coisa que alguém tentaria seria
 * comparar setembro remunerado contra agosto realizado, que é precisamente a
 * comparação que não se pode fazer.
 *
 * Pela mesma razão **não há Inverter**: a direção é o significado. Ver
 * `permiteInverter`, em `@workspace/comparison/fonte-de-finame`.
 *
 * O que a tela mostra ao lado do seletor são os **dois lados** do mês, por
 * extenso — quais vigências remuneradas o compõem e qual competência realizada
 * está sendo lida. É o que permite conferir, sem abrir mais nada, que os dois
 * lados falam do mesmo intervalo econômico.
 *
 * ---------------------------------------------------------------------------
 * Sem fonte do realizado, a tela diz isso
 * ---------------------------------------------------------------------------
 * Não desenha cartões zerados, não desenha tabela vazia e não desenha erro:
 * escreve que não há fonte, com o que falta para haver. R$ 0,00 seria uma
 * afirmação sobre dinheiro que ninguém mediu.
 */
export function ConfrontoDeFiname({
  consulta,
  tipo,
  competencia,
  onCompetencia,
  onCompetenciasCarregadas,
}: {
  /** O contexto da unidade aberta — `scopeHash`, canal, operação. */
  consulta: URLSearchParams;
  tipo: RecorteDeTipo;
  competencia: Competencia | null;
  onCompetencia: (c: Competencia) => void;
  /** As competências que existem, para a página reconciliar a da URL. */
  onCompetenciasCarregadas: (c: Competencia[]) => void;
}) {
  const contexto = consulta.toString();

  const competencias = useQuery({
    queryKey: ["finame", "competencias", contexto, tipo],
    queryFn: () =>
      fetchJson<RespostaDasCompetencias>(
        `/finame/competencias?${consultaDoConfronto(consulta, null, tipo)}`,
      ),
  });

  const disponiveis = useMemo(
    () => (competencias.data?.competencias ?? []).map((c) => c.competencia),
    [competencias.data],
  );

  /* A página é quem decide qual competência abrir — ela conhece a URL. Aqui só
     se avisa o que existe, e o aviso sai do render para não escrever estado de
     outro componente durante a renderização deste. */
  useEffect(() => {
    if (competencias.data) onCompetenciasCarregadas(disponiveis);
  }, [competencias.data, disponiveis, onCompetenciasCarregadas]);

  const confronto = useQuery({
    queryKey: ["finame", "confronto", contexto, tipo, competencia],
    /*
      Só se pergunta por um mês que a fonte listou.

      Sem a segunda condição, uma competência que sobrou na URL — de um recorte
      anterior, de um link velho — viraria um pedido ao servidor antes de a
      página ter chance de reconciliá-la. O servidor recusaria com 404, e o que
      chegaria à tela seria um painel de erro no lugar da competência certa.
    */
    enabled: Boolean(competencia) && disponiveis.includes(competencia as string),
    queryFn: () =>
      fetchJson<RespostaDoConfronto>(
        `/finame/confronto?${consultaDoConfronto(consulta, competencia, tipo)}`,
      ),
  });

  if (competencias.error) {
    return (
      <ApiErrorNotice
        error={competencias.error}
        what="as competências do realizado"
        onTentarDeNovo={() => void competencias.refetch()}
      />
    );
  }

  if (competencias.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (disponiveis.length === 0) {
    return (
      <EstadoVazio
        icone={FileText}
        titulo="Nenhuma competência para analisar"
        descricao={
          "Esta unidade ainda não tem vigência de equipamento importada — sem o lado " +
          "remunerado não há competência a confrontar."
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SeletorDaCompetencia
        competencias={competencias.data?.competencias ?? []}
        valor={competencia}
        onValor={onCompetencia}
        carregando={confronto.isFetching}
      />

      {confronto.error ? (
        <ApiErrorNotice
          error={confronto.error}
          what="o confronto da competência"
          onTentarDeNovo={() => void confronto.refetch()}
        />
      ) : confronto.isLoading || !confronto.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <ResultadoDoConfrontoEmTela resposta={confronto.data} />
      )}
    </div>
  );
}

/**
 * A competência analisada, e os dois lados que ela reúne.
 *
 * Uma competência que o realizado não tem continua sendo oferecida, marcada. A
 * alternativa — escondê-la — transformaria "não há realizado em agosto" num
 * mês que sumiu do seletor sem explicação, e quem audita passaria a procurar o
 * defeito na tela em vez de na fonte.
 */
function SeletorDaCompetencia({
  competencias,
  valor,
  onValor,
  carregando,
}: {
  competencias: RespostaDasCompetencias["competencias"];
  valor: Competencia | null;
  onValor: (c: Competencia) => void;
  carregando: boolean;
}) {
  const escolhida = competencias.find((c) => c.competencia === valor);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[240px] flex-1">
          <label
            htmlFor="finame-competencia"
            className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Competência analisada
          </label>
          <Select value={valor ?? undefined} onValueChange={(v) => onValor(v as Competencia)}>
            <SelectTrigger id="finame-competencia" disabled={carregando}>
              <SelectValue placeholder="Escolha a competência" />
            </SelectTrigger>
            <SelectContent>
              {competencias.map((c) => (
                <SelectItem key={c.competencia} value={c.competencia}>
                  {c.rotulo}
                  {!c.temRealizado && " · sem realizado"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/*
          Os dois lados escritos por extenso.

          É o que responde, sem abrir mais nada, a pergunta que decide a
          validade do número: *estes dois lados falam do mesmo intervalo?* As
          vigências do mês aparecem nomeadas — e o mês realizado aparece como
          mês, sem quinzena, porque é assim que ele existe.
        */}
        {escolhida && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <LadoDoConfronto
              icone={ReceiptText}
              titulo="Remunerado"
              detalhe={`${escolhida.rotulo} · ${
                escolhida.vigencias.length === 1
                  ? "1 vigência"
                  : `${escolhida.vigencias.length} vigências`
              }`}
            />
            <span aria-hidden="true" className="text-lg text-muted-foreground">
              ×
            </span>
            <LadoDoConfronto
              icone={FileText}
              titulo="Realizado"
              detalhe={`${escolhida.rotulo} · competência mensal`}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function LadoDoConfronto({
  icone: Icone,
  titulo,
  detalhe,
}: {
  icone: typeof FileText;
  titulo: string;
  detalhe: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <Icone aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
      <span>
        <span className="font-semibold">{titulo}:</span>{" "}
        <span className="text-muted-foreground">{detalhe}</span>
      </span>
    </span>
  );
}

function ResultadoDoConfrontoEmTela({ resposta }: { resposta: RespostaDoConfronto }) {
  if (!resposta.realizado.disponivel) {
    return (
      <EstadoVazio
        icone={AlertTriangle}
        tom="atencao"
        titulo="Fonte sem dados"
        descricao={
          <>
            {resposta.realizado.frase}
            {resposta.realizado.oQueFalta && (
              <>
                <br />
                <span className="text-xs">{resposta.realizado.oQueFalta}</span>
              </>
            )}
            <br />
            <span className="text-xs">
              O lado remunerado de {resposta.rotulo} está lido e consolidado:{" "}
              {formatNumber(resposta.remunerado.consolidados, 0)} de{" "}
              {formatNumber(resposta.remunerado.veiculos, 0)} veículos com parcela mensal
              única.
            </span>
          </>
        }
      />
    );
  }

  const confronto = resposta.confronto;
  if (!confronto || confronto.linhas.length === 0) {
    return (
      <EstadoVazio
        icone={FileText}
        titulo={`Sem dados suficientes em ${resposta.rotulo}`}
        descricao="A competência não reuniu nenhuma placa com os dois lados. Nada foi somado."
      />
    );
  }

  const { resumo } = confronto;
  const frases = frasesDaCobertura(resposta);

  function exportar() {
    if (!confronto) return;
    salvarArquivo(
      csvComoBlob(linhasDoCsvDoConfronto(confronto)),
      `finame-confronto-${paraNomeDeArquivo(resposta.rotulo)}.csv`,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
        aria-label="Indicadores do confronto"
      >
        <CartaoDeIndicador
          rotulo={TITULOS_DO_REAL.veiculosComparados}
          valor={escreverCobertura(resumo.veiculosConciliados, resumo.veiculosRemunerados)}
          nota="com os dois lados no mês"
          ajuda="Placas com remunerado mensal consolidado e realizado na mesma competência. São as que sustentam os totais ao lado."
          icone={Truck}
        />
        <CartaoDeIndicador
          rotulo={TITULOS_DO_REAL.remunerado}
          valor={escreverDinheiro(resumo.totalRemunerado)}
          nota={`somente dos conciliados · ${escreverCobertura(
            resumo.veiculosConciliados,
            resumo.veiculosRemunerados,
          )}`}
          ajuda="Parcela FINAME mensal remunerada pela Ambev. A parcela é mensal: as duas quinzenas do mês declaram o mesmo valor, e ele não é somado duas vezes."
          icone={ReceiptText}
        />
        <CartaoDeIndicador
          rotulo={TITULOS_DO_REAL.realizado}
          valor={escreverDinheiro(resumo.totalRealizado)}
          nota="somente dos conciliados"
          ajuda="Custo de FINAME que a operação incorreu na competência, pela fonte realizada."
          icone={HandCoins}
        />
        <CartaoDeIndicador
          rotulo={TITULOS_DO_REAL.sobra}
          valor={formatNumber(resumo.veiculosComSobra, 0)}
          nota="remunerado acima do custo"
          ajuda="Veículos em que a remuneração ficou acima do custo realizado. Sobra não é automaticamente boa: um ativo fora de operação e ainda remunerado aparece aqui."
          icone={TrendingUp}
        />
        <CartaoDeIndicador
          rotulo={TITULOS_DO_REAL.deficit}
          valor={formatNumber(resumo.veiculosComDeficit, 0)}
          nota="remunerado abaixo do custo"
          ajuda="Veículos em que a remuneração não cobriu o custo realizado."
          icone={TrendingDown}
          corDoIcone="bg-warning/12 text-warning-foreground"
        />
        <CartaoDeIndicador
          rotulo={TITULOS_DO_REAL.saldoDosConciliados}
          valor={escreverDinheiro(resumo.saldoDosConciliados)}
          /*
            A cobertura vem na nota, e vem **sempre** — inclusive quando tudo
            conciliou. Ela não é um aviso, é a metade do significado do número:
            sem ela, o saldo de 17 veículos se lê como o saldo do mês, que foi
            exatamente o que aconteceu em setembro/2026.
          */
          nota={`remunerado − realizado · ${escreverCobertura(
            resumo.veiculosConciliados,
            resumo.veiculosRemunerados,
          )}`}
          ajuda={
            "O saldo dos veículos conciliados, e só deles — não é o resultado do mês. " +
            "Placa sem realizado, sem remunerado ou não conciliada não entra em nenhum " +
            "dos três números. Os universos que ficaram de fora estão logo abaixo."
          }
          icone={CircleDollarSign}
          destaque
        />
      </div>

      {/*
        A cobertura numa linha, e não num sétimo cartão. Ver `frasesDaCobertura`:
        quando está tudo conciliado esta linha não existe.
      */}
      {frases.length > 0 && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Scale aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {frases.join(" · ")}
            {resumo.foraDoConfronto.veiculos > 0 && (
              <>
                {" · "}
                <span title="O que ficou fora dos totais, para que a soma na mão bata com o cartão.">
                  fora do confronto: {escreverDinheiro(resumo.foraDoConfronto.remuneradoSemRealizado)}{" "}
                  remunerados e {escreverDinheiro(resumo.foraDoConfronto.realizadoSemRemunerado)}{" "}
                  realizados
                </span>
              </>
            )}
          </span>
        </p>
      )}

      {resposta.universos && (
        <TresUniversos universos={resposta.universos} rotulo={resposta.rotulo} />
      )}

      <FinanciadosSemRealizado confronto={confronto} rotulo={resposta.rotulo} />

      {resposta.alertas && resposta.alertas.length > 0 && (
        <AlertasDaCompetencia alertas={resposta.alertas} />
      )}

      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-sm font-semibold">
            Remunerado × Realizado por veículo · {resposta.rotulo}
          </h2>
          <Button variant="outline" size="sm" onClick={exportar}>
            <Download aria-hidden="true" className="mr-1.5 h-4 w-4" />
            Exportar CSV
          </Button>
        </div>
        <TabelaDoConfronto confronto={confronto} />
      </div>
    </div>
  );
}

/**
 * OS TRÊS UNIVERSOS — e a razão de eles não virarem um total.
 *
 * ---------------------------------------------------------------------------
 * Por que três blocos, e não seis cartões
 * ---------------------------------------------------------------------------
 * Porque a fileira de cartões acima responde **uma** pergunta — a distância
 * entre os dois lados onde ela é mensurável — e esta seção responde outra:
 * *quanto da competência aquela pergunta alcança?* Enfiar "47 veículos sem
 * realizado" como um sétimo cartão o colocaria na mesma fileira do saldo, e uma
 * fileira de cartões se lê como um conjunto de parcelas da mesma coisa. Estes
 * três não se somam: o universo 2 é remuneração sem custo e o 3 é custo sem
 * ativo, lados opostos do mesmo confronto.
 *
 * A separação visual é o argumento. Ver
 * `docs/DEFINICOES-DO-CONFRONTO-DE-FINAME.md`.
 */
function TresUniversos({
  universos,
  rotulo,
}: {
  universos: NonNullable<RespostaDoConfronto["universos"]>;
  rotulo: string;
}) {
  const { conciliados, semRealizado, pendenteDeClassificacao } = universos;

  return (
    <section aria-label="Os três universos da competência" className="flex flex-col gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        O que {rotulo} tem, em três universos que não se somam
      </h2>
      <div className="grid gap-3 lg:grid-cols-3">
        <BlocoDoUniverso
          icone={Truck}
          tom="brand"
          titulo="1 · Conciliados"
          destaque={escreverCobertura(conciliados.veiculos, conciliados.de)}
          descricao="Com remunerado mensal consolidado e realizado na mesma competência. São os únicos que entram nos totais acima."
          linhas={[
            { rotulo: "Remunerado", valor: escreverDinheiro(conciliados.remunerado) },
            { rotulo: "Realizado", valor: escreverDinheiro(conciliados.realizado) },
            { rotulo: "Saldo", valor: escreverDinheiro(conciliados.saldo), forte: true },
          ]}
        />
        <BlocoDoUniverso
          icone={ReceiptText}
          tom="atencao"
          titulo="2 · Sem realizado"
          destaque={`${formatNumber(semRealizado.veiculos, 0)} ${
            semRealizado.veiculos === 1 ? "veículo" : "veículos"
          }`}
          descricao="Remunerados na competência, sem nenhum lançamento correspondente no razão. Ausência não é R$ 0,00: eles não entram em total nenhum."
          linhas={[
            {
              rotulo: "Remuneração sem contrapartida",
              valor: escreverDinheiro(semRealizado.remunerado),
              forte: true,
            },
            {
              rotulo: "Declarados financiados",
              valor: `${formatNumber(semRealizado.financiados, 0)} · ${escreverDinheiro(
                semRealizado.remuneradoFinanciado,
              )}`,
            },
            {
              rotulo: "Declarados quitados",
              valor: formatNumber(semRealizado.quitados, 0),
            },
          ]}
        />
        <BlocoDoUniverso
          icone={CircleHelp}
          tom="neutro"
          titulo="3 · Real pendente de classificação"
          destaque={`${formatNumber(pendenteDeClassificacao.naCompetencia.placas, 0)} ${
            pendenteDeClassificacao.naCompetencia.placas === 1 ? "placa" : "placas"
          }`}
          descricao="O razão traz o custo e o cadastro não resolve o tipo do ativo. Ficam fora do confronto até alguém classificá-las — preservados, nunca descartados."
          linhas={[
            {
              rotulo: `Nesta competência`,
              valor: escreverDinheiro(pendenteDeClassificacao.naCompetencia.valor),
              forte: true,
            },
            {
              /* Os dois recortes, ditos. O total do extrato é o tamanho da fila,
                 e não o que ficou de fora deste mês — apresentá-lo sozinho ao
                 lado de um painel mensal foi como R$ 174.826,25 passou a ser
                 lido como pendência de setembro. */
              rotulo: "Na fila do extrato inteiro",
              valor: `${formatNumber(pendenteDeClassificacao.noExtrato.placas, 0)} · ${escreverDinheiro(
                pendenteDeClassificacao.noExtrato.valor,
              )}`,
            },
          ]}
        />
      </div>
    </section>
  );
}

const TOM_DO_UNIVERSO = {
  brand: "border-brand/30 bg-brand/[0.04] text-brand",
  atencao: "border-warning/40 bg-warning/[0.06] text-warning-foreground",
  neutro: "border-border bg-muted/30 text-muted-foreground",
} as const;

function BlocoDoUniverso({
  icone: Icone,
  tom,
  titulo,
  destaque,
  descricao,
  linhas,
}: {
  icone: typeof Truck;
  tom: keyof typeof TOM_DO_UNIVERSO;
  titulo: string;
  destaque: string;
  descricao: string;
  linhas: { rotulo: string; valor: string; forte?: boolean }[];
}) {
  return (
    <div className={cn("flex flex-col rounded-lg border p-4", TOM_DO_UNIVERSO[tom])}>
      <div className="flex items-center gap-2">
        <Icone aria-hidden="true" className="h-4 w-4 shrink-0" />
        <h3 className="text-[0.8125rem] font-bold">{titulo}</h3>
      </div>
      <p className="mt-2 text-2xl font-extrabold tabular-nums leading-none tracking-[-0.01em] text-foreground">
        {destaque}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{descricao}</p>
      <dl className="mt-3 flex flex-col gap-1 border-t pt-3 text-xs">
        {linhas.map((l) => (
          <div key={l.rotulo} className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{l.rotulo}</dt>
            <dd
              className={cn(
                "tabular-nums",
                l.forte ? "font-bold text-foreground" : "font-medium",
              )}
            >
              {l.valor}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * OS FINANCIADOS SEM LANÇAMENTO REAL — fora da tabela, de propósito.
 *
 * ---------------------------------------------------------------------------
 * Por que este painel existe
 * ---------------------------------------------------------------------------
 * Porque estes veículos eram, até aqui, linhas cinzas de "Sem realizado" numa
 * tabela de 64 linhas paginada de 50 em 50 — e são o achado mais forte da tela.
 * Um cavalo que a base declara **financiado** e que o razão não cobra no mês é
 * uma de duas coisas, e as duas exigem alguém: ou o razão não registrou uma
 * parcela devida, ou a base remunera um financiamento que não existe mais.
 *
 * O painel mostra os maiores por remuneração e diz quantos ficaram de fora, em
 * vez de repetir a tabela. Quem quiser a lista inteira tem o CSV, que sai com a
 * situação declarada em coluna própria.
 *
 * Um veículo **quitado** sem lançamento não aparece aqui: ele é coerente, e
 * enchê-lo neste painel é o jeito de fazer alguém parar de lê-lo.
 */
const QUANTOS_FINANCIADOS_MOSTRAR = 8;

function FinanciadosSemRealizado({
  confronto,
  rotulo,
}: {
  confronto: NonNullable<RespostaDoConfronto["confronto"]>;
  rotulo: string;
}) {
  const financiados = useMemo(
    () =>
      confronto.linhas
        .filter(
          (l) =>
            l.cobertura === "SEM_REALIZADO" &&
            l.situacaoDoFinanciamento === "FINANCIADO" &&
            l.remunerado !== null,
        )
        .sort((a, b) => (b.remunerado ?? 0) - (a.remunerado ?? 0)),
    [confronto.linhas],
  );

  if (financiados.length === 0) return null;

  const total = confronto.resumo.semRealizado.remuneradoFinanciado;
  const mostrados = financiados.slice(0, QUANTOS_FINANCIADOS_MOSTRAR);
  const restantes = financiados.length - mostrados.length;

  return (
    <section
      aria-label="Veículos financiados sem lançamento real"
      className="rounded-lg border border-destructive/40 bg-destructive/[0.05] p-4"
      data-testid="financiados-sem-realizado"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ShieldAlert aria-hidden="true" className="h-4 w-4 shrink-0 text-destructive" />
        <h2 className="text-sm font-semibold">
          {formatNumber(financiados.length, 0)}{" "}
          {financiados.length === 1
            ? "veículo declarado financiado sem lançamento real"
            : "veículos declarados financiados sem lançamento real"}{" "}
          em {rotulo}
        </h2>
        <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs font-bold tabular-nums text-destructive">
          {escreverDinheiro(total)} remunerados
        </span>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">
        A base declara o financiamento vivo e o razão não traz parcela para eles nesta
        competência. Ou falta o lançamento, ou a remuneração continua sobre um contrato
        encerrado — nos dois casos, esta remuneração não está confrontada com custo nenhum.
      </p>
      <ul className="mt-3 grid gap-1.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
        {mostrados.map((l) => (
          <li
            key={`${l.entityType}-${l.entityLabel}`}
            className="flex items-baseline justify-between gap-2 rounded border bg-background/60 px-2.5 py-1.5"
          >
            <span className="font-medium">
              {l.entityLabel}{" "}
              <span className="text-[0.6875rem] text-muted-foreground">{l.entityType}</span>
            </span>
            <span className="tabular-nums font-semibold">{escreverDinheiro(l.remunerado)}</span>
          </li>
        ))}
      </ul>
      {restantes > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          e mais {formatNumber(restantes, 0)}{" "}
          {restantes === 1 ? "veículo" : "veículos"} — a lista inteira sai no CSV, com a
          situação declarada em coluna própria.
        </p>
      )}
    </section>
  );
}

/**
 * OS ALERTAS — o que a coluna Resultado não consegue dizer sozinha.
 *
 * Cada um vem com a evidência que o sustenta, e não só com a frase. Um aviso
 * que afirma sem mostrar manda quem audita reabrir a planilha para descobrir se
 * ele procede — e, na terceira vez, manda ignorá-lo. As regras moram em
 * `@workspace/comparison/alertas-do-confronto`; aqui só se desenha.
 */
function AlertasDaCompetencia({ alertas }: { alertas: AlertaDoConfronto[] }) {
  return (
    <section
      aria-label="Alertas da competência"
      className="flex flex-col gap-2"
      data-testid="alertas-do-confronto"
    >
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {alertas.length === 1 ? "1 alerta nesta competência" : `${alertas.length} alertas nesta competência`}
      </h2>
      {alertas.map((a) => (
        <div
          key={`${a.tipo}-${a.entityType}-${a.entityLabel}`}
          className="rounded-lg border border-warning/40 bg-warning/[0.06] p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-warning-foreground" />
            <span className="font-semibold">{a.entityLabel}</span>
            <span className="text-xs text-muted-foreground">{a.entityType}</span>
            <span className="text-sm">· {a.titulo}</span>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">{a.porque}</p>
          <dl className="mt-3 grid gap-1.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
            {a.evidencia.map((e) => (
              <div
                key={e.rotulo}
                className="flex items-baseline justify-between gap-2 rounded border bg-background/60 px-2.5 py-1.5"
              >
                <dt className="text-muted-foreground">{e.rotulo}</dt>
                <dd className="tabular-nums font-semibold">{e.valor}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}

/**
 * A ordem da tabela — e por que ela não é alfabética.
 *
 * A pergunta desta tela é a distância entre os dois lados, e quem responde a
 * ela são as placas conciliadas. Numa frota em que a conciliação ainda é
 * parcial, a ordem alfabética enterra as sete linhas que têm resposta debaixo
 * de cento e vinte que não têm — medido na primeira renderização sobre a base
 * real, e visível no print: três páginas de "Sem realizado" antes do primeiro
 * número comparável.
 *
 * Então a ordem é por **o que a linha consegue dizer**: primeiro as completas,
 * depois as que têm um lado só, e por último as que não conciliaram. Dentro de
 * cada grupo, o tipo e a placa — que é a ordem em que se procura uma placa
 * específica.
 */
const PESO_DA_COBERTURA: Record<CoberturaDoConfronto, number> = {
  COMPLETA: 0,
  SEM_REALIZADO: 1,
  SEM_REMUNERADO: 2,
  NAO_CONCILIADO: 3,
};

function TabelaDoConfronto({ confronto }: { confronto: NonNullable<RespostaDoConfronto["confronto"]> }) {
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(50);

  const ordenadas = useMemo(
    () =>
      [...confronto.linhas].sort(
        (a, b) =>
          PESO_DA_COBERTURA[a.cobertura] - PESO_DA_COBERTURA[b.cobertura] ||
          a.entityType.localeCompare(b.entityType) ||
          a.entityLabel.localeCompare(b.entityLabel),
      ),
    [confronto.linhas],
  );

  /* Trocar de competência encurta a lista; a página em que se estava pode não
     existir mais. O mesmo efeito da tabela do Remunerado. */
  useEffect(() => setPagina(1), [confronto.competencia, porPagina]);

  const naPagina = ordenadas.slice((pagina - 1) * porPagina, pagina * porPagina);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 text-left font-semibold">Veículo</th>
            <th className="px-4 py-2 text-right font-semibold">Remunerado</th>
            <th className="px-4 py-2 text-right font-semibold">Realizado</th>
            <th className="px-4 py-2 text-right font-semibold">Diferença</th>
            <th className="px-4 py-2 text-right font-semibold">Variação</th>
            <th className="px-4 py-2 text-left font-semibold">Resultado</th>
            <th className="px-4 py-2 text-left font-semibold">Cobertura</th>
          </tr>
        </thead>
        <tbody>
          {naPagina.map((l) => (
            <tr key={`${l.entityType}-${l.entityLabel}`} className="border-b last:border-0">
              <td className="px-4 py-2">
                <span className="font-medium">{l.entityLabel}</span>{" "}
                <span className="text-xs text-muted-foreground">{l.entityType}</span>
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {escreverDinheiro(l.remunerado)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {escreverDinheiro(l.realizado)}
              </td>
              <td
                className={cn(
                  "px-4 py-2 text-right tabular-nums font-medium",
                  COR_DO_RESULTADO[l.resultado],
                )}
              >
                {escreverDinheiro(l.diferenca)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {escreverVariacao(l.variacao)}
              </td>
              <td className={cn("px-4 py-2", COR_DO_RESULTADO[l.resultado])}>
                {ROTULO_CURTO_DO_RESULTADO[l.resultado]}
              </td>
              <td className="px-4 py-2">
                <span
                  className={cn(
                    "text-xs",
                    l.cobertura === "COMPLETA" ? "text-muted-foreground" : "text-warning-foreground",
                  )}
                  /* O motivo é o que transforma "Não conciliado" de veredito em
                     explicação — sem ele, a coluna manda procurar sem dizer onde. */
                  title={l.motivo ?? undefined}
                >
                  {ROTULO_DA_COBERTURA[l.cobertura]}
                  {l.motivo ? " ⓘ" : ""}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {confronto.linhas.length === 0 && (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{TRACO}</p>
      )}
      <Paginacao
        pagina={pagina}
        porPagina={porPagina}
        total={ordenadas.length}
        onPagina={setPagina}
        onPorPagina={setPorPagina}
        tamanhos={[25, 50, 100]}
        unidade="veículos"
        unidadeSingular="veículo"
        className="border-t px-4 py-3"
      />
    </div>
  );
}
