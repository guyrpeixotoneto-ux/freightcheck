/**
 * Os escopos — a pergunta "de que isto é atributo?".
 *
 * A tela de Parâmetros nasceu espelhando o Freightech: a grade dele, com as
 * gavetas dele, na ordem dele. O espelho continua valendo e continua na tela,
 * mas ele responde a uma pergunta que não é a de quem audita. Quem audita chega
 * sabendo **de qual coisa** quer ver o que mudou — do cavalo, da carreta, do
 * conjunto, do trecho, do QLP administrativo, do QLP operacional — e a grade do
 * Freightech não tem essa divisão em lugar nenhum: `Cavalo` e `Carreta` são dois
 * cartões dentro de FROTA, ao lado de `Combustível` e `Prazo FINAME`, que valem
 * para os dois.
 *
 * Este arquivo é a divisão que faltava. Os cinco primeiros escopos são os cinco
 * tipos que o produto importa — a mesma lista de `@workspace/ingest/tipos`, que
 * é quem decide o que é importável. O sexto, CONJUNTO, não é tipo de importação
 * nenhum: é a leitura de uma coluna da carreta que **já embute o cavalo**, e a
 * lista dele é `ESCOPOS_DE_CONJUNTO`, medida contra o export real. Ele existe
 * como escopo próprio por uma razão de auditoria: `carreta.custo_fixo` aparece
 * na linha de uma carreta e vale pelo par: lê-lo como atributo de carreta é o
 * caminho mais curto para contar o mesmo cavalo duas vezes.
 *
 * **Nenhum escopo é atribuído por palpite.** Um atributo cai num deles pelo
 * `entity_type` que o banco lhe deu ou por estar na lista medida do conjunto; o
 * que não se encaixa em nenhum vai para `SEM_ESCOPO`, que a tela escreve como
 * tal em vez de o distribuir no que parecer mais provável.
 */

import { ESCOPOS_DE_CONJUNTO } from "@workspace/comparison/composition";
import type { ChangeGroup, FamiliesView } from "@/components/inicio/types";

export type EscopoCode =
  | "CAVALO"
  | "CARRETA"
  | "CONJUNTO"
  | "TRECHO"
  | "QLP_ADMINISTRATIVO"
  | "QLP_OPERACIONAL"
  | "SEM_ESCOPO";

export interface Escopo {
  code: EscopoCode;
  /** O nome curto, para a barra de escopos: "Cavalo", "QLP adm.". */
  rotulo: string;
  /** O nome por extenso, para o título da seção. */
  nome: string;
  /** O plural das contagens: "3 cavalos". */
  plural: string;
  /** O que uma linha é, naquele escopo. Vai para a explicação da seção. */
  grao: string;
}

/**
 * Os seis, na ordem em que a tela os oferece.
 *
 * A ordem é a do peso na remuneração, e não a alfabética: cavalo e carreta são
 * onde está a frota, conjunto vem logo depois porque é a leitura combinada dos
 * dois, e os três de estrutura fecham. `SEM_ESCOPO` fica fora desta lista de
 * propósito — ele não é um escopo que alguém escolha, é o resto, e aparece na
 * barra apenas quando existe alguma coisa nele.
 */
export const ESCOPOS: Escopo[] = [
  {
    code: "CAVALO",
    rotulo: "Cavalo",
    nome: "Cavalo",
    plural: "cavalos",
    grao: "uma linha por placa de cavalo mecânico",
  },
  {
    code: "CARRETA",
    rotulo: "Carreta",
    nome: "Carreta",
    plural: "carretas",
    grao: "uma linha por placa de carreta",
  },
  {
    code: "CONJUNTO",
    rotulo: "Conjunto",
    nome: "Conjunto",
    plural: "conjuntos",
    grao:
      "colunas da carreta que já embutem o cavalo vinculado — o número é do par, " +
      "não da carreta sozinha",
  },
  {
    code: "TRECHO",
    rotulo: "Trecho",
    nome: "Trecho",
    plural: "trechos",
    grao: "uma linha por chave de trecho — origem, destino e quilometragem",
  },
  {
    code: "QLP_ADMINISTRATIVO",
    rotulo: "QLP adm.",
    nome: "QLP administrativo",
    plural: "cargos",
    grao: "uma linha por cargo da estrutura administrativa da unidade",
  },
  {
    code: "QLP_OPERACIONAL",
    rotulo: "QLP oper.",
    nome: "QLP operacional",
    plural: "cargos",
    grao: "uma linha por cargo e turno da operação",
  },
];

export const ESCOPO_RESTO: Escopo = {
  code: "SEM_ESCOPO",
  rotulo: "Sem escopo",
  nome: "Sem escopo identificado",
  plural: "linhas",
  grao:
    "o tipo da linha não é nenhum dos seis — a tela diz isso em vez de encaixar " +
    "o atributo no escopo que parecer mais provável",
};

const POR_CODIGO = new Map<EscopoCode, Escopo>(
  [...ESCOPOS, ESCOPO_RESTO].map((e) => [e.code, e]),
);

/** Se um valor vindo da URL é um escopo. Endereço adulterado cai em "todos". */
export function ehEscopo(valor: string | null): valor is EscopoCode {
  return valor !== null && POR_CODIGO.has(valor as EscopoCode);
}

export function escopoDe(code: EscopoCode): Escopo {
  return POR_CODIGO.get(code) ?? ESCOPO_RESTO;
}

/** Os códigos de atributo que são do conjunto, medidos — não uma segunda lista. */
const CODIGOS_DE_CONJUNTO = new Set(ESCOPOS_DE_CONJUNTO.map((e) => e.code));

/** Os `entity_type` que o produto importa, e o escopo de cada um. */
const POR_ENTITY_TYPE: Record<string, EscopoCode> = {
  CAVALO: "CAVALO",
  CARRETA: "CARRETA",
  TRECHO: "TRECHO",
  QLP_ADMINISTRATIVO: "QLP_ADMINISTRATIVO",
  QLP_OPERACIONAL: "QLP_OPERACIONAL",
};

/**
 * De qual escopo é este atributo.
 *
 * A ordem das três perguntas é a ordem da precedência, e ela importa:
 *
 * 1. **Está na lista medida do conjunto?** Então é do conjunto, ainda que o
 *    banco o guarde como CARRETA — porque é isso que ele é. Deixar o
 *    `entity_type` decidir aqui poria `carreta.custo_fixo` entre as carretas, e
 *    quem somasse a coluna somaria o cavalo junto sem saber.
 * 2. **O tipo vem com mais de um equipamento** (`CARRETA+CAVALO`)? Também é do
 *    conjunto — é a mesma coisa dita pelo banco em vez de pela medição.
 * 3. **É um dos cinco tipos importáveis?** Então é dele.
 *
 * O que sobra é `SEM_ESCOPO`, e é um resultado legítimo: um atributo de um tipo
 * que ainda não importamos não pertence a nenhum dos seis, e fingir que
 * pertence seria pior do que dizer que não se sabe.
 */
export function escopoDoAtributo(
  attributeCode: string | null,
  entityType: string | null,
): EscopoCode {
  if (attributeCode !== null && CODIGOS_DE_CONJUNTO.has(attributeCode)) return "CONJUNTO";

  const tipos = (entityType ?? "")
    .split("+")
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0);

  const conhecidos = [...new Set(tipos.filter((t) => t in POR_ENTITY_TYPE))];
  if (conhecidos.length > 1) return "CONJUNTO";
  if (conhecidos.length === 1) return POR_ENTITY_TYPE[conhecidos[0]];
  return "SEM_ESCOPO";
}

/* ------------------------------------------------------------------ */
/* O atributo, como a grade o desenha                                  */
/* ------------------------------------------------------------------ */

/**
 * Um atributo alterado nesta vigência.
 *
 * É um `ChangeGroup` com a procedência pendurada: de qual parâmetro nosso ele
 * saiu, de qual família, e qual cartão do catálogo o contém. Os três existem
 * porque o cartão de atributo é o degrau mais fundo da hierarquia — VISÃO GERAL
 * → ESCOPO → ATRIBUTO → VEÍCULO → EVIDÊNCIA — e chegar nele por busca, sem ter
 * passado pelos degraus de cima, deixaria quem lê sem saber de onde aquilo veio.
 */
export interface AtributoRender {
  /** A chave do grupo — endereço na URL e identidade do favorito. */
  chave: string;
  /** O código interno da coluna: `cavalo.finame_cavalo`. Nulo é raro e possível. */
  code: string | null;
  titulo: string;
  escopo: EscopoCode;
  /** O rótulo de equipamento que o servidor já calculou. */
  equipamento: string;
  /** A gaveta nossa a que ele pertence — "Financiamento", "Manutenção". */
  parametro: string;
  /**
   * A chave do parâmetro (`AQUISICAO_FINANCIAMENTO|Financiamento`).
   *
   * É o que liga este atributo ao cartão do catálogo: a ponte parâmetro →
   * cartão já existe na tela e é montada das mesmas seções que a grade do
   * espelho desenha. Nula quando a árvore de famílias não alcançou o grupo.
   */
  parametroChave: string | null;
  familia: string;
  grupo: ChangeGroup;
}

/**
 * Os atributos desta vigência, um por grupo de alteração.
 *
 * A lista sai de `view.groups`, que é a lista inteira — e não da árvore de
 * famílias, que é a mesma coisa recortada. A árvore serve aqui só para dizer de
 * qual parâmetro e de qual família cada grupo veio: `families-view` garante que
 * todo grupo cai em exatamente um parâmetro, então o mapa é total e não há
 * grupo órfão a inventar procedência para.
 */
export function montarAtributos(view: FamiliesView | null): AtributoRender[] {
  if (!view) return [];

  const procedencia = new Map<
    string,
    { parametro: string; parametroChave: string; familia: string }
  >();
  for (const familia of view.families) {
    for (const parametro of familia.parameters) {
      for (const grupo of parametro.groups) {
        procedencia.set(grupo.key, {
          parametro: parametro.name,
          parametroChave: parametro.key,
          familia: familia.name,
        });
      }
    }
  }

  return view.groups.map((grupo) => {
    const de = procedencia.get(grupo.key);
    return {
      chave: grupo.key,
      code: grupo.attributeCode,
      titulo: grupo.title,
      escopo: escopoDoAtributo(grupo.attributeCode, grupo.entityType),
      equipamento: grupo.equipment,
      parametro: de?.parametro ?? "Sem parâmetro",
      parametroChave: de?.parametroChave ?? null,
      familia: de?.familia ?? "Sem família",
      grupo,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Buscar e ordenar                                                    */
/* ------------------------------------------------------------------ */

export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * A busca procura em cinco campos, e não só no rótulo.
 *
 * O rótulo sozinho não serve para quem audita: o número que ele foi conferir
 * está na planilha com o nome de lá (`finameCavalo`), no nosso banco com o
 * código (`cavalo.finame_cavalo`) e na tela com o nome de leitura
 * ("Financiamento do cavalo"). Quem chega com um dos três e só encontra pelo
 * terceiro conclui que o atributo não está aqui. Parâmetro e família entram
 * pela mesma razão em outra direção: "quero tudo de manutenção" é uma pergunta
 * legítima e não é o nome de nenhum atributo.
 */
export function combina(atributo: AtributoRender, termo: string): boolean {
  if (termo === "") return true;
  const alvo = [
    atributo.titulo,
    atributo.code ?? "",
    atributo.parametro,
    atributo.familia,
    atributo.equipamento,
  ]
    .map(normalizar)
    .join(" ");
  // Cada palavra do termo tem de aparecer, em qualquer campo e em qualquer
  // ordem: "finame carreta" acha o financiamento da carreta sem exigir que
  // alguém adivinhe como os dois estão escritos juntos.
  return normalizar(termo)
    .split(/\s+/)
    .filter((p) => p.length > 0)
    .every((palavra) => alvo.includes(palavra));
}

export const ORDENS = [
  { code: "impacto", rotulo: "Maior impacto" },
  { code: "veiculos", rotulo: "Mais veículos" },
  { code: "alteracoes", rotulo: "Mais alterações" },
  { code: "nome", rotulo: "Nome (A–Z)" },
] as const;

export type OrdemCode = (typeof ORDENS)[number]["code"];

export function ehOrdem(valor: string | null): valor is OrdemCode {
  return ORDENS.some((o) => o.code === valor);
}

/**
 * Ordena sem somar periodicidades.
 *
 * `Math.abs(amount)` ordena por **tamanho** do movimento, e não por sinal: quem
 * abre a tela quer ver primeiro o que mais mexeu, tenha subido ou caído. O que
 * não se faz aqui é comparar um valor mensal com um anual como se fossem a
 * mesma grandeza — e é por isso que a ordenação por impacto empurra para o fim
 * tudo o que não tem preço, em vez de tratá-lo como zero. Zero é um número
 * apurado; sem preço é a ausência de um.
 */
export function ordenar(
  atributos: AtributoRender[],
  ordem: OrdemCode,
): AtributoRender[] {
  const copia = [...atributos];
  const porNome = (a: AtributoRender, b: AtributoRender) =>
    a.titulo.localeCompare(b.titulo, "pt-BR");

  if (ordem === "nome") return copia.sort(porNome);

  if (ordem === "veiculos") {
    return copia.sort((a, b) => b.grupo.vehicles - a.grupo.vehicles || porNome(a, b));
  }

  if (ordem === "alteracoes") {
    return copia.sort((a, b) => b.grupo.changes - a.grupo.changes || porNome(a, b));
  }

  const peso = (a: AtributoRender) => {
    const valor = a.grupo.impact.amount;
    return valor === null ? null : Math.abs(valor);
  };
  return copia.sort((a, b) => {
    const x = peso(a);
    const y = peso(b);
    if (x === null && y === null) return b.grupo.changes - a.grupo.changes || porNome(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x || porNome(a, b);
  });
}

/* ------------------------------------------------------------------ */
/* A barra de escopos                                                  */
/* ------------------------------------------------------------------ */

export interface ContagemDeEscopo {
  escopo: Escopo;
  atributos: number;
  alteracoes: number;
}

/**
 * O que cada escopo tem, para a barra de cima.
 *
 * **Dois números, e nenhum deles é "veículos".** Atributos e alterações somam
 * sem risco: são contagens de coisas distintas. Veículos, não — o mesmo cavalo
 * aparece em dez atributos, e somar diria "620 tocados" numa frota de 62. É o
 * mesmo erro que a grade do catálogo já se recusa a cometer quando tira a
 * contagem da tela em cartão com mais de um parâmetro.
 *
 * O maior grupo do escopo chegou a estar aqui, como piso — e um piso precisa
 * ser rotulado como piso. "62+ cavalos tocados" numa frota de 62 promete um
 * número acima de 62 que não existe, e a alternativa honesta ("pelo menos 62")
 * não cabe num botão. A pergunta de veículos tem resposta exata um degrau
 * abaixo, no cartão de cada atributo — "5 de 62 cavalos" —, que é onde ela
 * pode ser respondida sem ressalva.
 *
 * A barra só mostra escopo que tem alguma coisa. Um escopo vazio na barra é um
 * clique que leva a uma tela em branco, e nesta tela "em branco" é ambíguo:
 * pode ser que não haja trecho importado, ou que haja e nada tenha mudado. A
 * diferença entre as duas é dita por escrito, na tela, e não por uma aba morta.
 */
export function contarPorEscopo(atributos: AtributoRender[]): ContagemDeEscopo[] {
  const contagens = new Map<EscopoCode, ContagemDeEscopo>();

  for (const atributo of atributos) {
    const atual =
      contagens.get(atributo.escopo) ??
      { escopo: escopoDe(atributo.escopo), atributos: 0, alteracoes: 0 };
    atual.atributos += 1;
    atual.alteracoes += atributo.grupo.changes;
    contagens.set(atributo.escopo, atual);
  }

  const ordem = [...ESCOPOS, ESCOPO_RESTO].map((e) => e.code);
  return [...contagens.values()].sort(
    (a, b) => ordem.indexOf(a.escopo.code) - ordem.indexOf(b.escopo.code),
  );
}

/**
 * Quais escopos esta unidade tem importados nesta vigência.
 *
 * Sai de `view.series`, que é o que chegou, e não dos atributos alterados — a
 * diferença entre os dois é justamente a informação que interessa quando uma
 * seção está vazia: **importado e sem alteração** é resposta de auditoria
 * ("naquela quinzena ninguém mexeu nos trechos"); **não importado** é um
 * arquivo que falta pedir. As duas telas seriam idênticas sem isto.
 */
export function escoposImportados(view: FamiliesView | null): Set<EscopoCode> {
  const importados = new Set<EscopoCode>();
  for (const serie of view?.series ?? []) {
    for (const tipo of serie.entityTypeSet.split("+")) {
      const escopo = escopoDoAtributo(null, tipo);
      if (escopo !== "SEM_ESCOPO") importados.add(escopo);
    }
  }
  // O conjunto não é série própria: ele existe quando cavalo e carreta chegam,
  // porque é a leitura do par. Dizê-lo "não importado" com os dois na mão seria
  // mandar pedir um arquivo que não existe.
  if (importados.has("CAVALO") && importados.has("CARRETA")) importados.add("CONJUNTO");
  return importados;
}
