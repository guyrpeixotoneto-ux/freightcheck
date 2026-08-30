import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  FileCheck2,
  RotateCcw,
  Layers,
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
import { AbaBotao } from "@/components/changes/cartoes";
import { JustificarDialog } from "@/components/justificativas/justificar-dialog";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { useAmbiente } from "@/lib/ambiente-aberto";
import { contextoAberto, useContextosDaCasca } from "@/lib/contextos";
import {
  contracaoDoTipo,
  equipamentosDoAmbiente,
  palavrasDoTipo,
  rotuloDoTipo,
} from "@/lib/frota";
import { formatNumber } from "@/lib/format";
import { nomeDaUnidade } from "@/lib/recorte";
import {
  opcoesDeVigencia,
  useComparacoes,
  type Justificativa,
} from "@/lib/justificativas";
import {
  direcaoDaLinha,
  enderecoDasLinhas,
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
 *
 * ---------------------------------------------------------------------------
 * A fileira de abas
 * ---------------------------------------------------------------------------
 * **Geral** é o painel inteiro — a frota toda somada, com o tipo de ativo entre
 * os filtros, onde ele sempre esteve. Ao lado dela, **uma aba por tipo de
 * ativo** (Cavalo, Carreta, Trecho na empurrada; a lista é do ambiente aberto —
 * ver `EQUIPAMENTOS_DO_AMBIENTE`): o mesmo painel com o tipo promovido de filtro
 * a **população**. Na aba de um tipo, a caixa "Tipo de ativo" sai do lugar,
 * porque dois controles para o mesmo eixo é o caminho curto para a tela
 * discordar de si mesma.
 *
 * Uma aba por tipo, e não uma aba "por tipo" com pastilhas dentro: o segundo
 * desenho durou um dia e pedia dois cliques e duas leituras para responder à
 * pergunta que uma aba responde com um — e a pastilha dizia, sem querer, que o
 * tipo era um ajuste *dentro* de uma leitura, quando ele é a leitura.
 *
 * Nada é recontado por causa disso. O tipo já atravessava a leitura inteira —
 * `resumoDoPainel`, `vigenciasDoPainel` e a lista recebem todos o mesmo `tipo`,
 * e é por isso que a aba não precisou de conta nova nem de rota nova: ela é uma
 * escolha diferente sobre a mesma máquina, e não uma segunda máquina.
 *
 * O cartão "Pendências por tipo de ativo" continua atravessando os tipos em
 * todas as abas, e é de propósito: ele é o único lugar da tela que compara um tipo
 * com o outro, o título diz isso, e na aba de tipo é ele que mostra o tamanho
 * relativo da fila que se escolheu. As barras seguem clicáveis — numa aba de
 * tipo elas levam para a aba de outro.
 */

/* O endereço desta tela — o mesmo que `App.tsx` registra. A aba e o tipo são
   escritos nele, e trocá-los é navegar para cá de novo com outra pergunta. */
const PAINEL_DE_JUSTIFICATIVAS = "/painel-de-justificativas";

const TODAS = "__todas__";
const TODOS_OS_TIPOS = "__todos__";
const TODOS_OS_RESPONSAVEIS = "__todos_responsaveis__";
const TODAS_AS_UNIDADES = "__todas_unidades__";

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
  const search = useSearch();

  const comparacoes = useComparacoes();
  const contextos = useContextosDaCasca();

  /*
    A unidade aberta é a da lateral: a que a URL pede em `scopeHash`, e a
    primeira de `/contexts` quando ninguém pediu — a mesma regra da fila
    (`pages/justificativas.tsx`) e da caixa "Unidade atual". Sem este recorte o
    painel somava a operação inteira sob a lateral escrita PERNAMBUCO: os
    cartões traziam CAMAÇARI e MANAUS no mesmo total, e a lista abria placas de
    uma unidade que não é a aberta. `visaoGeral=1` é a escolha de somar todas —
    a leitura de antes, agora pedida e não presumida.
  */
  const params = new URLSearchParams(search);
  const emVisaoGeral = params.get("visaoGeral") === "1";
  const escopoAberto = emVisaoGeral
    ? null
    : (contextoAberto(contextos.contextos, params.get("scopeHash"))?.scopeHash ?? null);

  const [unidadeEscolhida, setUnidadeEscolhida] = useState<string | null>(null);

  /*
    Na Visão Geral o painel atravessa as unidades — e sem um filtro por unidade
    a única forma de isolar uma seria trocar a lateral, que é sair da Visão
    Geral. O filtro é o mesmo recorte da lateral por outra porta: escolher uma
    unidade aqui manda o mesmo `scopeHash` às duas consultas, sem trocar de
    tela. Com uma unidade aberta na lateral ele não existe — o recorte já é
    dela, e a caixa só ofereceria a escolha que a lateral já fez.
  */
  const escopoDaConsulta = emVisaoGeral ? unidadeEscolhida : escopoAberto;

  const { cobertura, autores, consulta } = usePainelDeJustificativas(escopoDaConsulta);

  /*
    As unidades que a caixa oferece: as que têm comparação calculada, e não as
    de `/contexts` inteiras — oferecer uma unidade sem vigência comparada seria
    prometer um recorte que abre vazio.
  */
  const unidades = useMemo(() => {
    const comComparacao = new Set(
      (comparacoes.data ?? []).map((c) => c.scopeHash).filter((h): h is string => !!h),
    );
    return contextos.contextos
      .filter((c) => comComparacao.has(c.scopeHash))
      .map((c) => ({ scopeHash: c.scopeHash, nome: nomeDaUnidade(c) }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [comparacoes.data, contextos.contextos]);

  /* Qual unidade os números são — dito no cabeçalho, e não deduzido da caixa
     da lateral. Vale para a unidade da lateral e para a escolhida no filtro:
     as duas recortam o mesmo `escopoDaConsulta`. Ver o mesmo cuidado em
     `pages/dados.tsx`. */
  const unidadeDoRecorte = useMemo(() => {
    if (escopoDaConsulta === null) return null;
    const contexto = contextos.contextos.find((c) => c.scopeHash === escopoDaConsulta);
    return contexto ? nomeDaUnidade(contexto) : null;
  }, [contextos.contextos, escopoDaConsulta]);

  /*
    O recorte de unidade viaja em todo link que sai desta tela: abrir a placa
    numa unidade e voltar precisa reencontrar a mesma lateral, e um endereço
    montado do zero devolveria à unidade padrão no meio do trabalho. É a mesma
    função `endereco` da fila.
  */
  const recorteDoEndereco = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const chave of ["scopeHash", "canal", "visaoGeral"]) {
      const valor = params.get(chave);
      if (valor) q.set(chave, valor);
    }
    for (const [chave, valor] of Object.entries(extra)) q.set(chave, valor);
    return q.toString();
  };

  /*
    Os filtros vivem em estado, e não no endereço como os da fila. A fila é
    ponto de partida de um trabalho que continua noutra tela — abrir a placa e
    voltar precisa reencontrar a mesma aba —; o painel é leitura, e o que dele
    se leva adiante é o link para a fila, que o botão de cada linha monta.
  */
  const [vigenciaEscolhida, setVigenciaEscolhida] = useState<string | null>(null);
  const [tipoFiltrado, setTipoFiltrado] = useState<string | null>(null);
  const [direcao, setDirecao] = useState<DirecaoDoImpacto>("TODAS");
  const [autor, setAutor] = useState<string | null>(null);
  const [situacao, setSituacao] = useState<SituacaoDaJustificativa>("PENDENTE");
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [dialogAlvo, setDialogAlvo] = useState<LinhaDoPainel[] | null>(null);
  const [exportando, setExportando] = useState(false);

  /*
    Trocar de unidade na lateral não desfaz o filtro de vigência, e a vigência
    de CAMAÇARI não existe no recorte de PERNAMBUCO: honrá-la deixaria a tela
    dizendo "nada a justificar" sobre um recorte que não é de ninguém. Enquanto
    a cobertura não chegou, a escolha vale — não há como saber ainda.
  */
  /*
    Qual aba — e a aba **é** o tipo.

    Uma fileira só: Geral, e um tipo por aba ao lado dela. Ela mora no endereço,
    e os filtros logo acima não: a diferença é que uma aba não é um recorte da
    leitura, é **qual leitura** se está fazendo. É o que alguém cola num chat
    ("olha a fila do trecho"), e é o que a Linha do Tempo escreve no endereço
    pela mesma razão. Os filtros continuam em estado, pelo motivo escrito acima
    deles.

    Sobra **um** parâmetro, e não dois: sem `?tipo=` é a Geral. Um `?aba=` a
    mais em todo link seria ruído que não muda nada — e um segundo parâmetro é
    uma segunda chance de os dois discordarem.

    `?tipo=` que não seja um equipamento **deste ambiente** cai na Geral, e não
    numa aba de tipo escolhida por nós: trocar em silêncio a leitura que a
    pessoa pediu é pior do que devolvê-la ao começo. Mesma régua de
    `equipamentoValido` nas telas 360°.
  */
  const equipamentos = equipamentosDoAmbiente(ambiente);
  const pedido = params.get("tipo");
  const tipoDaAba =
    pedido !== null && (equipamentos as readonly string[]).includes(pedido)
      ? pedido
      : null;
  const porTipo = tipoDaAba !== null;

  /*
    O tipo que a leitura inteira usa. Na aba Geral é o filtro (nulo = todos); na
    aba de um tipo é a população, e é ela que manda.
  */
  const tipo = porTipo ? tipoDaAba : tipoFiltrado;

  const irPara = (mudancas: Record<string, string | null>) => {
    const proxima = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null) proxima.delete(chave);
      else proxima.set(chave, valor);
    }
    const texto = proxima.toString();
    navegar(texto ? `${PAINEL_DE_JUSTIFICATIVAS}?${texto}` : PAINEL_DE_JUSTIFICATIVAS);
  };

  const changeSetId =
    vigenciaEscolhida === null ||
    cobertura === null ||
    cobertura.some((l) => l.changeSetId === vigenciaEscolhida)
      ? vigenciaEscolhida
      : null;

  const resumo = resumoDoPainel(cobertura, changeSetId, tipo);
  const barras = useMemo(
    () => pendenciasPorTipo(cobertura, changeSetId, equipamentos),
    // `equipamentos` sai de `ambiente` e é estável enquanto ele não muda.
    [cobertura, changeSetId, ambiente],
  );
  const porVigencia = useMemo(() => vigenciasDoPainel(cobertura, tipo), [cobertura, tipo]);
  const responsaveis = useMemo(
    () => responsaveisDoPainel(autores, changeSetId),
    [autores, changeSetId],
  );

  /*
    O nome de cada vigência — a mesma régua do seletor da fila, e a mesma regra
    para a unidade: ela só entra quando a lista atravessa unidades. Dentro de
    uma, o nome repetiria em toda linha do menu, em toda linha da tabela e no
    título do diálogo a mesma palavra que a lateral e o cabeçalho já dizem,
    empurrando a data para longe do que se está comparando.
  */
  const nomeDaVigencia = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const o of opcoesDeVigencia(comparacoes.data ?? [], contextos.contextos)) {
      nomes.set(
        o.id,
        escopoDaConsulta === null && o.unidade ? `${o.competencia} · ${o.unidade}` : o.competencia,
      );
    }
    return nomes;
  }, [comparacoes.data, contextos.contextos, escopoDaConsulta]);

  /*
    No CSV a unidade fica sempre. O arquivo sai da tela e é aberto sem a
    lateral que diz de qual unidade ele é — e duas exportações de unidades
    diferentes, com a mesma competência, ficariam indistinguíveis na mesa de
    quem as recebe.
  */
  const nomeDaVigenciaNoArquivo = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const o of opcoesDeVigencia(comparacoes.data ?? [], contextos.contextos)) {
      nomes.set(o.id, o.unidade ? `${o.competencia} · ${o.unidade}` : o.competencia);
    }
    return nomes;
  }, [comparacoes.data, contextos.contextos]);

  const recorte = {
    escopo: escopoDaConsulta,
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
      setUnidadeEscolhida(null);
      setVigenciaEscolhida(null);
      // Na aba de tipo o tipo não é filtro a limpar: é a população da aba.
      setTipoFiltrado(null);
      setDirecao("TODAS");
      setAutor(null);
    });

  const temFiltro =
    changeSetId !== null ||
    tipoFiltrado !== null ||
    direcao !== "TODAS" ||
    autor !== null ||
    unidadeEscolhida !== null;

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
        /* O mesmo endereço da lista em tela — inclusive a unidade aberta:
           exportar não pode trazer o que a tela não mostra. */
        const pagina = await fetchJson<{ total: number; linhas: LinhaDoPainel[] }>(
          enderecoDasLinhas({
            ...recorte,
            pagina: offset / passo + 1,
            porPagina: passo,
          }),
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
            aspas(nomeDaVigenciaNoArquivo.get(l.changeSetId) ?? l.changeSetId),
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
                e a seguinte, e a explicação que o gestor deve a cada uma
                {unidadeDoRecorte
                  ? `, em ${unidadeDoRecorte}`
                  : emVisaoGeral
                    ? ", somando todas as unidades"
                    : ""}
                .
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

      <div className="px-8 border-b max-w-[1400px]">
        <nav className="flex flex-wrap items-center gap-1" role="tablist">
          <AbaBotao
            active={!porTipo}
            onClick={() => trocar(() => irPara({ tipo: null }))}
            icon={<Layers className="w-4 h-4" />}
            label="Geral"
            hint="a frota inteira, com o tipo de ativo entre os filtros"
          />
          {equipamentos.map((codigo) => (
            <AbaBotao
              key={codigo}
              active={codigo === tipoDaAba}
              onClick={() => trocar(() => irPara({ tipo: codigo }))}
              label={rotuloDoTipo(codigo)}
              hint={`o mesmo painel, só ${contracaoDoTipo(codigo, "de")} ${palavrasDoTipo(codigo).plural}`}
            />
          ))}
        </nav>
      </div>

      <div className="px-8 pb-10 space-y-4 max-w-[1400px] pt-4">
        {porTipo && tipo !== null && (
          <p className="text-sm text-muted-foreground">
            Tudo abaixo — os cartões, a cobertura e a fila — fala só{" "}
            {contracaoDoTipo(tipo, "de")} {palavrasDoTipo(tipo).plural}.
          </p>
        )}

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
            <p className="text-lg font-bold">
              {porTipo && tipo !== null
                ? `Nada a justificar ${contracaoDoTipo(tipo, "em")} ${palavrasDoTipo(tipo).plural} deste recorte.`
                : "Nada a justificar neste recorte."}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {/*
                Na aba de tipo há uma terceira causa possível, e a tela não sabe
                distinguir as três: pode não haver alteração, pode não haver
                comparação calculada, e pode aquele tipo não ter sido importado
                aqui. Dizê-las juntas é mais honesto do que escolher uma.
              */}
              Sem alteração por ativo nas comparações escolhidas, não há
              justificativa a cobrar
              {porTipo ? " — e pode ser que este tipo nem tenha sido importado neste recorte" : ""}
              . Abra a aba Alterações para calcular a comparação entre as
              vigências importadas.
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
                        onClick={() =>
                          trocar(() =>
                            porTipo
                              ? // Numa aba de tipo não existe "nenhum tipo": a
                                // barra leva para a aba daquele tipo.
                                irPara({ tipo: barra.tipo })
                              : setTipoFiltrado(barra.tipo === tipo ? null : barra.tipo),
                          )
                        }
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
                {/* Só na Visão Geral — ver `escopoDaConsulta`. */}
                {emVisaoGeral && unidades.length > 1 && (
                  <label className="space-y-1">
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                      Unidade
                    </span>
                    <Select
                      value={unidadeEscolhida ?? TODAS_AS_UNIDADES}
                      onValueChange={(v) =>
                        trocar(() =>
                          setUnidadeEscolhida(v === TODAS_AS_UNIDADES ? null : v),
                        )
                      }
                    >
                      <SelectTrigger className="h-9 w-60 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={TODAS_AS_UNIDADES}>Todas as unidades</SelectItem>
                        {unidades.map((u) => (
                          <SelectItem key={u.scopeHash} value={u.scopeHash}>
                            {u.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                )}

                <label className="space-y-1">
                  <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                    Vigência
                  </span>
                  <Select
                    value={changeSetId ?? TODAS}
                    onValueChange={(v) =>
                      trocar(() => setVigenciaEscolhida(v === TODAS ? null : v))
                    }
                  >
                    <SelectTrigger className="h-9 w-72 text-sm">
                      {/*
                        O rótulo do gatilho é escrito aqui, e não deixado a cargo
                        do texto do item, porque o item carrega a contagem: fechado,
                        o campo deve dizer só a vigência escolhida — a contagem
                        pertence à lista, onde serve para comparar uma linha com
                        as outras.
                      */}
                      <SelectValue>
                        {changeSetId === null
                          ? "Todas as vigências"
                          : (nomeDaVigencia.get(changeSetId) ?? changeSetId)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODAS}>Todas as vigências</SelectItem>
                      {porVigencia.map((v) => (
                        <SelectItem
                          key={v.changeSetId}
                          value={v.changeSetId}
                          className="[&>span:last-child]:flex-1"
                        >
                          <span className="flex w-full items-center justify-between gap-6">
                            <span>{nomeDaVigencia.get(v.changeSetId) ?? v.changeSetId}</span>
                            <span className="text-xs font-normal text-muted-foreground tabular-nums">
                              {formatNumber(v.alteracoes)}{" "}
                              {v.alteracoes === 1 ? "alteração" : "alterações"}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                {/*
                  Só na aba Geral. Na aba de tipo o eixo é a própria aba, e uma
                  segunda caixa para ele deixaria a tela com dois controles do
                  mesmo recorte — o caminho curto para ela discordar de si
                  mesma sobre de quem está falando.
                */}
                {!porTipo && (
                  <label className="space-y-1">
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                      Tipo de ativo
                    </span>
                    <Select
                      value={tipo ?? TODOS_OS_TIPOS}
                      onValueChange={(v) =>
                        trocar(() => setTipoFiltrado(v === TODOS_OS_TIPOS ? null : v))
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
                )}

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
                                    `/justificativas/placa/${encodeURIComponent(linha.entityLabel)}?${recorteDoEndereco({ changeSetId: linha.changeSetId })}`,
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
                            setVigenciaEscolhida(changeSetId === v.changeSetId ? null : v.changeSetId),
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
