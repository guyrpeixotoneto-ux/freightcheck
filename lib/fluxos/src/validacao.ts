import {
  ehEspecieDeItem,
  ehSentidoDoIndicador,
  ehStatusDaEtapa,
  ehStatusDoFluxo,
  ehTipoDeConexao,
  ehTipoDeEtapa,
} from "./catalogo";
import type {
  EntradaDeAcao,
  EntradaDeConexao,
  EntradaDeEtapa,
  EntradaDeFluxo,
  EntradaDeIndicador,
  EntradaDeItem,
  PosicaoDaEtapa,
} from "./modelo";

/**
 * A recusa, com nome — a autoridade única sobre o que este módulo não aceita.
 *
 * Uma classe e um `codigo`, no mesmo formato do resto do produto (ver
 * `routes/unidades.ts`): a rota traduz o código em status HTTP e a tela mostra
 * a frase, sem que nenhuma das duas precise reimplementar a regra. Validar na
 * rota, como `if (!nome) res.status(400)`, é o que faz a regra existir em três
 * lugares e valer em um.
 */
export class RecusaDeFluxo extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "RecusaDeFluxo";
  }
}

/** Texto obrigatório: aparado, e recusado quando sobra nada. */
export function textoObrigatorio(valor: unknown, campo: string, codigo: string): string {
  const texto = typeof valor === "string" ? valor.trim() : "";
  if (texto === "") throw new RecusaDeFluxo(codigo, `${campo} não pode ficar em branco.`);
  return texto;
}

/** Texto opcional: `null` quando ausente ou vazio — nunca `""` no banco. */
export function textoOpcional(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  return texto === "" ? null : texto;
}

const LIMITE_DO_NOME = 200;
const LIMITE_DO_TEXTO_LONGO = 4000;

function aparar(texto: string, limite: number, campo: string, codigo: string): string {
  if (texto.length > limite) {
    throw new RecusaDeFluxo(codigo, `${campo} passa de ${limite} caracteres.`);
  }
  return texto;
}

/**
 * `Emissão de CTe até Recebimento` → `emissao-de-cte-ate-recebimento`.
 *
 * Sem acento, sem caixa, sem pontuação — a mesma normalização que o produto já
 * usa em `normalized_label` (ver `schema/significado.ts`). Determinística de
 * propósito: é ela que faz semear duas vezes não criar dois fluxos iguais.
 */
export function comoSlug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function validarEntradaDeFluxo(bruto: unknown): Required<
  Pick<EntradaDeFluxo, "nome" | "slug" | "categoria" | "status">
> &
  Pick<EntradaDeFluxo, "descricao" | "objetivo" | "dono"> {
  const corpo = (bruto ?? {}) as Record<string, unknown>;

  const nome = aparar(
    textoObrigatorio(corpo.nome, "O nome do fluxo", "FLUXO_SEM_NOME"),
    LIMITE_DO_NOME,
    "O nome do fluxo",
    "FLUXO_NOME_LONGO",
  );
  const categoria = aparar(
    textoObrigatorio(corpo.categoria, "A categoria", "FLUXO_SEM_CATEGORIA"),
    LIMITE_DO_NOME,
    "A categoria",
    "FLUXO_CATEGORIA_LONGA",
  );

  const slugPedido = textoOpcional(corpo.slug);
  const slug = comoSlug(slugPedido ?? nome);
  if (slug === "") {
    throw new RecusaDeFluxo(
      "FLUXO_SLUG_INVALIDO",
      "O nome do fluxo precisa ter ao menos uma letra ou número.",
    );
  }

  const status = corpo.status === undefined ? "RASCUNHO" : corpo.status;
  if (!ehStatusDoFluxo(status)) {
    throw new RecusaDeFluxo(
      "FLUXO_STATUS_INVALIDO",
      "Status precisa ser RASCUNHO, ATIVO ou ARQUIVADO.",
    );
  }

  return {
    nome,
    slug,
    categoria,
    status,
    descricao: textoOpcional(corpo.descricao),
    objetivo: textoOpcional(corpo.objetivo),
    dono: textoOpcional(corpo.dono),
  };
}

export function validarEntradaDeEtapa(bruto: unknown): Required<
  Pick<EntradaDeEtapa, "nome" | "tipo" | "status" | "posX" | "posY">
> &
  Omit<EntradaDeEtapa, "nome" | "tipo" | "status" | "posX" | "posY"> {
  const corpo = (bruto ?? {}) as Record<string, unknown>;

  const nome = aparar(
    textoObrigatorio(corpo.nome, "O nome da etapa", "ETAPA_SEM_NOME"),
    LIMITE_DO_NOME,
    "O nome da etapa",
    "ETAPA_NOME_LONGO",
  );

  const tipo = corpo.tipo === undefined ? "PROCESSO" : corpo.tipo;
  if (!ehTipoDeEtapa(tipo)) {
    throw new RecusaDeFluxo("ETAPA_TIPO_INVALIDO", `Tipo de etapa desconhecido: ${String(tipo)}.`);
  }

  const status = corpo.status === undefined ? "ATIVO" : corpo.status;
  if (!ehStatusDaEtapa(status)) {
    throw new RecusaDeFluxo(
      "ETAPA_STATUS_INVALIDO",
      `Status de etapa desconhecido: ${String(status)}.`,
    );
  }

  const longo = (v: unknown, campo: string, codigo: string): string | null => {
    const texto = textoOpcional(v);
    return texto === null ? null : aparar(texto, LIMITE_DO_TEXTO_LONGO, campo, codigo);
  };

  return {
    nome,
    tipo,
    status,
    ordem: inteiro(corpo.ordem, 0, "ETAPA_ORDEM_INVALIDA"),
    posX: inteiro(corpo.posX, 0, "ETAPA_POSICAO_INVALIDA"),
    posY: inteiro(corpo.posY, 0, "ETAPA_POSICAO_INVALIDA"),
    descricao: longo(corpo.descricao, "A descrição", "ETAPA_TEXTO_LONGO"),
    responsavel: textoOpcional(corpo.responsavel),
    area: textoOpcional(corpo.area),
    objetivo: longo(corpo.objetivo, "O objetivo", "ETAPA_TEXTO_LONGO"),
    sistemaPrincipal: textoOpcional(corpo.sistemaPrincipal),
    regras: longo(corpo.regras, "As regras", "ETAPA_TEXTO_LONGO"),
    observacoes: longo(corpo.observacoes, "As observações", "ETAPA_TEXTO_LONGO"),
    chaveMonitoramento: textoOpcional(corpo.chaveMonitoramento),
  };
}

/**
 * Inteiro com padrão — e o não-número é recusado, não substituído.
 *
 * `Number("abc")` é `NaN`, e `NaN` gravado numa coluna `integer` estoura no
 * driver com uma mensagem que não diz qual campo era. Trocar silenciosamente
 * por zero seria pior: a etapa apareceria no canto superior esquerdo do canvas
 * sem que ninguém tivesse pedido isso, e o defeito só apareceria na tela.
 */
function inteiro(valor: unknown, padrao: number, codigo: string): number {
  if (valor === undefined || valor === null) return padrao;
  const numero = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(numero)) {
    throw new RecusaDeFluxo(codigo, `Esperava um número, recebi ${JSON.stringify(valor)}.`);
  }
  return Math.round(numero);
}

export function validarEntradaDeConexao(
  bruto: unknown,
): Required<Pick<EntradaDeConexao, "origemEtapaId" | "destinoEtapaId" | "tipo" | "ordem">> &
  Pick<EntradaDeConexao, "rotulo"> {
  const corpo = (bruto ?? {}) as Record<string, unknown>;

  const origemEtapaId = textoObrigatorio(
    corpo.origemEtapaId,
    "A etapa de origem",
    "CONEXAO_SEM_ORIGEM",
  );
  const destinoEtapaId = textoObrigatorio(
    corpo.destinoEtapaId,
    "A etapa de destino",
    "CONEXAO_SEM_DESTINO",
  );

  /*
    Laço em si mesma recusado; ciclo entre etapas, permitido — e a decisão é
    explícita porque é a pergunta que este módulo mais recebe. Um processo real
    volta: rejeitado → correção → nova validação. Proibir ciclo seria proibir
    retrabalho, que é justamente o que o módulo existe para tornar visível.
    Um laço de uma etapa para ela mesma, por outro lado, não desenha nada e é
    sempre um clique errado no canvas.
  */
  if (origemEtapaId === destinoEtapaId) {
    throw new RecusaDeFluxo(
      "CONEXAO_EM_LACO",
      "Uma etapa não se conecta a ela mesma. Para representar repetição, ligue-a à etapa que a antecede.",
    );
  }

  const tipo = corpo.tipo === undefined ? "SEQUENCIA" : corpo.tipo;
  if (!ehTipoDeConexao(tipo)) {
    throw new RecusaDeFluxo(
      "CONEXAO_TIPO_INVALIDO",
      `Tipo de conexão desconhecido: ${String(tipo)}.`,
    );
  }

  return {
    origemEtapaId,
    destinoEtapaId,
    tipo,
    ordem: inteiro(corpo.ordem, 0, "CONEXAO_ORDEM_INVALIDA"),
    rotulo: textoOpcional(corpo.rotulo),
  };
}

export function validarItem(bruto: unknown, ordem: number): Required<EntradaDeItem> {
  const corpo = (bruto ?? {}) as Record<string, unknown>;

  if (!ehEspecieDeItem(corpo.especie)) {
    throw new RecusaDeFluxo("ITEM_ESPECIE_INVALIDA", `Espécie desconhecida: ${String(corpo.especie)}.`);
  }
  const nome = aparar(
    textoObrigatorio(corpo.nome, "O nome do item", "ITEM_SEM_NOME"),
    LIMITE_DO_NOME,
    "O nome do item",
    "ITEM_NOME_LONGO",
  );

  return {
    especie: corpo.especie,
    nome,
    descricao: textoOpcional(corpo.descricao),
    obrigatorio: typeof corpo.obrigatorio === "boolean" ? corpo.obrigatorio : null,
    link: validarLinkExterno(corpo.link),
    ordem: inteiro(corpo.ordem, ordem, "ITEM_ORDEM_INVALIDA"),
  };
}

/**
 * O link de um sistema é externo — e por isso só `http`/`https` passam.
 *
 * A etapa aponta para o portal da SEFAZ, para o internet banking, para o TMS.
 * O que ela não pode apontar é `javascript:` — um cadastro é escrito por gente
 * e lido por gente, e um botão que a interface apresenta como "abrir o sistema"
 * não pode ser o vetor de um script. Rota interna tem regra própria, mais
 * apertada, em `validarAcao`.
 */
export function validarLinkExterno(valor: unknown): string | null {
  const texto = textoOpcional(valor);
  if (texto === null) return null;
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    throw new RecusaDeFluxo(
      "ITEM_LINK_INVALIDO",
      "O link do sistema precisa ser um endereço completo, começando com https://.",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new RecusaDeFluxo(
      "ITEM_LINK_INVALIDO",
      "Só endereços http:// ou https:// são aceitos como link de sistema.",
    );
  }
  return texto;
}

export function validarIndicador(bruto: unknown, ordem: number): Required<EntradaDeIndicador> {
  const corpo = (bruto ?? {}) as Record<string, unknown>;

  const nome = aparar(
    textoObrigatorio(corpo.nome, "O nome do indicador", "INDICADOR_SEM_NOME"),
    LIMITE_DO_NOME,
    "O nome do indicador",
    "INDICADOR_NOME_LONGO",
  );
  const sentido = corpo.sentido === undefined ? "NEUTRO" : corpo.sentido;
  if (!ehSentidoDoIndicador(sentido)) {
    throw new RecusaDeFluxo(
      "INDICADOR_SENTIDO_INVALIDO",
      `Sentido desconhecido: ${String(sentido)}.`,
    );
  }

  return {
    nome,
    descricao: textoOpcional(corpo.descricao),
    unidade: textoOpcional(corpo.unidade),
    sentido,
    origem: textoOpcional(corpo.origem),
    ordem: inteiro(corpo.ordem, ordem, "INDICADOR_ORDEM_INVALIDA"),
  };
}

/**
 * A rota interna de uma ação — a única forma que a interface aceita navegar.
 *
 * Um caminho deste produto: começa com uma barra, e **não** com duas (`//host`
 * é endereço de outro domínio para o navegador, e passaria por qualquer teste
 * ingênuo de "começa com /"). Sem esquema, sem host, sem `javascript:`. O banco
 * repete a metade barata dessa regra num `CHECK`; a metade inteira está aqui.
 */
export function validarRotaInterna(valor: unknown): string {
  const rota = textoObrigatorio(valor, "A rota da ação", "ACAO_SEM_ROTA");
  if (!rota.startsWith("/") || rota.startsWith("//")) {
    throw new RecusaDeFluxo(
      "ACAO_ROTA_INVALIDA",
      "A rota precisa ser um caminho interno do FreightCheck, como /alteracoes.",
    );
  }
  if (/\s/.test(rota)) {
    throw new RecusaDeFluxo(
      "ACAO_ROTA_INVALIDA",
      "A rota não pode ter espaços nem quebras de linha.",
    );
  }
  return rota;
}

export function validarAcao(bruto: unknown, ordem: number): Required<EntradaDeAcao> {
  const corpo = (bruto ?? {}) as Record<string, unknown>;

  const titulo = aparar(
    textoObrigatorio(corpo.titulo, "O título da ação", "ACAO_SEM_TITULO"),
    LIMITE_DO_NOME,
    "O título da ação",
    "ACAO_TITULO_LONGO",
  );

  return {
    titulo,
    descricao: textoOpcional(corpo.descricao),
    rota: validarRotaInterna(corpo.rota),
    parametros: validarParametros(corpo.parametros),
    icone: textoOpcional(corpo.icone),
    ordem: inteiro(corpo.ordem, ordem, "ACAO_ORDEM_INVALIDA"),
  };
}

/**
 * Os parâmetros de uma ação: um objeto raso de texto para texto.
 *
 * Raso, e conferido. É o único `jsonb` do módulo, e a garantia de que ele não
 * vira um saco de qualquer coisa está aqui: nada de aninhamento, nada de array,
 * nada de valor que não seja escalar. O que ele produz é query string — ver
 * `enderecoDaAcao` —, e query string não tem como representar mais do que isso.
 */
export function validarParametros(valor: unknown): Record<string, string> | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== "object" || Array.isArray(valor)) {
    throw new RecusaDeFluxo(
      "ACAO_PARAMETROS_INVALIDOS",
      "Os parâmetros precisam ser um objeto de chave e valor.",
    );
  }
  const entradas = Object.entries(valor as Record<string, unknown>);
  if (entradas.length === 0) return null;
  const saida: Record<string, string> = {};
  for (const [chave, bruto] of entradas) {
    if (bruto === null || bruto === undefined) continue;
    if (typeof bruto === "object") {
      throw new RecusaDeFluxo(
        "ACAO_PARAMETROS_INVALIDOS",
        `O parâmetro "${chave}" precisa ser texto, número ou booleano.`,
      );
    }
    saida[chave] = String(bruto);
  }
  return Object.keys(saida).length === 0 ? null : saida;
}

export function validarPosicoes(bruto: unknown): PosicaoDaEtapa[] {
  if (!Array.isArray(bruto)) {
    throw new RecusaDeFluxo("POSICOES_INVALIDAS", "Esperava uma lista de posições.");
  }
  return bruto.map((item) => {
    const corpo = (item ?? {}) as Record<string, unknown>;
    return {
      etapaId: textoObrigatorio(corpo.etapaId, "A etapa", "POSICAO_SEM_ETAPA"),
      posX: inteiro(corpo.posX, 0, "ETAPA_POSICAO_INVALIDA"),
      posY: inteiro(corpo.posY, 0, "ETAPA_POSICAO_INVALIDA"),
    };
  });
}

/**
 * O endereço final de uma ação — a autoridade única sobre como se navega daqui.
 *
 * Existe para que nenhum componente monte URL na mão. A tela recebe uma rota e
 * um objeto de parâmetros e chama isto; se amanhã as ações passarem a aceitar
 * âncora, prefixo de ambiente ou codificação diferente, muda aqui e vale em
 * todo botão do produto.
 */
export function enderecoDaAcao(acao: {
  rota: string;
  parametros?: Record<string, string> | null;
}): string {
  const rota = validarRotaInterna(acao.rota);
  const parametros = acao.parametros ?? null;
  if (!parametros) return rota;
  const query = new URLSearchParams();
  /*
    Ordenado por chave, e não pela ordem em que o objeto veio do banco. Duas
    ações com os mesmos parâmetros passam a produzir o mesmo endereço — o que
    faz o cache do React Query, o histórico do navegador e os testes tratarem
    como iguais duas coisas que são iguais.
  */
  for (const chave of Object.keys(parametros).sort()) {
    query.set(chave, parametros[chave]);
  }
  const texto = query.toString();
  if (texto === "") return rota;
  return rota.includes("?") ? `${rota}&${texto}` : `${rota}?${texto}`;
}
