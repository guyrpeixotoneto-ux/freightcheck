import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  FileCheck2,
  RotateCcw,
  Truck,
  WifiOff,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { JustificarDialog } from "@/components/justificativas/justificar-dialog";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { useAmbiente } from "@/lib/ambiente-aberto";
import { useContextosDaCasca } from "@/lib/contextos";
import { equipamentosDoAmbiente, rotuloDoTipo } from "@/lib/frota";
import { formatNumber } from "@/lib/format";
import {
  opcoesDeVigencia,
  useComparacoes,
  type Justificativa,
} from "@/lib/justificativas";
import {
  direcaoDaLinha,
  iniciaisDoResponsavel,
  pendenciasPorTipo,
  responsaveisDoPainel,
  resumoDoPainel,
  useLinhasDoPainel,
  usePainelDeJustificativas,
  vigenciasDoPainel,
  type DirecaoDoImpacto,
  type LinhaDoPainel,
  type SituacaoDaJustificativa,
} from "@/lib/painel-de-justificativas";
import { cn } from "@/lib/utils";

/**
 * Plano de Ação — Painel de Justificativas.
 *
 * A fila de Justificativas responde "o que eu justifico agora". Este painel
 * responde a outra pergunta, que é a de quem **cobra** o trabalho: do que a
 * Ambev mudou, quanto já está explicado e quanto ainda falta explicar — no
 * acervo inteiro, e não numa vigência de cada vez. Era uma conta que só existia
 * somando telas na mão, vigência a vigência, aba a aba.
 *
 * O assunto é o mesmo do módulo Justificativas, e de propósito: a justificativa
 * que o gestor deve a cada alteração que subiu ou desceu um valor. Nada aqui é
 * um segundo cadastro — a linha pendente desta tela é a mesma linha da fila, o
 * botão Justificar grava na mesma rota, e uma justificativa escrita aqui aparece
 * lá no mesmo instante.
 *
 * **O que esta tela não tem é prazo.** O desenho que a pediu trazia um cartão de
 * "vencidos" e um gráfico por vencimento, e este produto não tem vencimento
 * nenhum: nenhuma justificativa vence, porque nenhuma tem data para ser
 * escrita. Um cartão vermelho com 78 vencidos seria o número inventado que a
 * regra da lateral proíbe. No lugar deles estão os dois recortes que existem e
 * respondem à mesma necessidade — **onde** está a pendência (por tipo de ativo)
 * e **em que vigência** ela está (a tabela por vigência) —, que é o que diz a
 * quem mandar a fila.
 *
 * As contas moram em `lib/painel-de-justificativas.ts`, que não lê tela nenhuma
 * e por isso é testável direto; aqui fica o desenho.
 */

const TODAS = "__todas__";
const TODOS_OS_TIPOS = "__todos__";
const TODOS_OS_RESPONSAVEIS = "__todos_responsaveis__";

const CORES = {
  justificadas: "hsl(142 71% 45%)",
  pendentes: "hsl(32 95% 54%)",
};

/** A régua de porcentagem da tela: uma casa, como os demais cartões da casa. */
function pct(valor: number): string {
  return `${formatNumber(valor, valor === 0 || valor === 100 ? 0 : 2)}%`;
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
  icon: typeof FileCheck2;
  tom: "neutro" | "verde" | "ambar" | "azul";
}) {
  const tons = {
    neutro: { texto: "text-foreground", fundo: "bg-muted", icone: "text-muted-foreground" },
    verde: { texto: "text-emerald-600", fundo: "bg-emerald-50", icone: "text-emerald-600" },
    ambar: { texto: "text-amber-600", fundo: "bg-amber-50", icone: "text-amber-600" },
    azul: { texto: "text-sky-700", fundo: "bg-sky-50", icone: "text-sky-700" },
  }[tom];

  return (
    <section className="bg-card border rounded-xl shadow-sm px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{titulo}</p>
          <p className={cn("text-3xl font-bold tracking-tight tabular-nums mt-1", tons.texto)}>
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

export default function PainelDeJustificativas() {
  const ambiente = useAmbiente();
  const queryClient = useQueryClient();
  const [, navegar] = useLocation();

  const { cobertura, autores, consulta } = usePainelDeJustificativas();
  const comparacoes = useComparacoes();
  const contextos = useContextosDaCasca();

  /*
    Os filtros vivem em estado, e não no endereço como os da fila. A fila é
    ponto de partida de um trabalho que continua noutra tela — abrir a placa e
    voltar precisa reencontrar a mesma aba —; o painel é leitura, e o que dele
    se leva adiante é o link para a fila, que o botão de cada linha monta.
  */
  const [changeSetId, setChangeSetId] = useState<string | null>(null);
  const [tipo, setTipo] = useState<string | null>(null);
  const [direcao, setDirecao] = useState<DirecaoDoImpacto>("TODAS");
  const [autor, setAutor] = useState<string | null>(null);
  const [situacao, setSituacao] = useState<SituacaoDaJustificativa>("PENDENTE");
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [dialogAlvo, setDialogAlvo] = useState<LinhaDoPainel[] | null>(null);
  const [exportando, setExportando] = useState(false);

  const resumo = resumoDoPainel(cobertura, changeSetId, tipo);
  const barras = useMemo(
    () => pendenciasPorTipo(cobertura, changeSetId, equipamentosDoAmbiente(ambiente)),
    [cobertura, changeSetId, ambiente],
  );
  const porVigencia = useMemo(() => vigenciasDoPainel(cobertura, tipo), [cobertura, tipo]);
  const responsaveis = useMemo(
    () => responsaveisDoPainel(autores, changeSetId),
    [autores, changeSetId],
  );

  /* O nome de cada vigência — a mesma régua do seletor da fila. */
  const nomeDaVigencia = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const o of opcoesDeVigencia(comparacoes.data ?? [], contextos.contextos)) {
      nomes.set(o.id, o.unidade ? `${o.competencia} · ${o.unidade}` : o.competencia);
    }
    return nomes;
  }, [comparacoes.data, contextos.contextos]);

  const recorte = {
    changeSetId,
    tipo,
    situacao,
    direcao,
    autor,
    pagina,
    porPagina,
  };
  const lista = useLinhasDoPainel(recorte);

  /*
    Trocar qualquer filtro volta para a primeira página e limpa a seleção: a
    página 4 de uma lista que encolheu não existe, e uma seleção guardada de um
    recorte que saiu de tela abriria o diálogo sobre alterações que quem clicou
    não está mais vendo. É a mesma razão da troca de aba na fila.
  */
  const trocar = (mudanca: () => void) => {
    mudanca();
    setPagina(1);
    setSelecionadas(new Set());
  };

  const limparFiltros = () =>
    trocar(() => {
      setChangeSetId(null);
      setTipo(null);
      setDirecao("TODAS");
      setAutor(null);
    });

  const temFiltro =
    changeSetId !== null || tipo !== null || direcao !== "TODAS" || autor !== null;

  const justificar = useMutation({
    mutationFn: async (input: { linhas: LinhaDoPainel[]; texto: string }) => {
      /*
        Uma justificativa pertence a uma comparação, e a lista do painel pode
        atravessar várias: a seleção vai ao servidor agrupada por vigência, um
        POST para cada. Mandar tudo num só faria o servidor recusar — e com
        razão — as alterações que não são daquela comparação.
      */
      const porComparacao = new Map<string, number[]>();
      for (const linha of input.linhas) {
        const atual = porComparacao.get(linha.changeSetId) ?? [];
        atual.push(linha.changeId);
        porComparacao.set(linha.changeSetId, atual);
      }
      for (const [id, changeIds] of porComparacao) {
        await fetchJson<{ justificativas: Justificativa[] }>("/justificativas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changeSetId: id, changeIds, texto: input.texto }),
        });
      }
    },
    onSuccess: () => {
      /* O painel inteiro reconta: os cartões, a rosca, as barras e a lista. */
      queryClient.invalidateQueries({ queryKey: ["justificativas"] });
      setSelecionadas(new Set());
      setDialogAlvo(null);
    },
  });

  const alternar = (changeId: number) =>
    setSelecionadas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(changeId)) proximo.delete(changeId);
      else proximo.add(changeId);
      return proximo;
    });

  const todasDaPagina = lista.linhas.length > 0 && lista.linhas.every((l) => selecionadas.has(l.changeId));
  const alternarPagina = () =>
    setSelecionadas((atual) => {
      const proximo = new Set(atual);
      for (const linha of lista.linhas) {
        if (todasDaPagina) proximo.delete(linha.changeId);
        else proximo.add(linha.changeId);
      }
      return proximo;
    });

  /**
   * Exportar o recorte aberto — o que está nos filtros, e não só a página.
   *
   * As páginas são buscadas em sequência até a lista acabar, porque é isso que
   * a rota oferece: um CSV com dez linhas quando a tela diz 406 seria a
   * exportação mentindo sobre o próprio nome.
   */
  const exportar = async () => {
    setExportando(true);
    try {
      const tudo: LinhaDoPainel[] = [];
      const passo = 100;
      for (let offset = 0; ; offset += passo) {
        const q = new URLSearchParams();
        if (changeSetId) q.set("changeSetId", changeSetId);
        if (tipo) q.set("entityType", tipo);
        q.set("situacao", situacao);
        if (direcao !== "TODAS") q.set("direcao", direcao);
        if (autor && situacao === "JUSTIFICADA") q.set("autor", autor);
        q.set("limit", String(passo));
        q.set("offset", String(offset));
        const pagina = await fetchJson<{ total: number; linhas: LinhaDoPainel[] }>(
          `/justificativas/pendencias?${q.toString()}`,
        );
        tudo.push(...pagina.linhas);
        if (tudo.length >= pagina.total || pagina.linhas.length === 0) break;
      }

      const aspas = (valor: string | null) => `"${(valor ?? "").replace(/"/g, '""')}"`;
      const csv = [
        [
          "Vigência",
          "Placa",
          "Tipo",
          "Atributo",
          "De",
          "Para",
          "Situação",
          "Justificativa",
          "Responsável",
          "Quando",
        ].join(";"),
        ...tudo.map((l) =>
          [
            aspas(nomeDaVigencia.get(l.changeSetId) ?? l.changeSetId),
            aspas(l.entityLabel),
            aspas(l.entityType ? rotuloDoTipo(l.entityType) : null),
            aspas(l.attributeName ?? l.attributeCode),
            aspas(l.valueBefore),
            aspas(l.valueAfter),
            aspas(l.texto === null ? "Pendente" : "Justificada"),
            aspas(l.texto),
            aspas(l.criadoPor),
            aspas(l.criadoEm ? new Date(l.criadoEm).toLocaleString("pt-BR") : null),
          ].join(";"),
        ),
      ].join("\n");

      salvarArquivo(
        /* BOM: sem ele o Excel abre "Justificação" como "JustificaÃ§Ã£o". */
        new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }),
        `painel-de-justificativas-${situacao.toLowerCase()}.csv`,
      );
    } finally {
      setExportando(false);
    }
  };

  const rosca = resumo
    ? [
        { name: "Justificadas", value: resumo.justificadas, cor: CORES.justificadas },
        { name: "Pendentes", value: resumo.pendentes, cor: CORES.pendentes },
      ].filter((f) => f.value > 0)
    : [];
  const maiorBarra = Math.max(1, ...barras.map((b) => b.pendentes));

  const carregando = consulta.carregando && !cobertura;

  return (
    <Layout>
      <header className="px-8 pt-7 pb-5 max-w-[1400px]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-primary/10 p-2.5 mt-0.5">
              <ClipboardList className="w-6 h-6 text-primary" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Plano de Ação
              </p>
              <h1 className="text-4xl font-bold tracking-tight mt-1">
                Painel de Justificativas
              </h1>
              <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
                Acompanhe tudo que foi justificado e o que ainda falta justificar —
                as alterações que subiram ou desceram um valor entre uma vigência
                e a seguinte, e a explicação que o gestor deve a cada uma.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={exportar}
            disabled={exportando || !resumo}
          >
            <Download className="w-4 h-4" />
            {exportando ? "Exportando…" : "Exportar"}
          </Button>
        </div>
      </header>

      <div className="px-8 pb-10 space-y-4 max-w-[1400px]">
        {consulta.indisponivel && (
          <ApiErrorNotice
            error={consulta.erro}
            what="A cobertura das justificativas não pôde ser carregada."
            onTentarDeNovo={consulta.tentarDeNovo}
            tentando={consulta.atualizando}
          />
        )}

        {consulta.avisarSobreDadoGuardado && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-200 bg-amber-50/70 px-4 py-2 text-sm text-amber-900">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>
              A atualização não completou. O que está em tela é de{" "}
              {new Date(consulta.respondidoEm ?? 0).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
              , e continua válido.
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={consulta.atualizando}
              onClick={consulta.tentarDeNovo}
            >
              {consulta.atualizando ? "Tentando…" : "Tentar de novo"}
            </Button>
          </div>
        )}

        {carregando && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        )}

        {resumo && resumo.alteracoes === 0 && (
          <section className="bg-card border rounded-xl shadow-sm px-6 py-10 text-center">
            <p className="text-lg font-bold">Nada a justificar neste recorte.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Sem alteração por ativo nas comparações escolhidas, não há
              justificativa a cobrar. Abra a aba Alterações para calcular a
              comparação entre as vigências importadas.
            </p>
          </section>
        )}

        {resumo && resumo.alteracoes > 0 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Cartao
                titulo="Alterações no recorte"
                valor={resumo.alteracoes.toLocaleString("pt-BR")}
                rodape="O que mudou por placa entre as vigências"
                icon={FileCheck2}
                tom="neutro"
              />
              <Cartao
                titulo="Justificadas"
                valor={resumo.justificadas.toLocaleString("pt-BR")}
                rodape={`${pct(resumo.cobertura)} do total`}
                icon={CheckCircle2}
                tom="verde"
              />
              <Cartao
                titulo="Falta justificar"
                valor={resumo.pendentes.toLocaleString("pt-BR")}
                rodape={`${pct(100 - resumo.cobertura)} do total`}
                icon={Clock}
                tom="ambar"
              />
              <Cartao
                titulo="Placas com pendência"
                valor={resumo.placasPendentes.toLocaleString("pt-BR")}
                rodape={
                  changeSetId
                    ? `de ${resumo.placas.toLocaleString("pt-BR")} placas alteradas na vigência`
                    : "na vigência que mais tem — placas não se somam entre vigências"
                }
                icon={Truck}
                tom="azul"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <section className="bg-card border rounded-xl shadow-sm px-6 py-5">
                <h2 className="text-lg font-bold">Visão geral</h2>
                <div className="flex items-center gap-6 mt-3">
                  <div className="relative shrink-0">
                    <ResponsiveContainer width={170} height={170}>
                      <PieChart>
                        <Pie
                          data={rosca}
                          cx="50%"
                          cy="50%"
                          innerRadius={54}
                          outerRadius={80}
                          dataKey="value"
                          stroke="none"
                          isAnimationActive={false}
                        >
                          {rosca.map((fatia) => (
                            <Cell key={fatia.name} fill={fatia.cor} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-2xl font-bold tabular-nums">
                        {resumo.alteracoes.toLocaleString("pt-BR")}
                      </span>
                      <span className="text-xs text-muted-foreground">Total</span>
                    </div>
                  </div>
                  <dl className="space-y-3 text-sm">
                    <div>
                      <dt className="flex items-center gap-2 font-medium">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ background: CORES.justificadas }}
                        />
                        Justificadas
                      </dt>
                      <dd className="text-muted-foreground tabular-nums ml-[18px]">
                        {resumo.justificadas.toLocaleString("pt-BR")} ({pct(resumo.cobertura)})
                      </dd>
                    </div>
                    <div>
                      <dt className="flex items-center gap-2 font-medium">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ background: CORES.pendentes }}
                        />
                        Pendentes
                      </dt>
                      <dd className="text-muted-foreground tabular-nums ml-[18px]">
                        {resumo.pendentes.toLocaleString("pt-BR")} (
                        {pct(100 - resumo.cobertura)})
                      </dd>
                    </div>
                  </dl>
                </div>
                <Progress value={resumo.cobertura} className="mt-4" />
                <p className="text-xs text-muted-foreground mt-2">
                  {pct(resumo.cobertura)} do que mudou já tem justificativa escrita.
                </p>
              </section>

              <section className="bg-card border rounded-xl shadow-sm px-6 py-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-lg font-bold">Pendências por tipo de ativo</h2>
                  <p className="text-xs text-muted-foreground">
                    Justificar é trabalho por tipo — a barra diz a quem mandar a fila.
                  </p>
                </div>
                <ul className="mt-4 space-y-3">
                  {barras.map((barra) => (
                    <li key={barra.tipo}>
                      <button
                        type="button"
                        onClick={() => trocar(() => setTipo(barra.tipo === tipo ? null : barra.tipo))}
                        className={cn(
                          "w-full text-left rounded-md px-2 py-1.5 hover:bg-muted/60 transition-colors",
                          tipo === barra.tipo && "bg-muted",
                        )}
                      >
                        <span className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="font-medium">{barra.rotulo}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {barra.pendentes.toLocaleString("pt-BR")} pendentes ·{" "}
                            {barra.justificadas.toLocaleString("pt-BR")} justificadas
                          </span>
                        </span>
                        <span className="mt-1.5 block h-2.5 w-full rounded-full bg-muted overflow-hidden">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${(barra.pendentes / maiorBarra) * 100}%`,
                              background: CORES.pendentes,
                            }}
                          />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <section className="bg-card border rounded-xl shadow-sm px-6 py-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1">
                  <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                    Vigência
                  </span>
                  <Select
                    value={changeSetId ?? TODAS}
                    onValueChange={(v) =>
                      trocar(() => setChangeSetId(v === TODAS ? null : v))
                    }
                  >
                    <SelectTrigger className="h-9 w-72 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODAS}>Todas as vigências</SelectItem>
                      {porVigencia.map((v) => (
                        <SelectItem key={v.changeSetId} value={v.changeSetId}>
                          {nomeDaVigencia.get(v.changeSetId) ?? v.changeSetId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="space-y-1">
                  <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                    Tipo de ativo
                  </span>
                  <Select
                    value={tipo ?? TODOS_OS_TIPOS}
                    onValueChange={(v) =>
                      trocar(() => setTipo(v === TODOS_OS_TIPOS ? null : v))
                    }
                  >
                    <SelectTrigger className="h-9 w-44 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODOS_OS_TIPOS}>Todos</SelectItem>
                      {barras.map((barra) => (
                        <SelectItem key={barra.tipo} value={barra.tipo}>
                          {barra.rotulo}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="space-y-1">
                  <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                    Impacto
                  </span>
                  <Select
                    value={direcao}
                    onValueChange={(v) => trocar(() => setDirecao(v as DirecaoDoImpacto))}
                  >
                    <SelectTrigger className="h-9 w-44 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TODAS">Todos</SelectItem>
                      <SelectItem value="AUMENTO">Aumento</SelectItem>
                      <SelectItem value="REDUCAO">Redução</SelectItem>
                    </SelectContent>
                  </Select>
                </label>

                <label className="space-y-1">
                  <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                    Responsável
                  </span>
                  <Select
                    value={autor ?? TODOS_OS_RESPONSAVEIS}
                    onValueChange={(v) =>
                      trocar(() => setAutor(v === TODOS_OS_RESPONSAVEIS ? null : v))
                    }
                    /* Uma pendência não tem quem a tenha escrito: sobre elas o
                       filtro não recorta nada e esvaziaria a lista sempre. */
                    disabled={situacao !== "JUSTIFICADA" || responsaveis.length === 0}
                  >
                    <SelectTrigger className="h-9 w-56 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODOS_OS_RESPONSAVEIS}>Todos</SelectItem>
                      {responsaveis.map((r) => (
                        <SelectItem key={r.criadoPor} value={r.criadoPor}>
                          {r.criadoPor} ({r.justificadas.toLocaleString("pt-BR")})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                {temFiltro && (
                  <Button variant="ghost" size="sm" className="h-9" onClick={limparFiltros}>
                    <RotateCcw className="w-4 h-4" />
                    Limpar filtros
                  </Button>
                )}
              </div>
            </section>

            <section className="bg-card border rounded-xl shadow-sm overflow-hidden">
              <div className="px-4 pt-3">
                <Tabs
                  value={situacao}
                  onValueChange={(v) =>
                    trocar(() => setSituacao(v as SituacaoDaJustificativa))
                  }
                >
                  <TabsList>
                    <TabsTrigger value="PENDENTE">
                      Pendentes de justificativa
                      <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
                        {resumo.pendentes.toLocaleString("pt-BR")}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="JUSTIFICADA">
                      Justificadas
                      <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
                        {resumo.justificadas.toLocaleString("pt-BR")}
                      </span>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {selecionadas.size > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/50 px-4 py-2.5 mt-3">
                  <p className="text-sm">
                    {selecionadas.size.toLocaleString("pt-BR")}{" "}
                    {selecionadas.size === 1 ? "alteração selecionada" : "alterações selecionadas"}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setSelecionadas(new Set())}>
                      Limpar seleção
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        setDialogAlvo(lista.linhas.filter((l) => selecionadas.has(l.changeId)))
                      }
                    >
                      Justificar selecionadas
                    </Button>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto mt-3">
                <table className="w-full text-sm">
                  <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="w-10 px-4 py-2.5">
                        <Checkbox
                          checked={todasDaPagina}
                          onCheckedChange={alternarPagina}
                          aria-label="Selecionar a página"
                          disabled={lista.linhas.length === 0}
                        />
                      </th>
                      <th className="px-3 py-2.5 text-left font-semibold">Placa</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Atributo</th>
                      <th className="px-3 py-2.5 text-left font-semibold">De → Para</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Vigência</th>
                      <th className="px-3 py-2.5 text-left font-semibold">
                        {situacao === "PENDENTE" ? "Situação" : "Justificativa"}
                      </th>
                      <th className="px-3 py-2.5 text-left font-semibold">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.consulta.isPending &&
                      Array.from({ length: 3 }).map((_, i) => (
                        <tr key={`esqueleto-${i}`} className="border-b">
                          <td colSpan={7} className="px-4 py-3">
                            <Skeleton className="h-5 w-full" />
                          </td>
                        </tr>
                      ))}

                    {!lista.consulta.isPending && lista.linhas.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                          {situacao === "PENDENTE"
                            ? "Nenhuma pendência neste recorte — tudo o que mudou aqui já está justificado."
                            : "Nenhuma justificativa escrita neste recorte ainda."}
                        </td>
                      </tr>
                    )}

                    {lista.linhas.map((linha) => {
                      const sentido = direcaoDaLinha(linha);
                      return (
                        <tr key={linha.changeId} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3 align-top">
                            <Checkbox
                              checked={selecionadas.has(linha.changeId)}
                              onCheckedChange={() => alternar(linha.changeId)}
                              aria-label={`Selecionar ${linha.entityLabel}`}
                            />
                          </td>
                          <td className="px-3 py-3 align-top">
                            <p className="font-mono font-semibold">{linha.entityLabel}</p>
                            {linha.entityType && (
                              <p className="text-xs text-muted-foreground">
                                {rotuloDoTipo(linha.entityType)}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top">
                            {linha.attributeName ?? linha.attributeCode ?? "—"}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <span className="inline-flex items-center gap-1.5 tabular-nums">
                              <span className="text-muted-foreground line-through decoration-muted-foreground/40">
                                {linha.valueBefore ?? "—"}
                              </span>
                              <span aria-hidden>→</span>
                              <span className="font-medium">{linha.valueAfter ?? "—"}</span>
                              {sentido === "AUMENTO" && (
                                <ArrowUpRight className="w-4 h-4 text-rose-600" aria-label="aumento" />
                              )}
                              {sentido === "REDUCAO" && (
                                <ArrowDownRight
                                  className="w-4 h-4 text-emerald-600"
                                  aria-label="redução"
                                />
                              )}
                            </span>
                          </td>
                          <td className="px-3 py-3 align-top text-muted-foreground">
                            {nomeDaVigencia.get(linha.changeSetId) ?? "—"}
                          </td>
                          <td className="px-3 py-3 align-top max-w-md">
                            {linha.texto === null ? (
                              <Badge
                                variant="outline"
                                className="border-amber-300 bg-amber-50 text-amber-800"
                              >
                                Pendente
                              </Badge>
                            ) : (
                              <div className="space-y-1">
                                <p className="whitespace-pre-wrap">{linha.texto}</p>
                                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
                                    {iniciaisDoResponsavel(linha.criadoPor ?? "")}
                                  </span>
                                  {linha.criadoPor} ·{" "}
                                  {linha.criadoEm
                                    ? new Date(linha.criadoEm).toLocaleString("pt-BR")
                                    : "—"}
                                </p>
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="flex items-center gap-1.5">
                              <Button variant="outline" size="sm" onClick={() => setDialogAlvo([linha])}>
                                {linha.texto === null ? "Justificar" : "Reescrever"}
                              </Button>
                              {/* A fila é onde o trabalho continua: a placa inteira,
                                  com as outras alterações dela ao lado. */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  navegar(
                                    `/justificativas/placa/${encodeURIComponent(linha.entityLabel)}?changeSetId=${linha.changeSetId}`,
                                  )
                                }
                              >
                                Abrir placa
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {lista.total > 0 && (
                <Paginacao
                  pagina={pagina}
                  porPagina={porPagina}
                  total={lista.total}
                  onPagina={setPagina}
                  onPorPagina={(n) => {
                    setPorPagina(n);
                    setPagina(1);
                  }}
                  tamanhos={[10, 25, 50, 100]}
                  unidade={situacao === "PENDENTE" ? "pendências" : "justificativas"}
                />
              )}
            </section>

            <section className="bg-card border rounded-xl shadow-sm px-6 py-5">
              <h2 className="text-lg font-bold">Quem justificou</h2>
              {responsaveis.length === 0 ? (
                <p className="text-sm text-muted-foreground mt-1">
                  Nenhuma justificativa escrita neste recorte ainda.
                </p>
              ) : (
                <ul className="mt-3 divide-y">
                  {responsaveis.map((r) => (
                    <li key={r.criadoPor} className="flex items-center justify-between gap-3 py-2">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                          {iniciaisDoResponsavel(r.criadoPor)}
                        </span>
                        <span className="truncate">{r.criadoPor}</span>
                      </span>
                      <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                        {r.justificadas.toLocaleString("pt-BR")}{" "}
                        {r.justificadas === 1 ? "alteração" : "alterações"} · última em{" "}
                        {new Date(r.ultimaEm).toLocaleDateString("pt-BR")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="bg-card border rounded-xl shadow-sm overflow-hidden">
              <div className="px-6 py-4">
                <h2 className="text-lg font-bold">Cobertura por vigência</h2>
                <p className="text-sm text-muted-foreground">
                  Da mais pendente para a menos — é a linha com pendência que se abre.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-semibold">Vigência</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Alterações</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Justificadas</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Falta</th>
                      <th className="px-3 py-2.5 text-left font-semibold w-56">Cobertura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porVigencia.map((v) => (
                      <tr
                        key={v.changeSetId}
                        className={cn(
                          "border-b last:border-0 cursor-pointer hover:bg-muted/30",
                          changeSetId === v.changeSetId && "bg-muted/50",
                        )}
                        onClick={() =>
                          trocar(() =>
                            setChangeSetId(changeSetId === v.changeSetId ? null : v.changeSetId),
                          )
                        }
                      >
                        <td className="px-4 py-3">
                          {nomeDaVigencia.get(v.changeSetId) ?? v.changeSetId}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {v.alteracoes.toLocaleString("pt-BR")}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-emerald-700">
                          {v.justificadas.toLocaleString("pt-BR")}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-amber-700">
                          {v.pendentes.toLocaleString("pt-BR")}
                        </td>
                        <td className="px-3 py-3">
                          <span className="flex items-center gap-2">
                            <Progress value={v.cobertura} className="h-2 flex-1" />
                            <span className="text-xs tabular-nums text-muted-foreground w-14 text-right">
                              {pct(v.cobertura)}
                            </span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>

      <JustificarDialog
        alvo={
          dialogAlvo?.map((l) => ({
            id: l.changeId,
            entityLabel: l.entityLabel,
            attributeCode: l.attributeCode,
            attributeName: l.attributeName,
          })) ?? null
        }
        contexto={
          dialogAlvo && dialogAlvo.length > 0
            ? `vigência ${nomeDaVigencia.get(dialogAlvo[0].changeSetId) ?? ""}`.trim()
            : undefined
        }
        justificativaAtual={
          dialogAlvo?.length === 1 && dialogAlvo[0].texto !== null
            ? {
                id: String(dialogAlvo[0].changeId),
                changeSetId: dialogAlvo[0].changeSetId,
                changeId: dialogAlvo[0].changeId,
                entityLabel: dialogAlvo[0].entityLabel,
                entityType: dialogAlvo[0].entityType,
                texto: dialogAlvo[0].texto ?? "",
                criadoPor: dialogAlvo[0].criadoPor ?? "",
                criadoEm: dialogAlvo[0].criadoEm ?? "",
              }
            : null
        }
        pendente={justificar.isPending}
        erro={justificar.error}
        onClose={() => setDialogAlvo(null)}
        onConfirmar={(texto) =>
          dialogAlvo && justificar.mutate({ linhas: dialogAlvo, texto })
        }
      />
    </Layout>
  );
}
