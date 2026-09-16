import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  CalendarRange,
  CheckCircle2,
  CircleHelp,
  Clock,
  Download,
  FileCheck2,
  Fuel,
  Landmark,
  Lightbulb,
  ListChecks,
  Radar,
  RotateCcw,
  Truck,
  Users,
  WifiOff,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Layout } from "@/components/layout/layout";
import { CabecalhoDePagina } from "@/components/layout/cabecalho-de-pagina";
import { ApiErrorNotice } from "@/components/api-error";
import { Button } from "@/components/ui/button";
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
import { AbaBotao } from "@/components/changes/cartoes";
import {
  BOTAO_DE_TROCA,
  MenuDeVigencias,
} from "@/components/vigencia/seletor-de-vigencia";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { useAmbiente } from "@/lib/ambiente-aberto";
import { contextoAberto, useContextosDaCasca } from "@/lib/contextos";
import { contracaoDoTipo, palavrasDoTipo, rotuloDoTipo } from "@/lib/frota";
import { formatNumber } from "@/lib/format";
import { nomeDaUnidade } from "@/lib/recorte";
import { opcoesDeVigencia, useComparacoes } from "@/lib/justificativas";
import { tempoRelativo } from "@/lib/visao-geral";
import {
  enderecoDasLinhas,
  iniciaisDoResponsavel,
  modulosDoPainel,
  pendenciasPorTipo,
  responsaveisDoPainel,
  resumoDoPainel,
  rubricasDoPainel,
  tiposDoPainel,
  usePainelDeJustificativas,
  vigenciasDoPainel,
  type LinhaDoPainel,
  type VigenciaDoPainel,
} from "@/lib/painel-de-justificativas";
import {
  moduloDeJustificativa,
  rubricaDaAlteracao,
  type ChaveDeModulo,
} from "@workspace/comparison/modulos-de-justificativa";
import { escreverRubrica } from "@/lib/qlp-comparacao";
import { cn } from "@/lib/utils";

/**
 * Chamados — Monitor de Justificativas.
 *
 * ---------------------------------------------------------------------------
 * Por que esta tela deixou de justificar
 * ---------------------------------------------------------------------------
 * Ela nasceu como **Painel de Justificativas**, e fazia as duas coisas: somava
 * a cobertura no topo e, embaixo, trazia a lista de alterações pendentes com um
 * botão `Justificar` em cada linha. Fazia sentido enquanto justificar só
 * acontecia aqui e na fila.
 *
 * Não acontece mais. Cada rubrica do Custo Fixo, do Custo Variável e do QLP
 * justifica as próprias alterações, na tela em que o gestor já está vendo o
 * número que mudou — com o catálogo daquela rubrica ao lado e a fórmula dela na
 * frente. Uma nona porta de escrita, aqui, competiria com as oito: seria o
 * lugar onde se justifica **pior**, porque é o único que não sabe de que
 * rubrica está falando.
 *
 * O que sobra é o que nenhuma das telas de rubrica sabe responder, porque cada
 * uma vê só a própria: **quanto do que mudou já está explicado, e onde está o
 * que falta**. É a pergunta de quem cobra o trabalho, e é a única desta tela.
 * Tudo aqui é leitura, e toda ação é um link para a tela que grava.
 *
 * O que saiu: a lista por placa e o botão `Justificar`, o diálogo, a seleção, e
 * os filtros de impacto e de responsável — os dois recortavam a lista que saiu,
 * e não a cobertura. O cartão "Placas com pendência" virou "Rubricas com
 * pendência": a pergunta deste monitor é *quantas telas alguém precisa abrir*.
 * A contagem por placa não sumiu — ela é da leitura por tipo de ativo, e está
 * na aba dela.
 *
 * ---------------------------------------------------------------------------
 * As quatro leituras, e por que elas são abas
 * ---------------------------------------------------------------------------
 * A mesma cobertura, por quatro eixos: **por módulo** (onde está a pendência),
 * **por responsável** (quem escreveu o que já está escrito), **por vigência**
 * (se o atraso é de uma quinzena ou do acervo) e **por tipo de ativo** (a quem
 * mandar a fila). São perguntas diferentes sobre a mesma máquina — e nenhuma
 * delas pede consulta nova, porque a cobertura chega inteira de uma vez.
 *
 * Eram abas **por tipo de ativo** (Geral, Cavalo, Carreta), e o tipo desceu para
 * os filtros: ele é um recorte *dentro* da leitura, e não qual leitura se está
 * fazendo — e com o QLP entre os módulos, uma fileira de abas por tipo de ativo
 * deixaria de fora justamente a população que não tem placa. `?tipo=` continua
 * valendo no endereço, agora como filtro: um link antigo abre o mesmo recorte
 * que abria.
 *
 * **O endereço é o mesmo** (`/painel-de-justificativas`). O nome na lateral
 * mudou, a tela mudou, e o link que alguém colou num chat há três meses
 * continua abrindo a leitura de cobertura que ele prometia.
 *
 * ---------------------------------------------------------------------------
 * O que a tela não afirma
 * ---------------------------------------------------------------------------
 * **Prazo.** Nenhuma justificativa vence, porque nenhuma tem data para ser
 * escrita. Um cartão vermelho de "vencidos" seria número inventado.
 *
 * **Dono da pendência.** A coluna "Quem escreveu" diz quem justificou por
 * último naquela rubrica — não de quem é o que falta. O produto não tem
 * atribuição de responsável, e um nome ao lado de uma pendência afirmaria uma
 * que não existe. Pela mesma razão não há botão de cobrar: cobrar exige saber
 * de quem, e a tela não sabe.
 *
 * **Tendência.** O destaque ao lado do gráfico diz qual vigência tem menos
 * explicação e qual módulo puxa a conta dela para baixo — o que está no dado.
 * "A pendência é recente" seria uma leitura de duas colunas viradas em
 * afirmação sobre o trabalho.
 *
 * As contas moram em `lib/painel-de-justificativas.ts`, e o mapa de *qual
 * alteração é de qual módulo* em `@workspace/comparison/modulos-de-justificativa`
 * — o mesmo que o servidor usa para dobrar as contagens. Aqui fica o desenho.
 */

/* O endereço desta tela — o mesmo que `App.tsx` registra, e o mesmo de quando
   ela se chamava Painel. A aba e o tipo são escritos nele. */
const MONITOR_DE_JUSTIFICATIVAS = "/painel-de-justificativas";

const TODAS = "__todas__";
const TODOS_OS_TIPOS = "__todos__";
const TODOS_OS_MODULOS = "__todos_modulos__";
const TODAS_AS_UNIDADES = "__todas_unidades__";

const CORES = {
  justificadas: "hsl(152 64% 31%)",
  pendentes: "hsl(32 95% 54%)",
};

/** As quatro leituras. A primeira é a de partida, e não vai para o endereço. */
const ABAS = [
  { chave: "modulo", rotulo: "Por módulo", hint: "onde está a pendência" },
  {
    chave: "responsavel",
    rotulo: "Por responsável",
    hint: "quem escreveu o que já está escrito",
  },
  { chave: "vigencia", rotulo: "Por vigência", hint: "se o atraso é de uma quinzena ou do acervo" },
  {
    chave: "tipo",
    rotulo: "Por tipo de ativo",
    hint: "a quem mandar a fila — cavalo, carreta",
  },
] as const;

type Aba = (typeof ABAS)[number]["chave"];

/**
 * O selo e o ícone de cada módulo.
 *
 * A cor é a mesma nas duas leituras — a barra de "Cobertura por módulo" e o selo
 * da tabela —, e é ela que permite descer de uma para a outra sem reler o nome.
 */
const DESENHO_DO_MODULO: Record<
  ChaveDeModulo,
  { icone: typeof Landmark; selo: string; fundo: string; tinta: string }
> = {
  CUSTO_FIXO: {
    icone: Landmark,
    selo: "bg-sky-50 text-sky-700",
    fundo: "bg-sky-50",
    tinta: "text-sky-700",
  },
  CUSTO_VARIAVEL: {
    icone: Fuel,
    selo: "bg-emerald-50 text-emerald-700",
    fundo: "bg-emerald-50",
    tinta: "text-emerald-700",
  },
  QLP: {
    icone: Users,
    selo: "bg-amber-50 text-amber-800",
    fundo: "bg-amber-50",
    tinta: "text-amber-700",
  },
  SEM_CLASSE: {
    icone: CircleHelp,
    selo: "bg-muted text-muted-foreground",
    fundo: "bg-muted",
    tinta: "text-muted-foreground",
  },
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
    <section className="superficie px-5 py-4">
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

/**
 * A barra de duas cores — o que está explicado e o que falta, na mesma régua.
 *
 * Duas cores, e não uma sobre um trilho cinza: o trilho diria "o resto" sem
 * dizer que o resto é trabalho de alguém. O laranja é o mesmo do cartão "Falta
 * justificar", e o verde o mesmo do "Justificadas".
 */
function BarraDaCobertura({ cobertura }: { cobertura: number }) {
  return (
    <span className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
      <span
        className="block h-full"
        style={{ width: `${cobertura}%`, background: CORES.justificadas }}
      />
      <span
        className="block h-full"
        style={{ width: `${100 - cobertura}%`, background: CORES.pendentes }}
      />
    </span>
  );
}

/** A rubrica de uma alteração do CSV — o mesmo mapa que a tabela usa. */
function rubricaDaLinha(linha: LinhaDoPainel): { modulo: ChaveDeModulo; rotulo: string } {
  const rubrica = rubricaDaAlteracao(linha);
  return {
    modulo: rubrica.modulo,
    /* O nome da rubrica do QLP é escrito aqui, como na tabela — o pacote de
       comparação devolve a chave crua de propósito. */
    rotulo: rubrica.rubricaDoQlp ? escreverRubrica(rubrica.rubricaDoQlp) : rubrica.rotulo,
  };
}

export default function MonitorDeJustificativas() {
  const ambiente = useAmbiente();
  const [, navegar] = useLocation();
  const search = useSearch();

  const comparacoes = useComparacoes();
  const contextos = useContextosDaCasca();

  /*
    A unidade aberta é a da lateral: a que a URL pede em `scopeHash`, e a
    primeira de `/contexts` quando ninguém pediu — a mesma regra da fila
    (`pages/justificativas.tsx`). Sem este recorte o monitor somaria a operação
    inteira sob a lateral escrita PERNAMBUCO. `visaoGeral=1` é a escolha de
    somar todas — pedida, e não presumida.
  */
  const params = new URLSearchParams(search);
  const emVisaoGeral = params.get("visaoGeral") === "1";
  const escopoAberto = emVisaoGeral
    ? null
    : (contextoAberto(contextos.contextos, params.get("scopeHash"))?.scopeHash ?? null);

  const [unidadeEscolhida, setUnidadeEscolhida] = useState<string | null>(null);

  /*
    Na Visão Geral o monitor atravessa as unidades — e sem um filtro por unidade
    a única forma de isolar uma seria trocar a lateral, que é sair da Visão
    Geral. Com uma unidade aberta na lateral ele não existe: o recorte já é
    dela, e a caixa só ofereceria a escolha que a lateral já fez.
  */
  const escopoDaConsulta = emVisaoGeral ? unidadeEscolhida : escopoAberto;

  const { cobertura, autores, rubricas, consulta } =
    usePainelDeJustificativas(escopoDaConsulta);

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
     da lateral. Ver o mesmo cuidado em `pages/dados.tsx`. */
  const unidadeDoRecorte = useMemo(() => {
    if (escopoDaConsulta === null) return null;
    const contexto = contextos.contextos.find((c) => c.scopeHash === escopoDaConsulta);
    return contexto ? nomeDaUnidade(contexto) : null;
  }, [contextos.contextos, escopoDaConsulta]);

  /*
    O recorte de unidade viaja em todo link que sai desta tela: abrir a rubrica
    numa unidade e voltar precisa reencontrar a mesma lateral, e um endereço
    montado do zero devolveria à unidade padrão no meio do trabalho.
  */
  const recorteDoEndereco = (extra: Record<string, string> = {}) => {
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
    voltar precisa reencontrar a mesma aba —; o monitor é leitura, e o que dele
    se leva adiante é o link da rubrica, que o botão de cada linha monta.

    A vigência está na mesma lista por isso, e não por ser filtro: ela é o
    recorte que o botão do cabeçalho troca, e `null` — todas as vigências
    somadas — é o estado de partida.
  */
  const [vigenciaEscolhida, setVigenciaEscolhida] = useState<string | null>(null);
  const [moduloFiltrado, setModuloFiltrado] = useState<ChaveDeModulo | null>(null);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);
  const [exportando, setExportando] = useState(false);

  /*
    A aba é **qual leitura** se está fazendo, e por isso mora no endereço: é o
    que alguém cola num chat ("olha a cobertura por vigência"). `?aba=` que não
    seja uma das quatro cai na primeira, e não numa escolhida por nós — a mesma
    régua de `?tipo=`.
  */
  const abaPedida = params.get("aba");
  const aba: Aba =
    (ABAS.find((a) => a.chave === abaPedida)?.chave as Aba | undefined) ?? "modulo";

  /*
    O tipo de ativo é filtro, e continua lido do endereço: ele era a aba, e um
    link antigo (`?tipo=CAVALO`) abre hoje o mesmo recorte que abria — só que
    numa tela que também sabe falar de QLP, que não tem placa.
  */
  const equipamentos = tiposDoPainel(ambiente);
  const pedido = params.get("tipo");
  const tipo =
    pedido !== null && (equipamentos as readonly string[]).includes(pedido) ? pedido : null;

  const irPara = (mudancas: Record<string, string | null>) => {
    const proxima = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null) proxima.delete(chave);
      else proxima.set(chave, valor);
    }
    const texto = proxima.toString();
    navegar(texto ? `${MONITOR_DE_JUSTIFICATIVAS}?${texto}` : MONITOR_DE_JUSTIFICATIVAS);
  };

  /*
    Trocar qualquer recorte volta a tabela para a primeira página: a página 4 de
    uma lista que encolheu não existe, e é a mesma razão da troca de aba na fila.
  */
  const trocar = (mudanca: () => void) => {
    mudanca();
    setPagina(1);
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

  const modulos = useMemo(
    () => modulosDoPainel(rubricas, changeSetId, tipo),
    [rubricas, changeSetId, tipo],
  );
  /* A tabela obedece ao filtro de módulo; os cartões e as barras, não — eles
     são o total do recorte, e é contra eles que a tabela se confere. */
  const linhasDeRubrica = useMemo(
    () => rubricasDoPainel(rubricas, changeSetId, tipo, moduloFiltrado),
    [rubricas, changeSetId, tipo, moduloFiltrado],
  );
  /* A tabela é paginada em tela, e não no servidor: a cobertura por rubrica já
     está inteira em mãos — são dezenas de linhas, não milhares —, e uma ida ao
     banco por página daria a mesma resposta por N vezes o custo. */
  const paginaDeRubricas = useMemo(
    () => linhasDeRubrica.slice((pagina - 1) * porPagina, pagina * porPagina),
    [linhasDeRubrica, pagina, porPagina],
  );
  /* O quarto cartão: quantas telas alguém precisa abrir para zerar a fila —
     sempre do recorte inteiro, e não do módulo filtrado. */
  const rubricasPendentes = useMemo(
    () => rubricasDoPainel(rubricas, changeSetId, tipo).filter((r) => r.pendentes > 0).length,
    [rubricas, changeSetId, tipo],
  );

  /* A contagem da linha "Todas as vigências" do menu. Alterações somam entre
     vigências — é o mesmo número do cartão "Alterações no recorte". */
  const totalDeAlteracoes = useMemo(
    () => porVigencia.reduce((soma, v) => soma + v.alteracoes, 0),
    [porVigencia],
  );

  /* Qual vigência a linha do cabeçalho nomeia. É a escolhida; e, quando o
     recorte tem uma só, é ela — "todas as vigências" e aquela vigência são o
     mesmo conjunto, e o nome diz mais do que a palavra "todas". */
  const vigenciaEscrita =
    changeSetId ?? (porVigencia.length === 1 ? porVigencia[0].changeSetId : null);

  const responsaveis = useMemo(
    () => responsaveisDoPainel(autores, changeSetId),
    [autores, changeSetId],
  );

  /*
    O nome de cada vigência — a mesma régua do seletor da fila, e a mesma regra
    para a unidade: ela só entra quando a lista atravessa unidades.
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
    O rótulo curto da coluna do gráfico — `jul/26 · 2ª qz`.

    O nome inteiro ("julho/2026 · 2ª quinzena") é o da tabela e o do menu, onde
    ele tem uma linha só para ele. Debaixo de uma coluna de doze, ele empurra a
    vizinha para fora do cartão — foi o que aconteceu no primeiro desenho, e o
    gráfico saiu pela direita.
  */
  const rotuloCurtoDaVigencia = useMemo(() => {
    const curtos = new Map<string, string>();
    for (const o of opcoesDeVigencia(comparacoes.data ?? [], contextos.contextos)) {
      const [mes, ano] = o.mes.split("/");
      const abreviado = ano ? `${mes.slice(0, 3)}/${ano.slice(-2)}` : o.mes;
      curtos.set(o.id, o.marca ? `${abreviado} · ${o.marca.replace("quinzena", "qz")}` : abreviado);
    }
    return curtos;
  }, [comparacoes.data, contextos.contextos]);

  /*
    A data de cada comparação — é ela que põe as colunas do gráfico em ordem.

    O gráfico é o único lugar da tela que lê a vigência pelo **tempo**: as
    tabelas ordenam por pendência, porque servem para achar por onde começar, e
    uma série temporal fora de ordem cronológica não é uma série — é uma lista
    com um eixo desenhado por cima.
  */
  const dataDaVigencia = useMemo(() => {
    const datas = new Map<string, string>();
    for (const c of comparacoes.data ?? []) datas.set(c.id, c.snapshotBDate.slice(0, 10));
    return datas;
  }, [comparacoes.data]);

  /* As doze últimas, em ordem — mais do que isso vira uma fileira de fios num
     cartão desta largura, e a pergunta que o gráfico responde (o atraso é de
     uma quinzena ou do acervo?) já está nas últimas. */
  const serieDeVigencias: VigenciaDoPainel[] = useMemo(
    () =>
      [...porVigencia]
        .sort((a, b) =>
          (dataDaVigencia.get(a.changeSetId) ?? "").localeCompare(
            dataDaVigencia.get(b.changeSetId) ?? "",
          ),
        )
        .slice(-12),
    [porVigencia, dataDaVigencia],
  );

  /*
    O destaque ao lado do gráfico — a leitura que ele dá, escrita.

    Ele **não** interpreta tendência ("a pendência é recente"): duas colunas
    bastam para uma reta, e não para uma afirmação sobre o trabalho. Ele diz o
    que está no dado — qual vigência tem menos explicação, e qual módulo puxa a
    conta dela para baixo —, que é por onde se começa.
  */
  const destaque = useMemo(() => {
    const pior = [...porVigencia]
      .filter((v) => v.pendentes > 0)
      .sort((a, b) => a.cobertura - b.cobertura || b.pendentes - a.pendentes)[0];
    if (!pior) return null;
    const moduloPior = modulosDoPainel(rubricas, pior.changeSetId, tipo)
      .filter((m) => m.pendentes > 0)
      .sort((a, b) => a.cobertura - b.cobertura || b.pendentes - a.pendentes)[0];
    return { vigencia: pior, modulo: moduloPior ?? null };
  }, [porVigencia, rubricas, tipo]);

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

  /* A vigência não está aqui, e é de propósito: ela saiu dos filtros para o
     botão do cabeçalho, e lá ela é o recorte da leitura — como a unidade da
     lateral. "Limpar filtros" desfaz o que se ajustou *dentro* de uma leitura. */
  const limparFiltros = () =>
    trocar(() => {
      setUnidadeEscolhida(null);
      setModuloFiltrado(null);
      irPara({ tipo: null });
    });

  const temFiltro = tipo !== null || moduloFiltrado !== null || unidadeEscolhida !== null;

  /**
   * Exportar o recorte aberto — alteração a alteração.
   *
   * É o único lugar onde o detalhe por alteração mora desde que a lista saiu da
   * tela, e por isso ele sai **inteiro**: as justificadas e as pendentes, com o
   * módulo e a rubrica de cada uma ao lado do que mudou.
   */
  const exportar = async () => {
    setExportando(true);
    try {
      const tudo: LinhaDoPainel[] = [];
      const passo = 100;
      for (let offset = 0; ; offset += passo) {
        /* O mesmo recorte da tela — inclusive a unidade aberta: exportar não
           pode trazer o que a tela não mostra. */
        const pagina = await fetchJson<{ total: number; linhas: LinhaDoPainel[] }>(
          enderecoDasLinhas({
            escopo: escopoDaConsulta,
            changeSetId,
            tipo,
            situacao: "TODAS",
            direcao: "TODAS",
            autor: null,
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
          "Módulo",
          "Rubrica",
          "Placa",
          "Tipo",
          "Atributo",
          "De",
          "Para",
          "Situação",
          "Justificativa",
          "Quem escreveu",
          "Quando",
        ].join(";"),
        ...tudo.map((l) => {
          /* O mesmo mapa da tabela — a linha do CSV e a linha da tela dizem a
             mesma rubrica, ou o arquivo contradiria o número que o gerou. */
          const rubrica = rubricaDaLinha(l);
          return [
            aspas(nomeDaVigenciaNoArquivo.get(l.changeSetId) ?? l.changeSetId),
            aspas(moduloDeJustificativa(rubrica.modulo).rotulo),
            aspas(rubrica.rotulo),
            aspas(l.entityLabel),
            aspas(l.entityType ? rotuloDoTipo(l.entityType) : null),
            aspas(l.attributeName ?? l.attributeCode),
            aspas(l.valueBefore),
            aspas(l.valueAfter),
            aspas(l.texto === null ? "Pendente" : "Justificada"),
            aspas(l.texto),
            aspas(l.criadoPor),
            aspas(l.criadoEm ? new Date(l.criadoEm).toLocaleString("pt-BR") : null),
          ].join(";");
        }),
      ].join("\n");

      salvarArquivo(
        /* BOM: sem ele o Excel abre "Justificação" como "JustificaÃ§Ã£o". */
        new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }),
        "monitor-de-justificativas.csv",
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

  /** A tabela por rubrica — a mesma nas abas que a mostram. */
  const tabelaDeRubricas = (
    <section className="superficie overflow-hidden">
      <div className="px-6 py-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">Onde está a pendência</h2>
        <p className="text-sm text-muted-foreground">
          Uma linha por rubrica. Nenhuma se justifica aqui — o botão leva à tela que grava.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-semibold">Módulo</th>
              <th className="px-3 py-2.5 text-left font-semibold">Rubrica</th>
              <th className="px-3 py-2.5 text-right font-semibold">Alterações</th>
              <th className="px-3 py-2.5 text-right font-semibold">Justificadas</th>
              <th className="px-3 py-2.5 text-left font-semibold w-64">Cobertura</th>
              <th className="px-3 py-2.5 text-left font-semibold">Quem escreveu</th>
              <th className="px-3 py-2.5 text-left font-semibold">Última justificativa</th>
              <th className="px-3 py-2.5 text-right font-semibold">Ações</th>
            </tr>
          </thead>
          <tbody>
            {linhasDeRubrica.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  Nenhuma rubrica neste recorte.
                </td>
              </tr>
            )}
            {paginaDeRubricas.map((linha) => {
              const desenho = DESENHO_DO_MODULO[linha.modulo];
              return (
                <tr key={linha.chave} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold",
                        desenho.selo,
                      )}
                    >
                      {linha.moduloRotulo}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-medium">{linha.rotulo}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {linha.alteracoes.toLocaleString("pt-BR")}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-emerald-700">
                    {linha.justificadas.toLocaleString("pt-BR")}
                  </td>
                  <td className="px-3 py-3">
                    <BarraDaCobertura cobertura={linha.cobertura} />
                    <span className="mt-1.5 block text-xs text-muted-foreground tabular-nums">
                      {pct(linha.cobertura)} ·{" "}
                      <span className="text-amber-700">
                        {linha.pendentes.toLocaleString("pt-BR")} pendentes
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {linha.ultimoAutor === null ? (
                      /* Ninguém — e não "sem responsável": a rubrica não tem
                         dono a quem cobrar, tem trabalho a fazer. */
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <span className="flex items-center gap-2 text-xs">
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold">
                          {iniciaisDoResponsavel(linha.ultimoAutor)}
                        </span>
                        <span className="truncate max-w-[12rem]">{linha.ultimoAutor}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {linha.ultimaEm === null
                      ? "Nenhuma ainda"
                      : tempoRelativo(new Date(linha.ultimaEm))}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-primary font-semibold"
                      onClick={() =>
                        navegar(
                          /*
                            A tela da rubrica quando ela tem uma; a fila quando
                            não — e a fila justifica qualquer alteração. Nenhum
                            dos dois caminhos abre um diálogo daqui: quem grava
                            é a tela de destino.
                          */
                          `${linha.rota ?? "/justificativas"}?${recorteDoEndereco(
                            changeSetId ? { changeSetId } : {},
                          )}`,
                        )
                      }
                    >
                      {linha.rota ? `Abrir em ${linha.moduloRotulo}` : "Abrir na fila"} →
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {linhasDeRubrica.length > 0 && (
        <Paginacao
          pagina={pagina}
          porPagina={porPagina}
          total={linhasDeRubrica.length}
          onPagina={setPagina}
          onPorPagina={(n) => {
            setPorPagina(n);
            setPagina(1);
          }}
          tamanhos={[10, 25, 50, 100]}
          unidade="rubricas"
        />
      )}
    </section>
  );

  /** O gráfico por vigência — verde é o que já está explicado. */
  const graficoDeVigencias = (
    <section className="superficie px-6 py-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold">Cobertura por vigência</h2>
        <p className="text-xs text-muted-foreground">verde = explicado</p>
      </div>
      <ul className="mt-5 flex items-end gap-2 overflow-hidden">
        {serieDeVigencias.map((v) => (
          <li
            key={v.changeSetId}
            className="flex min-w-0 flex-1 basis-0 flex-col items-center gap-2"
          >
            <button
              type="button"
              onClick={() =>
                trocar(() =>
                  setVigenciaEscolhida(changeSetId === v.changeSetId ? null : v.changeSetId),
                )
              }
              className={cn(
                "w-full rounded-md p-1 hover:bg-muted/60 transition-colors",
                changeSetId === v.changeSetId && "bg-muted",
              )}
              title={`${nomeDaVigencia.get(v.changeSetId) ?? v.changeSetId} — ${pct(
                v.cobertura,
              )} explicado`}
            >
              <span className="flex h-28 w-full flex-col justify-end overflow-hidden rounded-md bg-muted">
                <span
                  className="block w-full"
                  style={{
                    height: `${100 - v.cobertura}%`,
                    background: CORES.pendentes,
                  }}
                />
                <span
                  className="block w-full"
                  style={{ height: `${v.cobertura}%`, background: CORES.justificadas }}
                />
              </span>
            </button>
            <span className="w-full break-words text-center text-[10px] leading-tight text-muted-foreground">
              {rotuloCurtoDaVigencia.get(v.changeSetId) ?? v.changeSetId}
            </span>
          </li>
        ))}
      </ul>

      {destaque && (
        <div className="mt-5 flex gap-3 rounded-lg border bg-accent/60 px-4 py-3 text-sm">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>
            <strong>
              Comece por{" "}
              {nomeDaVigencia.get(destaque.vigencia.changeSetId) ??
                destaque.vigencia.changeSetId}
            </strong>{" "}
            — é a vigência com menos explicação: {pct(100 - destaque.vigencia.cobertura)} do que
            mudou nela ainda não tem justificativa
            {destaque.modulo
              ? `, e o módulo mais atrasado dentro dela é ${destaque.modulo.rotulo} (${pct(
                  destaque.modulo.cobertura,
                )} explicado)`
              : ""}
            .
          </p>
        </div>
      )}
    </section>
  );

  return (
    <Layout>
      <CabecalhoDePagina
        largura="1400px"
        icone={Radar}
        titulo="Monitor de Justificativas"
        descricao={
          <>
            Quanto do que a Ambev mudou já está explicado, e quanto ainda falta —
            por módulo, por rubrica e por vigência
            {unidadeDoRecorte
              ? `, em ${unidadeDoRecorte}`
              : emVisaoGeral
                ? ", somando todas as unidades"
                : ""}
            . Justificar acontece dentro de cada módulo; aqui se acompanha e se
            cobra.
          </>
        }
        rodape={
          <>
            {/* Qual vigência está aberta — escrito aqui, porque o botão que a
                troca diz só "Trocar vigência". Com uma vigência só no recorte, a
                linha diz o nome dela e não "todas": as duas leituras são o mesmo
                conjunto, e nomeá-lo é o que responde de quando são os números. */}
            {porVigencia.length > 0 && (
              <span className="inline-flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground mt-3">
                <CalendarRange className="w-3.5 h-3.5" />
                <span className="text-xs uppercase tracking-wide">Vigência</span>
                <span className="font-semibold text-foreground">
                  {vigenciaEscrita === null
                    ? "Todas as vigências"
                    : (nomeDaVigencia.get(vigenciaEscrita) ?? vigenciaEscrita)}
                </span>
                <span className="text-xs">· comparadas duas a duas</span>
              </span>
            )}
          </>
        }
        acoes={
          /*
            A vigência é o recorte da leitura, e não um filtro dela: ela decide
            **de que acervo** os cartões, os módulos e a tabela falam, do mesmo
            jeito que a unidade da lateral. Por isso o botão da casa — "Trocar
            vigência" —, no canto direito do cabeçalho.
          */
          <>
            {porVigencia.length > 1 && (
              <MenuDeVigencias
                rotulo="Trocar vigência"
                className={BOTAO_DE_TROCA}
                /* Sempre plural: com uma vigência só o botão não existe. */
                cabecalho={`${porVigencia.length} vigências com alterações`}
                opcoes={[
                  {
                    valor: TODAS,
                    mes: "Todas as vigências",
                    alteracoes: totalDeAlteracoes,
                  },
                  ...porVigencia.map((v) => ({
                    valor: v.changeSetId,
                    mes: nomeDaVigencia.get(v.changeSetId) ?? v.changeSetId,
                    alteracoes: v.alteracoes,
                  })),
                ]}
                ativa={changeSetId ?? TODAS}
                onEscolher={(valor) =>
                  trocar(() => setVigenciaEscolhida(valor === TODAS ? null : valor))
                }
              />
            )}
            <Button
              variant="outline"
              onClick={exportar}
              disabled={exportando || !resumo}
              /* A mesma caixa do botão ao lado — os dois são o cabeçalho, e
                 dois tamanhos diferentes lado a lado leem como dois níveis de
                 controle que não existem. */
              className="h-auto gap-2 rounded-lg px-4 py-2.5 text-sm font-bold"
            >
              <Download className="w-4 h-4" />
              {exportando ? "Exportando…" : "Exportar"}
            </Button>
          </>
        }
      />

      <div className="px-8 border-b max-w-[1400px]">
        <nav className="flex flex-wrap items-center gap-1" role="tablist">
          {ABAS.map((a) => (
            <AbaBotao
              key={a.chave}
              active={a.chave === aba}
              onClick={() => trocar(() => irPara({ aba: a.chave === "modulo" ? null : a.chave }))}
              icon={a.chave === "modulo" ? <ListChecks className="w-4 h-4" /> : undefined}
              label={a.rotulo}
              hint={a.hint}
            />
          ))}
        </nav>
      </div>

      <div className="px-8 pb-10 space-y-4 max-w-[1400px] pt-4">
        {tipo !== null && (
          <p className="text-sm text-muted-foreground">
            Tudo abaixo — os cartões, os módulos e a tabela — fala só{" "}
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
          <section className="superficie px-6 py-10 text-center">
            <p className="text-lg font-bold">
              {tipo !== null
                ? `Nada a justificar ${contracaoDoTipo(tipo, "em")} ${palavrasDoTipo(tipo).plural} deste recorte.`
                : "Nada a justificar neste recorte."}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {/*
                Com um tipo filtrado há uma terceira causa possível, e a tela não
                sabe distinguir as três: pode não haver alteração, pode não haver
                comparação calculada, e pode aquele tipo não ter sido importado
                aqui. Dizê-las juntas é mais honesto do que escolher uma.
              */}
              Sem alteração por ativo nas comparações escolhidas, não há
              justificativa a cobrar
              {tipo !== null
                ? " — e pode ser que este tipo nem tenha sido importado neste recorte"
                : ""}
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
                rodape={
                  modulos.length > 0
                    ? `O que mudou entre as vigências, em ${modulos.length} ${
                        modulos.length === 1 ? "módulo" : "módulos"
                      }`
                    : "O que mudou entre as vigências"
                }
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
                titulo="Rubricas com pendência"
                valor={rubricasPendentes.toLocaleString("pt-BR")}
                rodape="Cada uma é uma tela a abrir"
                icon={ListChecks}
                tom="azul"
              />
            </div>

            {aba === "modulo" && (
              <>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                  {/*
                    A leitura que esta tela existe para dar: onde está a
                    pendência, por módulo. Clicar na linha recorta a tabela
                    abaixo — que é a continuação da mesma pergunta, um nível mais
                    fundo —, e "Abrir" vai para a tela do módulo inteiro.
                  */}
                  <section className="superficie px-6 py-5">
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 className="text-lg font-bold">Cobertura por módulo</h2>
                      <p className="text-xs text-muted-foreground">
                        A barra diz onde mandar a cobrança. Clique para recortar a tabela.
                      </p>
                    </div>
                    {modulos.length === 0 ? (
                      <p className="text-sm text-muted-foreground mt-3">
                        A cobertura por módulo não veio nesta resposta.
                      </p>
                    ) : (
                      <ul className="mt-2 divide-y">
                        {modulos.map((m) => {
                          const desenho = DESENHO_DO_MODULO[m.modulo];
                          const Icone = desenho.icone;
                          return (
                            <li key={m.modulo} className="py-3">
                              <div className="flex items-start gap-3">
                                <span
                                  className={cn(
                                    "mt-0.5 shrink-0 rounded-xl p-2",
                                    desenho.fundo,
                                    desenho.tinta,
                                  )}
                                >
                                  <Icone className="h-4 w-4" />
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    trocar(() =>
                                      setModuloFiltrado(
                                        m.modulo === moduloFiltrado ? null : m.modulo,
                                      ),
                                    )
                                  }
                                  aria-pressed={moduloFiltrado === m.modulo}
                                  className={cn(
                                    "min-w-0 flex-1 rounded-md px-2 py-1 text-left hover:bg-muted/60 transition-colors",
                                    moduloFiltrado === m.modulo && "bg-muted",
                                  )}
                                >
                                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                    <span className="font-bold">{m.rotulo}</span>
                                    <span className="text-xs text-muted-foreground tabular-nums">
                                      {m.justificadas.toLocaleString("pt-BR")} justificadas ·{" "}
                                      {m.pendentes.toLocaleString("pt-BR")} pendentes ·{" "}
                                      {m.alteracoes.toLocaleString("pt-BR")} alterações
                                    </span>
                                  </span>
                                  <span className="mt-2 block">
                                    <BarraDaCobertura cobertura={m.cobertura} />
                                  </span>
                                  {/* As rubricas deste recorte, e não uma lista
                                      fixa — ver `modulosDoPainel`. */}
                                  <span className="mt-1.5 block truncate text-xs text-muted-foreground">
                                    {m.rubricas.slice(0, 5).join(", ")}
                                    {m.rubricas.length > 5
                                      ? ` e mais ${m.rubricas.length - 5}`
                                      : ""}
                                  </span>
                                </button>
                                <span className="flex shrink-0 items-center gap-3 pt-1">
                                  <span
                                    className={cn(
                                      "w-14 text-right text-sm font-bold tabular-nums",
                                      m.cobertura >= 50 ? "text-emerald-700" : "text-amber-600",
                                    )}
                                  >
                                    {pct(m.cobertura)}
                                  </span>
                                  {m.rota && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-primary font-semibold"
                                      onClick={() => navegar(`${m.rota}?${recorteDoEndereco()}`)}
                                    >
                                      Abrir →
                                    </Button>
                                  )}
                                </span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>

                  {graficoDeVigencias}
                </div>

                <section className="superficie px-6 py-4">
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
                        Tipo de ativo
                      </span>
                      <Select
                        value={tipo ?? TODOS_OS_TIPOS}
                        onValueChange={(v) =>
                          trocar(() => irPara({ tipo: v === TODOS_OS_TIPOS ? null : v }))
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

                    {/* A mesma escolha das barras acima, por outra porta — as
                        duas gravam o mesmo estado. */}
                    <label className="space-y-1">
                      <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                        Módulo
                      </span>
                      <Select
                        value={moduloFiltrado ?? TODOS_OS_MODULOS}
                        onValueChange={(v) =>
                          trocar(() =>
                            setModuloFiltrado(
                              v === TODOS_OS_MODULOS ? null : (v as ChaveDeModulo),
                            ),
                          )
                        }
                        disabled={modulos.length === 0}
                      >
                        <SelectTrigger className="h-9 w-56 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={TODOS_OS_MODULOS}>Todos</SelectItem>
                          {modulos.map((m) => (
                            <SelectItem key={m.modulo} value={m.modulo}>
                              {m.rotulo} ({m.pendentes.toLocaleString("pt-BR")} pendentes)
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

                {tabelaDeRubricas}
              </>
            )}

            {aba === "responsavel" && (
              <section className="superficie overflow-hidden">
                <div className="px-6 py-4">
                  <h2 className="text-lg font-bold">Quem justificou</h2>
                  <p className="text-sm text-muted-foreground">
                    Quem escreveu o que já está escrito, no recorte aberto. A pendência não tem
                    responsável: este produto não atribui alteração a ninguém — ela tem rubrica, e
                    a rubrica tem tela.
                  </p>
                </div>
                {responsaveis.length === 0 ? (
                  <p className="px-6 pb-6 text-sm text-muted-foreground">
                    Nenhuma justificativa escrita neste recorte ainda.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2.5 text-left font-semibold">Responsável</th>
                          <th className="px-3 py-2.5 text-right font-semibold">
                            Alterações justificadas
                          </th>
                          <th className="px-3 py-2.5 text-left font-semibold w-64">
                            Do que já está explicado
                          </th>
                          <th className="px-3 py-2.5 text-left font-semibold">Última</th>
                        </tr>
                      </thead>
                      <tbody>
                        {responsaveis.map((r) => {
                          const parte =
                            resumo.justificadas === 0
                              ? 0
                              : (r.justificadas / resumo.justificadas) * 100;
                          return (
                            <tr key={r.criadoPor} className="border-b last:border-0">
                              <td className="px-4 py-3">
                                <span className="flex items-center gap-2">
                                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
                                    {iniciaisDoResponsavel(r.criadoPor)}
                                  </span>
                                  <span className="truncate">{r.criadoPor}</span>
                                </span>
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums">
                                {r.justificadas.toLocaleString("pt-BR")}
                              </td>
                              <td className="px-3 py-3">
                                <span className="flex items-center gap-2">
                                  <Progress value={parte} className="h-2 flex-1" />
                                  <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
                                    {pct(parte)}
                                  </span>
                                </span>
                              </td>
                              <td className="px-3 py-3 text-xs text-muted-foreground">
                                {tempoRelativo(new Date(r.ultimaEm))}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {aba === "vigencia" && (
              <>
                {graficoDeVigencias}

                <section className="superficie overflow-hidden">
                  <div className="px-6 py-4">
                    <h2 className="text-lg font-bold">Vigência a vigência</h2>
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
                          <th className="px-3 py-2.5 text-left font-semibold w-64">Cobertura</th>
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
                                setVigenciaEscolhida(
                                  changeSetId === v.changeSetId ? null : v.changeSetId,
                                ),
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
                              <BarraDaCobertura cobertura={v.cobertura} />
                              <span className="mt-1.5 block text-xs text-muted-foreground tabular-nums">
                                {pct(v.cobertura)} explicado
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

            {aba === "tipo" && (
              <>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                  <section className="superficie px-6 py-5">
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 className="text-lg font-bold">Pendências por tipo de ativo</h2>
                      <p className="text-xs text-muted-foreground">
                        Clique para recortar a leitura inteira.
                      </p>
                    </div>
                    <ul className="mt-4 space-y-3">
                      {barras.map((barra) => (
                        <li key={barra.tipo}>
                          <button
                            type="button"
                            onClick={() =>
                              trocar(() =>
                                irPara({ tipo: barra.tipo === tipo ? null : barra.tipo }),
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
                    <p className="mt-4 text-xs text-muted-foreground">
                      {/* O QLP não tem placa, e por isso não tem barra aqui —
                          dizer isso é o que impede a leitura de ser lida como a
                          cobertura inteira. */}
                      O quadro de pessoal não aparece nesta leitura: ele não é ativo com placa. A
                      cobertura dele está na aba Por módulo.
                    </p>
                  </section>

                  <section className="superficie px-6 py-5">
                    <h2 className="text-lg font-bold">Placas do recorte</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Placas não se somam entre vigências: a mesma placa que mudou em duas
                      comparações é uma placa. Os números abaixo são os da vigência que mais tem.
                    </p>
                    <div className="mt-5 flex items-end gap-8">
                      <span>
                        <span className="block text-3xl font-bold tabular-nums text-sky-700">
                          {resumo.placasPendentes.toLocaleString("pt-BR")}
                        </span>
                        <span className="text-xs text-muted-foreground">com pendência</span>
                      </span>
                      <span>
                        <span className="block text-3xl font-bold tabular-nums">
                          {resumo.placas.toLocaleString("pt-BR")}
                        </span>
                        <span className="text-xs text-muted-foreground">alteradas</span>
                      </span>
                      <span className="ml-auto">
                        <Truck className="h-8 w-8 text-muted-foreground/40" />
                      </span>
                    </div>
                    <div className="mt-6 flex items-center gap-4">
                      <div className="relative shrink-0">
                        <ResponsiveContainer width={110} height={110}>
                          <PieChart>
                            <Pie
                              data={rosca}
                              cx="50%"
                              cy="50%"
                              innerRadius={34}
                              outerRadius={52}
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
                      </div>
                      <dl className="space-y-2 text-sm">
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
                  </section>
                </div>

                {tabelaDeRubricas}
              </>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
