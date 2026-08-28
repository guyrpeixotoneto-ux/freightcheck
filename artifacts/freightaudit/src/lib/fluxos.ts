import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api";
import { apresentar } from "@/lib/apresentar-erro";

/**
 * FLUXOS OPERACIONAIS — o que a tela sabe sobre o módulo, num arquivo só.
 *
 * Aqui moram os tipos que a API promete, as consultas, as mutações e — a parte
 * que os testes cobrem — as **funções puras** que transformam o fluxo guardado
 * no que o canvas desenha e no que o painel lateral mostra.
 *
 * A divisão é a mesma do resto deste pacote (`vitest.config.ts` a explica): o
 * que é decisão vira função pura e é provado; o que é pixel fica no componente.
 * Por isso a montagem dos nós e das setas, o agrupamento do material da etapa e
 * o endereço de uma ação estão neste arquivo, e não dentro do `.tsx`.
 *
 * **O catálogo não é copiado aqui.** Ele vem de `/api/fluxos/catalogo`, servido
 * pelo mesmo motor que valida a gravação. Uma segunda lista no front é o jeito
 * conhecido de um tipo novo existir no banco e não aparecer na tela.
 */

// ---------------------------------------------------------------------------
// O que a API promete
// ---------------------------------------------------------------------------

export type StatusDoFluxo = "RASCUNHO" | "ATIVO" | "ARQUIVADO";
export type StatusDaEtapa = "ATIVO" | "ATENCAO" | "INATIVO";

export interface Fluxo {
  id: string;
  empresaId: string;
  nome: string;
  slug: string;
  descricao: string | null;
  objetivo: string | null;
  categoria: string;
  status: StatusDoFluxo;
  versao: number;
  dono: string | null;
  criadoEm: string;
  atualizadoEm: string;
  criadoPor: string | null;
  atualizadoPor: string | null;
}

export interface FluxoNaLista extends Fluxo {
  etapas: number;
  conexoes: number;
  /** A etapa que este fluxo detalha, quando ele é subfluxo. `null` na raiz. */
  pai: PaiNaLista | null;
}

/** O degrau de cima de uma linha da listagem: quem detalha o quê. */
export interface PaiNaLista {
  fluxoId: string;
  etapaId: string;
  etapaNome: string;
}

export interface ItemDaEtapa {
  id: string;
  especie: string;
  nome: string;
  descricao: string | null;
  obrigatorio: boolean | null;
  link: string | null;
  ordem: number;
}

export interface IndicadorDaEtapa {
  id: string;
  nome: string;
  descricao: string | null;
  unidade: string | null;
  sentido: string;
  origem: string | null;
  ordem: number;
}

export interface AcaoDaEtapa {
  id: string;
  titulo: string;
  descricao: string | null;
  rota: string;
  parametros: Record<string, string> | null;
  icone: string | null;
  ordem: number;
}

export interface Etapa {
  id: string;
  fluxoId: string;
  nome: string;
  descricao: string | null;
  tipo: string;
  ordem: number;
  responsavel: string | null;
  area: string | null;
  objetivo: string | null;
  sistemaPrincipal: string | null;
  regras: string | null;
  informacoesConsultadas: string | null;
  /**
   * As três dimensões do que dá errado, do que trava e do que é preciso saber
   * — ver `lib/fluxos/modelo.ts`. São colunas separadas porque é o que permite
   * somá-las pelo processo inteiro depois.
   */
  falhas: string | null;
  gargalos: string | null;
  informacoes: string | null;
  /**
   * O texto de antes do recorte em três, preservado pela migration `0072`.
   *
   * A tela não o mostra e não o escreve — mas `corpoDaEtapa` continua mandando
   * de volta o valor que recebeu, porque a rota é substituição: omiti-lo faria
   * a primeira edição de qualquer campo apagar o original.
   */
  observacoes: string | null;
  status: StatusDaEtapa;
  posX: number;
  posY: number;
  chaveMonitoramento: string | null;
  /** O fluxo que detalha esta etapa, quando existe — ver `subfluxos` abaixo. */
  subfluxoId: string | null;
  itens: ItemDaEtapa[];
  indicadores: IndicadorDaEtapa[];
  acoes: AcaoDaEtapa[];
}

export interface Conexao {
  id: string;
  fluxoId: string;
  origemEtapaId: string;
  destinoEtapaId: string;
  tipo: string;
  rotulo: string | null;
  ordem: number;
}

/** O cabeçalho de um subfluxo — o que o cartão da etapa detalhada mostra. */
export interface ResumoDeSubfluxo {
  id: string;
  nome: string;
  slug: string;
  categoria: string;
  status: string;
  etapas: number;
}

/** Um degrau do caminho de volta — o fluxo pai e a etapa que trouxe até aqui. */
export interface DegrauDaTrilha {
  fluxoId: string;
  fluxoNome: string;
  etapaId: string;
  etapaNome: string;
}

export interface FluxoCompleto {
  fluxo: Fluxo;
  etapas: Etapa[];
  conexoes: Conexao[];
  /*
    Os dois campos do subfluxo são **opcionais aqui e obrigatórios no
    servidor**, e a diferença é deliberada: uma projeção montada à mão — num
    teste, numa exportação — continua sendo um `FluxoCompleto` legítimo sem
    saber que subfluxo existe, e quem lê os campos já trata a ausência como
    "não tem detalhe". Exigi-los na tela obrigaria dezenas de objetos de teste
    a declarar duas listas vazias para provar coisas sobre desenho.
  */
  /** Um por `subfluxoId` distinto das etapas acima. Use `subfluxoDaEtapa`. */
  subfluxos?: ResumoDeSubfluxo[];
  /** De onde este fluxo é detalhe — vazio quando ele é raiz. */
  trilha?: DegrauDaTrilha[];
}

/**
 * O subfluxo de uma etapa, resolvido contra a lista que veio junto.
 *
 * A etapa guarda a referência e o fluxo carrega os cabeçalhos: quem desenha um
 * cartão pergunta aqui em vez de procurar na lista, e nenhuma visão precisa
 * saber que a resolução é um `find`.
 *
 * Tolera `subfluxos` ausente de propósito — uma resposta de servidor antigo,
 * ou um `FluxoCompleto` montado à mão num teste, devolve "não tem detalhe" em
 * vez de quebrar o cartão inteiro.
 */
export function subfluxoDaEtapa(
  completo: Pick<FluxoCompleto, "subfluxos"> | null | undefined,
  etapa: Pick<Etapa, "subfluxoId">,
): ResumoDeSubfluxo | null {
  if (!etapa.subfluxoId) return null;
  return completo?.subfluxos?.find((s) => s.id === etapa.subfluxoId) ?? null;
}

/**
 * O degrau de volta — o fluxo pai imediato, ou `null` quando este é raiz.
 *
 * A trilha vem da raiz para o pai imediato (é a ordem em que uma migalha de pão
 * se lê), então quem volta um passo quer o **último** degrau, não o primeiro.
 * Quem abriu um subfluxo chegou nele de dentro do pai — pela marca no cartão,
 * pelo painel da etapa ou logo depois de "detalhar" —, e é para lá que a seta do
 * cabeçalho tem de devolver. Um fluxo raiz não tem degrau nenhum: esse foi mesmo
 * aberto pela listagem, e é para ela que ele volta.
 */
export function degrauDeVolta(
  completo: Pick<FluxoCompleto, "trilha"> | null | undefined,
): DegrauDaTrilha | null {
  const trilha = completo?.trilha;
  if (!trilha || trilha.length === 0) return null;
  return trilha[trilha.length - 1] ?? null;
}

export interface EntradaDoCatalogo {
  valor: string;
  rotulo: string;
  descricao: string;
}

export interface TipoDeEtapaNoCatalogo extends EntradaDoCatalogo {
  forma: "retangulo" | "losango" | "pilula";
  classe: string;
  icone: string;
}

export interface TipoDeConexaoNoCatalogo extends EntradaDoCatalogo {
  tracejada: boolean;
  classe: string;
}

export interface EspecieNoCatalogo extends EntradaDoCatalogo {
  titulo: string;
  icone: string;
  usaLink: boolean;
  usaObrigatorio: boolean;
}

export interface ModeloNoCatalogo {
  slug: string;
  nome: string;
  categoria: string;
  resumo: string;
  /** É o processo já levantado da empresa (entra na lista sozinho)? */
  jaMapeado: boolean;
  etapas: number;
}

export interface Catalogo {
  tiposDeEtapa: TipoDeEtapaNoCatalogo[];
  tiposDeConexao: TipoDeConexaoNoCatalogo[];
  especiesDeItem: EspecieNoCatalogo[];
  statusDoFluxo: EntradaDoCatalogo[];
  statusDaEtapa: EntradaDoCatalogo[];
  sentidosDoIndicador: EntradaDoCatalogo[];
  modelos: ModeloNoCatalogo[];
}

// ---------------------------------------------------------------------------
// Funções puras — o que os testes cobrem
// ---------------------------------------------------------------------------

/**
 * O endereço de uma ação, montado num lugar só.
 *
 * A regra é a mesma do servidor (`enderecoDaAcao` em `@workspace/fluxos`), e a
 * repetição é deliberada: o servidor precisa dela para **recusar** a gravação, e
 * a tela precisa dela para **navegar**. O que não pode existir é uma terceira
 * cópia dentro de um componente, montando `?` e `&` à mão — que é como um botão
 * acaba levando para o lugar errado sem ninguém notar.
 *
 * Devolve `null` quando a rota não é um caminho interno. Nulo aqui significa
 * "não ofereça este botão": mesmo que uma linha antiga do banco carregue algo
 * estranho, a tela não monta navegação para fora.
 */
export function enderecoDaAcao(acao: {
  rota: string;
  parametros?: Record<string, string> | null;
}): string | null {
  const rota = acao.rota?.trim() ?? "";
  if (!rota.startsWith("/") || rota.startsWith("//") || /\s/.test(rota)) return null;

  const parametros = acao.parametros ?? null;
  if (!parametros) return rota;
  const query = new URLSearchParams();
  /* Ordenado, para que o mesmo conjunto produza sempre o mesmo endereço. */
  for (const chave of Object.keys(parametros).sort()) query.set(chave, parametros[chave]);
  const texto = query.toString();
  if (texto === "") return rota;
  return rota.includes("?") ? `${rota}&${texto}` : `${rota}?${texto}`;
}

/**
 * A frase de uma falha, para o rodapé de um formulário.
 *
 * Usa a mesma autoridade do resto do produto (`apresentar-erro.ts`) e escolhe a
 * frase mais próxima que houver: a orientação quando existe, a mensagem do
 * servidor quando não — que é onde caem as recusas nomeadas deste módulo, com o
 * texto que o motor escreveu. O último degrau é genérico e existe para nunca
 * ficar em branco: um formulário que recusa em silêncio é o pior desfecho.
 */
export function fraseDoErro(erro: unknown): string {
  const a = apresentar(erro);
  return a.principal ?? a.mensagemCrua ?? "Não foi possível concluir. Tente de novo.";
}

/** O material da etapa, agrupado por espécie, na ordem do catálogo. */
export function itensPorEspecie(
  etapa: Pick<Etapa, "itens">,
  especies: EspecieNoCatalogo[],
): { especie: EspecieNoCatalogo; itens: ItemDaEtapa[] }[] {
  return especies
    .map((especie) => ({
      especie,
      itens: etapa.itens
        .filter((i) => i.especie === especie.valor)
        .sort((a, b) => a.ordem - b.ordem),
    }))
    .filter((grupo) => grupo.itens.length > 0);
}

/**
 * O que o cartão mostra, e nada além.
 *
 * Nome, tipo e — quando há — quem responde. É a regra de UX escrita como
 * função: o resto do que a etapa guarda aparece no painel lateral, sob demanda.
 * Estar aqui, e não no JSX, é o que a torna verificável: um teste afirma que
 * uma etapa com dez falhas cadastradas continua produzindo um cartão de três
 * linhas.
 */
export interface ResumoDoCartao {
  nome: string;
  tipo: string;
  /** `Faturamento · Analista` — área e responsável, o que houver. */
  quemResponde: string | null;
  /** Quantos "detalhes" existem por trás, para o discreto contador do rodapé. */
  detalhes: number;
  atencao: boolean;
}

export function resumoDoCartao(etapa: Etapa): ResumoDoCartao {
  const partes = [etapa.area, etapa.responsavel].filter(
    (p): p is string => typeof p === "string" && p.trim() !== "",
  );
  return {
    nome: etapa.nome,
    tipo: etapa.tipo,
    quemResponde: partes.length > 0 ? partes.join(" · ") : null,
    detalhes: etapa.itens.length + etapa.indicadores.length + etapa.acoes.length,
    atencao: etapa.status === "ATENCAO",
  };
}

/** Um nó do canvas — o formato que o `@xyflow/react` consome. */
export interface NoDoCanvas {
  id: string;
  type: "etapa";
  position: { x: number; y: number };
  data: { etapa: Etapa; resumo: ResumoDoCartao; tipo: TipoDeEtapaNoCatalogo | undefined };
}

/** Uma seta do canvas. */
export interface SetaDoCanvas {
  id: string;
  source: string;
  target: string;
  label: string | undefined;
  animated: boolean;
  style: { stroke: string; strokeWidth: number; strokeDasharray?: string };
  markerEnd: { type: "arrowclosed"; color: string };
  data: { conexao: Conexao };
}

/**
 * As cores das setas — literais, e não classes do Tailwind.
 *
 * É a única exceção à regra de "cor vem do tema", e ela tem motivo: o SVG que o
 * canvas desenha recebe `stroke` como propriedade, não como classe, e a ponta da
 * flecha (`markerEnd`) precisa da mesma cor como valor. Ficam aqui, ao lado do
 * mapeamento, em vez de espalhadas pelo componente.
 */
const COR_DA_CONEXAO: Record<string, string> = {
  SEQUENCIA: "#94a3b8",
  DECISAO_SIM: "#10b981",
  DECISAO_NAO: "#f43f5e",
  EXCECAO: "#f59e0b",
  RETRABALHO: "#8b5cf6",
};

const COR_PADRAO = "#94a3b8";

/**
 * O fluxo guardado vira o que o canvas desenha.
 *
 * Função pura, e é o coração da tela de visualização: dela sai a afirmação de
 * que **toda** etapa cadastrada aparece e de que **toda** conexão vira seta —
 * inclusive a de retrabalho, que volta. Uma conexão cujas pontas não existem
 * mais é descartada em vez de virar uma seta para o nada.
 */
export function montarCanvas(
  completo: FluxoCompleto,
  catalogo: Pick<Catalogo, "tiposDeEtapa" | "tiposDeConexao"> | undefined,
): { nos: NoDoCanvas[]; setas: SetaDoCanvas[] } {
  const tipos = new Map((catalogo?.tiposDeEtapa ?? []).map((t) => [t.valor, t]));
  const tiposDeConexao = new Map((catalogo?.tiposDeConexao ?? []).map((t) => [t.valor, t]));
  const existe = new Set(completo.etapas.map((e) => e.id));

  const nos: NoDoCanvas[] = completo.etapas.map((etapa) => ({
    id: etapa.id,
    type: "etapa",
    position: { x: etapa.posX, y: etapa.posY },
    data: { etapa, resumo: resumoDoCartao(etapa), tipo: tipos.get(etapa.tipo) },
  }));

  const setas: SetaDoCanvas[] = completo.conexoes
    .filter((c) => existe.has(c.origemEtapaId) && existe.has(c.destinoEtapaId))
    .map((conexao) => {
      const cor = COR_DA_CONEXAO[conexao.tipo] ?? COR_PADRAO;
      const tracejada = tiposDeConexao.get(conexao.tipo)?.tracejada ?? false;
      return {
        id: conexao.id,
        source: conexao.origemEtapaId,
        target: conexao.destinoEtapaId,
        label: conexao.rotulo ?? undefined,
        /* Só o desvio se move: animar tudo vira ruído e some com a distinção. */
        animated: conexao.tipo === "RETRABALHO",
        style: {
          stroke: cor,
          strokeWidth: 1.5,
          ...(tracejada ? { strokeDasharray: "6 4" } : {}),
        },
        markerEnd: { type: "arrowclosed" as const, color: cor },
        data: { conexao },
      };
    });

  return { nos, setas };
}

/**
 * O texto que resume o fluxo no cabeçalho: "16 etapas · 20 conexões · com
 * retorno".
 *
 * "Com retorno" é a leitura de que o processo não é linear — a informação mais
 * útil de um mapa operacional, e a que some quando o desenho é uma lista.
 */
export function resumoDoFluxo(completo: FluxoCompleto): string {
  const partes = [
    `${completo.etapas.length} ${completo.etapas.length === 1 ? "etapa" : "etapas"}`,
    `${completo.conexoes.length} ${completo.conexoes.length === 1 ? "conexão" : "conexões"}`,
  ];
  if (completo.conexoes.some((c) => c.tipo === "RETRABALHO" || c.tipo === "EXCECAO")) {
    partes.push("com retorno");
  }
  return partes.join(" · ");
}

/** As categorias presentes na lista, para o filtro — sem repetição e ordenadas. */
export function categoriasDaLista(fluxos: FluxoNaLista[]): string[] {
  return [...new Set(fluxos.map((f) => f.categoria))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** O recorte da lista — o que a tela mostra depois dos filtros. */
export function filtrarFluxos(
  fluxos: FluxoNaLista[],
  filtro: { busca?: string; categoria?: string | null },
): FluxoNaLista[] {
  const busca = (filtro.busca ?? "").trim().toLowerCase();
  return fluxos.filter((f) => {
    if (filtro.categoria && f.categoria !== filtro.categoria) return false;
    if (busca === "") return true;
    return (
      f.nome.toLowerCase().includes(busca) ||
      f.categoria.toLowerCase().includes(busca) ||
      (f.descricao ?? "").toLowerCase().includes(busca) ||
      (f.dono ?? "").toLowerCase().includes(busca)
    );
  });
}

/**
 * Quantas etapas o roteiro digitado vai criar — o contador embaixo da caixa.
 *
 * **Não é o interpretador.** A gramática (tipos entre colchetes, `|`, `+`) mora
 * no servidor, em `interpretarRoteiro`, e é lá que ela é validada; aqui só se
 * conta o que conta como linha, para a pessoa ver "13 etapas" enquanto digita
 * em vez de descobrir o número depois de gravar. As duas definições de "linha
 * que vale" precisam coincidir, e é por isso que esta função tem teste.
 */
export function etapasDoRoteiro(texto: string): number {
  return texto
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter((linha) => linha !== "" && !linha.startsWith("#")).length;
}

/** `2026-08-27T12:00:00Z` → `27/08/2026`. Sem biblioteca, e sem recuar o dia. */
export function comoData(iso: string): string {
  const [data] = iso.split("T");
  const [ano, mes, dia] = data.split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}

/**
 * "há 2 dias", "há 1 semana" — quando o fluxo mudou pela última vez, como se
 * fala em voz alta.
 *
 * A data absoluta (`comoData`) responde "quando"; esta responde "está velho?",
 * que é a pergunta de quem bate o olho na lista para decidir o que reabrir.
 * As duas convivem: a lista mostra a relativa, o detalhe mostra a exata.
 *
 * A conta é feita em dias de calendário, não em horas: um fluxo salvo ontem às
 * 23h continua sendo "ontem" quando alguém abre a tela às 8h, e não "há 9
 * horas" nem "hoje".
 */
export function comoTempoRelativo(iso: string, agora: Date = new Date()): string {
  const [data] = iso.split("T");
  const [ano, mes, dia] = data.split("-").map(Number);
  if (!ano || !mes || !dia) return comoData(iso);

  const entao = Date.UTC(ano, mes - 1, dia);
  const hoje = Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const dias = Math.floor((hoje - entao) / 86_400_000);

  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias} dias`;
  if (dias < 30) {
    const semanas = Math.floor(dias / 7);
    return semanas === 1 ? "há 1 semana" : `há ${semanas} semanas`;
  }
  if (dias < 365) {
    const meses = Math.floor(dias / 30);
    return meses === 1 ? "há 1 mês" : `há ${meses} meses`;
  }
  const anos = Math.floor(dias / 365);
  return anos === 1 ? "há 1 ano" : `há ${anos} anos`;
}

/**
 * A cor da linha — a tarja à esquerda e a bolha do ícone, pela categoria.
 *
 * Serve para achar "aquele fluxo financeiro" varrendo a lista com o olho, antes
 * de ler nome nenhum. Por isso a cor **não** é sorteada nem tirada da posição na
 * lista: ela sai do nome da categoria, e assim a mesma categoria fica com a
 * mesma cor entre sessões, entre telas e depois de reordenar.
 */
export function acentoDaCategoria(categoria: string): { barra: string; bolha: string } {
  const paleta = [
    { barra: "bg-blue-500", bolha: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300" },
    {
      barra: "bg-emerald-500",
      bolha: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300",
    },
    {
      barra: "bg-violet-500",
      bolha: "bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-300",
    },
    {
      barra: "bg-amber-500",
      bolha: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300",
    },
    {
      barra: "bg-rose-500",
      bolha: "bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-300",
    },
  ];
  let soma = 0;
  for (const letra of categoria.trim().toLowerCase()) soma = (soma * 31 + letra.charCodeAt(0)) % 9973;
  return paleta[soma % paleta.length];
}

/**
 * A lista na ordem em que se procura: o que mudou por último em cima.
 *
 * Quem abre esta tela quase sempre volta para o que estava mexendo — ordem
 * alfabética serve para quem já sabe o nome, e essa pessoa usa a busca.
 * Arquivados vão para o fim: continuam no acervo, saem do caminho.
 */
export function ordenarPorAtualizacao(fluxos: FluxoNaLista[]): FluxoNaLista[] {
  return [...fluxos].sort((a, b) => {
    const arquivado = Number(a.status === "ARQUIVADO") - Number(b.status === "ARQUIVADO");
    if (arquivado !== 0) return arquivado;
    return b.atualizadoEm.localeCompare(a.atualizadoEm);
  });
}

/** Uma linha da lista com o que ela detalha pendurado embaixo. */
export interface RamoDeFluxos {
  fluxo: FluxoNaLista;
  filhos: RamoDeFluxos[];
}

/**
 * A LISTA PLANA VIRA ÁRVORE — um subfluxo aparece dentro do fluxo que o detalha.
 *
 * Sem isto, "Origem da tarifa e das informações do trecho" fica ao lado de
 * "Operação Empurrada", do mesmo tamanho e no mesmo nível, como se fossem dois
 * processos irmãos — e a lista de processos da empresa cresce um item cada vez
 * que alguém detalha uma etapa. São a mesma coisa vista de duas alturas.
 *
 * Três decisões, e todas vêm de a árvore ser montada sobre uma lista que já foi
 * filtrada e recortada:
 *
 * - **Órfão sobe.** Quem tem pai fora da lista (a busca pegou o filho e não o
 *   pai, ou o pai está arquivado e escondido) vira raiz. O contrário seria
 *   sumir com uma linha que passou pelo filtro — a busca deixaria de achar.
 * - **Ciclo não trava.** `ligarSubfluxo` recusa ciclo na gravação, mas a tela
 *   desenha o que vier: uma referência circular herdada de um dado antigo faria
 *   laço infinito aqui, então quem já foi visitado não é pendurado de novo.
 * - **A ordem de dentro é a de fora.** Os filhos saem na mesma ordem em que
 *   chegaram, para que trocar `ordenarPorAtualizacao` não precise ser lembrado
 *   em dois lugares.
 */
export function aninharSubfluxos(fluxos: FluxoNaLista[]): RamoDeFluxos[] {
  const ramos = new Map(fluxos.map((fluxo) => [fluxo.id, { fluxo, filhos: [] as RamoDeFluxos[] }]));
  const raizes: RamoDeFluxos[] = [];

  for (const ramo of ramos.values()) {
    const pai = ramo.fluxo.pai ? ramos.get(ramo.fluxo.pai.fluxoId) : undefined;
    if (pai && !ehDescendente(ramos, ramo.fluxo.id, pai.fluxo)) pai.filhos.push(ramo);
    else raizes.push(ramo);
  }

  return raizes;
}

/** `possivelPai` já pende de `id`? Então pendurar `id` nele fecharia um laço. */
function ehDescendente(
  ramos: Map<string, RamoDeFluxos>,
  id: string,
  possivelPai: FluxoNaLista,
): boolean {
  const visitados = new Set<string>();
  let atual: FluxoNaLista | undefined = possivelPai;
  while (atual && !visitados.has(atual.id)) {
    if (atual.id === id) return true;
    visitados.add(atual.id);
    atual = atual.pai ? ramos.get(atual.pai.fluxoId)?.fluxo : undefined;
  }
  return false;
}

/** Quantas linhas a árvore tem ao todo — o contador do cabeçalho da seção. */
export function contarRamos(ramos: RamoDeFluxos[]): number {
  return ramos.reduce((total, ramo) => total + 1 + contarRamos(ramo.filhos), 0);
}

// ---------------------------------------------------------------------------
// Consultas e mutações
// ---------------------------------------------------------------------------

/**
 * A empresa vai na query string de **toda** chamada, e faz parte da chave do
 * cache.
 *
 * Sem ela na chave, trocar de empresa mostraria o fluxo da anterior enquanto a
 * consulta nova não voltasse — o único jeito de esta tela exibir dado de outra
 * empresa, e justamente o que o módulo inteiro existe para não fazer.
 */
function comEmpresa(caminho: string, empresaId: string | null, extra?: Record<string, string>) {
  const query = new URLSearchParams(extra ?? {});
  if (empresaId) query.set("empresaId", empresaId);
  const texto = query.toString();
  return texto === "" ? caminho : `${caminho}?${texto}`;
}

export const chaveDosFluxos = (empresaId: string | null, incluirArquivados: boolean): QueryKey => [
  "fluxos",
  empresaId,
  incluirArquivados,
];

export const chaveDoFluxo = (empresaId: string | null, fluxoId: string): QueryKey => [
  "fluxo",
  empresaId,
  fluxoId,
];

export function useCatalogoDeFluxos() {
  return useQuery({
    queryKey: ["fluxos", "catalogo"],
    queryFn: () => fetchJson<Catalogo>("/fluxos/catalogo"),
    /* O vocabulário só muda quando o código muda: não vale reconsultar. */
    staleTime: Infinity,
  });
}

export function useFluxos(empresaId: string | null, incluirArquivados: boolean) {
  return useQuery({
    queryKey: chaveDosFluxos(empresaId, incluirArquivados),
    enabled: empresaId !== null,
    queryFn: () =>
      fetchJson<{ empresaId: string; fluxos: FluxoNaLista[] }>(
        comEmpresa("/fluxos", empresaId, incluirArquivados ? { incluirArquivados: "1" } : {}),
      ),
  });
}

export function lerFluxoAgora(empresaId: string | null, fluxoId: string): Promise<FluxoCompleto> {
  return fetchJson<FluxoCompleto>(comEmpresa(`/fluxos/${fluxoId}`, empresaId));
}

export function useFluxo(empresaId: string | null, fluxoId: string) {
  return useQuery({
    queryKey: chaveDoFluxo(empresaId, fluxoId),
    enabled: empresaId !== null && fluxoId !== "",
    queryFn: () => lerFluxoAgora(empresaId, fluxoId),
  });
}

/**
 * O CORPO DE UMA ETAPA JÁ GRAVADA — e por que ele é montado inteiro.
 *
 * `PUT /fluxos/:id/etapas/:etapaId` é substituição, não remendo: o servidor
 * valida o corpo inteiro e o que não vem volta nulo. Mandar `{ area: "Fiscal" }`
 * para corrigir uma área apagaria descrição, objetivo, regras, observações e a
 * posição do cartão — sem erro nenhum na tela, que é a pior forma.
 *
 * Quem só quer trocar um campo monta `{ ...corpoDaEtapa(etapa), area: "Fiscal" }`.
 * As listas (itens, indicadores, ações) não entram aqui porque não entram nessa
 * rota: cada uma tem o seu caminho, e é o que faz gravar uma coluna não tocar em
 * nada que esteja fora dela.
 */
export function corpoDaEtapa(etapa: Etapa): Record<string, unknown> {
  return {
    nome: etapa.nome,
    tipo: etapa.tipo,
    status: etapa.status,
    area: etapa.area ?? "",
    responsavel: etapa.responsavel ?? "",
    sistemaPrincipal: etapa.sistemaPrincipal ?? "",
    descricao: etapa.descricao ?? "",
    objetivo: etapa.objetivo ?? "",
    regras: etapa.regras ?? "",
    falhas: etapa.falhas ?? "",
    gargalos: etapa.gargalos ?? "",
    informacoes: etapa.informacoes ?? "",
    /* Vai de volta como veio: é o backup do texto antigo, e não um campo da tela. */
    observacoes: etapa.observacoes ?? "",
    informacoesConsultadas: etapa.informacoesConsultadas ?? "",
    chaveMonitoramento: etapa.chaveMonitoramento ?? "",
    ordem: etapa.ordem,
    posX: etapa.posX,
    posY: etapa.posY,
  };
}

/**
 * As escritas, todas por aqui — e cada uma com o seu caminho nomeado.
 *
 * Nenhuma delas monta URL fora deste arquivo, e nenhuma manda `empresaId` no
 * corpo: o escopo é query string, sempre, porque é assim que o servidor o lê e
 * é o único jeito de as duas pontas não discordarem.
 */
/*
  O cabeçalho é escrito **literalmente** em cada chamada, e não por uma
  constante compartilhada. Parece repetição e é uma regra deste repositório com
  teste próprio: `lib/__tests__/corpo-json.test.ts` varre o texto-fonte
  procurando todo `body: JSON.stringify` sem `Content-Type: application/json` no
  mesmo objeto de opções. Uma constante passaria batido pela varredura — e a
  varredura existe porque, sem o cabeçalho, o `express.json()` não desserializa
  e a rota roda com `req.body` vazio, sem erro nenhum.
*/
export const escritas = {
  criarFluxo: (empresaId: string | null, corpo: unknown) =>
    fetchJson<Fluxo>(comEmpresa("/fluxos", empresaId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    }),
  /*
    Semear os processos que a empresa já tem mapeados — o que a lista vazia
    pede uma vez, sem botão. Quem decide o que entra é o servidor: a tela não
    tem, e não deve ter, a lista do que é mapa da empresa e do que é exemplo.
  */
  semearJaMapeados: (empresaId: string | null) =>
    fetchJson<{ empresaId: string; fluxos: Fluxo[] }>(comEmpresa("/fluxos/semear", empresaId), {
      method: "POST",
    }),
  criarDeModelo: (empresaId: string | null, modelo: string) =>
    fetchJson<Fluxo>(comEmpresa("/fluxos/de-modelo", empresaId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelo }),
    }),
  /*
    Criar a partir de um roteiro em texto — uma etapa por linha.

    O texto vai cru para o servidor e é lá que ele é interpretado, por
    `interpretarRoteiro`. A tela **não** tem a gramática: uma segunda cópia dela
    aqui aceitaria hoje o que o servidor recusa amanhã, e a pessoa descobriria
    isso com o texto já digitado.
  */
  criarDeRoteiro: (empresaId: string | null, corpo: unknown) =>
    fetchJson<Fluxo>(comEmpresa("/fluxos/roteiro", empresaId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    }),
  acrescentarRoteiro: (
    empresaId: string | null,
    fluxoId: string,
    corpo: { roteiro: string; origem?: string | null },
  ) =>
    fetchJson<{ etapasCriadas: number; conexoesCriadas: number }>(
      comEmpresa(`/fluxos/${fluxoId}/roteiro`, empresaId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      },
    ),
  organizar: (empresaId: string | null, fluxoId: string, refazerTudo: boolean) =>
    fetchJson<{ movidas: number }>(comEmpresa(`/fluxos/${fluxoId}/organizar`, empresaId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refazerTudo }),
    }),
  atualizarFluxo: (empresaId: string | null, fluxoId: string, corpo: unknown) =>
    fetchJson<Fluxo>(comEmpresa(`/fluxos/${fluxoId}`, empresaId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    }),
  arquivar: (empresaId: string | null, fluxoId: string) =>
    fetchJson<Fluxo>(comEmpresa(`/fluxos/${fluxoId}/arquivar`, empresaId), { method: "POST" }),
  desarquivar: (empresaId: string | null, fluxoId: string) =>
    fetchJson<Fluxo>(comEmpresa(`/fluxos/${fluxoId}/desarquivar`, empresaId), { method: "POST" }),
  duplicar: (empresaId: string | null, fluxoId: string, nome: string) =>
    fetchJson<Fluxo>(comEmpresa(`/fluxos/${fluxoId}/duplicar`, empresaId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome }),
    }),
  criarEtapa: (empresaId: string | null, fluxoId: string, corpo: unknown) =>
    fetchJson<Etapa>(comEmpresa(`/fluxos/${fluxoId}/etapas`, empresaId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    }),
  atualizarEtapa: (empresaId: string | null, fluxoId: string, etapaId: string, corpo: unknown) =>
    fetchJson<Etapa>(comEmpresa(`/fluxos/${fluxoId}/etapas/${etapaId}`, empresaId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    }),
  excluirEtapa: (empresaId: string | null, fluxoId: string, etapaId: string) =>
    fetchJson<void>(comEmpresa(`/fluxos/${fluxoId}/etapas/${etapaId}`, empresaId), {
      method: "DELETE",
    }),
  salvarPosicoes: (
    empresaId: string | null,
    fluxoId: string,
    posicoes: { etapaId: string; posX: number; posY: number }[],
  ) =>
    fetchJson<{ gravadas: number }>(comEmpresa(`/fluxos/${fluxoId}/posicoes`, empresaId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posicoes }),
    }),
  /*
    Detalhar a etapa — o fluxo do detalhe nasce e já fica ligado.

    Duas escritas separadas para dois pedidos diferentes, como no servidor:
    `detalharEtapa` cria, `ligarSubfluxo` aponta para um fluxo que já existe.
    Uma função só, decidindo pelo corpo, esconderia qual das duas aconteceu.
  */
  detalharEtapa: (empresaId: string | null, fluxoId: string, etapaId: string, nome?: string) =>
    fetchJson<Fluxo>(comEmpresa(`/fluxos/${fluxoId}/etapas/${etapaId}/detalhar`, empresaId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: nome ?? null }),
    }),
  ligarSubfluxo: (
    empresaId: string | null,
    fluxoId: string,
    etapaId: string,
    subfluxoId: string,
  ) =>
    fetchJson<Etapa>(comEmpresa(`/fluxos/${fluxoId}/etapas/${etapaId}/subfluxo`, empresaId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subfluxoId }),
    }),
  desligarSubfluxo: (empresaId: string | null, fluxoId: string, etapaId: string) =>
    fetchJson<Etapa>(comEmpresa(`/fluxos/${fluxoId}/etapas/${etapaId}/subfluxo`, empresaId), {
      method: "DELETE",
    }),
  criarConexao: (empresaId: string | null, fluxoId: string, corpo: unknown) =>
    fetchJson<Conexao>(comEmpresa(`/fluxos/${fluxoId}/conexoes`, empresaId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    }),
  atualizarConexao: (
    empresaId: string | null,
    fluxoId: string,
    conexaoId: string,
    corpo: unknown,
  ) =>
    fetchJson<Conexao>(comEmpresa(`/fluxos/${fluxoId}/conexoes/${conexaoId}`, empresaId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    }),
  excluirConexao: (empresaId: string | null, fluxoId: string, conexaoId: string) =>
    fetchJson<void>(comEmpresa(`/fluxos/${fluxoId}/conexoes/${conexaoId}`, empresaId), {
      method: "DELETE",
    }),
  salvarItens: (
    empresaId: string | null,
    fluxoId: string,
    etapaId: string,
    especie: string,
    itens: unknown[],
  ) =>
    fetchJson<Etapa>(
      comEmpresa(`/fluxos/${fluxoId}/etapas/${etapaId}/itens/${especie}`, empresaId),
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itens }) },
    ),
  salvarIndicadores: (
    empresaId: string | null,
    fluxoId: string,
    etapaId: string,
    indicadores: unknown[],
  ) =>
    fetchJson<Etapa>(comEmpresa(`/fluxos/${fluxoId}/etapas/${etapaId}/indicadores`, empresaId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ indicadores }),
    }),
  salvarAcoes: (empresaId: string | null, fluxoId: string, etapaId: string, acoes: unknown[]) =>
    fetchJson<Etapa>(comEmpresa(`/fluxos/${fluxoId}/etapas/${etapaId}/acoes`, empresaId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acoes }),
    }),
};

/**
 * Depois de escrever, a leitura do fluxo é invalidada — e a lista também.
 *
 * Uma só função porque toda escrita deste módulo muda as duas coisas: o desenho
 * aberto e a contagem de etapas que a listagem mostra. Espalhar dois
 * `invalidateQueries` por mutação é como uma delas acaba esquecida.
 */
export function useRecarregarFluxos(empresaId: string | null) {
  const cliente = useQueryClient();
  return (fluxoId?: string) => {
    void cliente.invalidateQueries({ queryKey: ["fluxos", empresaId] });
    void cliente.invalidateQueries({ queryKey: chaveDosFluxos(empresaId, true) });
    void cliente.invalidateQueries({ queryKey: chaveDosFluxos(empresaId, false) });
    if (fluxoId) void cliente.invalidateQueries({ queryKey: chaveDoFluxo(empresaId, fluxoId) });
  };
}

// ---------------------------------------------------------------------------
// A empresa
// ---------------------------------------------------------------------------

export interface EmpresaCadastrada {
  id: string | null;
  nome: string;
  cnpj: string;
  cnpjFormatado: string;
  estado: string;
}

/**
 * As empresas que este módulo aceita — as unidades **cadastradas**.
 *
 * A rota `/unidades/canonicas` também devolve as unidades apenas detectadas no
 * acervo, que têm `id` nulo: elas não são identidade ainda, e um fluxo não pode
 * pertencer a algo que ninguém confirmou. Filtrar aqui é o que faz o seletor
 * não oferecer uma escolha que a gravação recusaria.
 */
export function useEmpresas() {
  return useQuery({
    queryKey: ["fluxos", "empresas"],
    queryFn: async () => {
      const linhas = await fetchJson<EmpresaCadastrada[]>("/unidades/canonicas");
      return linhas.filter((u): u is EmpresaCadastrada & { id: string } => u.id !== null);
    },
  });
}
