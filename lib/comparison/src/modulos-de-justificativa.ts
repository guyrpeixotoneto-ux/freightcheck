import { VARIAVEIS_DE_ALUGUEL, VARIAVEIS_DE_DETALHE_DE_ALUGUEL } from "./aluguel";
import { VARIAVEIS_DE_AQUISICAO, VARIAVEIS_DE_DETALHE_DE_AQUISICAO } from "./aquisicao";
import { VARIAVEIS_DE_FINAME } from "./finame";
import { VARIAVEIS_DE_IMPOSTOS } from "./impostos";
import { VARIAVEIS_DE_IPVA } from "./ipva";
import { VARIAVEIS_DE_KM } from "./km-rodado";
import { VARIAVEIS_DE_LUCRO_FIXO } from "./lucro-fixo";
import { VARIAVEIS_DE_MANUTENCAO } from "./manutencao";
import { VARIAVEIS_DE_SEGURO } from "./seguro";
import { VARIAVEIS_DE_VELOCIDADE } from "./velocidade-media";
import { placementOf } from "./families";
import { codigosDaRubrica, modulosDoQlp } from "./qlp-comparacao";

/**
 * EM QUE MÓDULO SE JUSTIFICA CADA ALTERAÇÃO.
 *
 * Justificar deixou de ser trabalho de uma tela só. Cada rubrica do Custo
 * Fixo, do Custo Variável e do QLP justifica as próprias alterações, na tela em
 * que o gestor já está vendo o número que mudou — e o Monitor de Justificativas
 * deixou de ser o lugar onde se escreve para ser o lugar de onde se **cobra**.
 * Cobrar exige uma pergunta que nenhuma das telas responde sozinha: *em que
 * módulo está a pendência, e em que rubrica dentro dele*.
 *
 * Este arquivo é o mapa que responde isso, e ele é a **mesma régua dos dois
 * lados**: o servidor dobra as contagens por atributo em contagens por rubrica,
 * e a tela lê a mesma tabela para escrever o nome e montar o link. Duas cópias
 * concordariam no dia em que fossem escritas — e a discordância apareceria como
 * uma linha que soma um número e abre outro.
 *
 * ---------------------------------------------------------------------------
 * As duas perguntas, e as duas respostas
 * ---------------------------------------------------------------------------
 * **Em que módulo?** Sai da classe de custo que a comparação **já gravou** na
 * própria alteração (`change.cost_class`, instantânea por
 * `classification.ts`), e não de uma segunda classificação escrita aqui: FIXO é
 * Custo Fixo, VARIAVEL é Custo Variável, e o quadro de pessoal é QLP pelo tipo
 * da entidade. O que a curadoria ainda não classificou não é empurrado para o
 * módulo maior — ele tem módulo próprio, com esse nome, e aparece na tela.
 * Inventar a classe aqui faria o Monitor discordar de toda outra tela que lê a
 * mesma coluna.
 *
 * **Em que rubrica?** Duas origens, nesta ordem:
 *
 * 1. **A rubrica que tem tela** — Aquisição, Aluguel de Frota, Finame, IPVA,
 *    Lucro Fixo, Impostos, Seguro, Manutenção, KM rodado, Velocidade média —, quando o código do atributo
 *    está no catálogo daquela tela (`VARIAVEIS_DE_*`, os mesmos que a tela lê).
 *    É a que importa para cobrar: ela tem endereço, e o endereço é onde a
 *    justificativa se escreve.
 * 2. **O parâmetro da família** (`families.ts`) para todo o resto. Ele cobre os
 *    138 atributos do dicionário sem exceção, então nenhuma alteração cai numa
 *    gaveta chamada "outras": ela aparece com o nome que o Freightech lhe dá.
 *    Não tem tela de rubrica, e por isso o link dela é a fila de Justificativas,
 *    que justifica qualquer alteração.
 *
 * **O TMA não está aqui, e é de propósito.** A tela dele existe
 * (`/custo-variavel-tma`), mas ela lê trecho — e o trecho está fora deste
 * painel desde `painel-de-justificativas-escopo.ts`. Uma linha de TMA aqui
 * seria uma rubrica permanentemente zerada, prometendo uma fila que este
 * recorte não tem.
 *
 * Nada neste arquivo toca o banco, e é essa ausência que o mantém importável
 * pelo navegador — a mesma escolha de `painel-de-justificativas-escopo.ts`.
 */

/**
 * Os módulos, na ordem em que o Monitor os lê.
 *
 * `SEM_CLASSE` é o último e existe pela regra de `families.ts`: nada é
 * descartado. Uma alteração cuja curadoria ainda não decidiu a classe de custo
 * continua sendo pendência de alguém, e escondê-la faria os módulos somarem
 * menos do que o cartão do total.
 */
export type ChaveDeModulo = "CUSTO_FIXO" | "CUSTO_VARIAVEL" | "QLP" | "SEM_CLASSE";

export interface ModuloDeJustificativa {
  chave: ChaveDeModulo;
  rotulo: string;
  /** O que este módulo reúne — a frase que a tela escreve sob o nome. */
  descricao: string;
  /**
   * A tela que abre o módulo inteiro — `null` quando ele não tem uma.
   *
   * O Custo Fixo tem o Monitor, que consolida as rubricas dele; o QLP tem o
   * quadro. O Custo Variável não tem tela de conjunto, e apontar para uma das
   * rubricas dele prometeria o módulo e entregaria uma parte — quem quer uma
   * rubrica clica na linha dela, logo abaixo.
   */
  rota: string | null;
}

export const MODULOS_DE_JUSTIFICATIVA: readonly ModuloDeJustificativa[] = [
  {
    chave: "CUSTO_FIXO",
    rotulo: "Custo Fixo",
    descricao: "O que se paga por ter o ativo, esteja ele rodando ou parado",
    rota: "/monitor-custo-fixo",
  },
  {
    chave: "CUSTO_VARIAVEL",
    rotulo: "Custo Variável",
    descricao: "O que só existe porque o ativo rodou",
    rota: null,
  },
  {
    chave: "QLP",
    rotulo: "QLP",
    descricao: "O quadro de pessoal — operacional e administrativo",
    rota: "/qlp-operacional",
  },
  {
    chave: "SEM_CLASSE",
    rotulo: "Sem classe de custo",
    descricao: "Alterações que a curadoria ainda não classificou como fixa ou variável",
    rota: null,
  },
];

/** Um módulo pelo nome. */
export function moduloDeJustificativa(
  chave: ChaveDeModulo,
): ModuloDeJustificativa {
  return (
    MODULOS_DE_JUSTIFICATIVA.find((m) => m.chave === chave) ??
    MODULOS_DE_JUSTIFICATIVA[MODULOS_DE_JUSTIFICATIVA.length - 1]
  );
}

/**
 * Uma rubrica do Monitor: onde a alteração mora, e onde ela se justifica.
 */
export interface RubricaDeJustificativa {
  /** Estável, e única dentro do módulo. É o que agrupa e o que vai na URL. */
  chave: string;
  /**
   * O nome na tela. Para as rubricas do QLP ele é a chave crua da rubrica, e
   * quem a escreve é a tela (`escreverRubrica`): nomear `saude` de "Plano de
   * saúde" é decisão de apresentação, e este pacote não fala com a tela — a
   * mesma divisão de `modulosDoQlp`.
   */
  rotulo: string;
  modulo: ChaveDeModulo;
  /**
   * A tela onde esta rubrica se justifica hoje — `null` quando ela não tem uma,
   * e aí quem justifica é a fila de Justificativas.
   */
  rota: string | null;
  /** A rubrica crua do QLP, quando é uma; `null` nas demais. */
  rubricaDoQlp: string | null;
}

/** Uma rubrica com tela própria: o catálogo que ela lê e o endereço dela. */
interface RubricaComTela {
  chave: string;
  rotulo: string;
  modulo: ChaveDeModulo;
  rota: string;
  codigos: readonly string[];
  /**
   * Os códigos de que esta rubrica é **dona**, ainda que outras telas os leiam.
   *
   * Existe porque o desempate abaixo descarta o código reivindicado por várias
   * — e essa regra só está certa enquanto **ninguém** tiver tomado a decisão de
   * quem é o dono. Com a Auditoria de Aquisição a decisão passou a existir: o
   * valor de nota, o percentual de entrada e a data são a rubrica *dela*, e
   * Finame, IPVA e Impostos os leem como base do próprio número, exatamente
   * como o `foraDaSoma` de cada um daqueles catálogos já dizia por escrito.
   *
   * Não é um desempate escrito à mão: é a mesma posse que
   * `__tests__/posse-da-soma-do-custo-fixo.test.ts` mede do lado do dinheiro,
   * dita aqui do lado da justificativa. E continua valendo para um código só
   * quando **uma** rubrica o declara — duas donas voltam a ser disputa, e a
   * disputa continua caindo na fila.
   */
  proprios?: readonly string[];
}

/** Os códigos de um catálogo de variáveis — por tipo de ativo, ou soltos. */
function codigos(
  variaveis: readonly { codigo: string | { CAVALO?: string; CARRETA?: string } }[],
): string[] {
  const lista: string[] = [];
  for (const v of variaveis) {
    if (typeof v.codigo === "string") lista.push(v.codigo);
    else for (const c of Object.values(v.codigo)) if (c) lista.push(c);
  }
  return [...new Set(lista)];
}

/**
 * As rubricas que têm tela, e os códigos de atributo de cada uma.
 *
 * Os códigos saem dos catálogos que as próprias telas leem — e não de uma
 * segunda lista escrita aqui —, pelo motivo do cabeçalho: quando a Ambev mandar
 * uma coluna nova e o catálogo da rubrica crescer, a linha do Monitor cresce
 * junto, sem ninguém vir a este arquivo.
 */
const RUBRICAS_COM_TELA: readonly RubricaComTela[] = [
  {
    chave: "aquisicao",
    rotulo: "Aquisição",
    modulo: "CUSTO_FIXO",
    rota: "/custo-fixo-aquisicao",
    codigos: codigos([...VARIAVEIS_DE_AQUISICAO, ...VARIAVEIS_DE_DETALHE_DE_AQUISICAO]),
    /* As cinco colunas da compra do ativo. Três telas as leem como base — e é
       por isso que, antes desta existir, elas não eram rubrica de ninguém. */
    proprios: codigos([...VARIAVEIS_DE_AQUISICAO, ...VARIAVEIS_DE_DETALHE_DE_AQUISICAO]),
  },
  {
    chave: "aluguel",
    rotulo: "Aluguel de Frota",
    modulo: "CUSTO_FIXO",
    rota: "/custo-fixo-aluguel",
    codigos: codigos([...VARIAVEIS_DE_ALUGUEL, ...VARIAVEIS_DE_DETALHE_DE_ALUGUEL]),
    /*
      Só as colunas de aluguel. A parcela FINAME está no catálogo desta tela
      porque é o que **confere** o aluguel — e continua sendo rubrica do Finame,
      que é quem a soma. Reivindicá-la aqui mandaria para esta tela a
      justificativa de toda alteração de parcela da frota financiada.
    */
    proprios: ["cavalo.custo_aluguel", "carreta.custo_aluguel"],
  },
  {
    chave: "finame",
    rotulo: "Finame",
    modulo: "CUSTO_FIXO",
    rota: "/custo-fixo-finame",
    codigos: codigos(VARIAVEIS_DE_FINAME),
  },
  {
    chave: "ipva",
    rotulo: "IPVA",
    modulo: "CUSTO_FIXO",
    rota: "/custo-fixo-ipva",
    codigos: codigos(VARIAVEIS_DE_IPVA),
  },
  {
    chave: "lucro-fixo",
    rotulo: "Lucro Fixo",
    modulo: "CUSTO_FIXO",
    rota: "/custo-fixo-lucro-fixo",
    codigos: codigos(VARIAVEIS_DE_LUCRO_FIXO),
  },
  {
    chave: "impostos",
    rotulo: "Impostos",
    modulo: "CUSTO_FIXO",
    rota: "/custo-fixo-impostos",
    codigos: codigos(VARIAVEIS_DE_IMPOSTOS),
  },
  {
    chave: "seguro",
    rotulo: "Seguro e Aparato",
    modulo: "CUSTO_FIXO",
    rota: "/custo-fixo-seguro",
    codigos: codigos(VARIAVEIS_DE_SEGURO),
  },
  {
    chave: "manutencao",
    rotulo: "Manutenção",
    modulo: "CUSTO_VARIAVEL",
    rota: "/custo-variavel-manutencao",
    codigos: codigos(VARIAVEIS_DE_MANUTENCAO),
  },
  {
    chave: "km-rodado",
    rotulo: "KM rodado",
    modulo: "CUSTO_VARIAVEL",
    rota: "/custo-variavel-km-rodado",
    codigos: codigos(VARIAVEIS_DE_KM),
  },
  {
    chave: "velocidade-media",
    rotulo: "Velocidade média",
    modulo: "CUSTO_VARIAVEL",
    rota: "/custo-variavel-velocidade-media",
    codigos: codigos(VARIAVEIS_DE_VELOCIDADE),
  },
];

/**
 * `código do atributo` → a rubrica com tela que o reivindica — quando **uma só**
 * o reivindica.
 *
 * Vários códigos são reivindicados por mais de uma tela, e por dois motivos
 * diferentes — que agora recebem tratamentos diferentes.
 *
 * **O primeiro é a coluna que tem dona.** `cavalo.valor_nf_compra` está no
 * catálogo do Finame, no do IPVA e no dos Impostos porque as três mostram o
 * valor da nota como contexto do próprio número; o mesmo vale para `cavalo.ano`
 * e `cavalo.data`. Enquanto nenhuma tela era a **rubrica** dessas colunas, dar a
 * qualquer uma delas teria sido inventar uma escolha que ninguém tomou — e elas
 * ficavam fora do mapa. Desde a Auditoria de Aquisição a escolha existe e está
 * escrita: ela as declara em `proprios`, e é ela que as recebe. As outras três
 * continuam mostrando a nota, e continuam dizendo, cada uma no próprio
 * `foraDaSoma`, que ela não é rubrica delas.
 *
 * **O segundo é a coluna que várias leem e ninguém reivindicou.**
 * `trecho.km_rodado` está no KM rodado e na Velocidade média, e nenhuma das
 * duas se declara dona. Essas continuam **fora deste mapa**, e caem na regra
 * seguinte: o nome vem do parâmetro da família, e o link vem da fila. Dar o km
 * rodado ao primeiro do menu faria a linha da outra tela contar menos do que a
 * própria tela mostra — um desempate escrito à mão diria, com cara de regra,
 * uma escolha que ninguém tomou.
 */
const POR_CODIGO = new Map<string, RubricaComTela>();
const REIVINDICADO_POR_VARIAS = new Set<string>();

/**
 * A posse declarada, antes do desempate — e só quando é de uma rubrica só.
 *
 * Dois donos do mesmo código voltam a ser disputa, e a disputa cai na fila: a
 * regra do desempate continua intacta para tudo o que ninguém reivindicou como
 * seu.
 */
const DONO_DECLARADO = new Map<string, RubricaComTela>();
const DECLARADO_POR_VARIAS = new Set<string>();
for (const rubrica of RUBRICAS_COM_TELA) {
  for (const codigo of rubrica.proprios ?? []) {
    if (DONO_DECLARADO.has(codigo)) {
      DECLARADO_POR_VARIAS.add(codigo);
      DONO_DECLARADO.delete(codigo);
      continue;
    }
    if (!DECLARADO_POR_VARIAS.has(codigo)) DONO_DECLARADO.set(codigo, rubrica);
  }
}

for (const rubrica of RUBRICAS_COM_TELA) {
  for (const codigo of rubrica.codigos) {
    const dono = DONO_DECLARADO.get(codigo);
    if (dono) {
      POR_CODIGO.set(codigo, dono);
      continue;
    }
    if (POR_CODIGO.has(codigo)) {
      REIVINDICADO_POR_VARIAS.add(codigo);
      POR_CODIGO.delete(codigo);
      continue;
    }
    if (!REIVINDICADO_POR_VARIAS.has(codigo)) POR_CODIGO.set(codigo, rubrica);
  }
}

/** As telas que reivindicam um código — vazio quando nenhuma o reivindica. */
export function telasQueReivindicam(codigo: string): string[] {
  return RUBRICAS_COM_TELA.filter((r) => r.codigos.includes(codigo)).map(
    (r) => r.chave,
  );
}

/** As rubricas do QLP: uma por assunto do quadro, com a tela do módulo. */
const RUBRICA_DO_CODIGO_DE_QLP = new Map<string, string>();
for (const modulo of modulosDoQlp()) {
  for (const quadro of modulo.quadros) {
    for (const codigo of codigosDaRubrica(quadro, modulo.chave)) {
      if (!RUBRICA_DO_CODIGO_DE_QLP.has(codigo)) {
        RUBRICA_DO_CODIGO_DE_QLP.set(codigo, modulo.chave);
      }
    }
  }
}

/** Os tipos de entidade do quadro de pessoal — ver `TIPO_DO_QUADRO`, em `qlp.ts`. */
const TIPOS_DE_QLP = ["QLP_OPERACIONAL", "QLP_ADMINISTRATIVO"];

function ehDoQlp(entityType: string | null | undefined): boolean {
  if (!entityType) return false;
  return TIPOS_DE_QLP.includes(entityType.trim().toUpperCase());
}

/** O que a alteração precisa trazer para achar o próprio módulo. */
export interface AlteracaoClassificavel {
  attributeCode: string | null;
  entityType: string | null;
  /** `FIXO` | `VARIAVEL` | `null`, como a comparação gravou. */
  costClass: string | null;
}

/**
 * De que módulo é a alteração.
 *
 * O quadro de pessoal decide pelo tipo, e não pela classe: as colunas do QLP
 * são custo fixo pela natureza, e classificá-las assim faria o quadro de gente
 * sumir dentro do Finame e do IPVA — que é exatamente a separação que a seção
 * Equipe existe para manter.
 */
export function moduloDaAlteracao(a: AlteracaoClassificavel): ChaveDeModulo {
  if (ehDoQlp(a.entityType)) return "QLP";
  const rubrica = a.attributeCode ? POR_CODIGO.get(a.attributeCode) : undefined;
  /* A rubrica com tela manda na classe: Finame é Custo Fixo mesmo que um
     atributo dele chegue sem classificação, ou a linha da tela e a linha do
     Monitor apontariam para módulos diferentes. */
  if (rubrica) return rubrica.modulo;
  const classe = (a.costClass ?? "").trim().toUpperCase();
  if (classe === "FIXO") return "CUSTO_FIXO";
  if (classe === "VARIAVEL") return "CUSTO_VARIAVEL";
  return "SEM_CLASSE";
}

/**
 * Em que rubrica a alteração entra, e onde ela se justifica.
 *
 * Nunca devolve nulo, pela mesma regra de `placementOf`: o que nenhum catálogo
 * conhece cai numa rubrica com o nome do parâmetro da família — ou com o
 * próprio código, quando nem a família o conhece —, em vez de sumir.
 */
export function rubricaDaAlteracao(
  a: AlteracaoClassificavel,
): RubricaDeJustificativa {
  const modulo = moduloDaAlteracao(a);
  return descreverRubrica(chaveDaRubrica(a, modulo), modulo);
}

/**
 * A chave da rubrica de uma alteração — três formas, e o prefixo diz qual.
 *
 * `qlp:<rubrica>` é assunto do quadro de pessoal; `parametro:<FAMÍLIA|nome>` é
 * o parâmetro da família, para o que não tem tela de rubrica; e a chave nua é
 * uma das rubricas com tela. O prefixo existe para que a chave possa voltar do
 * servidor **sozinha** e ainda ser reconhecida: é ele que permite à tela
 * escrever o nome e montar o link sem que a resposta carregue os dois.
 */
function chaveDaRubrica(
  a: AlteracaoClassificavel,
  modulo: ChaveDeModulo,
): string {
  if (modulo === "QLP") {
    const rubrica = a.attributeCode
      ? RUBRICA_DO_CODIGO_DE_QLP.get(a.attributeCode)
      : undefined;
    /* Sem rubrica declarada no catálogo do quadro, a coluna ainda é do QLP: ela
       vira a rubrica que o próprio catálogo já usa para esse caso. */
    return `qlp:${rubrica ?? "nao_identificado"}`;
  }
  const comTela = a.attributeCode ? POR_CODIGO.get(a.attributeCode) : undefined;
  if (comTela) return comTela.chave;
  return `parametro:${placementOf(a.attributeCode).parameterKey}`;
}

/**
 * A rubrica por extenso, a partir da chave — o caminho de volta.
 *
 * A contagem chega à tela com a chave e o módulo, e é esta função que devolve
 * o nome e a rota. O módulo vem junto porque ele não está na chave de um
 * parâmetro de família: o mesmo parâmetro pode ter atributos de classes
 * diferentes, e é a classe gravada na alteração que decide — não o nome.
 */
export function descreverRubrica(
  chave: string,
  modulo: ChaveDeModulo,
): RubricaDeJustificativa {
  if (chave.startsWith("qlp:")) {
    const rubrica = chave.slice("qlp:".length);
    return {
      chave,
      /* Crua: nomear `saude` de "Plano de saúde" é da tela — ver `rotulo`. */
      rotulo: rubrica,
      modulo,
      /* O módulo do QLP é uma rota por rubrica — `App.tsx` a atende com uma
         `<Route path="/qlp/:modulo">` só. */
      rota: `/qlp/${rubrica}`,
      rubricaDoQlp: rubrica,
    };
  }

  if (chave.startsWith("parametro:")) {
    const parameterKey = chave.slice("parametro:".length);
    /* `FAMÍLIA|parâmetro` — o nome é o que vem depois da barra vertical. */
    const separador = parameterKey.indexOf("|");
    return {
      chave,
      rotulo: separador === -1 ? parameterKey : parameterKey.slice(separador + 1),
      modulo,
      /* Sem tela de rubrica, quem justifica é a fila — e ela justifica qualquer
         alteração. O link é montado pela tela, que sabe o recorte aberto. */
      rota: null,
      rubricaDoQlp: null,
    };
  }

  const comTela = RUBRICAS_COM_TELA.find((r) => r.chave === chave);
  if (comTela) {
    return {
      chave,
      rotulo: comTela.rotulo,
      modulo: comTela.modulo,
      rota: comTela.rota,
      rubricaDoQlp: null,
    };
  }

  /* Chave de uma rubrica que este código não conhece — um servidor mais novo
     do que a tela, depois de um deploy pela metade. Ela aparece com a própria
     chave, que é feia e verdadeira, em vez de sumir da soma. */
  return { chave, rotulo: chave, modulo, rota: null, rubricaDoQlp: null };
}

/** As rubricas com tela, para o teste de cobertura e para quem precisar listá-las. */
export function rubricasComTela(): readonly RubricaComTela[] {
  return RUBRICAS_COM_TELA;
}
