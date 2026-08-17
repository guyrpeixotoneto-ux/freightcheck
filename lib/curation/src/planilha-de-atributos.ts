import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  attributeSemanticsTable,
  attributeTable,
  curationEventTable,
  taxonomyNodeTable,
} from "@workspace/db";
import { saveMeaning } from "./meaning";

/**
 * A curadoria em planilha: exportar o que falta, preencher no Excel, trazer de
 * volta.
 *
 * ---------------------------------------------------------------------------
 * Por que existe
 * ---------------------------------------------------------------------------
 * A tela cura uma coluna por vez, e isso é certo para o ato caro — confirmar
 * interpretação é assinar que um número pode entrar em soma financeira, e
 * assinar 121 vezes seguidas é como se assina sem ler. Mas o ato **barato** —
 * dizer como a coluna se chama, o que ela é e onde ela entra na conta — é
 * conhecimento que quem opera já tem escrito em algum lugar, e cobrá-lo em 121
 * idas e voltas de tela é o que manteve esses campos vazios.
 *
 * Então esta é a metade barata, em lote. O que ela **não** faz é o que mais
 * importa nela:
 *
 * - **Não confirma nada.** Nenhum caminho daqui escreve `semantics_status`,
 *   `confirmed_by` ou `confirmed_at`. Uma planilha preenchida em casa não
 *   destrava cálculo financeiro; quem destrava continua sendo a tela, com
 *   justificativa assinada por quem está logado.
 * - **Não cria atributo.** Coluna nasce da importação, de célula com valor.
 *   Um nome que a base não tem sai na prévia como linha ignorada — nunca como
 *   atributo novo, que apareceria na fila sem valor nenhum para curar e sem
 *   como ser curado.
 * - **Não toca `source_name`.** É por ele que a importação encontra a coluna na
 *   planilha do Freightec. O "nome gerencial" da planilha é apelido de leitura,
 *   exatamente como na tela.
 *
 * ---------------------------------------------------------------------------
 * A coluna que não é prosa
 * ---------------------------------------------------------------------------
 * "Categoria DRE" é uma das perguntas do card de confirmação — os mesmos
 * campos, com os mesmos nomes nos dois lugares —, e ela entra aqui como
 * **proposta**: grava `taxonomy_node_id` e para aí. É o que `runProposalPass`
 * já faz quando o motor lê os valores; a diferença é que agora a proposta é de
 * uma pessoa, o que a torna melhor, não mais poderosa. Quem abrir o atributo na
 * tela encontra a resposta pronta e uma justificativa a escrever.
 *
 * ---------------------------------------------------------------------------
 * Duas colunas, uma classificação
 * ---------------------------------------------------------------------------
 * A categoria sai e volta em **duas** colunas — "Categoria DRE - Sintético" e
 * "Categoria DRE - Analítico" —, e mesmo assim o que se grava continua sendo um
 * nó só. As duas são as duas alturas do mesmo caminho: `Custo Variável ›
 * Manutenção` é o sintético "Custo Variável" e o analítico "Manutenção".
 * Guardá-las em separado criaria o dia em que uma discorda da outra.
 *
 * A coluna de sintético não é decoração de leitura: ela é o que **desambigua**.
 * "Outros" existe dentro de custo fixo e dentro de custo variável, e a planilha
 * de uma coluna só recusava a célula dizendo "há mais de uma categoria com este
 * nome, escreva o caminho inteiro" — cobrando de quem preenche uma sintaxe com
 * `›` que ninguém digita. Com o sintético ao lado, a mesma resposta vira uma
 * escolha em duas listas suspensas.
 *
 * Arquivos antigos, com a coluna única "Categoria DRE", continuam sendo lidos:
 * o modelo saiu por e-mail antes desta mudança, e recusar a volta deles seria
 * jogar fora trabalho já feito.
 *
 * Num atributo **já confirmado** ela é recusada, e só ela: trocar a categoria
 * de quem já foi assinado muda em que linha da DRE o número cai, e desfazer uma
 * assinatura é ato de tela. Nome e descrição continuam entrando, porque prosa
 * não move dinheiro.
 *
 * ---------------------------------------------------------------------------
 * Célula em branco não apaga
 * ---------------------------------------------------------------------------
 * A regra da planilha inteira. Quem preenche 12 linhas de 121 devolve 109
 * células vazias que significam "não mexi nisto", e lê-las como "apague" faria
 * um arquivo pela metade destruir o trabalho da tela. Limpar um campo continua
 * sendo ato de tela, onde se vê o que está sendo apagado.
 */

// ---------------------------------------------------------------------------
// O formato
// ---------------------------------------------------------------------------

/**
 * Os campos que a planilha **grava**.
 *
 * `categoria` é um só apesar de a planilha ter duas colunas para ela: sintético
 * e analítico são duas alturas de um caminho, e o que se grava é o nó em que
 * esse caminho termina. Uma mudança de categoria vale pelo caminho inteiro.
 */
export type CampoDoModelo = "displayName" | "definition" | "categoria";

/** As colunas do arquivo — que não são os campos: a categoria ocupa duas. */
export type ChaveDeColuna =
  | "atributo"
  | "displayName"
  | "definition"
  | "categoriaSintetica"
  | "categoriaAnalitica";

export interface ColunaDoModelo {
  chave: ChaveDeColuna;
  rotulo: string;
  largura: number;
  /** Falso na coluna de identificação: ela sai preenchida e é lida. */
  preenchivel: boolean;
  ajuda: string;
}

/**
 * Cinco colunas, e a primeira é a chave.
 *
 * O modelo tinha nove — código, coluna de origem, status, valores, "também
 * existe em", nome, o que é, fórmula e significado — e o que se descobriu
 * olhando um arquivo preenchido de verdade é que as cinco de contexto não são
 * lidas: quem descreve colunas descreve olhando a coluna, não a contagem de
 * fatos dela. Elas custavam rolagem horizontal em toda linha.
 *
 * **`Atributo` é o nome de origem, e é por ele que a volta casa.** O código
 * (`cavalo.seguro`) saiu junto, e a chave passou a ser o par **aba +
 * atributo** — o que só funciona porque a importação recusa dois cabeçalhos
 * que normalizam para o mesmo nome dentro de um equipamento
 * (`AMBIGUOUS_COLUMN_SLUG`), e porque cada aba é um equipamento. É a mesma
 * unicidade de antes, dita no vocabulário de quem preenche: ninguém reconhece
 * `cavalo.valor_pis_cofins`, todo mundo reconhece `valorPisCofins`.
 */
export const COLUNAS_DO_MODELO: ColunaDoModelo[] = [
  {
    chave: "atributo",
    rotulo: "Atributo",
    largura: 32,
    preenchivel: false,
    ajuda:
      "A coluna como veio do Freightec. Não edite: é por este nome, dentro desta aba, que o preenchimento volta para o atributo certo.",
  },
  {
    chave: "displayName",
    rotulo: "Nome Gerencial",
    largura: 32,
    preenchivel: true,
    ajuda: "Apelido de leitura. Em branco, as telas mostram o nome de origem.",
  },
  {
    chave: "definition",
    rotulo: "O que é",
    largura: 80,
    preenchivel: true,
    ajuda: "A descrição que você daria a alguém que nunca viu esta planilha.",
  },
  {
    chave: "categoriaSintetica",
    rotulo: "Categoria DRE - Sintético",
    largura: 30,
    preenchivel: true,
    ajuda:
      "A linha da DRE que totaliza — Custo Variável, Custo Fixo, Cadastral. Sozinha ela não classifica: é o par com o analítico ao lado que diz onde a coluna entra na conta.",
  },
  {
    chave: "categoriaAnalitica",
    rotulo: "Categoria DRE - Analítico",
    largura: 34,
    preenchivel: true,
    ajuda:
      "O detalhe dentro do sintético — Manutenção, Pneus, Combustível. É o que de fato classifica a coluna, e entra como proposta: não confirma o atributo.",
  },
];

/** O rótulo antigo, quando a categoria cabia numa coluna só. Ainda é lido. */
export const ROTULO_DA_COLUNA_ANTIGA = "Categoria DRE";

/** Uma linha do modelo, como o servidor a escreve no arquivo. */
export interface LinhaDoModelo {
  atributo: string;
  entityType: string;
  displayName: string;
  definition: string;
  categoriaSintetica: string;
  categoriaAnalitica: string;
}

/** O atributo como a base o tem, para o modelo e para a conferência. */
export interface AtributoDoModelo {
  /** A identidade real, que nunca aparece no arquivo. */
  code: string;
  sourceName: string;
  entityType: string;
  /** CONFIRMED, PRESUMED ou UNKNOWN — ver a recusa em {@link conferirPreenchimento}. */
  semanticsStatus: string;
  displayName: string | null;
  definition: string | null;
  /**
   * A categoria por **código**, e não pelo texto que a tela mostra.
   *
   * A diferença apareceu na primeira volta do arquivo: a fila devolve o caminho
   * técnico da taxonomia (`remuneracao/custo_variavel/cv_pneus`) e o catálogo
   * fala `Custo Variável › Pneus` — exportar um e conferir contra o outro fazia
   * a planilha recusar a categoria que ela mesma tinha escrito.
   */
  taxonomyCode: string | null;
}

/**
 * As linhas do arquivo, já com o que a base sabe escrito nas colunas de
 * preenchimento.
 *
 * Sair preenchida é o ponto: a planilha é um round-trip, e uma exportação com
 * as colunas em branco faria quem a devolvesse reescrever à mão o que já estava
 * lá — ou, pior, apagá-lo, se a leitura fosse destrutiva.
 */
export function montarLinhas(
  atributos: AtributoDoModelo[],
  catalogos: CatalogosDoModelo,
): LinhaDoModelo[] {
  // O texto que a célula mostra sai do catálogo, que é de onde a lista suspensa
  // também sai: o arquivo abre com a opção já selecionada, e não com um texto
  // parecido com uma das opções. Vale para as duas colunas — uma categoria já
  // classificada volta com o par completo, e quem só quiser mudar o analítico
  // não precisa reescrever o sintético.
  const porCodigo = new Map(catalogos.categorias.map((c) => [c.code, c]));

  return atributos.map((a) => {
    const categoria = a.taxonomyCode ? porCodigo.get(a.taxonomyCode) : undefined;
    return {
      atributo: a.sourceName,
      entityType: a.entityType,
      displayName: a.displayName ?? "",
      definition: a.definition ?? "",
      categoriaSintetica: categoria?.sintetico ?? "",
      categoriaAnalitica: categoria?.analitico ?? "",
    };
  });
}

// ---------------------------------------------------------------------------
// A conferência
// ---------------------------------------------------------------------------

/** Uma linha como voltou do Excel. Todo campo é texto; em branco é "não mexi". */
export interface LinhaPreenchida {
  /** A aba e a linha física, para a prévia apontar onde está o problema. */
  aba: string;
  linha: number;
  /** O nome de origem da coluna, da primeira célula da linha. */
  atributo: string;
  displayName?: string;
  definition?: string;
  categoriaSintetica?: string;
  categoriaAnalitica?: string;
  /** A coluna única dos arquivos gerados antes da separação em dois níveis. */
  categoria?: string;
}

export interface CategoriaDoCatalogo {
  code: string;
  /** "Custo Variável › Manutenção" — os dois níveis juntos. */
  caminho: string;
  /** "Custo Variável" — a linha que totaliza. */
  sintetico: string;
  /** "Manutenção" — o que de fato classifica. */
  analitico: string;
}

export interface CatalogosDoModelo {
  categorias: CategoriaDoCatalogo[];
}

export interface MudancaDeCampo {
  campo: CampoDoModelo;
  de: string | null;
  para: string;
  /** O código do catálogo, quando o campo é a categoria. */
  codigo?: string;
}

export type DesfechoDaLinha =
  /** Tem o que gravar. */
  | "MUDA"
  /** Voltou igual ao que já está na base. */
  | "IGUAL"
  /** A linha não diz de que atributo fala. */
  | "SEM_ATRIBUTO_NA_LINHA"
  /** O nome não corresponde a nenhuma coluna importada. */
  | "SEM_ATRIBUTO"
  /** O nome existe em mais de um equipamento e a aba não disse qual. */
  | "AMBIGUO";

export interface LinhaConferida {
  aba: string;
  linha: number;
  atributo: string;
  /** O código do atributo casado, para a gravação. `null` quando não casou. */
  code: string | null;
  desfecho: DesfechoDaLinha;
  mudancas: MudancaDeCampo[];
  /**
   * O que não deu para entender **nesta linha**, célula a célula.
   *
   * Célula, e não linha, e a diferença apareceu na primeira volta de um arquivo
   * real: alguém escreveu "Lucro" na categoria — que não existe no catálogo — e
   * a recusa levava junto o nome gerencial e a descrição da mesma linha, que
   * estavam certos e escritos à mão. Perder dois campos bons por causa de um
   * erro de digitação no terceiro é a diferença entre uma planilha que ajuda e
   * uma que faz a pessoa preencher tudo de novo.
   */
  problemas: string[];
}

export interface ConferenciaDoModelo {
  linhas: LinhaConferida[];
  resumo: {
    /** Linhas que gravam alguma coisa. */
    mudam: number;
    /** Quantos campos ao todo. É o número que a prévia mostra em destaque. */
    campos: number;
    iguais: number;
    /** Linhas que não casaram com atributo nenhum. */
    ignoradas: number;
    /** Células que a conferência não entendeu, em qualquer linha. */
    naoEntendidas: number;
  };
}

/** Comparação de texto que perdoa acento, caixa e espaço repetido. */
function dobrar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * O texto da categoria sem o comentário entre parênteses.
 *
 * "Cadastral (não entra na DRE)" é como a lista que existe hoje, escrita antes
 * deste catálogo, nomeia a classe — e o parêntese é explicação para quem lê, não
 * parte do nome. Cortá-lo antes de casar transforma uma recusa em um acerto, ou
 * — quando o que sobra é uma classe — numa recusa que sabe listar as opções.
 */
function semParenteses(texto: string): string {
  return texto.replace(/\([^)]*\)/g, " ").trim();
}

/** Em branco não é valor: é a ausência de resposta, e ela não apaga nada. */
function preenchido(valor: string | undefined): string | null {
  const texto = valor?.trim() ?? "";
  return texto === "" ? null : texto;
}

/**
 * O texto do que já estava lá, para a prévia mostrar "de → para".
 *
 * Vem do catálogo, e não do atributo: o que a base guarda é o código, e a
 * prévia que dissesse `cv_pneus → Custo Variável › Pneus` faria a pessoa
 * conferir uma troca que não é a que ela fez.
 */
function caminhoDe(
  codigo: string | null,
  categorias: CategoriaDoCatalogo[],
): string | null {
  if (codigo === null) return null;
  return categorias.find((c) => c.code === codigo)?.caminho ?? codigo;
}

type Achado =
  | { tipo: "ACHADA"; code: string; caminho: string }
  /** Só o sintético veio, e ele sozinho não classifica. */
  | { tipo: "SO_SINTETICO"; opcoes: string[] }
  /** O analítico existe em mais de um sintético, e nenhum foi dito. */
  | { tipo: "AMBIGUA"; opcoes: string[] }
  /** O sintético escrito não é nenhuma das linhas que totalizam. */
  | { tipo: "SINTETICO_DESCONHECIDO"; opcoes: string[] }
  /** Os dois existem, e não são o mesmo caminho. */
  | { tipo: "INCOMPATIVEL"; caminhoReal: string }
  | { tipo: "NENHUMA" };

/** Os sintéticos do catálogo, sem repetir, na ordem em que a árvore os traz. */
export function sinteticosDoCatalogo(categorias: CategoriaDoCatalogo[]): string[] {
  return [...new Set(categorias.map((c) => c.sintetico))].filter((s) => s !== "");
}

/**
 * Se um texto escrito à mão nomeia este sintético.
 *
 * As duas formas, com e sem parênteses, porque quem escreve "Cadastral", quem
 * copia "Cadastral (não remuneratório)" da lista e quem escreve "Cadastral (não
 * entra na DRE)" da planilha do time querem a mesma linha da DRE.
 */
function ehEsteSintetico(texto: string, sintetico: string): boolean {
  /*
    Os parênteses caem dos **dois** lados, e não só do nome cadastrado.

    A classe se chama "Cadastral (não remuneratório)" e a planilha do time
    escreve "Cadastral (não entra na DRE)": cortando só de um lado, as duas
    formas continuam diferentes e a célula é recusada como se o galho não
    existisse. Cortando dos dois, sobra "Cadastral" nas duas — que é o que as
    duas queriam dizer.
  */
  const escritos = [dobrar(texto), dobrar(semParenteses(texto))].filter(
    (t) => t !== "",
  );
  const cadastrados = [dobrar(sintetico), dobrar(semParenteses(sintetico))];
  return escritos.some((escrito) => cadastrados.includes(escrito));
}

/** As categorias que vivem sob um sintético escrito à mão. */
function daqueleSintetico(
  texto: string,
  categorias: CategoriaDoCatalogo[],
): CategoriaDoCatalogo[] {
  return categorias.filter((c) => ehEsteSintetico(texto, c.sintetico));
}

/**
 * O analítico dentro de um conjunto de candidatas, pelo caminho inteiro, pelo
 * analítico ou pela folha.
 *
 * Os três porque é assim que as pessoas escrevem. `Custo Variável › Manutenção`
 * é o que a lista de uma coluna só oferecia e o que ainda volta de arquivo
 * antigo; "Manutenção" é o que a lista nova oferece e o que se digita.
 */
function acharAnalitico(
  texto: string,
  candidatas: CategoriaDoCatalogo[],
): CategoriaDoCatalogo[] {
  const folha = (caminho: string) => caminho.split("›").at(-1)?.trim() ?? caminho;
  for (const candidato of [texto, semParenteses(texto)]) {
    const alvo = dobrar(candidato);
    if (alvo === "") continue;
    for (const campo of [
      (c: CategoriaDoCatalogo) => c.caminho,
      (c: CategoriaDoCatalogo) => c.analitico,
      (c: CategoriaDoCatalogo) => folha(c.analitico || c.caminho),
    ]) {
      const achadas = candidatas.filter((c) => dobrar(campo(c)) === alvo);
      if (achadas.length > 0) return achadas;
    }
  }
  return [];
}

/**
 * A categoria a partir das duas células.
 *
 * O sintético estreita, o analítico decide. É a razão de a coluna sintética
 * existir: "Outros" mora em custo fixo e em custo variável, e com a classe ao
 * lado a resposta deixa de ser "escreva o caminho inteiro com ›" e passa a ser
 * duas escolhas de lista.
 *
 * Um sintético sozinho não classifica — é uma classe, e a árvore não oferece
 * classes como escolha —, mas responder "não está no catálogo" a quem escreveu
 * o nome de um galho que existe é inútil: a recusa devolve as opções do galho.
 *
 * Quando os dois vêm e discordam, o analítico ganha e a linha é recusada com o
 * caminho real à vista. Adivinhar qual dos dois a pessoa quis dizer é o tipo de
 * escolha que classifica a coluna no lugar errado sem ninguém perceber.
 */
function acharCategoria(
  sintetico: string | null,
  analitico: string | null,
  categorias: CategoriaDoCatalogo[],
): Achado {
  const doSintetico = sintetico ? daqueleSintetico(sintetico, categorias) : null;

  /*
    Sintético escrito e não reconhecido é recusa, mesmo quando o analítico ao
    lado resolveria sozinho.

    A tentação é deixar passar — o analítico decide, afinal. Mas a célula que
    não foi entendida é justamente a que nomeia a linha da DRE em que o valor
    cai, e aceitá-la em silêncio é gravar uma classificação enquanto se ignora a
    metade da resposta que discordaria dela. Quem escreveu algo ali quis dizer
    alguma coisa, e a planilha devolve as opções em vez de escolher sozinha.
  */
  if (doSintetico !== null && doSintetico.length === 0) {
    return {
      tipo: "SINTETICO_DESCONHECIDO",
      opcoes: sinteticosDoCatalogo(categorias),
    };
  }

  if (analitico === null) {
    return {
      tipo: "SO_SINTETICO",
      opcoes: (doSintetico ?? []).map((c) => c.analitico),
    };
  }

  // A partir daqui `doSintetico` é nulo (célula vazia) ou uma lista não vazia:
  // o caso do sintético desconhecido já saiu acima.
  const candidatas = doSintetico ?? categorias;
  const achadas = acharAnalitico(analitico, candidatas);

  if (achadas.length === 1) {
    const [achada] = achadas;
    // O sintético existia, tinha categorias, e a busca caiu fora dele: só
    // acontece quando o analítico veio como caminho inteiro de outro galho.
    if (doSintetico && !doSintetico.includes(achada)) {
      return { tipo: "INCOMPATIVEL", caminhoReal: achada.caminho };
    }
    return { tipo: "ACHADA", code: achada.code, caminho: achada.caminho };
  }
  if (achadas.length > 1) {
    return { tipo: "AMBIGUA", opcoes: achadas.map((c) => c.caminho) };
  }

  // Nada no galho pedido. Se o analítico existe em outro, o problema é o par —
  // e dizer isso vale mais do que dizer "não está no catálogo".
  if (doSintetico) {
    const foraDoGalho = acharAnalitico(analitico, categorias);
    if (foraDoGalho.length > 0) {
      return { tipo: "INCOMPATIVEL", caminhoReal: foraDoGalho[0].caminho };
    }
  }

  // O analítico não casou com nada, e o que veio na célula pode ser uma classe
  // — alguém que escreveu "Cadastral" na coluna do analítico.
  const comoSintetico = daqueleSintetico(analitico, categorias);
  if (comoSintetico.length > 0) {
    return {
      tipo: "SO_SINTETICO",
      opcoes: comoSintetico.map((c) => c.analitico),
    };
  }

  return { tipo: "NENHUMA" };
}

/**
 * O que a planilha preenchida muda, sem gravar nada.
 *
 * É a prévia inteira, e ela é obrigatória por uma razão prática: um arquivo que
 * passou por três pessoas e um "salvar como" chega com colunas trocadas, e a
 * diferença entre "4 campos mudam" e "480 campos mudam" é a diferença entre
 * aplicar e conferir o arquivo de novo.
 */
export function conferirPreenchimento(
  linhas: LinhaPreenchida[],
  base: AtributoDoModelo[],
  catalogos: CatalogosDoModelo,
): ConferenciaDoModelo {
  /*
    A chave é o par (equipamento, nome de origem), e a aba diz o equipamento.
    O índice sem equipamento existe para o caso em que ela não diz — aba
    renomeada, linha colada de outro lugar — e nesse caso o nome só serve se for
    único na base inteira: `seguro` existe no cavalo e na carreta, e escolher um
    dos dois seria descrever a coluna errada.
  */
  const porEquipamento = new Map(
    base.map((a) => [`${a.entityType}\u0000${dobrar(a.sourceName)}`, a]),
  );
  const porNome = new Map<string, AtributoDoModelo[]>();
  for (const a of base) {
    const chave = dobrar(a.sourceName);
    porNome.set(chave, [...(porNome.get(chave) ?? []), a]);
  }

  const conferidas = linhas.map((linha): LinhaConferida => {
    const molde = {
      aba: linha.aba,
      linha: linha.linha,
      atributo: linha.atributo.trim(),
    };

    if (molde.atributo === "") {
      return {
        ...molde,
        code: null,
        desfecho: "SEM_ATRIBUTO_NA_LINHA",
        mudancas: [],
        problemas: [
          "Linha sem atributo. A primeira coluna é a chave do preenchimento e não pode ser apagada nem inventada.",
        ],
      };
    }

    const nome = dobrar(molde.atributo);
    const daAba = equipamentoDaAba(linha.aba, base);
    const homonimos = porNome.get(nome) ?? [];
    const atributo =
      (daAba ? porEquipamento.get(`${daAba}\u0000${nome}`) : undefined) ??
      (homonimos.length === 1 ? homonimos[0] : undefined);

    if (!atributo) {
      if (homonimos.length > 1) {
        return {
          ...molde,
          code: null,
          desfecho: "AMBIGUO",
          mudancas: [],
          problemas: [
            `"${molde.atributo}" existe em ${homonimos
              .map((h) => h.entityType)
              .join(" e ")}, e esta aba não diz qual. São atributos separados, com valores ` +
              "próprios: mova a linha para a aba do equipamento certo.",
          ],
        };
      }
      return {
        ...molde,
        code: null,
        desfecho: "SEM_ATRIBUTO",
        mudancas: [],
        problemas: [
          `Não existe coluna "${molde.atributo}"${daAba ? ` em ${daAba}` : ""} nesta base. ` +
            "Atributo nasce da importação da planilha do Freightec, de coluna com valor — esta " +
            "planilha descreve o que já existe, e não cria coluna. Colunas de chave (vigência, " +
            "placa) também não viram atributo: elas identificam a linha em vez de medir algo.",
        ],
      };
    }

    const mudancas: MudancaDeCampo[] = [];
    const problemas: string[] = [];

    const texto = (campo: "displayName" | "definition") => {
      const valor = preenchido(linha[campo]);
      if (valor === null) return;
      if ((atributo[campo] ?? "").trim() === valor) return;
      mudancas.push({ campo, de: atributo[campo], para: valor });
    };
    texto("displayName");
    texto("definition");

    /*
      A coluna antiga, de um arquivo gerado antes da separação, entra como
      analítico: ela guardava o caminho inteiro, e `acharAnalitico` casa por
      caminho antes de casar por folha.
    */
    const sintetico = preenchido(linha.categoriaSintetica);
    const analitico =
      preenchido(linha.categoriaAnalitica) ?? preenchido(linha.categoria);

    if (sintetico !== null || analitico !== null) {
      const escrito = [sintetico, analitico].filter((t) => t !== null).join(" › ");
      const achada = acharCategoria(sintetico, analitico, catalogos.categorias);
      if (achada.tipo === "NENHUMA") {
        problemas.push(
          `"Categoria DRE": "${escrito}" não está no catálogo. Escolha um item das listas das ` +
            "células, ou cadastre a categoria nova na tela de Curadoria antes de reenviar. O resto " +
            "desta linha entra normalmente.",
        );
      } else if (achada.tipo === "SINTETICO_DESCONHECIDO") {
        problemas.push(
          `"Categoria DRE - Sintético": "${sintetico}" não é uma das linhas da DRE. Escolha uma ` +
            `destas: ${achada.opcoes.join(", ")}. O resto desta linha entra normalmente.`,
        );
      } else if (achada.tipo === "AMBIGUA") {
        problemas.push(
          `"Categoria DRE - Analítico": há mais de uma categoria chamada "${analitico}" ` +
            `(${achada.opcoes.join(", ")}). Preencha o sintético ao lado para dizer qual. O resto ` +
            "desta linha entra normalmente.",
        );
      } else if (achada.tipo === "SO_SINTETICO") {
        problemas.push(
          `"Categoria DRE": "${escrito}" é uma linha inteira da DRE, e classificar nela é o mesmo ` +
            `que não classificar. Preencha o analítico com uma destas: ${achada.opcoes.join(", ")}. ` +
            "O resto desta linha entra normalmente.",
        );
      } else if (achada.tipo === "INCOMPATIVEL") {
        problemas.push(
          `"Categoria DRE": "${analitico}" não fica em "${sintetico}" — o lugar dela é ` +
            `"${achada.caminhoReal}". Corrija uma das duas células; não escolho por você, porque ` +
            "cada uma manda o valor para uma linha diferente da DRE. O resto desta linha entra " +
            "normalmente.",
        );
      } else if (achada.code !== atributo.taxonomyCode) {
        /*
          Trocar a Categoria DRE de um atributo **confirmado** é mudar em que
          linha da DRE o número cai — e isso é exatamente o que a confirmação
          assinou. Uma planilha que voltou por e-mail não desfaz uma assinatura:
          a recusa manda para a tela, onde a troca custa uma justificativa nova.

          Só a categoria é barrada. Nome e descrição continuam entrando num
          atributo confirmado, porque prosa não move dinheiro — é a mesma
          assimetria que separa `saveMeaning` de `confirmAttribute`.
        */
        if (atributo.semanticsStatus === "CONFIRMED") {
          problemas.push(
            `"Categoria DRE": "${atributo.sourceName}" já está confirmado, e trocar a categoria ` +
              "muda em que linha da DRE o valor cai. Isso exige justificativa assinada — faça pela " +
              "tela de Curadoria. O resto desta linha entra normalmente.",
          );
        } else {
          mudancas.push({
            campo: "categoria",
            de: caminhoDe(atributo.taxonomyCode, catalogos.categorias),
            para: achada.caminho,
            codigo: achada.code,
          });
        }
      }
    }

    return {
      ...molde,
      code: atributo.code,
      desfecho: mudancas.length > 0 ? "MUDA" : "IGUAL",
      mudancas,
      problemas,
    };
  });

  return {
    linhas: conferidas,
    resumo: {
      mudam: conferidas.filter((l) => l.desfecho === "MUDA").length,
      campos: conferidas.reduce((soma, l) => soma + l.mudancas.length, 0),
      iguais: conferidas.filter((l) => l.desfecho === "IGUAL").length,
      ignoradas: conferidas.filter(
        (l) => l.desfecho !== "MUDA" && l.desfecho !== "IGUAL",
      ).length,
      naoEntendidas: conferidas
        .filter((l) => l.desfecho === "MUDA" || l.desfecho === "IGUAL")
        .reduce((soma, l) => soma + l.problemas.length, 0),
    },
  };
}

/**
 * O equipamento de uma aba, pelo nome dela.
 *
 * "Cavalo" → CAVALO, e é só isso: comparar contra os tipos que a **base** tem,
 * em vez de contra uma lista escrita aqui, é o que faz um equipamento novo
 * funcionar sem mudança de código — e o que faz uma aba chamada "Resumo" não
 * virar um tipo inventado.
 */
function equipamentoDaAba(aba: string, base: AtributoDoModelo[]): string | null {
  const alvo = dobrar(aba);
  const tipos = [...new Set(base.map((a) => a.entityType))];
  return tipos.find((tipo) => dobrar(tipo) === alvo) ?? null;
}

// ---------------------------------------------------------------------------
// A gravação
// ---------------------------------------------------------------------------

export interface AplicacaoDoModelo {
  gravadas: number;
  campos: number;
  /** O que o servidor não conseguiu gravar, linha a linha. */
  recusadas: { code: string; motivo: string }[];
}

/**
 * Gravar o que a conferência aprovou.
 *
 * Só as linhas `MUDA` — as outras já foram explicadas na prévia, e reprocessá-las
 * aqui produziria evento de curadoria para escrita que não escreveu nada.
 *
 * A prosa vai por {@link saveMeaning}, que é a mesma função da tela: um caminho
 * a mais para gravar nome e definição seria um segundo lugar para a regra do
 * "não mexe no status" ser esquecida.
 */
export async function aplicarPreenchimento(
  db: Database,
  entrada: { linhas: LinhaConferida[]; actor: string },
): Promise<AplicacaoDoModelo> {
  if (!entrada.actor?.trim()) {
    throw new Error("Aplicar a planilha exige um responsável identificado.");
  }

  const recusadas: AplicacaoDoModelo["recusadas"] = [];
  let gravadas = 0;
  let campos = 0;

  for (const linha of entrada.linhas.filter((l) => l.desfecho === "MUDA")) {
    // `code` só é nulo quando a linha não casou, e essas não são MUDA. O guarda
    // existe para que uma mudança futura na conferência não vire uma gravação
    // em atributo nenhum.
    const code = linha.code;
    if (code === null) continue;

    const de = (campo: CampoDoModelo) =>
      linha.mudancas.find((m) => m.campo === campo);
    try {
      const prosa = (["displayName", "definition"] as const).filter(
        (campo) => de(campo) !== undefined,
      );
      if (prosa.length > 0) {
        await saveMeaning(db, {
          code,
          actor: entrada.actor,
          ...Object.fromEntries(prosa.map((campo) => [campo, de(campo)!.para])),
        });
      }

      const categoria = de("categoria");
      if (categoria?.codigo) {
        await proporCategoria(db, {
          code,
          taxonomyCode: categoria.codigo,
          actor: entrada.actor,
        });
      }

      gravadas++;
      campos += linha.mudancas.length;
    } catch (err) {
      recusadas.push({
        code,
        motivo: err instanceof Error ? err.message : "Erro desconhecido",
      });
    }
  }

  return { gravadas, campos, recusadas };
}

/**
 * A categoria escrita como proposta — e nada além disso.
 *
 * `semantics_status`, `confirmed_by` e `confirmed_at` não estão no update, e é
 * a razão de esta função existir em vez de `confirmAttribute`: quem preenche
 * uma planilha responde onde a coluna entra na conta, mas não assina que o
 * número pode entrar em soma financeira. É o mesmo campo que `runProposalPass`
 * escreve quando o motor lê os valores; o que muda é a autoria da proposta.
 *
 * Unidade, periodicidade, agregação e natureza monetária continuam sem ser
 * escritas daqui: são derivadas do significado no momento da confirmação, e
 * antecipá-las poria na versão em vigor um número técnico que ninguém
 * confirmou.
 */
async function proporCategoria(
  db: Database,
  entrada: { code: string; taxonomyCode: string; actor: string },
): Promise<void> {
  const [atributo] = await db
    .select()
    .from(attributeTable)
    .where(eq(attributeTable.code, entrada.code));
  if (!atributo) throw new Error(`Atributo "${entrada.code}" não encontrado.`);

  const [no] = await db
    .select()
    .from(taxonomyNodeTable)
    .where(eq(taxonomyNodeTable.code, entrada.taxonomyCode));
  if (!no) throw new Error(`Categoria "${entrada.taxonomyCode}" não está cadastrada.`);

  await db.transaction(async (tx) => {
    await tx
      .update(attributeTable)
      .set({ taxonomyNodeId: no.id })
      .where(eq(attributeTable.id, atributo.id));

    // A proposta vale para o presente, e o presente é a versão em vigor — a
    // mesma regra da passagem de propostas. Sem isto, `projectCurrentVersion`
    // devolveria a categoria antiga na próxima vez que rodasse.
    await tx
      .update(attributeSemanticsTable)
      .set({ taxonomyNodeId: no.id })
      .where(
        and(
          eq(attributeSemanticsTable.attributeId, atributo.id),
          isNull(attributeSemanticsTable.effectiveUntil),
        ),
      );

    await tx.insert(curationEventTable).values({
      targetKind: "ATTRIBUTE",
      targetId: atributo.id,
      targetLabel: atributo.code,
      field: "taxonomy_node_id",
      valueBefore: atributo.taxonomyNodeId,
      valueAfter: no.code,
      actor: entrada.actor,
      // Sem `reason`, como toda escrita que não é confirmação: o valor novo é o
      // conteúdo, e a origem está no `changeKind`.
      detail: { changeKind: "PLANILHA_DE_ATRIBUTOS" },
    });
  });
}
