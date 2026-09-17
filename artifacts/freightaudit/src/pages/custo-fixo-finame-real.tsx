import { useMemo, useState, type ReactElement } from "react";
import { useLocation, useSearch } from "wouter";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Scale,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { CabecalhoDePagina } from "@/components/layout/cabecalho-de-pagina";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Paginacao } from "@/components/ui/paginacao";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ACERVOS } from "@workspace/ingest/tipos";
import {
  ROTULO_DO_ESTADO_REAL,
  TOM_DO_ESTADO_REAL,
  escreverDesvio,
  escreverReais,
  useComparacaoDoReal,
  useLancamentosDaPlaca,
  usePendenciasDoReal,
  useRegistrarDecisao,
  type LinhaDaComparacaoReal,
} from "@/lib/financiamento-real";
import { Button } from "@/components/ui/button";

/**
 * FINANCIAMENTO REAL — o que o banco cobrou, ao lado do que a Ambev paga.
 *
 * ---------------------------------------------------------------------------
 * A única coisa que esta tela precisa dizer bem
 * ---------------------------------------------------------------------------
 * **Que os dois lados medem períodos diferentes, e que nada foi somado nem
 * dividido para fazê-los caber um no outro.** O remunerado vive em vigências
 * quinzenais e carrega um valor mensal dentro de cada uma; o realizado vive em
 * competência mensal, porque o extrato do banco fecha por mês.
 *
 * As duas frases ficam no topo, lado a lado, e vêm do servidor — são as mesmas
 * constantes que a API responde (`GRANULARIDADE_DO_*`). Escrevê-las aqui seria
 * abrir a porta para a tela dizer uma coisa e a regra fazer outra.
 *
 * ---------------------------------------------------------------------------
 * O que esta tela não faz
 * ---------------------------------------------------------------------------
 * Não soma as duas quinzenas do remunerado — medido: em agosto/2026, 111 de 111
 * placas trazem o **mesmo** número nas duas, de modo que somar dobraria o custo
 * e a auditoria passaria a acusar 100% de desvio em toda a frota. E não divide
 * o realizado por dois para caber numa quinzena: repartir a parcela seria
 * inventar uma alocação que o banco não fez.
 *
 * Nenhuma conta acontece aqui. Os números chegam comparados por
 * `compararCompetencia` e `resumirCompetencia`, as mesmas funções que a API
 * usa — é assim que o cartão do topo e a linha da tabela nunca discordam.
 */
/*
  Os tipos que o acervo Real aceita — a lista mora no domínio, e a tela a lê.

  Uma segunda lista aqui concordaria no dia em que fosse escrita e discordaria no
  dia do sexto equipamento.
*/
const TIPOS_DE_ATIVO = ACERVOS.find((a) => a.code === "REAL")?.tipos ?? [];

export default function FinanciamentoReal() {
  const busca = useSearch();
  const [, navegar] = useLocation();
  const parametros = useMemo(() => new URLSearchParams(busca), [busca]);
  const competenciaDaUrl = parametros.get("competencia");

  const [filtro, setFiltro] = useState("");
  const [placaAberta, setPlacaAberta] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);

  const comparacao = useComparacaoDoReal(competenciaDaUrl);
  const pendencias = usePendenciasDoReal();

  const dados = comparacao.data;
  const linhas = dados?.linhas ?? [];

  const visiveis = useMemo(() => {
    const termo = filtro.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const base = termo === "" ? linhas : linhas.filter((l) => l.placa.includes(termo));
    /*
      Maior desvio primeiro, e as ausências no fim. A pergunta que traz alguém a
      esta tela é "onde o banco cobrou mais do que pagamos", e uma ordem
      alfabética faria essa resposta começar na página quatro.
    */
    return [...base].sort((a, b) => {
      const pesoA = a.desvio === null ? -Infinity : Math.abs(a.desvio);
      const pesoB = b.desvio === null ? -Infinity : Math.abs(b.desvio);
      return pesoB - pesoA || a.placa.localeCompare(b.placa);
    });
  }, [linhas, filtro]);

  /*
    Se há **alguma** placa com os dois lados. Sem isso, todo total desta tela é
    zero por ausência, e zero é a única coisa que ele não pode dizer.
  */
  const temComparacao = (dados?.resumo?.placasComparadas ?? 0) > 0;

  /*
    A página, e não a tabela inteira.

    São 134 placas numa competência do acervo real, e desenhá-las todas fazia a
    página crescer doze mil pixels — a pendência do topo, que é o que alguém
    precisa ver, saía da primeira tela e a rolagem virava o trabalho. O recorte
    é o mesmo componente que as demais tabelas deste produto usam.
  */
  const daPagina = useMemo(
    () => visiveis.slice((pagina - 1) * porPagina, pagina * porPagina),
    [visiveis, pagina, porPagina],
  );

  function trocarCompetencia(competencia: string): void {
    /* Trocar de mês volta para a primeira página: a página 4 do mês anterior
       não descreve nada no mês novo. */
    setPagina(1);
    const novos = new URLSearchParams(busca);
    novos.set("competencia", competencia);
    navegar(`/custo-fixo-finame-real?${novos.toString()}`);
  }

  return (
    <Layout>
      <CabecalhoDePagina
        icone={Scale}
        titulo="Financiamento Real"
        descricao="O extrato do banco ao lado do que a Ambev remunera, competência a competência."
      />

      {comparacao.isError ? (
        <ApiErrorNotice error={comparacao.error} what="a comparação do financiamento real" />
      ) : comparacao.isLoading ? (
        <div className="space-y-3" data-testid="carregando-financiamento-real">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : dados?.competencia === null ? (
        <EstadoVazio
          icone={Banknote}
          titulo="Nenhuma competência importada"
          descricao={
            dados.motivo ??
            "O extrato do financiamento entra pela aba Real da tela de Importações."
          }
        />
      ) : (
        <div className="space-y-6">
          {/*
            A fileira que explica a granularidade. Ela vem **antes** dos
            números de propósito: quem lê "R$ 1,1 milhão de realizado contra R$
            1,0 milhão de remunerado" precisa saber, antes de tirar conclusão,
            que os dois são do mesmo mês e que nenhum deles foi somado ou
            repartido para chegar ali.
          */}
          <section className="grid gap-3 sm:grid-cols-2" data-testid="granularidade">
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {dados?.granularidade.remunerado}
              </p>
              <p className="mt-1 text-2xl font-semibold" data-testid="total-remunerado">
                {temComparacao ? escreverReais(dados?.resumo?.totalRemunerado ?? null) : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {!temComparacao
                  ? "A vigência remunerada deste mês ainda não foi importada — não há o que comparar."
                  : dados?.quinzenasLidas?.length === 2
                    ? "As duas quinzenas do mês trazem o mesmo valor mensal — ele não é somado."
                    : `Lido de ${dados?.quinzenasLidas?.join(", ")}.`}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {dados?.granularidade.realizado}
              </p>
              <p className="mt-1 text-2xl font-semibold" data-testid="total-realizado">
                {temComparacao ? escreverReais(dados?.resumo?.totalRealizado ?? null) : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {temComparacao
                  ? "O extrato do banco fecha por mês; o valor não foi dividido por quinzena."
                  : `O extrato trouxe ${linhas.length} placas nesta competência, mas nenhuma delas tem remuneração importada para confrontar.`}
              </p>
            </div>
          </section>

          <section className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={dados?.competencia ?? undefined}
                onValueChange={trocarCompetencia}
              >
                <SelectTrigger className="w-[220px]" data-testid="seletor-competencia">
                  <SelectValue placeholder="Competência" />
                </SelectTrigger>
                <SelectContent>
                  {dados?.competencias.map((c) => (
                    <SelectItem key={c.competencia} value={c.competencia}>
                      {c.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/*
                O desvio de um mês sem par **não é zero**, e escrevê-lo assim
                seria a mentira mais fácil desta tela: "R$ 0,00" ao lado de "0
                placas comparadas" se lê como "bateu certinho", quando o que
                houve foi que não havia o que comparar. É a mesma regra que
                atravessa o produto inteiro — ausência tem nome, e nunca vira
                zero.
              */}
              <div className="rounded-md border px-3 py-2">
                <span className="text-xs text-muted-foreground">Desvio do mês</span>
                <p
                  className={cn(
                    "text-lg font-semibold",
                    !temComparacao
                      ? "text-muted-foreground"
                      : (dados?.resumo?.desvio ?? 0) > 0
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-emerald-600 dark:text-emerald-400",
                  )}
                  data-testid="desvio-do-mes"
                >
                  {temComparacao ? escreverDesvio(dados?.resumo?.desvio ?? null) : "—"}
                  {temComparacao &&
                  dados?.resumo?.desvioPercentual !== null &&
                  dados?.resumo?.desvioPercentual !== undefined ? (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {dados.resumo.desvioPercentual > 0 ? "+" : ""}
                      {dados.resumo.desvioPercentual.toFixed(2)}%
                    </span>
                  ) : null}
                </p>
              </div>

              <p className="text-sm text-muted-foreground" data-testid="contagem-de-placas">
                {temComparacao
                  ? `${dados?.resumo?.placasComparadas ?? 0} placas comparadas`
                  : "Nenhuma placa comparável"}
                {(dados?.resumo?.placasSemRemunerado ?? 0) > 0
                  ? ` · ${dados?.resumo?.placasSemRemunerado} sem remunerado`
                  : ""}
                {(dados?.resumo?.placasSemRealizado ?? 0) > 0
                  ? ` · ${dados?.resumo?.placasSemRealizado} sem realizado`
                  : ""}
              </p>
            </div>

            <Input
              value={filtro}
              onChange={(e) => {
                setFiltro(e.target.value);
                setPagina(1);
              }}
              placeholder="Filtrar por placa"
              className="w-[200px]"
              data-testid="filtro-placa"
            />
          </section>

          {/*
            A tarja do mês possivelmente parcial. Ela não esconde número nenhum
            — o desvio continua calculado e visível —, porque a marca diz
            "confira", e não "está errado": um mês real com queda de frota cairia
            aqui do mesmo jeito.
          */}
          {dados?.parcial ? (
            <div
              className="flex items-start gap-3 rounded-lg border border-sky-500/40 bg-sky-500/5 p-4"
              data-testid="aviso-competencia-parcial"
            >
              <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
              <div>
                <p className="font-medium">Competência possivelmente parcial</p>
                <p className="text-sm text-muted-foreground">{dados.motivoParcial}</p>
              </div>
            </div>
          ) : null}

          {/* As duas filas do que ficou de fora da soma. */}
          {pendencias.data &&
          (pendencias.data.duplicatas.length > 0 ||
            pendencias.data.semClassificacao.length > 0) ? (
            <section className="grid gap-3 sm:grid-cols-2" data-testid="pendencias">
              {pendencias.data.duplicatas.length > 0 ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
                  <div className="flex items-center gap-2">
                    <Copy className="h-4 w-4 text-amber-600" />
                    <p className="font-medium">
                      {pendencias.data.duplicatas.length} lançamentos repetidos, retidos
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Linhas idênticas em todas as colunas, inclusive na data de
                    escrituração. Não entraram na soma e não foram descartadas:{" "}
                    <strong>{escreverReais(pendencias.data.valorRetido)}</strong> aguardam
                    confirmação. Somá-las cobraria duas vezes o mesmo pagamento;
                    descartá-las perderia um pagamento que talvez exista.
                  </p>
                  <ul className="mt-3 space-y-2 text-xs">
                    {pendencias.data.duplicatas.slice(0, 5).map((d) => (
                      <DuplicataPendente
                        key={`${d.competencia}-${d.numdoc}-${d.linhaRepetida}`}
                        duplicata={d}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}

              {pendencias.data.semClassificacao.length > 0 ? (
                <div className="rounded-lg border border-slate-500/40 bg-slate-500/5 p-4">
                  <div className="flex items-center gap-2">
                    <CircleHelp className="h-4 w-4 text-slate-600" />
                    <p className="font-medium">
                      {pendencias.data.semClassificacao.length} placas sem tipo de ativo
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Não estão no cadastro, e o tipo não é deduzido da conta contábil —
                    &ldquo;C.D.C. - VP&rdquo; vale para cavalo, caminhão e carreta
                    igualmente. Os lançamentos estão preservados e{" "}
                    <strong>{escreverReais(pendencias.data.valorSemClassificacao)}</strong>{" "}
                    ficam fora da comparação até alguém classificá-las.
                  </p>
                  <ul className="mt-3 space-y-2 text-xs">
                    {pendencias.data.semClassificacao.slice(0, 5).map((placa) => (
                      <PlacaSemTipo key={placa.placa} placa={placa} />
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-lg border">
            <table className="w-full text-sm" data-testid="tabela-financiamento-real">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="w-8 p-3" />
                  <th className="p-3 font-medium">Placa</th>
                  <th className="p-3 text-right font-medium">Remunerado (mês)</th>
                  <th className="p-3 text-right font-medium">Realizado (competência)</th>
                  <th className="p-3 text-right font-medium">Desvio</th>
                  <th className="p-3 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {daPagina.map((linha) => (
                  <LinhaDaTabela
                    key={linha.placa}
                    linha={linha}
                    competencia={dados?.competencia ?? null}
                    aberta={placaAberta === linha.placa}
                    aoAlternar={() =>
                      setPlacaAberta(placaAberta === linha.placa ? null : linha.placa)
                    }
                  />
                ))}
              </tbody>
            </table>
            {visiveis.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma placa encontrada com esse filtro.
              </p>
            ) : (
              <Paginacao
                pagina={pagina}
                porPagina={porPagina}
                total={visiveis.length}
                onPagina={setPagina}
                onPorPagina={(n) => {
                  setPorPagina(n);
                  setPagina(1);
                }}
                tamanhos={[25, 50, 100]}
                unidade="placas"
                unidadeSingular="placa"
                className="border-t p-3"
              />
            )}
          </section>
        </div>
      )}
    </Layout>
  );
}

/**
 * Uma duplicata provável, com as duas saídas que ela tem.
 *
 * As duas, e não uma: "é o export repetindo" e "são dois pagamentos" são
 * respostas opostas para a mesma pergunta, e oferecer só uma delas seria empurrar
 * quem decide para o lado que o software achou mais provável. O motivo é
 * obrigatório — o servidor recusa sem ele — porque daqui a seis meses o
 * histórico precisa dizer **por que**, e não só o quê.
 */
function DuplicataPendente({
  duplicata,
}: {
  duplicata: {
    competencia: string;
    placa: string;
    numdoc: string;
    valor: number;
    linhaRepetida: number;
    impressaoHash: string | null;
  };
}): ReactElement {
  const [motivo, setMotivo] = useState("");
  const registrar = useRegistrarDecisao();

  return (
    <li className="rounded border bg-background/60 p-2" data-testid="duplicata-pendente">
      <p className="text-muted-foreground">
        {duplicata.placa} · {duplicata.competencia} · doc {duplicata.numdoc} ·{" "}
        {escreverReais(duplicata.valor)} · linha {duplicata.linhaRepetida}
      </p>
      {duplicata.impressaoHash === null ? (
        /*
          A pendência existe e continua à vista; o que falta é endereço. Ela foi
          lida antes de a coluna da impressão digital existir, e decidir sobre
          ela exigiria gravar uma chave que não aponta para grupo nenhum.
          Reimportar o mês escreve a impressão e devolve os botões.
        */
        <p className="mt-1 text-muted-foreground">
          Esta pendência foi lida antes de o endereço dela existir. Reimporte esta
          competência para poder decidir sobre ela.
        </p>
      ) : registrar.isSuccess ? (
        <p className="mt-1 text-emerald-700 dark:text-emerald-300">
          {registrar.data.efeito}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Por quê?"
            className="h-7 w-48 text-xs"
            data-testid="motivo-da-decisao"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={motivo.trim() === "" || registrar.isPending}
            onClick={() =>
              registrar.mutate({
                tipo: "DUPLICATA_CONFIRMADA",
                chave: duplicata.impressaoHash as string,
                motivo,
              })
            }
          >
            É repetição do export
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={motivo.trim() === "" || registrar.isPending}
            onClick={() =>
              registrar.mutate({
                tipo: "LANCAMENTOS_DISTINTOS",
                chave: duplicata.impressaoHash as string,
                motivo,
              })
            }
          >
            São dois pagamentos
          </Button>
          {registrar.isError ? (
            <span className="text-rose-600">{registrar.error.message}</span>
          ) : null}
        </div>
      )}
    </li>
  );
}

/**
 * Uma placa que o cadastro não resolveu, com a classificação declarada.
 *
 * A conta contábil aparece como evidência ao lado — e continua não decidindo
 * nada: quem escolhe o tipo é quem está olhando, e é por isso que a lista de
 * tipos é a do produto e não uma dedução da conta.
 */
function PlacaSemTipo({
  placa,
}: {
  placa: {
    placa: string;
    competencias: string[];
    lancamentos: number;
    valor: number;
    contas: string[];
  };
}): ReactElement {
  const [tipo, setTipo] = useState("");
  const [motivo, setMotivo] = useState("");
  const registrar = useRegistrarDecisao();

  return (
    <li className="rounded border bg-background/60 p-2" data-testid="placa-sem-tipo">
      <p className="text-muted-foreground">
        {placa.placa} · {placa.lancamentos} lançamentos · {escreverReais(placa.valor)} ·{" "}
        {placa.contas.join(", ")}
      </p>
      {registrar.isSuccess ? (
        <p className="mt-1 text-emerald-700 dark:text-emerald-300">
          {registrar.data.efeito}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger className="h-7 w-36 text-xs" data-testid="tipo-do-ativo">
              <SelectValue placeholder="Tipo do ativo" />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_DE_ATIVO.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Como se sabe?"
            className="h-7 w-44 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={tipo === "" || motivo.trim() === "" || registrar.isPending}
            onClick={() =>
              registrar.mutate({
                tipo: "CLASSIFICAR_ATIVO",
                chave: placa.placa,
                valor: tipo,
                motivo,
              })
            }
          >
            Classificar
          </Button>
          {registrar.isError ? (
            <span className="text-rose-600">{registrar.error.message}</span>
          ) : null}
        </div>
      )}
    </li>
  );
}

/**
 * Uma linha da tabela, com a expansão que mostra os lançamentos.
 *
 * A expansão é o que impede o consolidado de ser uma soma sem origem: abrir a
 * placa mostra os documentos que compõem o valor, com filial, conta, data de
 * escrituração e a linha do arquivo de onde cada um veio.
 */
function LinhaDaTabela({
  linha,
  competencia,
  aberta,
  aoAlternar,
}: {
  linha: LinhaDaComparacaoReal;
  competencia: string | null;
  aberta: boolean;
  aoAlternar: () => void;
}): ReactElement {
  const lancamentos = useLancamentosDaPlaca(
    aberta ? competencia : null,
    aberta ? linha.placa : null,
  );

  return (
    <>
      <tr
        className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
        onClick={aoAlternar}
        data-testid={`linha-${linha.placa}`}
      >
        <td className="p-3 text-muted-foreground">
          {aberta ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </td>
        <td className="p-3 font-medium">{linha.placa}</td>
        <td className="p-3 text-right tabular-nums">
          {escreverReais(linha.remunerado)}
        </td>
        <td className="p-3 text-right tabular-nums">
          {escreverReais(linha.realizado)}
          {linha.lancamentos !== null && linha.lancamentos > 1 ? (
            <span className="ml-2 text-xs text-muted-foreground">
              {linha.lancamentos} lançamentos
            </span>
          ) : null}
        </td>
        <td
          className={cn(
            "p-3 text-right tabular-nums font-medium",
            linha.desvio === null
              ? "text-muted-foreground"
              : linha.desvio > 0
                ? "text-rose-600 dark:text-rose-400"
                : "text-emerald-600 dark:text-emerald-400",
          )}
        >
          {escreverDesvio(linha.desvio)}
        </td>
        <td className="p-3">
          <Badge variant="secondary" className={cn(TOM_DO_ESTADO_REAL[linha.estado])}>
            {ROTULO_DO_ESTADO_REAL[linha.estado]}
          </Badge>
        </td>
      </tr>

      {aberta ? (
        <tr className="border-b bg-muted/20">
          <td colSpan={6} className="p-4">
            {linha.nota ? (
              <p className="mb-3 flex items-start gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {linha.nota}
              </p>
            ) : null}

            {/* De onde saiu o remunerado — as quinzenas lidas, uma a uma. */}
            {linha.quinzenasLidas.length > 0 ? (
              <p className="mb-3 text-xs text-muted-foreground">
                Remunerado lido de{" "}
                {linha.quinzenasLidas
                  .map((q) => `${q.label} (${escreverReais(q.valor)})`)
                  .join(" e ")}
                {linha.quinzenasLidas.length === 2
                  ? " — o mesmo valor mensal nas duas, e por isso ele não é somado."
                  : "."}
              </p>
            ) : null}

            {lancamentos.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : lancamentos.data && lancamentos.data.lancamentos.length > 0 ? (
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="pb-1 font-medium">Documento</th>
                    <th className="pb-1 font-medium">Conta</th>
                    <th className="pb-1 font-medium">Filial</th>
                    <th className="pb-1 font-medium">Escrituração</th>
                    <th className="pb-1 pr-6 text-right font-medium">Valor</th>
                    <th className="pb-1 font-medium">Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {lancamentos.data.lancamentos.map((l) => (
                    <tr key={`${l.numdoc}-${l.linha}`} className="border-t">
                      <td className="py-1">{l.numdoc}</td>
                      <td className="py-1">{l.conta ?? "—"}</td>
                      <td className="py-1">{l.filial ?? "—"}</td>
                      <td className="py-1">{l.escrituracao?.slice(0, 10) ?? "—"}</td>
                      <td className="py-1 pr-6 text-right tabular-nums">
                        {escreverReais(l.valor)}
                        {l.status !== "ACEITO" ? (
                          <span className="ml-2 text-amber-600">({l.status})</span>
                        ) : null}
                      </td>
                      <td className="py-1 text-muted-foreground">
                        {l.aba}, linha {l.linha}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-muted-foreground">
                Não há lançamentos do extrato para esta placa nesta competência.
              </p>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
