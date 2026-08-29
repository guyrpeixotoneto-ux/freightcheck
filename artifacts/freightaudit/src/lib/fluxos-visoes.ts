import type { Conexao, Etapa, FluxoCompleto } from "@/lib/fluxos";

/**
 * O MOTOR DE VISUALIZAÇÃO — o mesmo processo, projetado de sete jeitos.
 *
 * Este arquivo é a resposta à única regra que o módulo não pode quebrar: existe
 * **uma** fonte de verdade do processo, e ela é o `FluxoCompleto` que a API
 * devolve — o fluxo, as etapas e as conexões. Nenhuma visualização tem fluxo
 * próprio, etapa própria, conexão própria ou versão própria. O que cada uma tem
 * é uma **projeção**: uma função pura que recebe o mesmo `FluxoCompleto` e
 * devolve coordenadas, faixas ou uma lista ordenada.
 *
 * Daí a consequência que os testes cobrem: trocar de visualização não escreve
 * nada. Não há mutação aqui dentro, não há `fetch`, não há `escritas`. Alternar
 * Fluxo → Raias → Lista → Gargalos → Fluxo é recalcular funções puras sobre o
 * objeto que já está no cache do React Query, e por isso não pode criar linha
 * nenhuma no banco: não existe caminho de código por onde isso aconteceria.
 *
 * A sétima projeção, o Monitoramento, é a única que **busca** — e o que ela
 * busca é uma leitura: `GET /fluxos/:id/monitoramento` apura o farol e não grava
 * nada. A promessa continua de pé; o que muda é que agora ela vale por dois
 * motivos, e não por um só.
 *
 * ---------------------------------------------------------------------------
 * O que é persistido, e o que é calculado
 * ---------------------------------------------------------------------------
 *
 * `pos_x`/`pos_y` continuam sendo o arranjo que a pessoa montou **no Fluxo
 * vertical**, e continuam sendo a única posição gravada. Todas as outras
 * disposições — o fluxo horizontal, as raias, o mapa — são **derivadas na
 * hora**, de forma determinística, a partir do grafo.
 *
 * A alternativa seria guardar um layout por visualização (`layout.raias.area`,
 * `layout.fluxo.horizontal`…), e ela foi recusada de propósito: seriam N
 * conjuntos de coordenadas para manter em dia a cada etapa criada, movida ou
 * excluída, com N chances de o desenho de uma visualização discordar do
 * processo. Como as projeções são determinísticas, ir para as Raias e voltar
 * devolve exatamente o arranjo arrastado — sem guardar nada — que é a garantia
 * que o pedido de fato precisa. Se um dia alguém precisar arrastar cartão
 * **dentro** das raias, o lugar de guardar isso é uma tabela de layout à parte
 * (`fluxo_etapa_layout`, com `visualizacao` na chave), nunca uma segunda cópia
 * da etapa.
 */

// ---------------------------------------------------------------------------
// O vocabulário das visualizações
// ---------------------------------------------------------------------------

export type Visualizacao =
  | "fluxo"
  | "raias"
  | "jornada"
  | "mapa"
  | "lista"
  | "gargalos"
  | "monitoramento";

export type Orientacao = "vertical" | "horizontal";

/** Por qual coluna da etapa as raias são agrupadas. */
export type AgrupamentoDeRaia = "area" | "responsavel" | "sistema";

/**
 * Qual leitura a Jornada faz do mesmo caminho.
 *
 * A Jornada é a linha do tempo do processo, e a linha do tempo não muda: as
 * etapas são as mesmas, na mesma ordem, com a mesma numeração. O que a lente
 * troca é **qual campo da etapa** cada cartão mostra — quem responde e em que
 * sistema, o que está documentado, o que costuma falhar, o que trava, o que a
 * etapa mede.
 *
 * É a mesma decisão do resto do motor: nenhuma lente tem dado próprio. Cada uma
 * é uma função pura sobre a linha que a Lista já monta, e por isso trocar de
 * lente não busca nada, não grava nada e não pode discordar do processo.
 */
export type LenteDaJornada =
  | "operacao"
  | "documentacao"
  | "falhas"
  | "gargalos"
  | "informacoes";

export interface EntradaDeVisualizacao {
  valor: Visualizacao;
  rotulo: string;
  descricao: string;
  /** O nome do ícone `lucide-react` que o seletor monta. */
  icone: string;
  /** A visualização desenha no canvas (pan, zoom, setas)? */
  ehCanvas: boolean;
}

/**
 * As sete visualizações, num lugar só.
 *
 * Mesma decisão do catálogo do motor: a lista é dado, e não um `switch`
 * espalhado por componente. Acrescentar uma sétima projeção é uma entrada aqui
 * e um componente — nunca uma condicional nova em cada arquivo da tela.
 */
export const VISUALIZACOES: readonly EntradaDeVisualizacao[] = [
  {
    valor: "fluxo",
    rotulo: "Fluxo",
    descricao: "O fluxograma: etapas, decisões, retornos e exceções.",
    icone: "Workflow",
    ehCanvas: true,
  },
  {
    valor: "raias",
    rotulo: "Raias",
    descricao: "O processo separado por quem responde — os handoffs à vista.",
    icone: "Rows3",
    ehCanvas: true,
  },
  {
    valor: "jornada",
    rotulo: "Jornada",
    descricao: "A linha do tempo do processo, para leitura executiva.",
    icone: "Milestone",
    ehCanvas: false,
  },
  {
    valor: "mapa",
    rotulo: "Mapa",
    descricao: "O processo inteiro de uma vez, em cartões compactos.",
    icone: "Map",
    ehCanvas: true,
  },
  {
    valor: "lista",
    rotulo: "Lista",
    descricao: "A tabela das etapas — busca, filtros e auditoria.",
    icone: "Table2",
    ehCanvas: false,
  },
  {
    valor: "gargalos",
    rotulo: "Gargalos",
    descricao: "O mesmo desenho, com os sinais de risco em cima.",
    icone: "AlertTriangle",
    ehCanvas: true,
  },
  /*
    A sétima, e a única que não é projeção pura: ela lê o farol apurado pelo
    servidor (`GET /fluxos/:id/monitoramento`). Entra no fim porque é a única
    que responde sobre o **agora** — as seis acima descrevem o processo
    desenhado, esta descreve o que os dados dizem dele hoje.

    Continua sem dado próprio do processo: as etapas são as mesmas, na mesma
    quantidade, vindas do mesmo `FluxoCompleto`. O que ela acrescenta é uma
    leitura por etapa, e o que ela nunca faz é esconder a etapa que ninguém
    mede — ver `visao-monitoramento.tsx`.
  */
  {
    valor: "monitoramento",
    rotulo: "Monitoramento",
    descricao: "O farol de cada etapa, com o que os coletores mediram agora.",
    icone: "Activity",
    ehCanvas: false,
  },
];

const VISUALIZACOES_VALIDAS = new Set(VISUALIZACOES.map((v) => v.valor));

export const ehVisualizacao = (v: unknown): v is Visualizacao =>
  typeof v === "string" && VISUALIZACOES_VALIDAS.has(v as Visualizacao);

export interface EntradaDeLente {
  valor: LenteDaJornada;
  rotulo: string;
  descricao: string;
  /** O nome do ícone `lucide-react` que o seletor monta. */
  icone: string;
  /**
   * O cartão mostra os selos da etapa (o tipo e o "Atenção")?
   *
   * Verdadeiro só na Operação, que é a leitura executiva do processo — ali o
   * tipo da etapa é parte do assunto. Nas lentes focadas o cartão é uma linha
   * de uma leitura só — o número, o nome da etapa e o documento (ou a falha, ou
   * o gargalo) —, e o selo de tipo ("Sistema", "Validação") é justamente a
   * informação de outra pergunta: some para que a coluna da lente seja a única
   * coisa que se lê de cima a baixo. O tipo e o "Atenção" continuam no
   * fluxograma, na Lista e no painel da etapa.
   */
  selos: boolean;
}

/**
 * As lentes da Jornada, num lugar só — dado, e não um `switch` na tela.
 *
 * "Operação" é a primeira porque é a leitura executiva de sempre, a que a
 * Jornada já fazia: quem, onde, em quanto tempo. As outras quatro respondem
 * perguntas que antes obrigavam a abrir etapa por etapa no painel.
 */
export const LENTES_DA_JORNADA: readonly EntradaDeLente[] = [
  {
    valor: "operacao",
    rotulo: "Operação",
    descricao: "Quem responde, em que sistema, em quanto tempo.",
    icone: "Users",
    selos: true,
  },
  {
    valor: "documentacao",
    rotulo: "Documentação",
    descricao: "Só os documentos de cada etapa — o fluxo documental, de ponta a ponta.",
    icone: "FileText",
    selos: false,
  },
  {
    valor: "falhas",
    rotulo: "Falhas",
    descricao: "Só o que costuma dar errado em cada etapa.",
    icone: "AlertTriangle",
    selos: false,
  },
  {
    valor: "gargalos",
    rotulo: "Gargalos",
    descricao: "Só o que trava a etapa, mesmo quando nada falha.",
    icone: "Hourglass",
    selos: false,
  },
  {
    valor: "informacoes",
    rotulo: "Dados",
    descricao: "Só o que a etapa consulta para conseguir ser feita.",
    icone: "Activity",
    selos: false,
  },
];

const LENTES_VALIDAS = new Set(LENTES_DA_JORNADA.map((l) => l.valor));

export const ehLenteDaJornada = (v: unknown): v is LenteDaJornada =>
  typeof v === "string" && LENTES_VALIDAS.has(v as LenteDaJornada);

export const AGRUPAMENTOS_DE_RAIA: readonly { valor: AgrupamentoDeRaia; rotulo: string }[] = [
  { valor: "area", rotulo: "Área" },
  { valor: "responsavel", rotulo: "Responsável" },
  { valor: "sistema", rotulo: "Sistema" },
];

// ---------------------------------------------------------------------------
// A preferência de quem está olhando
// ---------------------------------------------------------------------------

const CHAVE_DA_PREFERENCIA = "freightcheck.fluxos.visualizacao";

export interface PreferenciaDeVisualizacao {
  visualizacao: Visualizacao;
  orientacao: Orientacao;
  agrupamento: AgrupamentoDeRaia;
  /** O tipo de jornada — só a Jornada usa. */
  lente: LenteDaJornada;
}

export const PREFERENCIA_PADRAO: PreferenciaDeVisualizacao = {
  visualizacao: "fluxo",
  orientacao: "vertical",
  agrupamento: "area",
  lente: "operacao",
};

/**
 * A última escolha volta na próxima abertura — e uma leitura que falhe nunca
 * derruba a tela.
 *
 * Fica em `localStorage`, e não no banco, porque é preferência de quem olha e
 * não fato do processo: guardá-la ao lado do fluxo faria a escolha de uma pessoa
 * mudar a tela de outra. `try/catch` porque `localStorage` lança em janela
 * privada e em contexto sem DOM — e um seletor de visualização não é motivo
 * para uma tela inteira não abrir.
 */
export function lerPreferencia(): PreferenciaDeVisualizacao {
  try {
    const cru = globalThis.localStorage?.getItem(CHAVE_DA_PREFERENCIA);
    if (!cru) return PREFERENCIA_PADRAO;
    return normalizarPreferencia(JSON.parse(cru));
  } catch {
    return PREFERENCIA_PADRAO;
  }
}

export function gravarPreferencia(preferencia: PreferenciaDeVisualizacao): void {
  try {
    globalThis.localStorage?.setItem(CHAVE_DA_PREFERENCIA, JSON.stringify(preferencia));
  } catch {
    /* Sem armazenamento, a preferência simplesmente não sobrevive à sessão. */
  }
}

/** Um valor guardado por uma versão anterior nunca quebra a tela de hoje. */
export function normalizarPreferencia(cru: unknown): PreferenciaDeVisualizacao {
  const objeto = (cru ?? {}) as Record<string, unknown>;
  return {
    visualizacao: ehVisualizacao(objeto.visualizacao)
      ? objeto.visualizacao
      : PREFERENCIA_PADRAO.visualizacao,
    orientacao: objeto.orientacao === "horizontal" ? "horizontal" : "vertical",
    agrupamento: AGRUPAMENTOS_DE_RAIA.some((a) => a.valor === objeto.agrupamento)
      ? (objeto.agrupamento as AgrupamentoDeRaia)
      : PREFERENCIA_PADRAO.agrupamento,
    lente: ehLenteDaJornada(objeto.lente) ? objeto.lente : PREFERENCIA_PADRAO.lente,
  };
}

// ---------------------------------------------------------------------------
// A topologia — calculada uma vez, usada por todas as projeções
// ---------------------------------------------------------------------------

/**
 * Os níveis do grafo, por distância da origem.
 *
 * É a mesma busca em largura de `@workspace/fluxos/layout.ts`, e a repetição é
 * consciente: aquele pacote exporta o repositório junto (drizzle, banco), e
 * importá-lo aqui arrastaria o servidor inteiro para dentro do bundle da tela.
 * O que se repete são trinta linhas de grafo puro, com teste dos dois lados —
 * o que **não** se repete é regra de negócio: o desenho continua saindo do
 * mesmo dado, e o layout gravado continua sendo calculado só no servidor.
 */
export function niveisDoFluxo(etapas: Etapa[], conexoes: Conexao[]): string[][] {
  if (etapas.length === 0) return [];

  const existe = new Set(etapas.map((e) => e.id));
  const saidas = new Map<string, string[]>();
  const grauDeEntrada = new Map<string, number>();
  for (const etapa of etapas) {
    saidas.set(etapa.id, []);
    grauDeEntrada.set(etapa.id, 0);
  }
  for (const conexao of conexoes) {
    if (!existe.has(conexao.origemEtapaId) || !existe.has(conexao.destinoEtapaId)) continue;
    saidas.get(conexao.origemEtapaId)!.push(conexao.destinoEtapaId);
    grauDeEntrada.set(conexao.destinoEtapaId, (grauDeEntrada.get(conexao.destinoEtapaId) ?? 0) + 1);
  }

  const porOrdem = [...etapas].sort(
    (a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"),
  );

  const raizes = porOrdem.filter((e) => (grauDeEntrada.get(e.id) ?? 0) === 0).map((e) => e.id);
  const fila: string[] = raizes.length > 0 ? [...raizes] : [porOrdem[0].id];

  const nivelDe = new Map<string, number>();
  for (const id of fila) nivelDe.set(id, 0);

  for (let i = 0; i < fila.length; i += 1) {
    const atual = fila[i];
    const nivel = nivelDe.get(atual)!;
    for (const destino of saidas.get(atual) ?? []) {
      if (nivelDe.has(destino)) continue;
      nivelDe.set(destino, nivel + 1);
      fila.push(destino);
    }
  }

  /* O que não é alcançável vai para o fim, em níveis próprios — nunca some. */
  let proximo = Math.max(-1, ...nivelDe.values()) + 1;
  for (const etapa of porOrdem) {
    if (!nivelDe.has(etapa.id)) {
      nivelDe.set(etapa.id, proximo);
      proximo += 1;
    }
  }

  const niveis: string[][] = [];
  for (const etapa of porOrdem) {
    const nivel = nivelDe.get(etapa.id)!;
    (niveis[nivel] ??= []).push(etapa.id);
  }
  return niveis.map((n) => n ?? []);
}

/**
 * A ordem de leitura do processo — a mesma para Jornada, Mapa, Lista e a
 * numeração dos cartões.
 *
 * É a topologia, e não `ordem`: a numeração "01, 02, 03" que a Jornada mostra
 * precisa seguir o caminho real do processo, e `ordem` é só o desempate de
 * quem foi cadastrado antes. Uma função só, usada por todas as projeções, é o
 * que impede a etapa 4 da Jornada de ser a etapa 6 da Lista.
 */
export function ordemDeLeitura(completo: FluxoCompleto): Etapa[] {
  const porId = new Map(completo.etapas.map((e) => [e.id, e]));
  return niveisDoFluxo(completo.etapas, completo.conexoes)
    .flat()
    .map((id) => porId.get(id))
    .filter((e): e is Etapa => e !== undefined);
}

/** A posição de leitura de cada etapa — `01`, `02`… — indexada por id. */
export function numeracaoDoFluxo(completo: FluxoCompleto): Map<string, number> {
  const numeros = new Map<string, number>();
  ordemDeLeitura(completo).forEach((etapa, indice) => numeros.set(etapa.id, indice + 1));
  return numeros;
}

// ---------------------------------------------------------------------------
// Projeção 1 e 2 — o Fluxo, vertical e horizontal
// ---------------------------------------------------------------------------

/** A largura de um cartão mais o respiro. Espelha o CSS do nó no canvas. */
export const PASSO_X = 260;
/**
 * A altura de uma faixa. Sobra para o rótulo da seta caber entre duas — e para
 * o losango da decisão, que é o cartão mais alto do desenho.
 */
export const PASSO_Y = 170;
/** Quantas colunas cabem numa linha antes de o desenho quebrar e continuar abaixo. */
export const COLUNAS_POR_LINHA = 8;
/** O respiro entre o caminho principal e a faixa dos desvios, na mesma linha. */
export const RESPIRO_DO_DESVIO = 40;
/** O respiro entre uma linha do desenho e a seguinte. */
export const RESPIRO_ENTRE_LINHAS = 90;

export type Posicoes = Map<string, { x: number; y: number }>;

/** As conexões que tiram a etapa do caminho feliz. */
const CONEXOES_DE_DESVIO = new Set(["EXCECAO", "RETRABALHO"]);
/** O tipo de etapa que, por definição, é tratamento de exceção. */
const TIPO_DE_DESVIO = "PENDENCIA";

/**
 * QUEM NÃO É CAMINHO FELIZ — a separação de que o desenho horizontal depende.
 *
 * Um fluxograma real não é uma fila: entre "emitir o documento" e "auditar" há
 * um "corrigir o cadastro" que só acontece quando algo deu errado. Enfileirar
 * os dois no mesmo trilho — que é o que o horizontal fazia — mente sobre o
 * processo (sugere que todo mundo passa pela correção) **e** estica o desenho
 * até o cartão virar um borrão na tela.
 *
 * O critério é o cadastro, não uma heurística de texto: é desvio a etapa de
 * tipo `PENDENCIA` — que o catálogo define como "espera ou tratamento de
 * exceção fora do caminho feliz" — e a etapa em que **só** se chega por exceção
 * ou retrabalho. A regra se propaga: o que só é alcançável a partir de um
 * desvio também é desvio, senão o segundo passo de um tratamento de exceção
 * voltaria para o trilho principal sozinho.
 *
 * E há uma trava: se a conta marcar o fluxo inteiro como desvio — um processo
 * cadastrado só com pendências —, ninguém é desvio. Um desenho sem caminho
 * principal não é uma leitura melhor do processo, é uma faixa vazia no topo.
 */
export function desviosDoFluxo(etapas: Etapa[], conexoes: Conexao[]): Set<string> {
  const existe = new Set(etapas.map((e) => e.id));
  const entradas = new Map<string, Conexao[]>();
  for (const etapa of etapas) entradas.set(etapa.id, []);
  for (const conexao of conexoes) {
    if (!existe.has(conexao.origemEtapaId) || !existe.has(conexao.destinoEtapaId)) continue;
    entradas.get(conexao.destinoEtapaId)!.push(conexao);
  }

  const desvios = new Set<string>();
  for (const etapa of etapas) {
    if (etapa.tipo === TIPO_DE_DESVIO) desvios.add(etapa.id);
  }

  /*
    O ponto fixo: a cada volta, quem só recebe de desvio vira desvio. Para em no
    máximo uma volta por etapa — que é o pior caso de uma cadeia inteira de
    tratamento de exceção descoberta um degrau por vez.
  */
  for (let volta = 0; volta < etapas.length; volta += 1) {
    let mudou = false;
    for (const etapa of etapas) {
      if (desvios.has(etapa.id)) continue;
      const chegadas = entradas.get(etapa.id) ?? [];
      if (chegadas.length === 0) continue;
      const soPorDesvio = chegadas.every(
        (c) => CONEXOES_DE_DESVIO.has(c.tipo) || desvios.has(c.origemEtapaId),
      );
      if (soPorDesvio) {
        desvios.add(etapa.id);
        mudou = true;
      }
    }
    if (!mudou) break;
  }

  return desvios.size === etapas.length ? new Set() : desvios;
}

/** Uma linha do desenho horizontal — o que a quebra produziu. */
export interface LinhaDoFluxo {
  /** O topo da linha, em coordenadas do canvas. */
  topo: number;
  /** A altura total: o caminho principal mais a faixa de desvios, quando há. */
  altura: number;
  /** A primeira coluna de leitura desta linha, e quantas ela carrega. */
  colunaInicial: number;
  colunas: number;
}

export interface ProjecaoDoFluxoHorizontal {
  posicoes: Posicoes;
  /** As etapas que saíram do trilho principal para a faixa de baixo. */
  desvios: Set<string>;
  /** A coluna de leitura de cada etapa — é nela que as fases se apoiam. */
  colunas: Map<string, number>;
  linhas: LinhaDoFluxo[];
}

/**
 * O FLUXO DEITADO — em trilho, em faixa de desvio, e quebrado em linhas.
 *
 * Três decisões, e as três existem pelo mesmo motivo: um processo de vinte
 * etapas tem que caber numa tela sem virar um fio de cabelo.
 *
 * **O trilho** é o caminho feliz, em cima, uma coluna por nível do grafo — a
 * mesma numeração que a Jornada e a Lista usam, porque é o mesmo grafo.
 *
 * **A faixa** é onde os desvios ficam: embaixo, na coluna de quem os originou.
 * Assim a pendência aparece pendurada na decisão que leva a ela, e o trilho de
 * cima continua legível como a leitura de "o que acontece quando dá certo".
 *
 * **A quebra** é o que o desenho antigo não tinha: passadas oito colunas, a
 * linha recomeça à esquerda, embaixo. Sem ela, quarenta etapas viram um
 * retângulo de dez mil pixels de largura, e o `fitView` — que é obrigado a
 * caber tudo — afasta a câmera até o texto sumir. É exatamente o desenho
 * ilegível que se via, e nenhuma mudança de cor ou de tipografia conserta,
 * porque o problema é a proporção da caixa.
 *
 * Nada aqui grava: `pos_x`/`pos_y` continuam sendo o arranjo do vertical, e
 * voltar para ele devolve o desenho intacto.
 */
export function projetarFluxoHorizontal(completo: FluxoCompleto): ProjecaoDoFluxoHorizontal {
  const posicoes: Posicoes = new Map();
  const colunas = new Map<string, number>();
  if (completo.etapas.length === 0) {
    return { posicoes, desvios: new Set(), colunas, linhas: [] };
  }

  const desvios = desviosDoFluxo(completo.etapas, completo.conexoes);
  const principais = completo.etapas.filter((e) => !desvios.has(e.id));
  const idsPrincipais = new Set(principais.map((e) => e.id));

  /*
    As colunas do trilho saem dos mesmos níveis de sempre — só que calculados no
    subgrafo do caminho feliz. Sem tirar as conexões de volta, o retrabalho
    empurraria a etapa de destino para depois da origem, e o desenho andaria
    para trás no meio da linha.
  */
  const conexoesDoTrilho = completo.conexoes.filter(
    (c) =>
      idsPrincipais.has(c.origemEtapaId) &&
      idsPrincipais.has(c.destinoEtapaId) &&
      !CONEXOES_DE_DESVIO.has(c.tipo),
  );
  niveisDoFluxo(principais, conexoesDoTrilho).forEach((idsDoNivel, indice) => {
    for (const id of idsDoNivel) colunas.set(id, indice);
  });

  /*
    O desvio herda a coluna de quem o originou — é o que o pendura embaixo da
    decisão que leva até ele. Em voltas, porque um desvio pode sair de outro.
  */
  for (let volta = 0; volta < completo.etapas.length; volta += 1) {
    let mudou = false;
    for (const etapa of completo.etapas) {
      if (colunas.has(etapa.id)) continue;
      const origens = completo.conexoes
        .filter((c) => c.destinoEtapaId === etapa.id && colunas.has(c.origemEtapaId))
        .map((c) => colunas.get(c.origemEtapaId)!);
      if (origens.length === 0) continue;
      colunas.set(etapa.id, Math.max(...origens));
      mudou = true;
    }
    if (!mudou) break;
  }

  /* O que não tem origem alcançável vai para o fim — nunca some do desenho. */
  const ultimaColuna = Math.max(0, ...colunas.values());
  for (const etapa of completo.etapas) {
    if (!colunas.has(etapa.id)) colunas.set(etapa.id, ultimaColuna);
  }

  const totalDeColunas = Math.max(...colunas.values()) + 1;
  const porColuna = Array.from({ length: totalDeColunas }, () => ({
    trilho: [] as string[],
    faixa: [] as string[],
  }));
  const emOrdem = [...completo.etapas].sort(
    (a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"),
  );
  for (const etapa of emOrdem) {
    const coluna = porColuna[colunas.get(etapa.id)!];
    (desvios.has(etapa.id) ? coluna.faixa : coluna.trilho).push(etapa.id);
  }

  const linhas: LinhaDoFluxo[] = [];
  let topo = 0;
  for (let inicio = 0; inicio < totalDeColunas; inicio += COLUNAS_POR_LINHA) {
    const fim = Math.min(inicio + COLUNAS_POR_LINHA, totalDeColunas);
    const daLinha = porColuna.slice(inicio, fim);
    const pilhaDoTrilho = Math.max(1, ...daLinha.map((c) => c.trilho.length));
    const pilhaDaFaixa = Math.max(0, ...daLinha.map((c) => c.faixa.length));
    const alturaDoTrilho = pilhaDoTrilho * PASSO_Y;
    const alturaDaFaixa = pilhaDaFaixa === 0 ? 0 : RESPIRO_DO_DESVIO + pilhaDaFaixa * PASSO_Y;

    daLinha.forEach((coluna, indice) => {
      const x = indice * PASSO_X;
      /* O trilho fica centrado na sua faixa: uma coluna de um cartão não cola no topo. */
      const recuo = (alturaDoTrilho - coluna.trilho.length * PASSO_Y) / 2;
      coluna.trilho.forEach((id, i) =>
        posicoes.set(id, { x, y: Math.round(topo + recuo + i * PASSO_Y) }),
      );
      coluna.faixa.forEach((id, i) =>
        posicoes.set(id, {
          x,
          y: Math.round(topo + alturaDoTrilho + RESPIRO_DO_DESVIO + i * PASSO_Y),
        }),
      );
    });

    linhas.push({
      topo,
      altura: alturaDoTrilho + alturaDaFaixa,
      colunaInicial: inicio,
      colunas: fim - inicio,
    });
    topo += alturaDoTrilho + alturaDaFaixa + RESPIRO_ENTRE_LINHAS;
  }

  return { posicoes, desvios, colunas, linhas };
}

/**
 * Onde cada cartão fica no Fluxo.
 *
 * **Vertical** devolve o que está gravado: é o arranjo que a pessoa arrastou, e
 * respeitá-lo é o motivo de ele existir. **Horizontal** é derivado na hora, por
 * `projetarFluxoHorizontal` — porque ninguém deveria ter que reposicionar cem
 * etapas à mão para ler o mesmo processo da esquerda para a direita.
 *
 * Nada aqui grava: a projeção horizontal não sobrescreve `pos_x`/`pos_y`, e por
 * isso voltar para o vertical devolve o desenho intacto.
 */
export function posicoesDoFluxo(completo: FluxoCompleto, orientacao: Orientacao): Posicoes {
  if (orientacao === "vertical") {
    const posicoes: Posicoes = new Map();
    for (const etapa of completo.etapas) posicoes.set(etapa.id, { x: etapa.posX, y: etapa.posY });
    return posicoes;
  }
  return projetarFluxoHorizontal(completo).posicoes;
}

// ---------------------------------------------------------------------------
// As fases — a faixa colorida por cima do fluxo deitado
// ---------------------------------------------------------------------------

/** A altura do cabeçalho da fase, acima da linha que ela cobre. */
export const ALTURA_DA_FASE = 64;
/** Quantas cores de fase existem antes de a sequência recomeçar. */
export const CORES_DAS_FASES = 7;

export interface FaseDoFluxo {
  chave: string;
  rotulo: string;
  /** A fase é o "não preenchido" desta coluna? */
  semInformacao: boolean;
  /** O índice da cor, de 0 a `CORES_DAS_FASES - 1`. A tela resolve a classe. */
  cor: number;
  x: number;
  largura: number;
  topo: number;
  altura: number;
  etapas: string[];
}

/**
 * AS FASES — o que o fluxograma de parede tem e o desenho não tinha.
 *
 * A faixa de cima ("Preparação", "Emissão", "Fiscal", "Financeiro") é o que
 * transforma vinte cartões numa história com capítulos: antes de ler etapa por
 * etapa, o olho já sabe que o processo tem sete momentos e onde cada um começa.
 *
 * Ela **não** é um cadastro novo. A fase de uma coluna é o mesmo campo que as
 * Raias agrupam — a área, o responsável ou o sistema —, lido pelas etapas do
 * trilho daquela coluna; colunas vizinhas com a mesma resposta viram uma faixa
 * só. Um campo a mais na etapa seria uma segunda verdade sobre a mesma coisa,
 * com duas chances de discordarem.
 *
 * Duas recusas deliberadas:
 *
 * - **Sem o campo preenchido, não há faixa.** Um processo em que ninguém
 *   cadastrou a área renderia uma única barra cinza de ponta a ponta escrita
 *   "sem área definida" — decoração que ocupa o topo da tela e não informa
 *   nada. Some inteira, e a Lista continua sendo onde essa pendência de
 *   cadastro aparece.
 * - **A faixa não atravessa a quebra de linha.** Uma fase que continua na
 *   linha de baixo é desenhada como duas faixas com o mesmo nome, porque é
 *   isso que ela é no desenho: dois trechos. Uma caixa só, esticada entre as
 *   linhas, cobriria cartões de outras fases pelo caminho.
 */
export function projetarFases(
  completo: FluxoCompleto,
  projecao: ProjecaoDoFluxoHorizontal,
  agrupamento: AgrupamentoDeRaia = "area",
): FaseDoFluxo[] {
  const porId = new Map(completo.etapas.map((e) => [e.id, e]));
  const temCadastro = completo.etapas.some((e) => raiaDaEtapa(e, agrupamento) !== "");
  if (!temCadastro || projecao.linhas.length === 0) return [];

  /* A resposta de cada coluna: a do trilho manda; o desvio só decide se o trilho está vazio. */
  const chaveDaColuna = new Map<number, string>();
  const etapasDaColuna = new Map<number, string[]>();
  for (const etapa of completo.etapas) {
    const coluna = projecao.colunas.get(etapa.id);
    if (coluna === undefined) continue;
    const lista = etapasDaColuna.get(coluna) ?? [];
    lista.push(etapa.id);
    etapasDaColuna.set(coluna, lista);
  }
  for (const [coluna, ids] of etapasDaColuna) {
    const doTrilho = ids.filter((id) => !projecao.desvios.has(id));
    const candidatos = doTrilho.length > 0 ? doTrilho : ids;
    const chave = candidatos
      .map((id) => raiaDaEtapa(porId.get(id)!, agrupamento))
      .find((c) => c !== "");
    chaveDaColuna.set(coluna, chave ?? "");
  }

  /* A cor é a da ordem de aparição, e não do nome: a primeira fase é sempre a primeira cor. */
  const cores = new Map<string, number>();
  const corDe = (chave: string) => {
    if (!cores.has(chave)) cores.set(chave, cores.size % CORES_DAS_FASES);
    return cores.get(chave)!;
  };

  const fases: FaseDoFluxo[] = [];
  for (const linha of projecao.linhas) {
    let atual: FaseDoFluxo | null = null;
    for (let i = 0; i < linha.colunas; i += 1) {
      const coluna = linha.colunaInicial + i;
      const chave = chaveDaColuna.get(coluna) ?? "";
      const etapas = etapasDaColuna.get(coluna) ?? [];
      if (atual && atual.chave === chave) {
        atual.largura += PASSO_X;
        atual.etapas.push(...etapas);
        continue;
      }
      atual = {
        chave,
        rotulo: chave === "" ? ROTULO_SEM[agrupamento] : chave,
        semInformacao: chave === "",
        cor: corDe(chave),
        x: i * PASSO_X,
        largura: PASSO_X,
        topo: linha.topo - ALTURA_DA_FASE,
        altura: linha.altura + ALTURA_DA_FASE,
        etapas: [...etapas],
      };
      fases.push(atual);
    }
  }
  return fases;
}

// ---------------------------------------------------------------------------
// Projeção 3 — as Raias
// ---------------------------------------------------------------------------

/** A altura de um cartão empilhado dentro de uma raia. */
export const ALTURA_DO_CARTAO = 110;
/** O respiro de cima e de baixo dentro de uma raia. */
export const RESPIRO_DA_RAIA = 28;
/** A largura da coluna de rótulos, à esquerda das raias. */
export const LARGURA_DO_ROTULO = 190;

export interface Raia {
  chave: string;
  rotulo: string;
  /** A raia é o "não preenchido" desta coluna? */
  semInformacao: boolean;
  y: number;
  altura: number;
  etapas: string[];
}

export interface ProjecaoDeRaias {
  raias: Raia[];
  posicoes: Posicoes;
  largura: number;
  altura: number;
  /** As trocas de responsabilidade — as conexões que atravessam raias. */
  handoffs: { conexaoId: string; de: string; para: string }[];
}

const ROTULO_SEM = {
  area: "Sem área definida",
  responsavel: "Sem responsável definido",
  sistema: "Sem sistema definido",
} as const;

/**
 * A qual raia a etapa pertence.
 *
 * Para "sistema", o sistema principal vem primeiro e o primeiro item da espécie
 * SISTEMA é o degrau seguinte — quem cadastrou o sistema como item, e não como
 * coluna, não pode cair no balde do "sem sistema".
 */
export function raiaDaEtapa(etapa: Etapa, agrupamento: AgrupamentoDeRaia): string {
  const texto = (v: string | null | undefined) => (v ?? "").trim();
  if (agrupamento === "area") return texto(etapa.area);
  if (agrupamento === "responsavel") return texto(etapa.responsavel);
  const principal = texto(etapa.sistemaPrincipal);
  if (principal !== "") return principal;
  const item = etapa.itens.find((i) => i.especie === "SISTEMA" && texto(i.nome) !== "");
  return texto(item?.nome);
}

/**
 * O processo organizado por quem responde.
 *
 * A coluna de uma etapa é o nível dela no grafo — a mesma que o Fluxo usa —, e
 * por isso o desenho continua andando da esquerda para a direita na ordem do
 * processo. A linha é a raia. O handoff, que é o que esta visualização existe
 * para mostrar, é o que sobra: toda conexão cujas duas pontas caem em raias
 * diferentes.
 *
 * A ordem das raias é a de **primeira aparição** no processo, não alfabética:
 * lido de cima para baixo, o desenho conta a história na ordem em que ela
 * acontece. A raia do "não preenchido" vai sempre para o fim — ela é uma
 * pendência de cadastro, não uma etapa do processo.
 */
export function projetarRaias(
  completo: FluxoCompleto,
  agrupamento: AgrupamentoDeRaia,
): ProjecaoDeRaias {
  const niveis = niveisDoFluxo(completo.etapas, completo.conexoes);
  const colunaDe = new Map<string, number>();
  niveis.forEach((ids, coluna) => ids.forEach((id) => colunaDe.set(id, coluna)));

  const porId = new Map(completo.etapas.map((e) => [e.id, e]));
  const emOrdem = ordemDeLeitura(completo);

  const chaveDe = new Map<string, string>();
  const ordemDasRaias: string[] = [];
  for (const etapa of emOrdem) {
    const chave = raiaDaEtapa(etapa, agrupamento);
    chaveDe.set(etapa.id, chave);
    if (!ordemDasRaias.includes(chave)) ordemDasRaias.push(chave);
  }
  /* O balde do não preenchido por último — é pendência, não etapa. */
  ordemDasRaias.sort((a, b) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0));

  const posicoes: Posicoes = new Map();
  const raias: Raia[] = [];
  let y = 0;

  for (const chave of ordemDasRaias) {
    const daRaia = emOrdem.filter((e) => chaveDe.get(e.id) === chave);
    /* Duas etapas da mesma raia na mesma coluna empilham em vez de se cobrir. */
    const usoPorColuna = new Map<number, number>();
    let pilhaMaxima = 1;
    for (const etapa of daRaia) {
      const coluna = colunaDe.get(etapa.id) ?? 0;
      const usados = usoPorColuna.get(coluna) ?? 0;
      usoPorColuna.set(coluna, usados + 1);
      pilhaMaxima = Math.max(pilhaMaxima, usados + 1);
      posicoes.set(etapa.id, {
        x: LARGURA_DO_ROTULO + coluna * PASSO_X,
        y: y + RESPIRO_DA_RAIA + usados * ALTURA_DO_CARTAO,
      });
    }
    const altura = pilhaMaxima * ALTURA_DO_CARTAO + RESPIRO_DA_RAIA * 2 - (ALTURA_DO_CARTAO - 72);
    raias.push({
      chave,
      rotulo: chave === "" ? ROTULO_SEM[agrupamento] : chave,
      semInformacao: chave === "",
      y,
      altura,
      etapas: daRaia.map((e) => e.id),
    });
    y += altura;
  }

  const handoffs = completo.conexoes
    .filter((c) => porId.has(c.origemEtapaId) && porId.has(c.destinoEtapaId))
    .filter((c) => chaveDe.get(c.origemEtapaId) !== chaveDe.get(c.destinoEtapaId))
    .map((c) => ({
      conexaoId: c.id,
      de: chaveDe.get(c.origemEtapaId) ?? "",
      para: chaveDe.get(c.destinoEtapaId) ?? "",
    }));

  const colunas = Math.max(1, niveis.length);
  return {
    raias,
    posicoes,
    largura: LARGURA_DO_ROTULO + colunas * PASSO_X,
    altura: y,
    handoffs,
  };
}

/**
 * Os números do cabeçalho das Raias: quantas trocas de responsabilidade,
 * quantas áreas, quantos responsáveis, quantos sistemas.
 *
 * São contagens do que **está cadastrado** — nada de estimativa. Quando a
 * coluna está vazia em toda etapa, a contagem é zero e a tela diz isso em vez
 * de inventar um número.
 */
export interface ResumoDeResponsabilidade {
  trocas: number;
  areas: number;
  responsaveis: number;
  sistemas: number;
}

export function resumoDeResponsabilidade(
  completo: FluxoCompleto,
  agrupamento: AgrupamentoDeRaia,
): ResumoDeResponsabilidade {
  const distintos = (agrupar: AgrupamentoDeRaia) =>
    new Set(
      completo.etapas.map((e) => raiaDaEtapa(e, agrupar)).filter((v) => v !== ""),
    ).size;

  return {
    trocas: projetarRaias(completo, agrupamento).handoffs.length,
    areas: distintos("area"),
    responsaveis: distintos("responsavel"),
    sistemas: distintos("sistema"),
  };
}

// ---------------------------------------------------------------------------
// Projeção 4 — o Mapa
// ---------------------------------------------------------------------------

/** O passo do mapa — cartão compacto, para caber processo grande na tela. */
export const PASSO_X_COMPACTO = 168;
export const PASSO_Y_COMPACTO = 84;

/**
 * O processo inteiro de uma vez.
 *
 * Mesmos níveis, escala menor: o mapa não é uma visualização diferente do
 * fluxo, é o **mesmo desenho** com cartão compacto e passo curto. Em duzentas
 * etapas é a diferença entre navegar e se perder.
 */
export function posicoesDoMapa(completo: FluxoCompleto): Posicoes {
  const posicoes: Posicoes = new Map();
  const niveis = niveisDoFluxo(completo.etapas, completo.conexoes);
  niveis.forEach((idsDoNivel, indiceDoNivel) => {
    const deslocamento = ((idsDoNivel.length - 1) * PASSO_X_COMPACTO) / 2;
    idsDoNivel.forEach((id, indice) => {
      posicoes.set(id, {
        x: Math.round(indice * PASSO_X_COMPACTO - deslocamento),
        y: indiceDoNivel * PASSO_Y_COMPACTO,
      });
    });
  });
  return posicoes;
}
