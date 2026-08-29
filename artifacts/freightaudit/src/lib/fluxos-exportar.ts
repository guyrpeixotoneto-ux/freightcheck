import { montarCanvas, resumoDoFluxo, type Catalogo, type Etapa, type FluxoCompleto } from "@/lib/fluxos";
import {
  ALTURA_DA_FASE,
  projetarFases,
  projetarFluxoHorizontal,
  type AgrupamentoDeRaia,
  type FaseDoFluxo,
} from "@/lib/fluxos-visoes";

/**
 * EXPORTAR O FLUXOGRAMA — o desenho saindo do produto como arquivo.
 *
 * Um mapa de processo existe para ser discutido, e a discussão acontece em
 * reunião, em apresentação e em anexo de e-mail — lugares onde ninguém tem
 * sessão aberta no FreightCheck. Sem exportação, a única saída era a captura de
 * tela de quem estava com o fluxo aberto, recortada no olho.
 *
 * ---------------------------------------------------------------------------
 * Um SVG montado do dado, e não uma foto da tela
 * ---------------------------------------------------------------------------
 *
 * A saída **não** é uma raspagem do DOM do canvas. Este arquivo monta um SVG
 * novo a partir de `montarCanvas` — a mesma função pura que alimenta o
 * `@xyflow/react` —, e é dele que saem tanto o PNG quanto o PDF.
 *
 * Três coisas dependem dessa escolha:
 *
 * - **É função pura, e por isso é testada.** O que sai no arquivo — todo cartão
 *   presente, toda seta presente, a de retrabalho inclusive, o rótulo da
 *   condição, a legenda — é afirmado em teste sem DOM, dentro da régua deste
 *   pacote (ver `vitest.config.ts`: o que é decisão vira função pura; o que é
 *   pixel não é testado aqui).
 * - **O arquivo não depende do que está na tela.** Zoom, rolagem, painel
 *   aberto, tema escuro e cartão selecionado não vazam para o arquivo: quem
 *   exporta o fluxo inteiro recebe o fluxo inteiro, enquadrado, mesmo com um
 *   canto ampliado na tela.
 * - **Nenhuma dependência nova.** A checagem foi feita: não há `html-to-image`,
 *   `html2canvas` nem `jspdf` neste repositório, e trazer duas bibliotecas para
 *   desenhar retângulos e escrever um PDF de uma página seria mais código de
 *   terceiro do que o que está escrito aqui.
 *
 * ---------------------------------------------------------------------------
 * O arquivo sai sempre claro
 * ---------------------------------------------------------------------------
 *
 * Independente do tema de quem exporta. Um PNG de fundo escuro colado num
 * slide branco, ou impresso, é o defeito mais comum de exportação de diagrama —
 * e o tema é preferência de quem lê a tela, não propriedade do processo.
 */

// ---------------------------------------------------------------------------
// A paleta do arquivo
// ---------------------------------------------------------------------------

/**
 * Cores literais, e não classes do tema — pela mesma razão que
 * `COR_DA_CONEXAO` em `lib/fluxos.ts` é literal, e é a mesma exceção já aberta
 * ali: um SVG que vai virar arquivo não tem folha de estilo do produto por
 * perto, e uma classe do Tailwind dentro dele seria um atributo sem efeito.
 *
 * Os pares espelham as classes que o catálogo serve (`border-*`/`bg-*` no tom
 * claro). O catálogo continua sendo a autoridade sobre **quais** tipos existem:
 * um tipo que ele traga e esta tabela não conheça sai com o par neutro, e o
 * cartão aparece — desenhar cinza é sempre melhor do que sumir com a etapa.
 */
const PALETA_DO_TIPO: Record<string, { borda: string; fundo: string }> = {
  INICIO: { borda: "#6ee7b7", fundo: "#ecfdf5" },
  PROCESSO: { borda: "#e2e8f0", fundo: "#ffffff" },
  DECISAO: { borda: "#fcd34d", fundo: "#fffbeb" },
  VALIDACAO: { borda: "#7dd3fc", fundo: "#f0f9ff" },
  DOCUMENTO: { borda: "#c4b5fd", fundo: "#f5f3ff" },
  SISTEMA: { borda: "#a5b4fc", fundo: "#eef2ff" },
  PENDENCIA: { borda: "#fda4af", fundo: "#fff1f2" },
  FIM: { borda: "#cbd5e1", fundo: "#f1f5f9" },
};

const NEUTRO = { borda: "#cbd5e1", fundo: "#ffffff" };

const COR_DA_CONEXAO: Record<string, string> = {
  SEQUENCIA: "#94a3b8",
  DECISAO_SIM: "#10b981",
  DECISAO_NAO: "#f43f5e",
  EXCECAO: "#f59e0b",
  RETRABALHO: "#8b5cf6",
};

/**
 * As cores das fases, na mesma ordem em que a tela as gasta.
 *
 * É a tradução literal de `CORES` em `no-da-fase.tsx` — mesma sequência, mesmos
 * tons no claro. A duplicação é a mesma já aberta para `PALETA_DO_TIPO` e
 * `COR_DA_CONEXAO`: um SVG que vira arquivo não tem folha de estilo do produto
 * por perto. O que não pode divergir é a **ordem**, porque é ela que faz a
 * terceira fase do arquivo ter a cor da terceira fase da tela.
 */
const PALETA_DA_FASE: { barra: string; tinta: string; corpo: string }[] = [
  { barra: "#d1fae5", tinta: "#047857", corpo: "#f0fdf6" },
  { barra: "#e0f2fe", tinta: "#0369a1", corpo: "#f4faff" },
  { barra: "#ede9fe", tinta: "#6d28d9", corpo: "#f8f6ff" },
  { barra: "#fef3c7", tinta: "#b45309", corpo: "#fffcf0" },
  { barra: "#ccfbf1", tinta: "#0f766e", corpo: "#f2fdfb" },
  { barra: "#dbeafe", tinta: "#1d4ed8", corpo: "#f3f8ff" },
  { barra: "#f1f5f9", tinta: "#334155", corpo: "#fafbfc" },
];

const FASE_SEM_INFORMACAO = { barra: "#e2e8f0", tinta: "#64748b", corpo: "#f8fafc" };

const TINTA = "#0f172a";
const TINTA_FRACA = "#64748b";
const PAPEL = "#ffffff";

/*
  A pilha de fontes é a do produto, com o `sans-serif` do sistema no fim. Um SVG
  exportado é renderizado por quem o abrir — navegador, visualizador de imagem,
  editor de slides —, e nenhum deles vai buscar a fonte da aplicação. A cadeia
  garante que o texto sempre tenha com o que ser desenhado.
*/
const FONTE = "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif";

// ---------------------------------------------------------------------------
// A geometria do cartão
// ---------------------------------------------------------------------------

export const LARGURA_DO_CARTAO = 200;
const RESPIRO = 12;
const ALTURA_DA_LINHA_DO_NOME = 17;
const MAXIMO_DE_LINHAS_DO_NOME = 3;

/**
 * A GEOMETRIA DO LOSANGO — a largura útil, e por que ela é tão menor.
 *
 * A caixa do losango continua com a largura do cartão, porque é dela que as
 * setas saem e é nela que elas encostam: mudar isso deslocaria toda ligação que
 * chega numa decisão. O que muda é o **texto**, que só pode ocupar a faixa
 * central da forma — num losango, a linha do meio é a única que tem a largura
 * inteira, e uma linha 20px acima já perdeu um quarto dela de cada lado.
 *
 * Daí os 96px: é a faixa em que três linhas de texto cabem sem encostar na
 * aresta. E daí a altura mínima — um losango de 60px de altura não é
 * reconhecível como losango; vira um pequeno diamante achatado.
 */
const LARGURA_UTIL_DO_LOSANGO = 96;
const ALTURA_MINIMA_DO_LOSANGO = 132;

/**
 * O texto quebrado em linhas — sem DOM, e por estimativa.
 *
 * Medir texto de verdade exige um `canvas` ou um elemento montado, e as duas
 * coisas tirariam esta função do lado testável do pacote. A estimativa é por
 * largura média de caractere, calibrada para 13px na pilha de fontes acima; ela
 * erra por alguns pixels e o cartão tem folga para isso.
 *
 * O que ela **não** faz é cortar palavra no meio nem estourar o cartão: uma
 * palavra maior que a linha fica sozinha nela, e o que passar do limite de
 * linhas é resumido com reticências — um nome longo vira um cartão previsível,
 * e não um retângulo que invade o vizinho.
 */
export function quebrarEmLinhas(
  texto: string,
  larguraDisponivel: number,
  larguraDoCaractere: number,
  maximoDeLinhas: number,
): string[] {
  const cabe = Math.max(4, Math.floor(larguraDisponivel / larguraDoCaractere));
  const palavras = texto.trim().split(/\s+/).filter((p) => p !== "");
  if (palavras.length === 0) return [];

  const linhas: string[] = [];
  let atual = "";
  for (const palavra of palavras) {
    const candidata = atual === "" ? palavra : `${atual} ${palavra}`;
    if (candidata.length <= cabe) {
      atual = candidata;
      continue;
    }
    if (atual !== "") linhas.push(atual);
    atual = palavra;
  }
  if (atual !== "") linhas.push(atual);

  if (linhas.length <= maximoDeLinhas) return linhas;
  const cortadas = linhas.slice(0, maximoDeLinhas);
  const ultima = cortadas[maximoDeLinhas - 1];
  cortadas[maximoDeLinhas - 1] =
    ultima.length > cabe - 1 ? `${ultima.slice(0, Math.max(1, cabe - 1))}…` : `${ultima}…`;
  return cortadas;
}

/** Uma linha só, encurtada com reticências quando não cabe. */
function encurtar(texto: string, larguraDisponivel: number, larguraDoCaractere: number): string {
  const cabe = Math.max(4, Math.floor(larguraDisponivel / larguraDoCaractere));
  return texto.length <= cabe ? texto : `${texto.slice(0, cabe - 1)}…`;
}

export interface CaixaDaEtapa {
  etapa: Etapa;
  x: number;
  y: number;
  largura: number;
  altura: number;
  linhasDoNome: string[];
  rotuloDoTipo: string;
  quemResponde: string | null;
  detalhes: number;
  atencao: boolean;
  forma: "retangulo" | "losango" | "pilula";
  cores: { borda: string; fundo: string };
}

/**
 * O cartão de uma etapa: onde ele fica, que tamanho tem e o que escreve.
 *
 * O conteúdo é o mesmo do cartão da tela (`resumoDoCartao`): nome, tipo, quem
 * responde e o contador de detalhes. Exportar mais do que a tela mostra faria o
 * arquivo e o produto contarem histórias diferentes sobre o mesmo processo.
 */
export function caixaDaEtapa(
  etapa: Etapa,
  tipo: { rotulo: string; forma: "retangulo" | "losango" | "pilula" } | undefined,
  /** Onde o cartão fica, quando o desenho é projetado. Ausente, valem as gravadas. */
  posicao?: { x: number; y: number },
): CaixaDaEtapa {
  /*
    A etapa em atenção tem um triângulo no canto superior direito, e o nome
    precisa desviar dele: sem reservar essa faixa, "Fechamento / classificação"
    passa por baixo do sinal e as duas coisas ficam ilegíveis.
  */
  const atencao = etapa.status === "ATENCAO";
  const forma = tipo?.forma ?? "retangulo";
  const x = posicao?.x ?? etapa.posX;
  const y = posicao?.y ?? etapa.posY;
  const cores = PALETA_DO_TIPO[etapa.tipo] ?? NEUTRO;

  /*
    O LOSANGO CARREGA SÓ A PERGUNTA.

    Nem tipo, nem responsável, nem contador de detalhes — é a mesma decisão do
    cartão da tela, e pela mesma razão: dentro da forma há espaço para uma
    pergunta curta e mais nada. Escrever "DECISÃO" embaixo de "Dados válidos?"
    também não acrescenta: a forma já disse isso, e é para isso que ela existe.

    O que se perde continua a um clique no produto e continua na planilha do
    modelo — o arquivo de desenho é o desenho.
  */
  if (forma === "losango") {
    const linhas = quebrarEmLinhas(
      etapa.nome,
      LARGURA_UTIL_DO_LOSANGO,
      5.8,
      MAXIMO_DE_LINHAS_DO_NOME,
    );
    const alturaDoTexto = Math.max(1, linhas.length) * ALTURA_DA_LINHA_DO_NOME;
    return {
      etapa,
      x,
      y,
      largura: LARGURA_DO_CARTAO,
      altura: Math.max(ALTURA_MINIMA_DO_LOSANGO, alturaDoTexto + 72 + (atencao ? 16 : 0)),
      linhasDoNome: linhas.length > 0 ? linhas : ["(sem nome)"],
      rotuloDoTipo: tipo?.rotulo ?? etapa.tipo,
      quemResponde: null,
      detalhes: 0,
      atencao,
      forma,
      cores,
    };
  }

  const linhasDoNome = quebrarEmLinhas(
    etapa.nome,
    LARGURA_DO_CARTAO - RESPIRO * 2 - (atencao ? 18 : 0),
    6.4,
    MAXIMO_DE_LINHAS_DO_NOME,
  );
  const quem = [etapa.area, etapa.responsavel]
    .filter((p): p is string => typeof p === "string" && p.trim() !== "")
    .join(" · ");
  const detalhes = etapa.itens.length + etapa.indicadores.length + etapa.acoes.length;

  const altura =
    RESPIRO +
    Math.max(1, linhasDoNome.length) * ALTURA_DA_LINHA_DO_NOME +
    15 +
    (quem === "" ? 0 : 15) +
    (detalhes > 0 ? 14 : 0) +
    RESPIRO;

  return {
    etapa,
    x,
    y,
    largura: LARGURA_DO_CARTAO,
    altura,
    linhasDoNome: linhasDoNome.length > 0 ? linhasDoNome : ["(sem nome)"],
    rotuloDoTipo: tipo?.rotulo ?? etapa.tipo,
    quemResponde: quem === "" ? null : encurtar(quem, LARGURA_DO_CARTAO - RESPIRO * 2, 5.6),
    detalhes,
    atencao,
    forma,
    cores,
  };
}

// ---------------------------------------------------------------------------
// O SVG
// ---------------------------------------------------------------------------

/** `&`, `<`, `>`, `"` viram entidade. Um nome de etapa com `&` quebraria o XML. */
export function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface OpcoesDaExportacao {
  /** A data que vai no rodapé, em ISO. Entra por parâmetro para a função ser pura. */
  exportadoEm?: string;
  /** O nome da empresa, quando a tela souber qual é. */
  empresa?: string | null;
  /**
   * QUAL DESENHO SAI NO ARQUIVO — e por que isto é uma opção.
   *
   * `"vertical"` (o padrão) exporta o arranjo **gravado**: as coordenadas que
   * alguém arrastou. `"horizontal"` exporta a projeção deitada — trilho, faixa
   * de desvios e quebra em linhas —, que é a mesma de `projetarFluxoHorizontal`
   * e portanto a mesma que a tela desenha.
   *
   * A opção existe porque as fases só existem no deitado: elas são um cabeçalho
   * por **coluna** de leitura, e no arranjo gravado não há coluna nenhuma — há
   * as coordenadas que a pessoa escolheu. Inventar fases ali seria desenhar no
   * arquivo uma leitura que o produto não faz.
   *
   * Quem exporta recebe o desenho que estava vendo: a tela passa a orientação
   * em que está. Sem ela, alguém que passou a tarde no fluxo deitado abriria o
   * PNG e encontraria outro desenho — e concluiria, com razão, que a exportação
   * está errada.
   */
  disposicao?: "vertical" | "horizontal";
  /** Por qual campo as fases são agrupadas. Só o desenho deitado usa. */
  agrupamento?: AgrupamentoDeRaia;
}

export interface SvgDoFluxo {
  svg: string;
  largura: number;
  altura: number;
}

const MARGEM = 32;
const ALTURA_DO_CABECALHO = 78;

/**
 * O fluxo inteiro como um SVG — cabeçalho, cartões, setas e legenda.
 *
 * O enquadramento sai das posições gravadas: a caixa que contém todos os
 * cartões, mais margem. Um fluxo nunca sai cortado, e nunca sai com metade da
 * folha em branco porque alguém arrastou um cartão para longe e voltou.
 */
export function montarSvgDoFluxo(
  completo: FluxoCompleto,
  catalogo: Catalogo | undefined,
  opcoes: OpcoesDaExportacao = {},
): SvgDoFluxo {
  const { nos, setas } = montarCanvas(completo, catalogo);
  const tipos = new Map((catalogo?.tiposDeEtapa ?? []).map((t) => [t.valor, t]));

  /*
    O desenho deitado é calculado aqui, uma vez, e serve às duas coisas que
    dependem dele: onde cada cartão fica e onde cada fase começa. Recalcular a
    projeção dentro do desenho das fases seria a segunda chance de a faixa
    discordar dos cartões que ela cobre.
  */
  const deitado = opcoes.disposicao === "horizontal";
  const projecao = deitado ? projetarFluxoHorizontal(completo) : null;
  const fases = projecao ? projetarFases(completo, projecao, opcoes.agrupamento ?? "area") : [];

  const caixas = nos.map((no) =>
    caixaDaEtapa(
      no.data.etapa,
      tipos.get(no.data.etapa.tipo),
      projecao?.posicoes.get(no.data.etapa.id),
    ),
  );
  const porId = new Map(caixas.map((c) => [c.etapa.id, c]));

  /*
    O desenho vazio ainda produz arquivo. Um fluxo sem etapas exportado como
    "erro" faria a pessoa achar que a exportação está quebrada; exportado como
    uma folha com o nome do processo e "sem etapas", ele diz a verdade.
  */
  const vazio = caixas.length === 0;
  /*
    A caixa da folha conta as fases junto: o cabeçalho de uma fase fica **acima**
    do primeiro cartão da linha, em coordenada negativa. Sem incluí-lo aqui, a
    faixa sairia cortada rente ao topo — e o corte apareceria só na primeira
    exportação de um fluxo com fase, que é tarde.
  */
  const minX = vazio ? 0 : Math.min(...caixas.map((c) => c.x), ...fases.map((f) => f.x));
  const minY = vazio ? 0 : Math.min(...caixas.map((c) => c.y), ...fases.map((f) => f.topo));
  const maxX = vazio
    ? 320
    : Math.max(...caixas.map((c) => c.x + c.largura), ...fases.map((f) => f.x + f.largura));
  const maxY = vazio
    ? 120
    : Math.max(...caixas.map((c) => c.y + c.altura), ...fases.map((f) => f.topo + f.altura));

  const legenda = montarLegenda(completo, catalogo);
  const alturaDaLegenda = legenda.length === 0 ? 0 : 46;

  /*
    As setas que voltam — o retrabalho — saem por um canal fora dos cartões, em
    vez de cortar em linha reta o que estiver no caminho. Num processo em
    corrente, a volta atravessaria meia dúzia de etapas e o rótulo dela
    ("divergência de valor") cairia em cima de um cartão, ilegível. É a
    diferença entre um fluxograma e um risco por cima do desenho.

    Onde fica o canal depende de para onde o desenho anda. No arranjo em pé, a
    volta sobe, e o canal é uma coluna à direita de todos os cartões. No
    deitado, a volta anda para a **esquerda** — e um canal à direita a faria sair
    andando na direção contrária antes de voltar. Ali o canal é uma faixa
    embaixo, que é como um fluxograma da esquerda para a direita sempre
    desenhou o retorno.
  */
  const retornos = setas.filter((seta) => {
    const origem = porId.get(seta.source);
    const destino = porId.get(seta.target);
    return origem !== undefined && destino !== undefined && ehVolta(origem, destino, deitado);
  });
  /*
    O canal fica afastado pela **metade do maior rótulo** que vai nele, e não
    por uma distância fixa: com folga fixa, "divergência de valor" escrito no
    meio do canal encostava no cartão vizinho — o rótulo é centrado na linha, e
    metade dele avança para dentro do desenho. No deitado o rótulo se estende no
    eixo do canal, e não contra ele, então a folga é a altura de uma tarja.
  */
  const maiorRotuloDeRetorno = Math.max(
    0,
    ...retornos.map((seta) => larguraDoTexto(seta.label ?? "", 5.6)),
  );
  const afastamentoDoCanal = deitado ? 52 : 40 + maiorRotuloDeRetorno / 2;
  /*
    Uma faixa por volta, a mais longa por fora — assim as linhas se aninham em
    vez de se cruzarem, e os rótulos deixam de ser escritos uns por cima dos
    outros. A ordenação desempata pelo id para o arquivo ser sempre o mesmo:
    duas exportações do mesmo fluxo têm que produzir bytes iguais.
  */
  const porVao = [...retornos].sort((a, b) => {
    const vao = (seta: (typeof retornos)[number]) => {
      const origem = porId.get(seta.source)!;
      const destino = porId.get(seta.target)!;
      return deitado
        ? Math.abs(origem.x - destino.x)
        : Math.abs(origem.y - destino.y);
    };
    return vao(a) - vao(b) || a.id.localeCompare(b.id);
  });
  const faixaDaVolta = new Map(
    porVao.map((seta, indice) => [seta.id, afastamentoDoCanal + indice * PASSO_DA_FAIXA]),
  );
  const faixasDeRetorno = Math.max(1, porVao.length);
  const respiroDoRetorno =
    retornos.length === 0
      ? 0
      : afastamentoDoCanal +
        (faixasDeRetorno - 1) * PASSO_DA_FAIXA +
        (deitado ? 24 : maiorRotuloDeRetorno / 2 + 12);
  /*
    O corredor da descida fica à esquerda do cartão de origem, e o da subida à
    esquerda do de destino. Na primeira coluna isso é coordenada negativa: a
    folha ganha essa faixa à esquerda, senão a volta sai cortada na borda.
  */
  const respiroEsquerdo =
    deitado && retornos.length > 0 ? CORREDOR_DO_RETORNO + 12 : 0;

  const deslocX = MARGEM + respiroEsquerdo - minX;
  const deslocY = MARGEM + ALTURA_DO_CABECALHO - minY;
  const larguraDoDesenho =
    maxX - minX + respiroEsquerdo + (deitado ? 0 : respiroDoRetorno) + MARGEM * 2;
  /*
    O cabeçalho também tem largura. Um processo em corrente sai estreito — uma
    coluna de cartões de 200px —, e o nome do fluxo por extenso é bem mais largo
    do que isso: sem este mínimo, o título saía cortado no arquivo, que é
    exatamente o que a primeira exportação de verdade mostrou.
  */
  const largura = Math.round(Math.max(larguraDoDesenho, larguraDoCabecalho(completo, opcoes)));
  const altura = Math.round(
    maxY -
      minY +
      (deitado ? respiroDoRetorno : 0) +
      MARGEM * 2 +
      ALTURA_DO_CABECALHO +
      alturaDaLegenda,
  );

  const canal: CanalDoRetorno = {
    eixo: deitado ? "y" : "x",
    porSeta: new Map(
      [...faixaDaVolta].map(([id, faixa]) => [
        id,
        deitado ? maxY + faixa + deslocY : maxX + faixa + deslocX,
      ]),
    ),
    padrao: deitado
      ? maxY + afastamentoDoCanal + deslocY
      : maxX + afastamentoDoCanal + deslocX,
  };

  const partes: string[] = [];
  partes.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}" font-family="${FONTE}">`,
  );
  partes.push(`<rect width="${largura}" height="${altura}" fill="${PAPEL}"/>`);
  partes.push(marcadoresDeSeta(setas));
  partes.push(cabecalho(completo, largura, opcoes));

  /* As fases primeiro: são cenário, e ficam atrás das setas e dos cartões. */
  for (const fase of fases) partes.push(desenharFase(fase, deslocX, deslocY));

  /* Depois as setas: cartão por cima de linha, e não linha por cima de nome. */
  for (const seta of setas) {
    const origem = porId.get(seta.source);
    const destino = porId.get(seta.target);
    if (!origem || !destino) continue;
    partes.push(desenharSeta(origem, destino, seta, deslocX, deslocY, canal, deitado));
  }
  for (const caixa of caixas) partes.push(desenharCartao(caixa, deslocX, deslocY));

  if (legenda.length > 0) partes.push(desenharLegenda(legenda, MARGEM, altura - MARGEM / 2 - 22));
  partes.push("</svg>");

  return { svg: partes.join(""), largura, altura };
}

/** A largura estimada de um texto — a mesma régua da quebra de linha do cartão. */
function larguraDoTexto(texto: string, larguraDoCaractere: number): number {
  return texto.length * larguraDoCaractere;
}

/**
 * O quanto o cabeçalho precisa de folha.
 *
 * Título numa linha, e embaixo a linha de identificação com o carimbo da
 * exportação na outra ponta. É a largura mínima do arquivo — o desenho pode ser
 * mais estreito que ele, e frequentemente é.
 */
function larguraDoCabecalho(completo: FluxoCompleto, opcoes: OpcoesDaExportacao): number {
  const titulo = larguraDoTexto(completo.fluxo.nome, 9.8);
  const identificacao = larguraDoTexto(linhaDeIdentificacao(completo, opcoes), 6.1);
  /* 48 de folga entre a identificação e o carimbo: encostados, os dois viram uma frase só. */
  const carimbo = opcoes.exportadoEm ? larguraDoTexto("Exportado em 00/00/0000", 5.6) + 48 : 0;
  return MARGEM * 2 + Math.max(titulo, identificacao + carimbo);
}

function linhaDeIdentificacao(completo: FluxoCompleto, opcoes: OpcoesDaExportacao): string {
  return [
    completo.fluxo.categoria,
    completo.fluxo.status === "ATIVO" ? null : completo.fluxo.status.toLowerCase(),
    resumoDoFluxo(completo),
    completo.fluxo.dono,
    opcoes.empresa ?? null,
  ]
    .filter((p): p is string => typeof p === "string" && p !== "")
    .join(" · ");
}

function cabecalho(
  completo: FluxoCompleto,
  largura: number,
  opcoes: OpcoesDaExportacao,
): string {
  const linhaDois = linhaDeIdentificacao(completo, opcoes);

  const carimbo = opcoes.exportadoEm ? `Exportado em ${comoDataCurta(opcoes.exportadoEm)}` : "";

  return [
    `<text x="${MARGEM}" y="${MARGEM + 14}" font-size="19" font-weight="600" fill="${TINTA}">${escaparXml(
      completo.fluxo.nome,
    )}</text>`,
    `<text x="${MARGEM}" y="${MARGEM + 34}" font-size="12" fill="${TINTA_FRACA}">${escaparXml(
      linhaDois,
    )}</text>`,
    /*
      O carimbo vai na segunda linha, e não ao lado do título: o nome de um
      processo ocupa a faixa inteira com facilidade, e alinhar os dois na mesma
      altura escreve um por cima do outro — como a primeira exportação de
      verdade mostrou.
    */
    carimbo === ""
      ? ""
      : `<text x="${largura - MARGEM}" y="${MARGEM + 34}" font-size="11" fill="${TINTA_FRACA}" text-anchor="end">${escaparXml(
          carimbo,
        )}</text>`,
    `<line x1="${MARGEM}" y1="${MARGEM + 48}" x2="${largura - MARGEM}" y2="${
      MARGEM + 48
    }" stroke="#e2e8f0" stroke-width="1"/>`,
  ].join("");
}

/** `2026-08-27T…` → `27/08/2026`. Sem biblioteca, e sem recuar o dia pelo fuso. */
function comoDataCurta(iso: string): string {
  const [data] = iso.split("T");
  const [ano, mes, dia] = data.split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}

function desenharCartao(caixa: CaixaDaEtapa, dx: number, dy: number): string {
  const x = caixa.x + dx;
  const y = caixa.y + dy;

  if (caixa.forma === "losango") return desenharLosango(caixa, x, y);

  const raio = caixa.forma === "pilula" ? caixa.altura / 2 : 8;
  const recuo = caixa.forma === "pilula" ? 16 : RESPIRO;

  const partes: string[] = [
    `<rect x="${x}" y="${y}" width="${caixa.largura}" height="${caixa.altura}" rx="${raio}" ry="${raio}" fill="${caixa.cores.fundo}" stroke="${caixa.cores.borda}" stroke-width="1.5"/>`,
  ];

  let linha = y + RESPIRO + 12;
  caixa.linhasDoNome.forEach((texto) => {
    partes.push(
      `<text x="${x + recuo}" y="${linha}" font-size="13" font-weight="500" fill="${TINTA}">${escaparXml(
        texto,
      )}</text>`,
    );
    linha += ALTURA_DA_LINHA_DO_NOME;
  });

  partes.push(
    `<text x="${x + recuo}" y="${linha}" font-size="9.5" letter-spacing="0.6" fill="${TINTA_FRACA}">${escaparXml(
      caixa.rotuloDoTipo.toUpperCase(),
    )}</text>`,
  );
  linha += 15;

  if (caixa.quemResponde) {
    partes.push(
      `<text x="${x + recuo}" y="${linha}" font-size="11" fill="${TINTA_FRACA}">${escaparXml(
        caixa.quemResponde,
      )}</text>`,
    );
    linha += 15;
  }
  if (caixa.detalhes > 0) {
    partes.push(
      `<text x="${x + recuo}" y="${linha}" font-size="10" fill="#94a3b8">${caixa.detalhes} ${
        caixa.detalhes === 1 ? "detalhe" : "detalhes"
      }</text>`,
    );
  }

  /*
    A etapa marcada como atenção sai marcada no arquivo também — um triângulo no
    canto, como na tela. Sem ele, o arquivo apagaria a única informação de
    estado que o cartão carrega.
  */
  if (caixa.atencao) {
    const cx = x + caixa.largura - 16;
    const cy = y + 15;
    partes.push(
      `<path d="M ${cx} ${cy - 6} L ${cx + 6} ${cy + 5} L ${cx - 6} ${cy + 5} Z" fill="none" stroke="#d97706" stroke-width="1.5" stroke-linejoin="round"/>`,
      `<line x1="${cx}" y1="${cy - 2}" x2="${cx}" y2="${cy + 1}" stroke="#d97706" stroke-width="1.5" stroke-linecap="round"/>`,
    );
  }

  return partes.join("");
}

/**
 * A DECISÃO DESENHADA COMO LOSANGO — e não como um retângulo amarelo.
 *
 * O arquivo desenhava a decisão com a mesma forma da atividade, e a cor era a
 * única diferença. Isso falha no que a forma existe para fazer: num desenho de
 * vinte cartões impresso em preto e branco, ou visto de longe num slide, "onde
 * o caminho se divide" tem que saltar aos olhos antes de qualquer leitura.
 *
 * Aqui é um `polygon` de quatro pontos, e não um quadrado girado como na tela:
 * a tela usa `transform` porque precisa preservar a borda que um recorte CSS
 * cortaria, e este arquivo não tem esse problema — um polígono do SVG tem
 * contorno próprio, e ainda aceita a proporção deitada, que dá mais faixa de
 * texto do que um quadrado giraria.
 *
 * As pontas do losango tocam o meio de cada lado da caixa, que é exatamente
 * onde as setas encostam: a ligação continua chegando no lugar certo sem que
 * `desenharSeta` saiba que esta forma existe.
 */
function desenharLosango(caixa: CaixaDaEtapa, x: number, y: number): string {
  const cx = x + caixa.largura / 2;
  const cy = y + caixa.altura / 2;
  const pontos = [
    `${arredondar(cx)},${arredondar(y)}`,
    `${arredondar(x + caixa.largura)},${arredondar(cy)}`,
    `${arredondar(cx)},${arredondar(y + caixa.altura)}`,
    `${arredondar(x)},${arredondar(cy)}`,
  ].join(" ");

  const partes: string[] = [
    `<polygon points="${pontos}" fill="${caixa.cores.fundo}" stroke="${caixa.cores.borda}" stroke-width="1.5" stroke-linejoin="round"/>`,
  ];

  /* O texto é centrado nos dois eixos — é a única faixa larga da forma. */
  const alturaDoTexto = caixa.linhasDoNome.length * ALTURA_DA_LINHA_DO_NOME;
  const reservaDaAtencao = caixa.atencao ? 16 : 0;
  let linha = cy - (alturaDoTexto + reservaDaAtencao) / 2 + 12;
  for (const texto of caixa.linhasDoNome) {
    partes.push(
      `<text x="${arredondar(cx)}" y="${arredondar(linha)}" font-size="12" font-weight="500" fill="${TINTA}" text-anchor="middle">${escaparXml(
        texto,
      )}</text>`,
    );
    linha += ALTURA_DA_LINHA_DO_NOME;
  }

  /*
    A atenção fica **embaixo** do nome, e não no canto: num losango o canto
    superior direito é fora da forma. É a mesma posição do cartão da tela.
  */
  if (caixa.atencao) {
    const ay = arredondar(linha + 1);
    partes.push(
      `<path d="M ${arredondar(cx)} ${ay - 6} L ${arredondar(cx + 6)} ${ay + 5} L ${arredondar(
        cx - 6,
      )} ${ay + 5} Z" fill="none" stroke="#d97706" stroke-width="1.5" stroke-linejoin="round"/>`,
      `<line x1="${arredondar(cx)}" y1="${ay - 2}" x2="${arredondar(cx)}" y2="${
        ay + 1
      }" stroke="#d97706" stroke-width="1.5" stroke-linecap="round"/>`,
    );
  }

  return partes.join("");
}

/**
 * A FAIXA DA FASE — o capítulo do processo, atrás dos cartões.
 *
 * É o cabeçalho colorido do fluxograma de parede, e no arquivo ele vale ainda
 * mais do que na tela: quem recebe um PNG num slide não tem seletor de
 * visualização nem painel de detalhe — tem a folha, e só. Sem a faixa, vinte
 * cartões são vinte cartões; com ela, são sete momentos.
 *
 * Vai **antes** das setas na lista de partes, e portanto atrás de tudo: é
 * cenário. Um corpo quase branco de propósito — o que precisa de cor é a barra
 * do título, e pintar a coluna inteira brigaria com a cor do cartão, que é a
 * que carrega significado.
 */
function desenharFase(fase: FaseDoFluxo, dx: number, dy: number): string {
  const cor = fase.semInformacao
    ? FASE_SEM_INFORMACAO
    : PALETA_DA_FASE[fase.cor % PALETA_DA_FASE.length];
  const x = arredondar(fase.x + dx);
  const y = arredondar(fase.topo + dy);
  const largura = arredondar(fase.largura);
  const altura = arredondar(fase.altura);
  const etapas = fase.etapas.length;
  const rotulo = encurtar(fase.rotulo.toUpperCase(), largura - 28, 7.2);

  return [
    `<rect x="${x}" y="${y}" width="${largura}" height="${altura}" rx="10" ry="10" fill="${cor.corpo}"/>`,
    /*
      A barra do título tem canto arredondado em cima e reto embaixo — dois
      retângulos sobrepostos, porque `rx` no SVG arredonda os quatro cantos e um
      `path` com quatro comandos seria mais linha para o mesmo desenho.
    */
    `<rect x="${x}" y="${y}" width="${largura}" height="${ALTURA_DA_FASE}" rx="10" ry="10" fill="${cor.barra}"/>`,
    `<rect x="${x}" y="${y + ALTURA_DA_FASE - 10}" width="${largura}" height="10" fill="${cor.barra}"/>`,
    `<text x="${x + 14}" y="${y + 26}" font-size="12" font-weight="600" letter-spacing="0.8" fill="${
      cor.tinta
    }">${escaparXml(rotulo)}</text>`,
    `<text x="${x + 14}" y="${y + 43}" font-size="10.5" fill="${TINTA_FRACA}">${etapas} ${
      etapas === 1 ? "etapa" : "etapas"
    }</text>`,
  ].join("");
}

/** Um marcador de ponta de flecha por cor usada — referenciados por `marker-end`. */
function marcadoresDeSeta(setas: { style: { stroke: string } }[]): string {
  const cores = [...new Set(setas.map((s) => s.style.stroke))];
  const defs = cores
    .map(
      (cor) =>
        `<marker id="${idDaPonta(cor)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${cor}"/></marker>`,
    )
    .join("");
  return `<defs>${defs}</defs>`;
}

const idDaPonta = (cor: string): string => `ponta-${cor.replace("#", "")}`;

/**
 * A seta entre dois cartões — e onde ela encosta em cada um.
 *
 * O lado é escolhido pela posição relativa: quem está abaixo recebe pela borda
 * de cima, quem está ao lado recebe pela lateral. É o que faz a volta do
 * retrabalho — que sobe — sair por fora do desenho em vez de atravessar os
 * cartões que estão entre as duas pontas.
 */
/**
 * A seta volta, e volta de longe? Então ela sai pelo canal.
 *
 * "De longe" é mais de uma faixa acima: uma volta para a etapa imediatamente
 * anterior é curta e fica legível em linha reta; a que sobe seis etapas é a que
 * atravessa o desenho inteiro.
 */
function voltaLonga(origem: CaixaDaEtapa, destino: CaixaDaEtapa): boolean {
  const centroO = origem.y + origem.altura / 2;
  const centroD = destino.y + destino.altura / 2;
  return centroD < centroO && centroO - centroD > 200;
}

/**
 * A mesma pergunta, no desenho deitado: a seta anda de volta para a esquerda?
 *
 * Aqui basta **uma** coluna de recuo, e não duas como na altura: a volta do
 * retrabalho no deitado sai da faixa de desvios, embaixo, e sobe para o trilho —
 * traçada em linha reta ela cortaria a coluna inteira de cartões que está entre
 * as duas pontas, que é justamente o que o canal existe para evitar.
 */
function voltaDeitada(origem: CaixaDaEtapa, destino: CaixaDaEtapa): boolean {
  return destino.x + destino.largura <= origem.x + 40;
}

const ehVolta = (origem: CaixaDaEtapa, destino: CaixaDaEtapa, deitado: boolean): boolean =>
  deitado ? voltaDeitada(origem, destino) : voltaLonga(origem, destino);

/**
 * ONDE A VOLTA PASSA — e por que é uma faixa por volta, e não uma só.
 *
 * Um canal só funciona enquanto há um retorno. Com três, as três linhas se
 * sobrepõem e — pior — os três rótulos são escritos no mesmo lugar: "corrigido,
 * revalidar", "em atraso" e "recobrar" viram uma mancha, e a informação que
 * explica por que cada volta existe é justamente a que se perde.
 *
 * Então cada volta ganha a sua faixa, e a ordem não é arbitrária: a volta mais
 * longa fica na faixa mais externa, de modo que as curtas ficam **dentro** das
 * longas. Assim as linhas se aninham em vez de se cruzarem.
 */
export interface CanalDoRetorno {
  eixo: "x" | "y";
  /** A faixa de cada volta, por id da conexão. Já em coordenadas da folha. */
  porSeta: Map<string, number>;
  /** A faixa de quem não estiver no mapa — a primeira. */
  padrao: number;
}

/** O espaço entre duas faixas de retorno. Cabe a tarja de um rótulo. */
const PASSO_DA_FAIXA = 22;
/**
 * O corredor entre duas colunas de cartões.
 *
 * A volta do desenho deitado desce, corre pela faixa e sobe — e a subida é o
 * problema: feita no meio do cartão de destino, ela atravessa em pé todas as
 * linhas que estiverem entre a faixa e ele. O passo do layout é 260 e o cartão
 * tem 200, então há 60 de corredor entre duas colunas: subir por ele é o que
 * faz a volta chegar sem riscar nenhum cartão pelo caminho.
 */
const CORREDOR_DO_RETORNO = 30;

function desenharSeta(
  origem: CaixaDaEtapa,
  destino: CaixaDaEtapa,
  seta: {
    id: string;
    style: { stroke: string; strokeDasharray?: string };
    label: string | undefined;
  },
  dx: number,
  dy: number,
  canal: CanalDoRetorno,
  deitado: boolean,
): string {
  const o = { x: origem.x + dx, y: origem.y + dy, w: origem.largura, h: origem.altura };
  const d = { x: destino.x + dx, y: destino.y + dy, w: destino.largura, h: destino.altura };
  const centroO = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
  const centroD = { x: d.x + d.w / 2, y: d.y + d.h / 2 };

  if (ehVolta(origem, destino, deitado)) {
    const faixa = canal.porSeta.get(seta.id) ?? canal.padrao;
    return canal.eixo === "y"
      ? desenharVoltaPorBaixo(o, d, centroO, centroD, seta, faixa)
      : desenharVoltaPeloCanal(o, d, centroO, centroD, seta, faixa);
  }

  const paraBaixo = centroD.y > centroO.y;
  const vertical = Math.abs(centroD.y - centroO.y) > Math.abs(centroD.x - centroO.x) * 0.6;

  let p1: { x: number; y: number };
  let p2: { x: number; y: number };
  let c1: { x: number; y: number };
  let c2: { x: number; y: number };

  if (vertical) {
    p1 = { x: centroO.x, y: paraBaixo ? o.y + o.h : o.y };
    p2 = { x: centroD.x, y: paraBaixo ? d.y : d.y + d.h };
    const salto = Math.max(24, Math.abs(p2.y - p1.y) / 2);
    c1 = { x: p1.x, y: p1.y + (paraBaixo ? salto : -salto) };
    c2 = { x: p2.x, y: p2.y + (paraBaixo ? -salto : salto) };
  } else {
    const paraDireita = centroD.x > centroO.x;
    p1 = { x: paraDireita ? o.x + o.w : o.x, y: centroO.y };
    p2 = { x: paraDireita ? d.x : d.x + d.w, y: centroD.y };
    const salto = Math.max(24, Math.abs(p2.x - p1.x) / 2);
    c1 = { x: p1.x + (paraDireita ? salto : -salto), y: p1.y };
    c2 = { x: p2.x + (paraDireita ? -salto : salto), y: p2.y };
  }

  const traco = seta.style.strokeDasharray
    ? ` stroke-dasharray="${seta.style.strokeDasharray}"`
    : "";
  const caminho = `<path d="M ${arredondar(p1.x)} ${arredondar(p1.y)} C ${arredondar(
    c1.x,
  )} ${arredondar(c1.y)}, ${arredondar(c2.x)} ${arredondar(c2.y)}, ${arredondar(
    p2.x,
  )} ${arredondar(p2.y)}" fill="none" stroke="${seta.style.stroke}" stroke-width="1.5"${traco} marker-end="url(#${idDaPonta(
    seta.style.stroke,
  )})"/>`;

  if (!seta.label) return caminho;

  /*
    O rótulo ganha uma tarja do papel por baixo. Sem ela, "se rejeitado" escrito
    em cima da própria seta fica ilegível — e é justamente o rótulo que explica
    por que a seta existe.
  */
  const mx = arredondar((p1.x + p2.x) / 2);
  const my = arredondar((p1.y + p2.y) / 2);
  const largura = Math.max(20, seta.label.length * 5.6 + 10);
  return [
    caminho,
    `<rect x="${arredondar(mx - largura / 2)}" y="${my - 9}" width="${arredondar(
      largura,
    )}" height="16" rx="4" fill="${PAPEL}" fill-opacity="0.92"/>`,
    `<text x="${mx}" y="${my + 3}" font-size="10" fill="${TINTA_FRACA}" text-anchor="middle">${escaparXml(
      seta.label,
    )}</text>`,
  ].join("");
}

const arredondar = (n: number): number => Math.round(n * 10) / 10;

/**
 * A volta desenhada por fora: sai pela direita da origem, sobe pelo canal e
 * entra pela direita do destino, com os cantos arredondados.
 *
 * O rótulo fica **no canal**, onde não há cartão nenhum — é por isso que o
 * respiro à direita da folha é calculado contando com ele.
 */
function desenharVoltaPeloCanal(
  o: { x: number; y: number; w: number; h: number },
  d: { x: number; y: number; w: number; h: number },
  centroO: { x: number; y: number },
  centroD: { x: number; y: number },
  seta: { style: { stroke: string; strokeDasharray?: string }; label: string | undefined },
  canal: number,
): string {
  const raio = 12;
  const saida = { x: o.x + o.w, y: centroO.y };
  const chegada = { x: d.x + d.w, y: centroD.y };
  const traco = seta.style.strokeDasharray
    ? ` stroke-dasharray="${seta.style.strokeDasharray}"`
    : "";

  const caminho = [
    `M ${arredondar(saida.x)} ${arredondar(saida.y)}`,
    `L ${arredondar(canal - raio)} ${arredondar(saida.y)}`,
    `Q ${arredondar(canal)} ${arredondar(saida.y)} ${arredondar(canal)} ${arredondar(saida.y - raio)}`,
    `L ${arredondar(canal)} ${arredondar(chegada.y + raio)}`,
    `Q ${arredondar(canal)} ${arredondar(chegada.y)} ${arredondar(canal - raio)} ${arredondar(chegada.y)}`,
    `L ${arredondar(chegada.x)} ${arredondar(chegada.y)}`,
  ].join(" ");

  const linha = `<path d="${caminho}" fill="none" stroke="${seta.style.stroke}" stroke-width="1.5"${traco} marker-end="url(#${idDaPonta(
    seta.style.stroke,
  )})"/>`;
  if (!seta.label) return linha;

  const my = arredondar((saida.y + chegada.y) / 2);
  const largura = Math.max(20, larguraDoTexto(seta.label, 5.6) + 10);
  return [
    linha,
    `<rect x="${arredondar(canal - largura / 2)}" y="${my - 9}" width="${arredondar(
      largura,
    )}" height="16" rx="4" fill="${PAPEL}" fill-opacity="0.92"/>`,
    `<text x="${canal}" y="${my + 3}" font-size="10" fill="${TINTA_FRACA}" text-anchor="middle">${escaparXml(
      seta.label,
    )}</text>`,
  ].join("");
}

/**
 * A volta do desenho deitado: desce da origem, corre pela faixa de baixo e sobe
 * pela borda inferior do destino.
 *
 * É o retorno como um fluxograma da esquerda para a direita sempre o desenhou —
 * e é o espelho exato de `desenharVoltaPeloCanal`, com os eixos trocados. Duas
 * funções, e não uma com eixo parametrizado: o que muda entre elas não é só
 * `x` por `y`, é qual lado do cartão a seta toca e para que lado o canto
 * arredonda, e a versão genérica ficaria com quatro ternários por comando de
 * caminho — mais difícil de ler do que as duas escritas por extenso.
 *
 * O rótulo fica **no canal**, onde não há cartão nenhum — é por isso que o
 * respiro embaixo da folha é calculado contando com ele.
 */
function desenharVoltaPorBaixo(
  o: { x: number; y: number; w: number; h: number },
  d: { x: number; y: number; w: number; h: number },
  centroO: { x: number; y: number },
  centroD: { x: number; y: number },
  seta: { style: { stroke: string; strokeDasharray?: string }; label: string | undefined },
  canal: number,
): string {
  const raio = 12;
  /*
    Sai pela esquerda da origem e entra pela esquerda do destino, descendo e
    subindo pelos corredores entre colunas: é o que impede a linha de riscar em
    pé os cartões das linhas que estão entre a faixa e o destino.
  */
  const descida = o.x - CORREDOR_DO_RETORNO;
  const subida = d.x - CORREDOR_DO_RETORNO;
  const saida = { x: o.x, y: centroO.y };
  const chegada = { x: d.x, y: centroD.y };
  const traco = seta.style.strokeDasharray
    ? ` stroke-dasharray="${seta.style.strokeDasharray}"`
    : "";

  const caminho = [
    `M ${arredondar(saida.x)} ${arredondar(saida.y)}`,
    `L ${arredondar(descida + raio)} ${arredondar(saida.y)}`,
    `Q ${arredondar(descida)} ${arredondar(saida.y)} ${arredondar(descida)} ${arredondar(saida.y + raio)}`,
    `L ${arredondar(descida)} ${arredondar(canal - raio)}`,
    `Q ${arredondar(descida)} ${arredondar(canal)} ${arredondar(descida - raio)} ${arredondar(canal)}`,
    `L ${arredondar(subida + raio)} ${arredondar(canal)}`,
    `Q ${arredondar(subida)} ${arredondar(canal)} ${arredondar(subida)} ${arredondar(canal - raio)}`,
    `L ${arredondar(subida)} ${arredondar(chegada.y + raio)}`,
    `Q ${arredondar(subida)} ${arredondar(chegada.y)} ${arredondar(subida + raio)} ${arredondar(chegada.y)}`,
    `L ${arredondar(chegada.x)} ${arredondar(chegada.y)}`,
  ].join(" ");

  const linha = `<path d="${caminho}" fill="none" stroke="${seta.style.stroke}" stroke-width="1.5"${traco} marker-end="url(#${idDaPonta(
    seta.style.stroke,
  )})"/>`;
  if (!seta.label) return linha;

  const mx = arredondar((descida + subida) / 2);
  const largura = Math.max(20, larguraDoTexto(seta.label, 5.6) + 10);
  return [
    linha,
    `<rect x="${arredondar(mx - largura / 2)}" y="${arredondar(canal - 9)}" width="${arredondar(
      largura,
    )}" height="16" rx="4" fill="${PAPEL}" fill-opacity="0.92"/>`,
    `<text x="${mx}" y="${arredondar(canal + 3)}" font-size="10" fill="${TINTA_FRACA}" text-anchor="middle">${escaparXml(
      seta.label,
    )}</text>`,
  ].join("");
}

// ---------------------------------------------------------------------------
// A legenda
// ---------------------------------------------------------------------------

export interface ItemDaLegenda {
  rotulo: string;
  cor: string;
  tracejada: boolean;
}

/**
 * A legenda traz **só os tipos de seta que o fluxo usa**.
 *
 * Cinco entradas fixas num processo que só tem sequência é ruído; a entrada
 * "retrabalho" num processo que tem a volta é a informação mais importante do
 * desenho. Ela sai do dado, e não de uma lista escrita à mão.
 */
export function montarLegenda(
  completo: FluxoCompleto,
  catalogo: Catalogo | undefined,
): ItemDaLegenda[] {
  const usados = new Set(completo.conexoes.map((c) => c.tipo));
  const catalogados = catalogo?.tiposDeConexao ?? [];
  return [...usados]
    .sort((a, b) => a.localeCompare(b))
    .map((valor) => {
      const entrada = catalogados.find((t) => t.valor === valor);
      return {
        rotulo: entrada?.rotulo ?? valor,
        cor: COR_DA_CONEXAO[valor] ?? COR_DA_CONEXAO.SEQUENCIA,
        tracejada: entrada?.tracejada ?? false,
      };
    });
}

function desenharLegenda(itens: ItemDaLegenda[], x: number, y: number): string {
  const partes: string[] = [];
  let cursor = x;
  for (const item of itens) {
    partes.push(
      `<line x1="${cursor}" y1="${y}" x2="${cursor + 22}" y2="${y}" stroke="${item.cor}" stroke-width="2"${
        item.tracejada ? ' stroke-dasharray="6 4"' : ""
      }/>`,
      `<text x="${cursor + 28}" y="${y + 4}" font-size="11" fill="${TINTA_FRACA}">${escaparXml(
        item.rotulo,
      )}</text>`,
    );
    cursor += 28 + item.rotulo.length * 6.2 + 24;
  }
  return partes.join("");
}

// ---------------------------------------------------------------------------
// O nome do arquivo
// ---------------------------------------------------------------------------

/**
 * `Operação Empurrada` + `2026-08-27` → `operacao-empurrada-2026-08-27.png`.
 *
 * Sem acento, sem espaço e com a data: os três são o que faz uma pasta de
 * downloads com seis versões do mesmo fluxo continuar navegável. A data entra
 * por parâmetro — a função é pura, e é testada.
 */
export function nomeDoArquivo(
  fluxo: { nome: string; slug: string },
  extensao: "png" | "pdf" | "svg" | "xlsx",
  emIso: string,
): string {
  const base =
    (fluxo.slug ?? "").trim() !== ""
      ? fluxo.slug
      : fluxo.nome
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
  const data = (emIso.split("T")[0] ?? "").trim();
  const inicio = base === "" ? "fluxo" : base;
  return data === "" ? `${inicio}.${extensao}` : `${inicio}-${data}.${extensao}`;
}

// ---------------------------------------------------------------------------
// O PDF
// ---------------------------------------------------------------------------

/** A4 em pontos (1/72"), que é a unidade do PDF. */
const A4 = { menor: 595.28, maior: 841.89 };
const MARGEM_DO_PDF = 24;

export interface ImagemParaPdf {
  /** Os bytes da imagem, já no formato que o filtro declara. */
  dados: Uint8Array;
  /** `DCTDecode` para JPEG; `FlateDecode` para RGB cru comprimido. */
  filtro: "DCTDecode" | "FlateDecode";
  largura: number;
  altura: number;
  titulo: string;
}

/**
 * Um PDF de uma página com a imagem do fluxograma dentro — escrito à mão.
 *
 * Parece exótico e é o oposto: um PDF que carrega **uma** imagem é meia dúzia
 * de objetos e uma tabela de deslocamentos. A alternativa era somar uma
 * biblioteca de geração de PDF ao pacote da tela para usar 2% dela.
 *
 * A orientação sai da forma do desenho — um fluxo alto sai retrato, um largo
 * sai paisagem — e a imagem é encaixada na página inteira menos a margem,
 * mantendo a proporção. É por isso que o PDF de um processo de dezesseis etapas
 * não sai com o desenho espremido num canto.
 *
 * Função pura: recebe bytes, devolve bytes. O que ela produz é afirmado em
 * teste sem navegador — cabeçalho, objetos, `startxref` e a tabela de
 * deslocamentos batendo com o arquivo montado.
 */
export function montarPdfDeImagem(imagem: ImagemParaPdf): Uint8Array {
  const paisagem = imagem.largura >= imagem.altura;
  const larguraDaPagina = paisagem ? A4.maior : A4.menor;
  const alturaDaPagina = paisagem ? A4.menor : A4.maior;

  const disponivelX = larguraDaPagina - MARGEM_DO_PDF * 2;
  const disponivelY = alturaDaPagina - MARGEM_DO_PDF * 2;
  const escala = Math.min(disponivelX / imagem.largura, disponivelY / imagem.altura);
  const larguraNaPagina = imagem.largura * escala;
  const alturaNaPagina = imagem.altura * escala;
  const esquerda = (larguraDaPagina - larguraNaPagina) / 2;
  /* A origem do PDF é o canto inferior esquerdo — daí a subtração. */
  const base = (alturaDaPagina - alturaNaPagina) / 2;

  const conteudo = `q ${dec(larguraNaPagina)} 0 0 ${dec(alturaNaPagina)} ${dec(esquerda)} ${dec(
    base,
  )} cm /Im0 Do Q\n`;

  const pedacos: (string | Uint8Array)[] = [];
  const deslocamentos: number[] = [];
  let tamanho = 0;

  const escrever = (pedaco: string | Uint8Array): void => {
    pedacos.push(pedaco);
    tamanho += typeof pedaco === "string" ? bytesDeTexto(pedaco).length : pedaco.length;
  };
  const abrirObjeto = (numero: number): void => {
    deslocamentos[numero] = tamanho;
    escrever(`${numero} 0 obj\n`);
  };

  escrever("%PDF-1.4\n");
  /*
    A linha de bytes altos logo depois do cabeçalho é o que faz um cliente de
    e-mail ou um servidor tratar o arquivo como binário, e não como texto que
    pode ter as quebras de linha "corrigidas" no caminho. Está na especificação
    e é a diferença entre um PDF que abre e um que chega corrompido.
  */
  escrever(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  abrirObjeto(1);
  escrever("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  abrirObjeto(2);
  escrever("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  abrirObjeto(3);
  escrever(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${dec(larguraDaPagina)} ${dec(
      alturaDaPagina,
    )}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
  );

  abrirObjeto(4);
  escrever(`<< /Length ${bytesDeTexto(conteudo).length} >>\nstream\n${conteudo}endstream\nendobj\n`);

  abrirObjeto(5);
  escrever(
    `<< /Type /XObject /Subtype /Image /Width ${imagem.largura} /Height ${imagem.altura} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${imagem.filtro} /Length ${imagem.dados.length} >>\nstream\n`,
  );
  escrever(imagem.dados);
  escrever("\nendstream\nendobj\n");

  abrirObjeto(6);
  escrever(`<< /Title (${textoDePdf(imagem.titulo)}) /Producer (FreightCheck) >>\nendobj\n`);

  const inicioDaTabela = tamanho;
  const total = 7;
  let tabela = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i += 1) {
    tabela += `${String(deslocamentos[i]).padStart(10, "0")} 00000 n \n`;
  }
  tabela += `trailer\n<< /Size ${total} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${inicioDaTabela}\n%%EOF\n`;
  escrever(tabela);

  const saida = new Uint8Array(tamanho);
  let cursor = 0;
  for (const pedaco of pedacos) {
    const bytes = typeof pedaco === "string" ? bytesDeTexto(pedaco) : pedaco;
    saida.set(bytes, cursor);
    cursor += bytes.length;
  }
  return saida;
}

/**
 * Texto para dentro de uma string literal de PDF.
 *
 * Parêntese e barra invertida são a sintaxe da própria string: um fluxo chamado
 * "Faturamento (novo)" fecharia a string no meio e produziria um arquivo que
 * nenhum leitor abre. Acento vira ASCII aproximado porque o título vai sem
 * dicionário de codificação — o nome legível do processo está desenhado na
 * página, este campo é o rótulo da aba do leitor.
 */
function textoDePdf(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/** Latin-1, e não UTF-8: a estrutura do PDF é ASCII e os bytes precisam casar. */
function bytesDeTexto(texto: string): Uint8Array {
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i += 1) bytes[i] = texto.charCodeAt(i) & 0xff;
  return bytes;
}

const dec = (n: number): string => String(Math.round(n * 100) / 100);

// ---------------------------------------------------------------------------
// A parte que precisa do navegador
// ---------------------------------------------------------------------------

/** A escala do PNG. Dois é o que mantém o texto legível ao dar zoom no slide. */
export const ESCALA_PADRAO = 2;

/**
 * O SVG rasterizado — via `Image` e `canvas`, sem biblioteca.
 *
 * O SVG entra como `data:` URL, e é por isso que ele precisa ser
 * autossuficiente: uma imagem carregada assim não puxa nada de fora, e uma
 * fonte ou um ícone externo simplesmente não apareceriam. Tudo o que
 * `montarSvgDoFluxo` escreve é forma e texto.
 */
export async function svgParaCanvas(
  { svg, largura, altura }: SvgDoFluxo,
  escala = ESCALA_PADRAO,
): Promise<HTMLCanvasElement> {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const imagem = new Image();
  imagem.decoding = "sync";

  await new Promise<void>((resolver, recusar) => {
    imagem.onload = () => resolver();
    imagem.onerror = () => recusar(new Error("O desenho não pôde ser rasterizado."));
    imagem.src = url;
  });

  const tela = document.createElement("canvas");
  tela.width = Math.max(1, Math.round(largura * escala));
  tela.height = Math.max(1, Math.round(altura * escala));
  const pincel = tela.getContext("2d");
  if (!pincel) throw new Error("Este navegador não expôs o contexto 2D para desenhar a imagem.");
  /* Fundo pintado: um PNG com transparência vira preto em muito visualizador. */
  pincel.fillStyle = PAPEL;
  pincel.fillRect(0, 0, tela.width, tela.height);
  pincel.drawImage(imagem, 0, 0, tela.width, tela.height);
  return tela;
}

function comoBlob(tela: HTMLCanvasElement, tipo: string, qualidade?: number): Promise<Blob> {
  return new Promise((resolver, recusar) => {
    tela.toBlob(
      (blob) => (blob ? resolver(blob) : recusar(new Error("A imagem não pôde ser gerada."))),
      tipo,
      qualidade,
    );
  });
}

/**
 * O SVG como arquivo — o formato que continua editável depois de sair daqui.
 *
 * É o único dos três que não passa pelo `canvas`: o texto continua texto, as
 * formas continuam formas, e quem precisar ajustar o desenho para um material
 * de apresentação abre num editor de vetor em vez de recomeçar. Sai de graça,
 * porque é exatamente o que os outros dois já usam por dentro.
 */
export function fluxoComoSvg(
  completo: FluxoCompleto,
  catalogo: Catalogo | undefined,
  opcoes: OpcoesDaExportacao = {},
): Blob {
  const { svg } = montarSvgDoFluxo(completo, catalogo, opcoes);
  return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
}

export async function fluxoComoPng(
  completo: FluxoCompleto,
  catalogo: Catalogo | undefined,
  opcoes: OpcoesDaExportacao = {},
): Promise<Blob> {
  const tela = await svgParaCanvas(montarSvgDoFluxo(completo, catalogo, opcoes));
  return comoBlob(tela, "image/png");
}

/**
 * O PDF, com a imagem embutida sem perda quando o navegador tem `deflate`.
 *
 * `CompressionStream` existe em todos os navegadores atuais e devolve o fluxo
 * `zlib` que o `FlateDecode` do PDF espera — pixels exatos, texto sem borrar.
 * Onde ele não existir, o caminho é JPEG (`DCTDecode`): um pouco de artefato em
 * volta das letras é muito melhor do que um botão que não faz nada.
 */
export async function fluxoComoPdf(
  completo: FluxoCompleto,
  catalogo: Catalogo | undefined,
  opcoes: OpcoesDaExportacao = {},
): Promise<Blob> {
  const tela = await svgParaCanvas(montarSvgDoFluxo(completo, catalogo, opcoes));
  const pincel = tela.getContext("2d");
  if (!pincel) throw new Error("Este navegador não expôs o contexto 2D para gerar o PDF.");

  const imagem = await (async (): Promise<ImagemParaPdf> => {
    if (typeof CompressionStream === "function") {
      const rgba = pincel.getImageData(0, 0, tela.width, tela.height).data;
      const rgb = new Uint8Array((rgba.length / 4) * 3);
      for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
        rgb[j] = rgba[i];
        rgb[j + 1] = rgba[i + 1];
        rgb[j + 2] = rgba[i + 2];
      }
      return {
        dados: await comprimir(rgb),
        filtro: "FlateDecode",
        largura: tela.width,
        altura: tela.height,
        titulo: completo.fluxo.nome,
      };
    }
    const jpeg = await comoBlob(tela, "image/jpeg", 0.95);
    return {
      dados: new Uint8Array(await jpeg.arrayBuffer()),
      filtro: "DCTDecode",
      largura: tela.width,
      altura: tela.height,
      titulo: completo.fluxo.nome,
    };
  })();

  return new Blob([montarPdfDeImagem(imagem) as unknown as BlobPart], {
    type: "application/pdf",
  });
}

/** `deflate` — o formato zlib, que é o que `/FlateDecode` lê. */
async function comprimir(bytes: Uint8Array): Promise<Uint8Array> {
  const fluxo = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}
