import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  FileSpreadsheet,
  Headset,
  Scale,
  TriangleAlert,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { AbaBotao } from "@/components/changes/cartoes";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Paginacao } from "@/components/ui/paginacao";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { contextoAberto, useContextosDaCasca } from "@/lib/contextos";
import { formatNumber } from "@/lib/format";
import { rotuloDoTipo } from "@/lib/frota";
import { cn } from "@/lib/utils";
import {
  EXPLICACAO_DA_SITUACAO,
  ROTULO_DA_BASE,
  ROTULO_DA_SITUACAO,
  ROTULO_DA_SITUACAO_SINGULAR,
  SITUACOES,
  TEXTO_DO_AVISO,
  avisoDaConciliacao,
  barrasDaSituacao,
  nomeDoParametro,
  pendencias,
  percentualConciliado,
  rotuloDaComparacao,
  rotuloDoEnvio,
  useLinhasDaConciliacao,
  useOpcoesDaConciliacao,
  useResumoDaConciliacao,
  type LinhaDaConciliacao,
  type Situacao,
} from "@/lib/conciliacao-de-chamados";

/**
 * CONCILIAÇÃO DE CHAMADOS.
 *
 * A tela existe por uma frase de quem opera: *para cada alteração identificada
 * nas planilhas importadas deveria haver a mesma quantidade de alterações de
 * chamados.* O produto tinha as duas metades e não tinha o confronto — a aba
 * Planilha diz o que a Ambev mudou, a aba Chamados diz o que se pediu, e ambas
 * respondem sozinhas, sem nunca se olharem.
 *
 * Aqui elas se olham, e o que a tela publica é uma coisa só: **quantos pares
 * (placa, parâmetro) as duas contam do mesmo jeito, e quais não.**
 *
 * ---------------------------------------------------------------------------
 * O que manda no desenho
 * ---------------------------------------------------------------------------
 *
 * 1. **Os dois lados aparecem escolhidos, no topo, antes de qualquer número.**
 *    Uma conciliação é sempre *desta comparação* contra *deste envio*, e um
 *    cartão que não diga sobre o que fala é um número sem endereço. O servidor
 *    escolhe o padrão (a comparação mais recente da unidade aberta e o último
 *    envio lido) e **devolve qual escolheu**; os dois seletores mostram isso.
 *
 * 2. **A régua é o par, não a alteração da planilha.** O chamado que pediu o que
 *    a planilha não aplicou é pendência tanto quanto a alteração que ninguém
 *    pediu. Uma barra medida só sobre a planilha subiria enquanto a fila
 *    crescia do outro lado.
 *
 * 3. **Nada é somado entre os dois lados.** Os dois impactos aparecem lado a
 *    lado, para explicar a divergência, e nunca adicionados — a mesma regra que
 *    separa as duas superfícies desde `schema/tickets.ts`.
 *
 * 4. **O que não tem chave é contado e dito.** Parâmetro que o dicionário não
 *    reconheceu e alteração sem placa não entram em situação nenhuma, e o
 *    rodapé dos cartões diz quantos são. Suprimir em silêncio o que não se sabe
 *    classificar é a forma mais fácil de esta tela mentir.
 *
 * 5. **O aviso vem antes dos cartões, e é um fato contado.** Zero placas em
 *    comum com os dois lados cheios é o retrato de conciliar Recife contra
 *    Camaçari — e dizê-lo depois dos números seria dizer tarde demais. Ver
 *    `avisoDaConciliacao`, que é onde a régua mora.
 *
 * As contas ficam em `lib/conciliacao-de-chamados.ts`, que não monta tela
 * nenhuma e por isso é testável direto; aqui fica o desenho.
 */

/* O endereço desta tela — o mesmo que `App.tsx` registra. */
const CONCILIACAO = "/conciliacao-de-chamados";

const TODAS_AS_SITUACOES = "__todas__";
const TODOS_OS_TIPOS = "__todos__";

const POR_PAGINA = 50;

/** A cor de cada situação — a mesma no chip, na barra e na linha. */
const TOM_DA_SITUACAO: Record<Situacao, string> = {
  CONCILIADA: "bg-emerald-500",
  DIVERGENTE: "bg-red-500",
  SEM_CHAMADO: "bg-amber-500",
  SEM_ALTERACAO: "bg-sky-500",
};

const TEXTO_DA_SITUACAO: Record<Situacao, string> = {
  CONCILIADA: "text-emerald-700 bg-emerald-50 border-emerald-200",
  DIVERGENTE: "text-red-700 bg-red-50 border-red-200",
  SEM_CHAMADO: "text-amber-700 bg-amber-50 border-amber-200",
  SEM_ALTERACAO: "text-sky-700 bg-sky-50 border-sky-200",
};

/** A régua de porcentagem da tela: uma casa, como os demais cartões da casa. */
function pct(valor: number): string {
  return `${formatNumber(valor, valor === 0 || valor === 100 ? 0 : 1)}%`;
}

function Cartao({
  titulo,
  valor,
  rodape,
  icon: Icon,
  tom,
}: {
  titulo: string;
  valor: string;
  rodape: string;
  icon: typeof Scale;
  tom: "neutro" | "verde" | "ambar" | "vermelho";
}) {
  const tons = {
    neutro: { texto: "text-foreground", fundo: "bg-muted", icone: "text-muted-foreground" },
    verde: { texto: "text-emerald-600", fundo: "bg-emerald-50", icone: "text-emerald-600" },
    ambar: { texto: "text-amber-600", fundo: "bg-amber-50", icone: "text-amber-600" },
    vermelho: { texto: "text-red-600", fundo: "bg-red-50", icone: "text-red-600" },
  }[tom];

  return (
    <section className="bg-card border rounded-xl shadow-sm px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{titulo}</p>
          <p
            className={cn(
              "text-3xl font-bold tracking-tight tabular-nums mt-1",
              tons.texto,
            )}
          >
            {valor}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{rodape}</p>
        </div>
        <span className={cn("shrink-0 rounded-xl p-2.5", tons.fundo)}>
          <Icon className={cn("w-5 h-5", tons.icone)} />
        </span>
      </div>
    </section>
  );
}

/**
 * Um valor da tabela — o "antes → depois" de um dos lados.
 *
 * O travessão é o que quer dizer "este lado não existe neste par", e é
 * deliberadamente diferente de um valor vazio: uma célula em branco se lê como
 * dado que se perdeu.
 */
function Valores({
  antes,
  depois,
  ausente,
}: {
  antes: string | null;
  depois: string | null;
  ausente: string;
}) {
  if (antes === null && depois === null) {
    return <span className="text-muted-foreground italic text-xs">{ausente}</span>;
  }
  return (
    <span className="tabular-nums">
      <span className="text-muted-foreground">{antes ?? "—"}</span>
      <span className="mx-1.5 text-muted-foreground">→</span>
      <span className="font-medium">{depois ?? "—"}</span>
    </span>
  );
}

function Linha({ linha }: { linha: LinhaDaConciliacao }) {
  const nome = nomeDoParametro(linha);

  return (
    <tr className="border-b last:border-0 hover:bg-muted/40">
      <td className="px-3 py-2.5 align-top">
        <span
          className={cn(
            "inline-block rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
            TEXTO_DA_SITUACAO[linha.situacao],
          )}
          title={EXPLICACAO_DA_SITUACAO[linha.situacao]}
        >
          {ROTULO_DA_SITUACAO_SINGULAR[linha.situacao]}
        </span>
      </td>
      <td className="px-3 py-2.5 align-top font-medium whitespace-nowrap">
        {linha.entityLabel}
        {linha.entityType && (
          <span className="block text-xs font-normal text-muted-foreground">
            {rotuloDoTipo(linha.entityType)}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 align-top min-w-[14rem]">
        <span className="block">{nome}</span>
        <span className="block text-xs text-muted-foreground font-mono">
          {linha.attributeCode}
        </span>
        {/*
          O rótulo do arquivo de chamados só aparece quando difere do nome já
          escrito acima: repeti-lo em toda linha empurraria para longe o que
          muda de uma para outra — e numa linha sem alteração ele **é** o nome,
          porque o dicionário só nomeia o lado da planilha.
        */}
        {linha.parameterLabel && linha.parameterLabel !== nome && (
          <span className="block text-xs text-muted-foreground">
            no chamado: {linha.parameterLabel}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 align-top text-sm">
        <Valores
          antes={linha.planilhaAntes}
          depois={linha.planilhaDepois}
          ausente="a planilha não mudou"
        />
        {/*
          Duas alterações no mesmo par são raras — só acontecem quando duas
          identidades canônicas carregam a mesma placa —, e por isso a linha só
          fala delas quando existem. Calá-las mostraria uma das duas como se
          fosse tudo.
        */}
        {linha.alteracoesNoPar > 1 && (
          <span className="block text-xs text-muted-foreground mt-0.5">
            +{linha.alteracoesNoPar - 1} outra(s) alteração(ões) nesta placa e
            parâmetro
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 align-top text-sm">
        <Valores
          antes={linha.chamadoAntes}
          depois={linha.chamadoDepois}
          ausente="nenhum chamado"
        />
        {linha.externalId && (
          <span className="block text-xs text-muted-foreground mt-0.5">
            {linha.externalId}
            {linha.chamadosNoPar > 1 && ` · +${linha.chamadosNoPar - 1} outro(s)`}
            {linha.statusBucket && ` · ${linha.statusBucket.toLowerCase()}`}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 align-top text-sm tabular-nums whitespace-nowrap">
        {linha.diferencaDeValor === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span
            className={cn(
              "font-medium",
              linha.diferencaDeValor === 0 ? "text-muted-foreground" : "text-red-600",
            )}
          >
            {formatNumber(linha.diferencaDeValor)}
          </span>
        )}
        {linha.base && (
          <span className="block text-xs text-muted-foreground">
            por {ROTULO_DA_BASE[linha.base]}
          </span>
        )}
      </td>
    </tr>
  );
}

export default function ConciliacaoDeChamados() {
  const [, navegar] = useLocation();
  const busca = useSearch();
  const params = useMemo(() => new URLSearchParams(busca), [busca]);

  const contextos = useContextosDaCasca();
  /*
    A unidade aberta é a da lateral — a mesma regra do Painel de Justificativas
    e da caixa "Unidade atual". Ela recorta **quais comparações** o seletor
    oferece e qual delas o servidor escolhe por padrão: sem isso, abrir a tela
    com PERNAMBUCO na lateral concilia a vigência de outra unidade contra o
    envio desta, e o resultado é uma tela cheia de pendência que não é
    pendência.
  */
  const escopo =
    contextoAberto(contextos.contextos, params.get("scopeHash"))?.scopeHash ?? null;

  /*
    Os dois lados moram no endereço, como o dia e a série do Monitoramento e
    pelo mesmo motivo: um link para "julho→agosto contra o envio de 02/09" tem
    de abrir exatamente nisso. Os filtros da tabela ficam em estado — eles são
    recorte de leitura, e não a leitura.
  */
  const changeSetId = params.get("changeSetId");
  const ticketImportId = params.get("ticketImportId");
  const somenteVigenciaComparada = params.get("vigencia") === "1";

  const [situacao, setSituacao] = useState<Situacao | null>(null);
  const [tipo, setTipo] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [pagina, setPagina] = useState(1);

  const trocar = (mudancas: Record<string, string | null>) => {
    const proximos = new URLSearchParams(params);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null) proximos.delete(chave);
      else proximos.set(chave, valor);
    }
    const q = proximos.toString();
    navegar(q ? `${CONCILIACAO}?${q}` : CONCILIACAO);
    setPagina(1);
  };

  const recorte = {
    escopo,
    changeSetId,
    ticketImportId,
    somenteVigenciaComparada,
  };

  const opcoes = useOpcoesDaConciliacao(escopo);
  const { resumo, consulta } = useResumoDaConciliacao(recorte);
  const lista = useLinhasDaConciliacao({
    ...recorte,
    situacao,
    tipo,
    busca: texto,
    pagina,
    porPagina: POR_PAGINA,
  });

  const barras = useMemo(() => barrasDaSituacao(resumo), [resumo]);
  const aviso = avisoDaConciliacao(resumo);
  const naoConciliadas = pendencias(resumo);

  /*
    O que os seletores mostram é o que o servidor **usou**, e não o que a URL
    pede: sem `?changeSetId=` a escolha é dele, e um seletor vazio deixaria
    quem lê supor que está vendo "todas". Enquanto o resumo não voltou, cai-se
    no que a URL diz — que é o que ela sabe.
  */
  const comparacaoAtiva = resumo?.changeSetId ?? changeSetId ?? "";
  const envioAtivo = resumo?.ticketImportId ?? ticketImportId ?? "";

  const tipos = resumo?.tipos ?? [];

  return (
    <Layout>
      <div className="p-4 md:p-6 space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Scale className="w-6 h-6 text-nav-chamados" />
              Conciliação de Chamados
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
              Para cada alteração que a planilha importada trouxe, existe o
              chamado que a pediu? E para cada chamado que pediu alteração, ela
              apareceu na planilha? O confronto é por placa e parâmetro, e os
              dois impactos aparecem lado a lado — nunca somados.
            </p>
          </div>
        </header>

        {/*
          Os dois lados. Ficam acima de tudo porque nenhum número desta tela
          significa alguma coisa sem eles.
        */}
        <section className="bg-card border rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-4">
          <div className="min-w-[16rem] flex-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1.5">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Comparação de vigências
            </label>
            <Select
              value={comparacaoAtiva}
              onValueChange={(v) => trocar({ changeSetId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Escolha a comparação" />
              </SelectTrigger>
              <SelectContent>
                {(opcoes.comparacoes ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {rotuloDaComparacao(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ArrowLeftRight className="w-5 h-5 text-muted-foreground mb-2.5 shrink-0" />

          <div className="min-w-[16rem] flex-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1.5">
              <Headset className="w-3.5 h-3.5" />
              Envio de chamados
            </label>
            <Select
              value={envioAtivo}
              onValueChange={(v) => trocar({ ticketImportId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Escolha o envio" />
              </SelectTrigger>
              <SelectContent>
                {(opcoes.envios ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {rotuloDoEnvio(e)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/*
            O recorte por `Vig. Abertura`. Fica desligado por padrão e ao lado
            dos dois seletores porque é uma terceira escolha sobre o **mesmo**
            recorte, e não um filtro da tabela: ligá-lo muda a população dos
            dois lados, e portanto todos os números acima da tabela.
          */}
          <label className="flex items-center gap-2 text-sm mb-2 shrink-0">
            <Switch
              checked={somenteVigenciaComparada}
              onCheckedChange={(ligado) =>
                trocar({ vigencia: ligado ? "1" : null })
              }
            />
            <span className="text-muted-foreground">
              Só chamados da vigência comparada
            </span>
          </label>
        </section>

        {consulta.indisponivel ? (
          <ApiErrorNotice
            error={consulta.erro}
            what="a conciliação de chamados"
            onTentarDeNovo={consulta.tentarDeNovo}
            tentando={consulta.atualizando}
          />
        ) : (
          <>
            {aviso && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-900">{TEXTO_DO_AVISO[aviso]}</p>
              </div>
            )}

            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
              <Cartao
                titulo="Alterações na planilha"
                valor={resumo ? formatNumber(resumo.planilha.alteracoes, 0) : "—"}
                rodape={
                  resumo
                    ? `${formatNumber(resumo.planilha.placas, 0)} placas · ${formatNumber(
                        resumo.planilha.foraDaConciliacao,
                        0,
                      )} sem placa ou parâmetro`
                    : "carregando"
                }
                icon={FileSpreadsheet}
                tom="neutro"
              />
              <Cartao
                titulo="Alterações nos chamados"
                valor={resumo ? formatNumber(resumo.chamados.alteracoes, 0) : "—"}
                rodape={
                  resumo
                    ? `${formatNumber(resumo.chamados.placas, 0)} placas · ${formatNumber(
                        resumo.chamados.foraDaConciliacao,
                        0,
                      )} sem parâmetro reconhecido`
                    : "carregando"
                }
                icon={Headset}
                tom="neutro"
              />
              {/*
                A diferença de contagem — a conta que dá nome ao módulo. Zero é
                o estado esperado, e por isso é o único que veste verde.
              */}
              <Cartao
                titulo="Diferença de contagem"
                valor={
                  resumo
                    ? `${resumo.diferenca > 0 ? "+" : ""}${formatNumber(resumo.diferenca, 0)}`
                    : "—"
                }
                rodape={
                  resumo === null
                    ? "carregando"
                    : resumo.diferenca === 0
                      ? "os dois lados trazem a mesma quantidade"
                      : resumo.diferenca > 0
                        ? "a planilha mudou mais do que se pediu"
                        : "pediu-se mais do que a planilha mudou"
                }
                icon={Scale}
                tom={resumo === null ? "neutro" : resumo.diferenca === 0 ? "verde" : "ambar"}
              />
              <Cartao
                titulo="Pares não conciliados"
                valor={naoConciliadas === null ? "—" : formatNumber(naoConciliadas, 0)}
                rodape={
                  resumo
                    ? `${formatNumber(resumo.divergentes, 0)} divergentes · de ${formatNumber(
                        resumo.pares,
                        0,
                      )} pares`
                    : "carregando"
                }
                icon={TriangleAlert}
                tom={
                  naoConciliadas === null ? "neutro" : naoConciliadas === 0 ? "verde" : "vermelho"
                }
              />
            </div>

            {/* A barra da conciliação, e as quatro situações abaixo dela. */}
            <section className="bg-card border rounded-xl shadow-sm p-5 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <h2 className="text-sm font-semibold">Conciliação</h2>
                </div>
                <span className="text-sm font-semibold tabular-nums">
                  {resumo ? pct(percentualConciliado(resumo)) : "—"}
                </span>
              </div>
              <Progress value={resumo ? percentualConciliado(resumo) : 0} />

              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 pt-1">
                {barras.map((barra) => (
                  <button
                    key={barra.situacao}
                    onClick={() => {
                      setSituacao(situacao === barra.situacao ? null : barra.situacao);
                      setPagina(1);
                    }}
                    title={EXPLICACAO_DA_SITUACAO[barra.situacao]}
                    className={cn(
                      "text-left rounded-lg border px-3 py-2.5 transition-colors",
                      situacao === barra.situacao
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "h-2.5 w-2.5 rounded-full shrink-0",
                          TOM_DA_SITUACAO[barra.situacao],
                        )}
                      />
                      <span className="text-xs text-muted-foreground truncate">
                        {barra.rotulo}
                      </span>
                    </span>
                    <span className="block text-xl font-bold tabular-nums mt-0.5">
                      {resumo ? formatNumber(barra.pares, 0) : "—"}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {resumo ? pct(barra.proporcao) : ""}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {/* As abas por tipo de ativo — a união dos dois lados. */}
            {tipos.length > 1 && (
              <div className="flex items-center gap-1 border-b overflow-x-auto">
                <AbaBotao
                  active={tipo === null}
                  onClick={() => {
                    setTipo(null);
                    setPagina(1);
                  }}
                  label="Todos"
                  hint="Todos os tipos de ativo da conciliação"
                  count={resumo?.pares}
                />
                {tipos
                  .filter((t): t is { entityType: string; pares: number } =>
                    Boolean(t.entityType),
                  )
                  .map((t) => (
                    <AbaBotao
                      key={t.entityType}
                      active={tipo === t.entityType}
                      onClick={() => {
                        setTipo(t.entityType);
                        setPagina(1);
                      }}
                      label={rotuloDoTipo(t.entityType)}
                      hint={`Só os pares de ${rotuloDoTipo(t.entityType)}`}
                      count={t.pares}
                    />
                  ))}
              </div>
            )}

            <section className="bg-card border rounded-xl shadow-sm">
              <div className="p-4 flex flex-wrap items-center gap-3 border-b">
                <Input
                  value={texto}
                  onChange={(e) => {
                    setTexto(e.target.value);
                    setPagina(1);
                  }}
                  placeholder="Placa, parâmetro ou número do chamado"
                  className="max-w-xs"
                />
                <Select
                  value={situacao ?? TODAS_AS_SITUACOES}
                  onValueChange={(v) => {
                    setSituacao(v === TODAS_AS_SITUACOES ? null : (v as Situacao));
                    setPagina(1);
                  }}
                >
                  <SelectTrigger className="w-[13rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TODAS_AS_SITUACOES}>Todas as situações</SelectItem>
                    {SITUACOES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {ROTULO_DA_SITUACAO[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {tipos.length > 1 && (
                  <Select
                    value={tipo ?? TODOS_OS_TIPOS}
                    onValueChange={(v) => {
                      setTipo(v === TODOS_OS_TIPOS ? null : v);
                      setPagina(1);
                    }}
                  >
                    <SelectTrigger className="w-[12rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODOS_OS_TIPOS}>Todos os tipos</SelectItem>
                      {tipos
                        .filter((t): t is { entityType: string; pares: number } =>
                          Boolean(t.entityType),
                        )
                        .map((t) => (
                          <SelectItem key={t.entityType} value={t.entityType}>
                            {rotuloDoTipo(t.entityType)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
                <Badge variant="secondary" className="ml-auto tabular-nums">
                  {formatNumber(lista.total, 0)} pares
                </Badge>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Situação</th>
                      <th className="px-3 py-2 font-medium">Placa</th>
                      <th className="px-3 py-2 font-medium">Parâmetro</th>
                      <th className="px-3 py-2 font-medium">Planilha</th>
                      <th className="px-3 py-2 font-medium">Chamado</th>
                      <th className="px-3 py-2 font-medium">Diferença</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.consulta.isPending ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="px-3 py-3" colSpan={6}>
                            <Skeleton className="h-5 w-full" />
                          </td>
                        </tr>
                      ))
                    ) : lista.linhas.length === 0 ? (
                      <tr>
                        <td
                          className="px-3 py-10 text-center text-muted-foreground"
                          colSpan={6}
                        >
                          Nenhum par neste recorte.
                        </td>
                      </tr>
                    ) : (
                      lista.linhas.map((linha) => (
                        <Linha
                          key={`${linha.entityLabel}|${linha.attributeCode}`}
                          linha={linha}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <Paginacao
                pagina={pagina}
                porPagina={POR_PAGINA}
                total={lista.total}
                onPagina={setPagina}
                unidade="pares"
                className="border-t"
              />
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}
