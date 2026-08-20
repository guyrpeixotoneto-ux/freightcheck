import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  CircleHelp,
  CloudDownload,
  Info,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { fetchJson, fetchJsonOrNull, getApiUrl } from "@/lib/api";
import { primeiraPagina, type Janela } from "@/lib/paginacao";
import {
  ChangeTable,
  FilterBar,
  emptyFilters,
  toQuery,
  type Breakdown,
  type ChangeRow,
  type Filters,
} from "@/components/changes/change-table";
import { ImpactoPorPeriodicidade } from "@/components/changes/cartoes";
import {
  COLUNAS_DESTACADAS,
  agruparMovimentos,
  formatarValor,
  rotuloDaVigencia,
} from "@/components/qlp/apresentacao";
import {
  CHAVE_DO_CARGO,
  chaveDoAtributo,
  mesmaChave,
  ordenarUnidades,
  proximaOrdem,
  type ChaveDeOrdem,
  type OrdemDoQuadro,
} from "@/components/qlp/ordenacao";
import type {
  AtributoDoQuadro,
  DetalheDoCargo,
  EvolucaoDoQuadro,
  InconsistenciasDoQuadro,
  RegistroInconsistente,
  VisaoDoQuadro,
} from "@/components/qlp/tipos";
import {
  SecoesDaApresentacao,
  SeloDeSeveridade,
} from "@/components/apontamentos/apresentacao";

/**
 * QLP Administrativo — o quadro de pessoal da estrutura administrativa que o
 * modelo remunera: um cargo por unidade, com o que o export declara para ele.
 *
 * A tela responde três perguntas, uma por aba:
 *
 * - **Quadro** — quem está no quadro desta vigência e com que valores, unidade
 *   a unidade. Clicar num cargo abre a ficha com os 35 atributos e a célula de
 *   origem de cada um.
 * - **Evolução** — a presença de cada cargo, quinzena a quinzena. É onde
 *   entrada, saída e quinzena sem arquivo ficam visíveis sem conta nenhuma.
 * - **Alterações** — o que mudou entre duas vigências do quadro. O diff é o do
 *   motor canônico (`POST /change-sets`), o mesmo de Comparar Vigências: esta
 *   aba só escolhe o par e apresenta — nenhuma diferença é calculada aqui.
 * - **Inconsistências** — o que **não** está no quadro. A importação não escolhe
 *   em silêncio entre duas linhas que discordam sobre o mesmo cargo: ela deixa
 *   o registro de fora e o arquivo entra. Sem esta aba, a vigência apareceria
 *   completa sem estar — e é por isso que ela existe, e não como relatório.
 *
 * Efetivo total e custo da estrutura nascem **travados**: os atributos do QLP
 * chegam sem semântica confirmada, e agregar sem curadoria seria adivinhação.
 * A tela mostra o motivo por extenso e aponta para a Curadoria — nunca um zero
 * no lugar de um número que não existe.
 */

type Aba = "quadro" | "evolucao" | "alteracoes" | "inconsistencias";
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "quadro", rotulo: "Quadro" },
  { id: "evolucao", rotulo: "Evolução" },
  { id: "alteracoes", rotulo: "Alterações" },
  { id: "inconsistencias", rotulo: "Inconsistências" },
];

const TODAS = "__todas__";

export default function QlpAdministrativo() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);

  const pedida = params.get("aba") ?? "";
  const aba: Aba = ABAS.some((a) => a.id === pedida) ? (pedida as Aba) : "quadro";
  const period = params.get("period") ?? "";
  const [busca, setBusca] = useState("");
  const [unidade, setUnidade] = useState(TODAS);
  const [cargoAberto, setCargoAberto] = useState<string | null>(null);

  const comum = useMemo(() => {
    const q = new URLSearchParams();
    if (period) q.set("period", period);
    const scopeHash = params.get("scopeHash");
    if (scopeHash) q.set("scopeHash", scopeHash);
    const canal = params.get("canal");
    if (canal !== null) q.set("canal", canal);
    return q;
  }, [period, search]);

  const queryDoQuadro = useMemo(() => {
    const q = new URLSearchParams(comum);
    if (busca) q.set("busca", busca);
    if (unidade !== TODAS) q.set("unidade", unidade);
    return q.toString();
  }, [comum, busca, unidade]);

  /*
    404 aqui não é defeito: é "nenhum QLP importado ainda", e esse estado tem
    tela própria. `fetchJsonOrNull` devolve null e a página diz o que falta e
    onde se resolve — o mesmo desenho de Cobertura de dados.
  */
  const quadro = useQuery({
    queryKey: ["qlp", "quadro", queryDoQuadro],
    queryFn: () => fetchJsonOrNull<VisaoDoQuadro>(`/qlp/administrativo?${queryDoQuadro}`),
    retry: false,
  });

  /*
    A evolução também alimenta a aba de Alterações: é dela que sai o nome
    legível de cada cargo da série, porque as linhas de change carregam a chave
    normalizada — ver `agruparMovimentos`.
  */
  const evolucao = useQuery({
    queryKey: ["qlp", "evolucao", comum.toString()],
    queryFn: () =>
      fetchJsonOrNull<EvolucaoDoQuadro>(`/qlp/administrativo/evolucao?${comum.toString()}`),
    enabled: aba === "evolucao" || aba === "alteracoes",
    retry: false,
  });

  /*
    Sempre habilitada, e não só com a aba aberta.

    O selo do número no rótulo da aba é o que faz alguém reparar que falta dado
    — se ele só aparecesse depois do clique, só veria quem já desconfiava. A
    consulta é um `JOIN` indexado que devolve zero linhas no caso comum, e o
    seu contexto vem do mesmo `comum` das demais: unidade e canal, sem a
    vigência, porque a fila é do contexto inteiro.
  */
  const inconsistencias = useQuery({
    queryKey: ["qlp", "inconsistencias", comum.toString()],
    queryFn: () =>
      fetchJsonOrNull<InconsistenciasDoQuadro>(
        `/qlp/administrativo/inconsistencias?${comum.toString()}`,
      ),
    retry: false,
  });

  const irPara = (mudancas: Record<string, string>) => {
    const next = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === "") next.delete(chave);
      else next.set(chave, valor);
    }
    navigate(`/qlp-administrativo?${next}`);
  };

  const cabecalho = quadro.data;

  return (
    <Layout>
      <header className="border-b bg-card px-8 pt-6">
        <div className="flex items-start justify-between gap-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Briefcase className="w-6 h-6 text-nav-qlp" />
              QLP Administrativo
            </h1>
            <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
              O quadro de pessoal da estrutura administrativa que o modelo remunera — cargo a
              cargo, unidade a unidade, com a origem de cada número e o que a curadoria ainda
              não destravou.
            </p>
          </div>
          {cabecalho && (
            <div className="text-right shrink-0">
              <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                {cabecalho.context.label}
              </div>
              <Select value={cabecalho.effectiveDate} onValueChange={(v) => irPara({ period: v })}>
                <SelectTrigger className="w-64 mt-1 font-semibold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...cabecalho.vigencias].reverse().map((v) => (
                    <SelectItem key={v.effectiveDate} value={v.effectiveDate}>
                      {rotuloDaVigencia(v)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <nav className="flex items-end gap-1 mt-5 -mb-px" aria-label="Leituras do quadro">
          {ABAS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => irPara({ aba: item.id })}
              className={cn(
                "px-5 py-2.5 text-sm font-semibold uppercase tracking-wide border-b-2 transition-colors",
                item.id === aba
                  ? "border-brand text-brand"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {item.rotulo}
              {item.id === "inconsistencias" && (inconsistencias.data?.total ?? 0) > 0 && (
                <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[0.6875rem] font-bold text-red-700 tabular-nums">
                  {inconsistencias.data!.total}
                </span>
              )}
            </button>
          ))}
        </nav>
      </header>

      <div className="px-8 py-6 space-y-6">
        {quadro.error && (
          <ApiErrorNotice
            error={quadro.error}
            what="O quadro de QLP Administrativo não pôde ser carregado."
          />
        )}

        {quadro.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

        {quadro.data === null && <SemQlpImportado />}

        {quadro.data && (
          <>
            <ResumoExecutivo view={quadro.data} />

            {aba !== "inconsistencias" && quadro.data.registrosFaltando > 0 && (
              <QuadroIncompleto
                faltando={quadro.data.registrosFaltando}
                onVerDetalhe={() => irPara({ aba: "inconsistencias" })}
              />
            )}

            {aba === "quadro" && (
              <AbaQuadro
                view={quadro.data}
                busca={busca}
                onBusca={setBusca}
                unidade={unidade}
                onUnidade={setUnidade}
                onAbrirCargo={setCargoAberto}
              />
            )}
            {aba === "evolucao" && (
              <AbaEvolucao view={evolucao.data ?? null} carregando={evolucao.isLoading} />
            )}
            {aba === "alteracoes" && <AbaAlteracoes serie={evolucao.data?.quadro ?? []} />}
            {aba === "inconsistencias" && (
              <AbaInconsistencias
                view={inconsistencias.data ?? null}
                carregando={inconsistencias.isLoading}
              />
            )}
          </>
        )}
      </div>

      <DetalheDrawer
        entityId={cargoAberto}
        query={comum.toString()}
        onFechar={() => setCargoAberto(null)}
      />
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Estado vazio de primeira classe: sem QLP importado, a tela diz o caminho.
// ---------------------------------------------------------------------------

function SemQlpImportado() {
  return (
    <Card>
      <CardContent className="p-12 text-center space-y-3">
        <CloudDownload className="w-8 h-8 mx-auto text-muted-foreground" />
        <p className="font-semibold">Nenhuma vigência de QLP Administrativo foi importada.</p>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto">
          Esta tela lê o export "TABELA DE QLP ADM" do Freightech, enviado em{" "}
          <Link href="/importacoes" className="text-brand underline underline-offset-2">
            Importações
          </Link>{" "}
          pela aba <strong>QLP Administrativo</strong>. As vigências de equipamento não
          alimentam este quadro — o QLP tem export, grão e vigências próprios.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// O resumo executivo: quatro ângulos do mesmo quadro. Travado é travado com o
// motivo — nunca um zero no lugar do número que a curadoria ainda não liberou.
// ---------------------------------------------------------------------------

function ResumoExecutivo({ view }: { view: VisaoDoQuadro }) {
  const { resumo } = view;
  return (
    <section className="space-y-3">
      <div className="bg-card border rounded-md">
        <div className="grid grid-cols-2 lg:grid-cols-4 lg:divide-x divide-border">
          <Angulo rotulo="Unidades" valor={String(resumo.unidades)} />
          <Angulo rotulo="Cargos no quadro" valor={String(resumo.cargos)} />
          <Angulo
            rotulo="Efetivo remunerado"
            valor={resumo.efetivo.valor !== null ? String(resumo.efetivo.valor) : null}
            motivo={resumo.efetivo.motivo}
          />
          <Angulo
            rotulo="Custo da estrutura"
            valor={
              resumo.custo.valor !== null
                ? resumo.custo.valor.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                    maximumFractionDigits: 0,
                  })
                : null
            }
            motivo={resumo.custo.motivo}
            incompleto={resumo.custo.valor !== null && !resumo.apuracaoCompleta}
          />
        </div>
      </div>

      {resumo.curadoria.confirmados < resumo.curadoria.total && (
        <div className="bg-card border border-l-[6px] border-l-brand px-6 py-4 text-sm flex gap-3">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-brand" />
          <p>
            <strong>
              {resumo.curadoria.confirmados} de {resumo.curadoria.total}
            </strong>{" "}
            atributos deste export têm semântica confirmada. Os valores declarados aparecem
            todos abaixo; o que fica travado até a curadoria é a agregação — efetivo total,
            custo da estrutura e o impacto financeiro das alterações.{" "}
            <Link href="/curadoria" className="text-brand underline underline-offset-2">
              Confirmar na Curadoria
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}

function Angulo({
  rotulo,
  valor,
  motivo,
  incompleto,
}: {
  rotulo: string;
  valor: string | null;
  motivo?: string | null;
  incompleto?: boolean;
}) {
  return (
    <div className="px-6 py-4">
      <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </div>
      {valor !== null ? (
        <div className="text-3xl font-bold tabular-nums tracking-tight mt-1">
          {valor}
          {incompleto && (
            <span
              className="text-sm font-normal text-amber-700 ml-2"
              title="Há atributos numéricos ainda sem curadoria — este total pode não ser o custo inteiro."
            >
              parcial
            </span>
          )}
        </div>
      ) : (
        <div className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
          <CircleHelp className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{motivo ?? "Não calculável."}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba Quadro
// ---------------------------------------------------------------------------

function AbaQuadro({
  view,
  busca,
  onBusca,
  unidade,
  onUnidade,
  onAbrirCargo,
}: {
  view: VisaoDoQuadro;
  busca: string;
  onBusca: (v: string) => void;
  unidade: string;
  onUnidade: (v: string) => void;
  onAbrirCargo: (entityId: string) => void;
}) {
  const atributosPorCode = new Map(view.atributos.map((a) => [a.code, a]));
  const destacadas = COLUNAS_DESTACADAS.filter((code) => atributosPorCode.has(code));
  const visiveis = view.unidades.reduce((soma, u) => soma + u.cargos.length, 0);

  /*
    A ordem vale para as seções todas — o cabeçalho se repete unidade a unidade,
    e duas setas diferentes no mesmo cabeçalho seriam lidas como defeito, não
    como duas ordens. A régua, e o porquê de a ausência nunca contar como zero,
    estão em `components/qlp/ordenacao.ts`.
  */
  const [ordem, setOrdem] = useState<OrdemDoQuadro>(null);
  const unidades = useMemo(() => ordenarUnidades(view.unidades, ordem), [view.unidades, ordem]);

  /*
    As opções do seletor vêm da resposta — e a escolhida entra mesmo quando o
    filtro a deixou sozinha na lista, senão não haveria como voltar a TODAS.
  */
  const opcoes = new Map(view.unidades.map((u) => [u.cnpj, u.nome ?? u.cnpjLegivel]));
  if (unidade !== TODAS && !opcoes.has(unidade)) opcoes.set(unidade, unidade);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => onBusca(e.target.value)}
            placeholder="Buscar cargo…"
            className="pl-9 w-64"
          />
        </div>
        <Select value={unidade} onValueChange={onUnidade}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODAS}>Todas as unidades</SelectItem>
            {[...opcoes.entries()].map(([cnpj, nome]) => (
              <SelectItem key={cnpj} value={cnpj}>
                {nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          {visiveis} de {view.resumo.cargos} cargos
        </span>
      </div>

      {view.unidades.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center border rounded-md bg-card">
          Nenhum cargo desta vigência passa nos filtros aplicados.
        </p>
      )}

      {unidades.map((grupo) => (
        <section key={grupo.cnpj} className="bg-card border rounded-md overflow-x-auto">
          <header className="px-4 py-3 border-b bg-muted/40 flex items-baseline gap-2">
            <span className="font-semibold">{grupo.nome ?? "Unidade sem nome no arquivo"}</span>
            <span className="text-xs text-muted-foreground font-mono">{grupo.cnpjLegivel}</span>
            <span className="text-xs text-muted-foreground ml-auto tabular-nums">
              {grupo.cargos.length} cargo{grupo.cargos.length === 1 ? "" : "s"}
            </span>
          </header>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                <CabecalhoDoQuadro
                  chave={CHAVE_DO_CARGO}
                  rotulo="Cargo"
                  ordem={ordem}
                  onOrdenar={setOrdem}
                  alinhamento="esquerda"
                />
                {destacadas.map((code) => (
                  <CabecalhoDoQuadro
                    key={code}
                    chave={chaveDoAtributo(code)}
                    rotulo={atributosPorCode.get(code)!.sourceName}
                    atributo={atributosPorCode.get(code)}
                    ordem={ordem}
                    onOrdenar={setOrdem}
                    alinhamento="direita"
                  >
                    <SeloDeSemantica compacto status={atributosPorCode.get(code)!.semantica.status} />
                  </CabecalhoDoQuadro>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {grupo.cargos.map((cargo) => (
                <tr
                  key={cargo.entityId}
                  onClick={() => onAbrirCargo(cargo.entityId)}
                  className="border-b last:border-0 hover:bg-muted/40 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-2 font-medium">{cargo.cargo}</td>
                  {destacadas.map((code) => (
                    <td key={code} className="px-4 py-2 text-right tabular-nums">
                      {formatarValor(cargo.valores[code] ?? null, atributosPorCode.get(code))}
                    </td>
                  ))}
                  <td className="px-2 text-muted-foreground">
                    <ArrowRight className="w-4 h-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <p className="text-xs text-muted-foreground">
        A tabela destaca {destacadas.length} das {view.atributos.length} colunas do export;
        clique num cargo para ver todas, cada uma com a célula de origem. Valores aparecem como
        números, e não como reais, enquanto a curadoria não confirmar quais colunas são
        montante.
      </p>
    </>
  );
}

/**
 * Um cabeçalho que ordena a tabela do quadro.
 *
 * Um clique põe a coluna no sentido de estreia — quantidade e dinheiro do maior
 * para o menor, nome de cargo de A a Z —, o segundo inverte, o terceiro devolve
 * a ordem do servidor, por nome. A seta diz em qual dos três a tabela está: as
 * duas pontas quando ninguém pediu nada, e a ponta de cima ou de baixo quando
 * pediram. Sem ela o leitor teria que inferir a ordem lendo os valores, que é o
 * trabalho que a coluna acabou de fazer por ele.
 *
 * O selo de semântica continua no cabeçalho, ao lado do rótulo: ordenar por uma
 * coluna não confirmada é permitido — a ordem entre números não depende de
 * ninguém ter dito o que eles significam —, e o aviso de que o significado
 * ainda está em aberto não pode sumir por causa disso.
 *
 * A régua está em `components/qlp/ordenacao.ts`, com o motivo de a ausência
 * nunca contar como zero.
 */
function CabecalhoDoQuadro({
  chave,
  rotulo,
  atributo,
  ordem,
  onOrdenar,
  alinhamento,
  children,
}: {
  chave: ChaveDeOrdem;
  rotulo: string;
  atributo?: AtributoDoQuadro;
  ordem: OrdemDoQuadro;
  onOrdenar: (ordem: OrdemDoQuadro) => void;
  alinhamento: "esquerda" | "direita";
  children?: React.ReactNode;
}) {
  /* O sentido, e não um booleano: é o que a seta e o `aria-sort` precisam. */
  const sentido = ordem !== null && mesmaChave(ordem.chave, chave) ? ordem.sentido : null;
  /*
    O alinhamento desce até o <button> porque o rótulo quebra em duas linhas na
    largura de "QUANTIDADE ORDENADOS", e o <button> não herda o `text-right` da
    célula — a folha do agente centraliza texto de botão. Sem isto a segunda
    linha sairia centralizada debaixo da primeira, numa coluna de números
    encostada à direita.
  */
  const alinhar = alinhamento === "direita" ? "text-right" : "text-left";
  return (
    <th
      scope="col"
      aria-sort={sentido === null ? "none" : sentido === "asc" ? "ascending" : "descending"}
      className={cn("px-4 py-2 font-medium", alinhar)}
    >
      <button
        type="button"
        onClick={() => onOrdenar(proximaOrdem(ordem, chave, atributo))}
        title={
          sentido === null
            ? `ordenar por ${rotulo.toLowerCase()}`
            : "ordenar pelo outro sentido — o terceiro clique volta à ordem por cargo"
        }
        className={cn(
          /*
            O `uppercase tracking-wider` do <tr> não desce até aqui: o reset de
            formulário zera `text-transform` no <button>, e o rótulo sairia em
            caixa mista no meio de uma linha de cabeçalhos em caixa alta.
          */
          "inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground",
          alinhar,
          sentido !== null && "text-foreground",
        )}
      >
        {rotulo}
        {children}
        {sentido === null ? (
          <ChevronsUpDown className="w-3 h-3 shrink-0 opacity-40" />
        ) : sentido === "asc" ? (
          <ChevronUp className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 shrink-0" />
        )}
      </button>
    </th>
  );
}

function SeloDeSemantica({ status, compacto }: { status: string; compacto?: boolean }) {
  if (status === "CONFIRMED") {
    return compacto ? (
      <ShieldCheck className="w-3 h-3 text-emerald-600" aria-label="Semântica confirmada" />
    ) : (
      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100">
        <ShieldCheck className="w-3 h-3 mr-1" />
        Confirmado
      </Badge>
    );
  }
  if (status === "PRESUMED") {
    return compacto ? (
      <CircleHelp className="w-3 h-3 text-amber-600" aria-label="Semântica presumida" />
    ) : (
      <Badge className="bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-100">
        <CircleHelp className="w-3 h-3 mr-1" />
        Presumido
      </Badge>
    );
  }
  /* Vermelho como na Curadoria: a semântica pendente é o que trava o número. */
  return compacto ? (
    <AlertTriangle className="w-3 h-3 text-red-500" aria-label="Semântica desconhecida" />
  ) : (
    <Badge className="bg-red-100 text-red-800 border-red-300 hover:bg-red-100">
      <AlertTriangle className="w-3 h-3 mr-1" />
      Desconhecido
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Aba Evolução: presença por quinzena — a leitura que não precisa de curadoria.
// ---------------------------------------------------------------------------

function AbaEvolucao({
  view,
  carregando,
}: {
  view: EvolucaoDoQuadro | null;
  carregando: boolean;
}) {
  if (carregando) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!view) return null;

  if (view.vigencias.length === 1) {
    return (
      <>
        <TilesDaEvolucao view={view} />
        <p className="text-sm text-muted-foreground py-8 text-center border rounded-md bg-card">
          A série tem uma vigência só ({rotuloDaVigencia(view.vigencias[0])}). Evolução e
          alterações passam a existir quando a segunda quinzena for importada.
        </p>
      </>
    );
  }

  return (
    <>
      <TilesDaEvolucao view={view} />
      <section className="bg-card border rounded-md overflow-x-auto">
        <header className="px-4 py-3 border-b bg-muted/40 text-sm font-semibold">
          Presença no quadro, quinzena a quinzena
        </header>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-4 py-2 font-medium">Unidade</th>
              <th className="text-left px-4 py-2 font-medium">Cargo</th>
              {view.vigencias.map((v) => (
                <th key={v.effectiveDate} className="text-center px-3 py-2 font-medium">
                  {v.sourceLabels[0] ?? v.periodLabel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.quadro.map((linha) => (
              <tr key={linha.entityId} className="border-b last:border-0">
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                  {linha.unidadeCnpjLegivel}
                </td>
                <td className="px-4 py-2 font-medium">{linha.cargo}</td>
                {linha.presencas.map((presente, i) => (
                  <td
                    key={view.vigencias[i].effectiveDate}
                    className="px-3 py-2 text-center"
                    aria-label={presente ? "presente" : "ausente"}
                  >
                    <span className={presente ? "text-brand" : "text-muted-foreground/40"}>
                      {presente ? "●" : "○"}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-muted-foreground">
        ● no quadro daquela quinzena · ○ fora dele. Quinzena que não foi importada não vira
        coluna — a régua mostra só o que existe, e o buraco fica visível pela data que falta.
      </p>
    </>
  );
}

function TilesDaEvolucao({ view }: { view: EvolucaoDoQuadro }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {view.vigencias.map((v) => (
        <div key={v.effectiveDate} className="rounded-lg border bg-card px-4 py-3">
          <div className="text-xs font-medium text-muted-foreground">
            {v.sourceLabels.join(" · ") || v.periodLabel}
          </div>
          <div className="text-xl font-bold tabular-nums mt-1">
            {v.cargos} cargo{v.cargos === 1 ? "" : "s"}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
            {v.unidades} unidade{v.unidades === 1 ? "" : "s"} · {v.fatos} fatos
            {v.nulos > 0 ? ` · ${v.nulos} vazios` : ""}
            {v.herdados > 0 ? ` · ${v.herdados} herdados` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba Alterações: o par escolhido aqui, o diff no motor canônico de sempre.
// ---------------------------------------------------------------------------

interface SnapshotComparavel {
  id: string;
  sourceLabel: string;
  effectiveDate: string;
  entityTypeSet: string;
  entityCount: number;
  factCount: number;
}

interface ChangeSetCriado {
  id: string;
  valueChanges: number;
  entitiesAdded: number;
  entitiesRemoved: number;
  attributesAdded: number;
  attributesRemoved: number;
  unchanged: number;
  inconclusive: number;
  impacto: {
    oficial: Record<string, number>;
    bruto: Record<string, number>;
    mudancasForaDoTotal: number;
  };
  impactNotCalculable: number;
}

function AbaAlteracoes({ serie }: { serie: EvolucaoDoQuadro["quadro"] }) {
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [set, setSet] = useState<ChangeSetCriado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [janela, setJanela] = useState<Janela>(primeiraPagina);

  useEffect(() => {
    setJanela((atual) => (atual.pagina === 1 ? atual : { ...atual, pagina: 1 }));
  }, [filters, set?.id]);

  /*
    A família é pedida ao servidor, e não recortada depois.

    `/snapshots` responde pela família de equipamento quando ninguém pede outra
    — é a mesma regra de `/contexts`, e ela existe porque o contrário fazia uma
    quinzena de cargos entrar na leitura de placas. Esta tela é a que fala de
    gente, então ela nomeia a família dela, do mesmo jeito que
    `lib/qlp/src/contexto.ts` já nomeava. A constante mora em
    `@workspace/ingest` (`DATASET_FAMILY_QUADRO_DE_PESSOAL`) e não é importada
    aqui de propósito: aquele pacote carrega o pipeline de importação inteiro, e
    ele não tem por que ir para o bundle do navegador.
  */
  const { data: snapshots = [], error: snapshotsError } = useQuery({
    queryKey: ["snapshots", "QUADRO_DE_PESSOAL"],
    queryFn: () =>
      fetchJson<SnapshotComparavel[]>("/snapshots?datasetFamily=QUADRO_DE_PESSOAL"),
  });

  /*
    Dentro da família, só o administrativo entra nos seletores — o operacional é
    do mesmo quadro e forma série própria. O motor recusaria um par entre as
    duas coberturas de todo jeito; aqui o par nem chega a ser oferecido.
  */
  const doQuadro = useMemo(
    () => snapshots.filter((s) => s.entityTypeSet === "QLP_ADMINISTRATIVO"),
    [snapshots],
  );

  useEffect(() => {
    if (doQuadro.length >= 2 && !aId && !bId) {
      setAId(doQuadro[doQuadro.length - 2].id);
      setBId(doQuadro[doQuadro.length - 1].id);
    }
  }, [doQuadro, aId, bId]);

  const comparar = useMutation({
    mutationFn: async () => {
      const response = await fetch(getApiUrl("/change-sets"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotAId: aId, snapshotBId: bId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao comparar");
      return body as ChangeSetCriado;
    },
    onSuccess: (resultado) => {
      setErro(null);
      setSet(resultado);
    },
    onError: (err: Error) => {
      setSet(null);
      setErro(err.message);
    },
  });

  const { data: changes } = useQuery({
    queryKey: ["qlp", "change-set", set?.id, filters, janela],
    queryFn: () =>
      fetchJson<{ breakdown: Breakdown; total: number; rows: ChangeRow[] }>(
        `/change-sets/${set!.id}/changes?${toQuery(filters, {}, janela)}`,
      ),
    enabled: set !== null,
  });

  /*
    Entradas e saídas por unidade: as linhas ENTITY_ADDED/ENTITY_REMOVED que o
    change-set já calculou, pedidas com o filtro do próprio endpoint e apenas
    reagrupadas para leitura (`agruparMovimentos`, com o nome legível vindo da
    série).
  */
  const { data: linhasDeMovimento } = useQuery({
    queryKey: ["qlp", "movimentos", set?.id],
    queryFn: async () => {
      const pagina: Janela = { pagina: 1, porPagina: 300 };
      const [entradas, saidas] = await Promise.all([
        fetchJson<{ rows: ChangeRow[] }>(
          `/change-sets/${set!.id}/changes?${toQuery({ ...emptyFilters, changeType: "ENTITY_ADDED" }, {}, pagina)}`,
        ),
        fetchJson<{ rows: ChangeRow[] }>(
          `/change-sets/${set!.id}/changes?${toQuery({ ...emptyFilters, changeType: "ENTITY_REMOVED" }, {}, pagina)}`,
        ),
      ]);
      return [...entradas.rows, ...saidas.rows];
    },
    enabled: set !== null,
  });
  const movimentos = useMemo(
    () => agruparMovimentos(linhasDeMovimento ?? [], serie),
    [linhasDeMovimento, serie],
  );

  const rotulo = (id: string) => {
    const s = doQuadro.find((x) => x.id === id);
    return s ? s.sourceLabel : "—";
  };

  if (doQuadro.length < 2) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center border rounded-md bg-card">
        Comparar exige duas vigências do quadro
        {doQuadro.length === 1 ? ` — existe uma (${doQuadro[0].sourceLabel}).` : "."} A segunda
        quinzena importada destrava esta aba.
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <SeletorDeVigencia
          rotulo="Vigência anterior"
          valor={aId}
          onMudar={setAId}
          opcoes={doQuadro}
        />
        <ArrowRight className="w-5 h-5 text-muted-foreground mb-2.5" />
        <SeletorDeVigencia
          rotulo="Vigência nova"
          valor={bId}
          onMudar={setBId}
          opcoes={doQuadro}
        />
        <Button
          onClick={() => comparar.mutate()}
          disabled={!aId || !bId || aId === bId || comparar.isPending}
        >
          {comparar.isPending ? "Comparando…" : "Comparar"}
        </Button>
      </div>

      {snapshotsError && (
        <ApiErrorNotice
          error={snapshotsError}
          what="As vigências disponíveis não puderam ser carregadas."
        />
      )}
      {erro && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {erro}
        </div>
      )}

      {set && (
        <>
          <div
            /*
              Pelo espaço que sobra, não pelo tamanho da janela: seis colunas
              fixas ignoram os 304px da lateral e entregam ladrilhos de 139px
              numa tela de 1280 — estreitos demais para um valor em reais, que
              então era escrito por cima do ladrilho vizinho. Com `auto-fit`, o
              que cede é o número de colunas.
            */
            className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]"
          >
            <TileDeAlteracao rotulo="Valores alterados" valor={set.valueChanges} />
            <TileDeAlteracao rotulo="Sem alteração" valor={set.unchanged} />
            <TileDeAlteracao rotulo="Cargos entraram" valor={`+${set.entitiesAdded}`} />
            <TileDeAlteracao rotulo="Cargos saíram" valor={`−${set.entitiesRemoved}`} />
            <TileDeAlteracao
              rotulo="Colunas +/−"
              valor={`+${set.attributesAdded} / −${set.attributesRemoved}`}
            />
            {/*
              O mesmo componente dos cartões das abas, e não uma cópia com as
              mesmas regras: uma linha por periodicidade — R$/mês e R$/ano não
              somam —, e o corpo do número escolhido pela largura que este
              ladrilho tem. Emendadas numa string só, as duas periodicidades
              saíam do ladrilho pela direita.
            */}
            <TileDeAlteracao
              rotulo="Impacto apurado"
              valor={
                <ImpactoPorPeriodicidade
                  buckets={set.impacto.oficial}
                  escala="ladrilho"
                  colorido={false}
                />
              }
              hint={
                set.impactNotCalculable > 0
                  ? `${set.impactNotCalculable} alterações sem preço — semântica pendente`
                  : undefined
              }
            />
          </div>

          {movimentos && movimentos.length > 0 && (
            <section className="bg-card border rounded-md">
              <header className="px-4 py-3 border-b bg-muted/40 text-sm font-semibold">
                Entradas e saídas do quadro, por unidade
              </header>
              <div className="divide-y">
                {movimentos.map((m) => (
                  <div key={m.unidade} className="px-4 py-3 text-sm flex flex-wrap gap-x-6 gap-y-1">
                    <span className="font-mono text-xs text-muted-foreground pt-0.5">
                      {m.unidade}
                    </span>
                    {m.entraram.length > 0 && (
                      <span>
                        <span className="text-emerald-700 font-medium">entrou:</span>{" "}
                        {m.entraram.join(", ")}
                      </span>
                    )}
                    {m.sairam.length > 0 && (
                      <span>
                        <span className="text-red-700 font-medium">saiu:</span>{" "}
                        {m.sairam.join(", ")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <FilterBar filters={filters} onChange={setFilters} breakdown={changes?.breakdown} />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {rotulo(aId)} → {rotulo(bId)}
                {changes && (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    · {changes.total} alterações
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {changes && (
                <ChangeTable
                  rows={changes.rows}
                  total={changes.total}
                  janela={janela}
                  onJanela={setJanela}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {!set && !erro && (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            Escolha duas vigências do quadro e clique em Comparar. A comparação é a mesma de
            Comparar Vigências — identidade de cargo e atributo, nunca posição de linha.
          </CardContent>
        </Card>
      )}
    </>
  );
}

function SeletorDeVigencia({
  rotulo,
  valor,
  onMudar,
  opcoes,
}: {
  rotulo: string;
  valor: string;
  onMudar: (v: string) => void;
  opcoes: SnapshotComparavel[];
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</div>
      <Select value={valor} onValueChange={onMudar}>
        <SelectTrigger className="w-72">
          <SelectValue placeholder="Selecionar vigência…" />
        </SelectTrigger>
        <SelectContent>
          {opcoes.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.sourceLabel} · {s.entityCount} cargos
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function TileDeAlteracao({
  rotulo,
  valor,
  hint,
}: {
  rotulo: string;
  /**
   * Um número, ou o que não cabe em um: o impacto é uma linha por
   * periodicidade, e um ladrilho que só aceitasse texto obrigaria a emendar as
   * duas numa string — que é como elas saíam pela direita do cartão.
   */
  valor: React.ReactNode;
  hint?: string;
}) {
  return (
    // `@container`: a largura do ladrilho é a régua que o valor consulta para
    // escolher o próprio corpo.
    <div className="rounded-lg border bg-card px-4 py-3 @container">
      <div className="text-xs font-medium text-muted-foreground">{rotulo}</div>
      <div className="text-xl font-bold tabular-nums mt-1">{valor}</div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// O detalhe do cargo — os 35 atributos, cada um com a célula de origem.
// ---------------------------------------------------------------------------

function DetalheDrawer({
  entityId,
  query,
  onFechar,
}: {
  entityId: string | null;
  query: string;
  onFechar: () => void;
}) {
  const detalhe = useQuery({
    queryKey: ["qlp", "detalhe", entityId, query],
    queryFn: () =>
      fetchJsonOrNull<DetalheDoCargo>(`/qlp/administrativo/entidades/${entityId}?${query}`),
    enabled: entityId !== null,
    retry: false,
  });

  const dados = detalhe.data;

  return (
    <Sheet open={entityId !== null} onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent side="right" className="w-full sm:max-w-3xl p-0 flex flex-col gap-0">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-nav-qlp" />
            {dados ? dados.cargo : "Cargo"}
          </SheetTitle>
          <SheetDescription asChild>
            <div className="text-sm text-muted-foreground">
              {dados && (
                <>
                  <span className="font-mono">{dados.chaveLegivel}</span>
                  <span> · vigência {dados.vigencias.find((v) => v.effectiveDate === dados.effectiveDate)?.sourceLabels.join(" · ") ?? dados.periodLabel}</span>
                  {dados.vigenciasDoCargo.length > 0 && (
                    <span>
                      {" "}
                      · no quadro em {dados.vigenciasDoCargo.length} quinzena
                      {dados.vigenciasDoCargo.length === 1 ? "" : "s"}
                    </span>
                  )}
                </>
              )}
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {detalhe.isLoading && (
            <p className="text-sm text-muted-foreground p-6">Carregando…</p>
          )}
          {detalhe.error != null && (
            <div className="p-6">
              <ApiErrorNotice
                error={detalhe.error}
                what="A ficha deste cargo não pôde ser carregada."
              />
            </div>
          )}
          {dados && !dados.presente && (
            <p className="text-sm text-muted-foreground p-6">
              Este cargo não está no quadro da vigência aberta — ele aparece em outra quinzena
              da série. Troque a vigência no topo da tela para vê-lo.
            </p>
          )}
          {dados && dados.presente && (
            <table className="w-full text-sm table-fixed">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b bg-muted/40 text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium w-[30%]">Atributo</th>
                  <th className="text-right px-4 py-2 font-medium w-[18%]">Valor</th>
                  <th className="text-left px-4 py-2 font-medium w-[17%]">Semântica</th>
                  <th className="text-left px-4 py-2 font-medium">Origem</th>
                </tr>
              </thead>
              <tbody>
                {dados.atributos.map((fato) => (
                  <tr key={fato.code} className="border-b last:border-0 align-top">
                    <td className="px-4 py-2">
                      <div className="font-medium">{fato.sourceName}</div>
                      <div className="text-xs text-muted-foreground font-mono">{fato.code}</div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {fato.isNull ? (
                        <span
                          className="text-muted-foreground"
                          title={fato.nullReason ?? "Célula vazia no arquivo."}
                        >
                          —
                        </span>
                      ) : (
                        formatarValor(fato.valor, fato)
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <SeloDeSemantica status={fato.semantica.status} />
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground break-words">
                      {fato.origem.aba ? (
                        <div className="font-mono">
                          {fato.origem.aba} · linha {fato.origem.linha} · coluna{" "}
                          {fato.origem.coluna}
                        </div>
                      ) : (
                        <div>Sem célula de origem registrada.</div>
                      )}
                      {fato.origem.arquivo && (
                        <div className="truncate" title={fato.origem.arquivo}>
                          {fato.origem.arquivo}
                        </div>
                      )}
                      {fato.origem.valorBruto !== null && (
                        <div className="font-mono truncate" title={fato.origem.valorBruto}>
                          bruto: {fato.origem.valorBruto}
                        </div>
                      )}
                      {fato.herdadoDe && (
                        <div className="text-amber-700">herdado de {fato.herdadoDe}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// O que não está no quadro — e a ressalva que impede lê-lo como se estivesse.
// ---------------------------------------------------------------------------

/**
 * A ressalva no topo do quadro incompleto.
 *
 * Ela existe porque a quarentena por chave tem um efeito colateral que nenhum
 * número da tela denuncia sozinho: um cargo que ficou de fora **não aparece
 * como faltando**, ele simplesmente não aparece — e não há como distinguir, na
 * tabela, o cargo que a unidade não tem do cargo que a planilha trazia duas
 * vezes com salários diferentes. "Cargos no quadro: 214" é verdade sobre o
 * quadro e mentira sobre a unidade, e a diferença entre as duas coisas é esta
 * frase.
 *
 * Por isso ela fica acima do conteúdo, em todas as abas menos a que já mostra o
 * detalhe, e não atrás de um clique.
 */
function QuadroIncompleto({
  faltando,
  onVerDetalhe,
}: {
  faltando: number;
  onVerDetalhe: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
      <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
      <div className="text-sm">
        <p className="font-semibold text-amber-900">
          Este quadro está incompleto: {faltando}{" "}
          {faltando === 1 ? "registro ficou" : "registros ficaram"} de fora da importação.
        </p>
        <p className="text-amber-800 mt-0.5">
          A planilha trouxe {faltando === 1 ? "esse cargo" : "esses cargos"} mais de uma vez
          na mesma vigência, com valores que discordam, e a importação não escolhe uma das
          linhas em silêncio. Eles não estão na tabela abaixo nem nas contagens acima.{" "}
          <button
            type="button"
            onClick={onVerDetalhe}
            className="font-semibold underline underline-offset-2"
          >
            Ver quais são
          </button>
          .
        </p>
      </div>
    </div>
  );
}

/**
 * A aba de Inconsistências: a fila do que precisa ser corrigido na origem.
 *
 * ---------------------------------------------------------------------------
 * Por que ela ignora o seletor de vigência
 * ---------------------------------------------------------------------------
 * As outras três abas são retratos de uma quinzena, e o seletor é o que as
 * governa. Esta não é retrato: é trabalho pendente. Um cargo que ficou de fora
 * de uma quinzena de três meses atrás continua sendo dado que falta hoje, e
 * escondê-lo atrás do seletor faria a aba parecer vazia justamente para quem
 * abriu o produto na quinzena mais recente — o único jeito de descobrir seria
 * varrer o seletor quinzena a quinzena. Por isso a lista é do contexto inteiro,
 * agrupada por vigência, da mais nova para a mais antiga.
 *
 * ---------------------------------------------------------------------------
 * Por que o desenho de cada registro não é daqui
 * ---------------------------------------------------------------------------
 * É o mesmo apontamento que a tela de Importações mostra, com a mesma
 * evidência — a chave como está escrita no arquivo, as linhas que colidiram, os
 * valores lado a lado, o que fazer. Desenhá-lo de novo aqui seria pedir que
 * duas telas concordassem para sempre sobre o que um conflito é. Ver
 * `components/apontamentos/apresentacao.tsx`.
 */
function AbaInconsistencias({
  view,
  carregando,
}: {
  view: InconsistenciasDoQuadro | null;
  carregando: boolean;
}) {
  if (carregando) {
    return <p className="text-sm text-muted-foreground">Carregando as inconsistências…</p>;
  }
  if (!view) return null;

  if (view.total === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center space-y-3">
          <ShieldCheck className="w-8 h-8 mx-auto text-emerald-600" />
          <p className="font-semibold">Nenhum registro ficou de fora.</p>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto">
            Em todas as vigências de <strong>{view.context.label}</strong>, cada cargo aparece
            uma vez só por quinzena — ou, quando aparece repetido, as linhas dizem a mesma
            coisa e foram consolidadas. Os quadros desta série estão completos.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="w-5 h-5 shrink-0 text-muted-foreground mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">
                {view.total} {view.total === 1 ? "registro" : "registros"}
              </strong>{" "}
              {view.total === 1 ? "ficou" : "ficaram"} de fora do quadro em{" "}
              {view.pendencias.length}{" "}
              {view.pendencias.length === 1 ? "vigência" : "vigências"} de{" "}
              <strong className="text-foreground">{view.context.label}</strong>. A importação
              não escolhe entre duas linhas que discordam sobre o mesmo cargo — ela deixa o
              registro de fora, com a evidência abaixo, e importa o resto do arquivo.
            </p>
            <p className="mt-2">
              Esta lista é de toda a série, e não da quinzena selecionada acima: dado que
              falta não deixa de faltar por estarmos olhando outra vigência. Corrigida a
              origem e importado o arquivo de novo, o registro entra e sai daqui sozinho.
            </p>
          </div>
        </CardContent>
      </Card>

      {view.pendencias.map((vigencia) => (
        <Card key={vigencia.vigenciaLabel}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              {vigencia.periodLabel}
              <span className="font-mono text-xs font-normal text-muted-foreground">
                {vigencia.vigenciaLabel}
              </span>
              <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
                {vigencia.registros.length}{" "}
                {vigencia.registros.length === 1 ? "registro" : "registros"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {vigencia.registros.map((registro, i) => (
              <RegistroDeInconsistencia key={`${registro.chave}-${i}`} registro={registro} />
            ))}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

/**
 * Um registro que ficou de fora, com a evidência inteira.
 *
 * O título é a chave como está escrita na planilha — `07.526.557/0015-05 ·
 * ANALISTA ADM` —, e não a normalizada: quem vai corrigir procura na planilha,
 * e a normalizada não está lá. Quando o apontamento é anterior ao contrato de
 * apresentação, a frase do pipeline aparece inteira; ela sempre existe.
 */
function RegistroDeInconsistencia({ registro }: { registro: RegistroInconsistente }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/50 px-4 py-3 text-sm text-red-950">
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="font-semibold break-words">{registro.chave || "Registro sem chave legível"}</p>
        <SeloDeSeveridade severity="ERROR" code={registro.code} />
      </div>
      {registro.apresentacao ? (
        <SecoesDaApresentacao
          apresentacao={registro.apresentacao}
          severity="ERROR"
          code={registro.code}
        />
      ) : (
        <div className="space-y-1">
          <p className="leading-relaxed">{registro.mensagem}</p>
          {registro.linhas.length > 0 && (
            <p className="text-xs opacity-75">{registro.linhas.join(" · ")}</p>
          )}
        </div>
      )}
    </div>
  );
}
