import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CircleDollarSign,
  Download,
  FileText,
  HandCoins,
  ReceiptText,
  Scale,
  TrendingDown,
  TrendingUp,
  Truck,
} from "lucide-react";

import type { Competencia } from "@workspace/comparison/competencia-de-finame";
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
          valor={formatNumber(resumo.veiculosConciliados, 0)}
          nota="com os dois lados no mês"
          ajuda="Placas com remunerado mensal consolidado e realizado na mesma competência. São as que sustentam os totais ao lado."
          icone={Truck}
        />
        <CartaoDeIndicador
          rotulo={TITULOS_DO_REAL.remunerado}
          valor={escreverDinheiro(resumo.totalRemunerado)}
          nota="somente dos conciliados"
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
          rotulo={TITULOS_DO_REAL.resultadoLiquido}
          valor={escreverDinheiro(resumo.resultadoLiquido)}
          nota="remunerado − realizado"
          ajuda="A diferença dos dois totais acima, e só deles: placa não conciliada não entra em nenhum dos três."
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
