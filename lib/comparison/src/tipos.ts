/**
 * Os tipos que uma vigência pode conter — a pergunta "**o que** estou olhando?".
 *
 * ---------------------------------------------------------------------------
 * Por que esta lista existe
 * ---------------------------------------------------------------------------
 * A tela de Parâmetros filtrava por **canal, vigência e unidade** — quando,
 * onde, e de qual operação. Faltava o eixo que ninguém tinha escrito: *o quê*.
 * Sem ele, o tipo entrava de carona na vigência, e uma vigência que por acaso
 * só tinha trecho lia-se como "esta unidade não tem nada":
 *
 *     agosto/2026 ← 3 trechos, nenhum cavalo   → tela zerada, "0 veículos"
 *     agosto/2026 ← 24 cavalos, 31 carretas    → invisível, uma linha abaixo
 *
 * As duas se chamavam "agosto/2026" no seletor (`rotuloDaVigencia` responde a
 * essa metade), e a tela abria na mais recente. O equipamento continuava
 * inteiro no banco — nada foi apagado, nada foi herdado errado —, e mesmo assim
 * a leitura na tela era a de um sumiço.
 *
 * ---------------------------------------------------------------------------
 * O que é um tipo, e o que ele não é
 * ---------------------------------------------------------------------------
 * Um tipo é o **grão da linha**: uma placa de cavalo, uma placa de carreta, uma
 * chave de trecho, um cargo. Quatro dos seis são `entity_type` no banco, e é
 * daí que a presença deles é lida — nunca do nome do arquivo, nunca da
 * declaração de quem importou, nunca de uma lista escrita à mão que
 * concordaria com o banco só no dia em que fosse escrita.
 *
 * **CONJUNTO não é `entity_type`** e não é importável: é a leitura do par
 * cavalo+carreta, materializada pelo vínculo `cavalo.placa_carreta` — a mesma
 * medida que `ESCOPOS_DE_CONJUNTO` usa para dizer que `carreta.custo_fixo` vale
 * pelo par e não pela carreta sozinha. Ele conta pares, e conta zero enquanto
 * um dos dois lados não tiver chegado.
 *
 * **Tipo não é família de dataset.** A família (`REMUNERACAO_EQUIPAMENTO`,
 * `QUADRO_DE_PESSOAL`) é o que decide qual arquivo entra como *revisão* de qual
 * vigência — identidade canônica, `promote`, fato herdado. O tipo é o que a
 * pessoa quer analisar. Os dois se cruzam e não se substituem: CAVALO, CARRETA,
 * CONJUNTO e TRECHO vivem na mesma família de propósito (a remuneração lê
 * trecho e equipamento na mesma vigência — `@workspace/remuneracao/leitura`), e
 * separá-los em famílias para arrumar um seletor quebraria essa leitura. A
 * `familia` aqui é **descritiva**: ela diz onde o tipo mora, para a tela poder
 * explicar por que o QLP de uma unidade tem vigência própria em vez de mentir
 * que ele não existe.
 *
 * ---------------------------------------------------------------------------
 * Por que este arquivo não importa banco
 * ---------------------------------------------------------------------------
 * Pelo mesmo motivo de `@workspace/ingest/tipos`: a barra de filtros da tela
 * precisa desta lista, e pedi-la pelo índice de `@workspace/comparison`
 * arrastaria `drizzle-orm` e o `pg` inteiro para o bundle do navegador. Quem
 * consulta o banco é `tipos-da-vigencia.ts`, ao lado. Sem import, o subcaminho
 * `@workspace/comparison/tipos` é publicável para os dois lados — e a fileira
 * de tipos da tela e a contagem do servidor passam a ler a mesma lista.
 *
 * O único import é `@workspace/ingest/tipos`, que é do mesmo feitio — sem
 * dependência nenhuma, publicável para o navegador — e é de lá que sai a lista
 * de equipamentos do recorte da Linha do Tempo, no fim do arquivo. Importar
 * dele não desfaz nada do que está escrito acima: o que não pode entrar aqui é
 * banco, não é lista.
 */

import { TIPOS_DE_IMPORTACAO, type TipoDeImportacao } from "@workspace/ingest/tipos";

/** As famílias de dataset, repetidas aqui porque este arquivo não importa nada. */
export const FAMILIA_EQUIPAMENTO = "REMUNERACAO_EQUIPAMENTO";
export const FAMILIA_QUADRO_DE_PESSOAL = "QUADRO_DE_PESSOAL";

export type TipoDeAnalise =
  | "CAVALO"
  | "CARRETA"
  | "CONJUNTO"
  | "TRECHO"
  | "QLP_ADMINISTRATIVO"
  | "QLP_OPERACIONAL";

/** O valor do filtro quando ninguém recortou: a vigência inteira, como ela é. */
export const TODOS_OS_TIPOS = "TODOS" as const;

/** O que o filtro de Tipo aceita: um dos seis, ou todos. */
export type FiltroDeTipo = TipoDeAnalise | typeof TODOS_OS_TIPOS;

export interface DefinicaoDeTipoDeAnalise {
  code: TipoDeAnalise;
  /** O nome curto, para a pastilha e o seletor: "Cavalo", "QLP adm.". */
  rotulo: string;
  /** O nome por extenso, para o título da seção e as frases. */
  nome: string;
  /** O plural das contagens: "3 cavalos". */
  plural: string;
  /** O que uma linha é, naquele tipo. Vai para a explicação da seção. */
  grao: string;
  /**
   * O `entity_type` que materializa este tipo no banco.
   *
   * `null` só no CONJUNTO, que não é tipo de entidade nenhum — ver o cabeçalho.
   * É esta chave que faz a contagem sair do dado e não de uma opinião.
   */
  entityType: string | null;
  /** Em que família de dataset este tipo mora. Descritivo — ver o cabeçalho. */
  familia: string;
}

/**
 * Os seis, na ordem em que a tela os oferece.
 *
 * A ordem é a do peso na remuneração, e não a alfabética: cavalo e carreta são
 * onde está a frota, conjunto vem logo depois porque é a leitura combinada dos
 * dois, trecho fecha o lado variável, e os dois de estrutura vêm por último.
 */
export const TIPOS_DE_ANALISE: DefinicaoDeTipoDeAnalise[] = [
  {
    code: "CAVALO",
    rotulo: "Cavalo",
    nome: "Cavalo",
    plural: "cavalos",
    grao: "uma linha por placa de cavalo mecânico",
    entityType: "CAVALO",
    familia: FAMILIA_EQUIPAMENTO,
  },
  {
    code: "CARRETA",
    rotulo: "Carreta",
    nome: "Carreta",
    plural: "carretas",
    grao: "uma linha por placa de carreta",
    entityType: "CARRETA",
    familia: FAMILIA_EQUIPAMENTO,
  },
  {
    code: "CONJUNTO",
    rotulo: "Conjunto",
    nome: "Conjunto",
    plural: "conjuntos",
    grao:
      "colunas da carreta que já embutem o cavalo vinculado — o número é do par, " +
      "não da carreta sozinha",
    entityType: null,
    familia: FAMILIA_EQUIPAMENTO,
  },
  {
    code: "TRECHO",
    rotulo: "Trecho",
    nome: "Trecho",
    plural: "trechos",
    grao: "uma linha por chave de trecho — origem, destino e quilometragem",
    entityType: "TRECHO",
    familia: FAMILIA_EQUIPAMENTO,
  },
  {
    code: "QLP_ADMINISTRATIVO",
    rotulo: "QLP adm.",
    nome: "QLP administrativo",
    plural: "cargos",
    grao: "uma linha por cargo da estrutura administrativa da unidade",
    entityType: "QLP_ADMINISTRATIVO",
    familia: FAMILIA_QUADRO_DE_PESSOAL,
  },
  {
    code: "QLP_OPERACIONAL",
    rotulo: "QLP oper.",
    nome: "QLP operacional",
    plural: "cargos",
    grao: "uma linha por cargo e turno da operação",
    entityType: "QLP_OPERACIONAL",
    familia: FAMILIA_QUADRO_DE_PESSOAL,
  },
];

const POR_CODIGO = new Map<string, DefinicaoDeTipoDeAnalise>(
  TIPOS_DE_ANALISE.map((t) => [t.code, t]),
);

const POR_ENTITY_TYPE = new Map<string, DefinicaoDeTipoDeAnalise>(
  TIPOS_DE_ANALISE.filter((t) => t.entityType !== null).map((t) => [t.entityType!, t]),
);

/** A definição de um código, ou `null` quando ele não é um tipo desta lista. */
export function tipoDeAnalise(code: string | null | undefined): DefinicaoDeTipoDeAnalise | null {
  if (code === null || code === undefined) return null;
  return POR_CODIGO.get(code.trim().toUpperCase()) ?? null;
}

/** O tipo de um `entity_type` do banco, ou `null` para um que não é dos seis. */
export function tipoDoEntityType(
  entityType: string | null | undefined,
): DefinicaoDeTipoDeAnalise | null {
  if (entityType === null || entityType === undefined) return null;
  return POR_ENTITY_TYPE.get(entityType.trim().toUpperCase()) ?? null;
}

/**
 * Se um valor vindo da URL é um filtro de tipo válido.
 *
 * Endereço adulterado cai em "todos" em vez de quebrar a tela — a mesma
 * doutrina de `ehEscopo` e `ehOrdem`, que já protegem os outros recortes da
 * grade.
 */
export function ehFiltroDeTipo(valor: string | null | undefined): valor is FiltroDeTipo {
  if (valor === null || valor === undefined) return false;
  return valor === TODOS_OS_TIPOS || POR_CODIGO.has(valor);
}

/**
 * "1 cavalo", "24 cavalos" — a contagem escrita como se fala.
 *
 * Recebe só as duas palavras de que precisa, e não a definição inteira: quem
 * chama costuma ter em mãos um `TipoNaVigencia` — a definição já misturada com
 * a contagem daquela vigência — e exigir o catálogo faria a tela procurar de
 * novo o que já está no objeto.
 */
export function contagemDoTipo(
  tipo: Pick<DefinicaoDeTipoDeAnalise, "nome" | "plural">,
  quantidade: number,
): string {
  return quantidade === 1
    ? `1 ${tipo.nome.toLowerCase()}`
    : `${quantidade} ${tipo.plural}`;
}

/* ------------------------------------------------------------------ */
/* O recorte da Linha do Tempo                                         */
/* ------------------------------------------------------------------ */

/**
 * Os tipos que a Linha do Tempo sabe percorrer sozinhos: os **equipamentos**.
 *
 * A lista não é escrita aqui, e a razão é a que este arquivo inteiro defende:
 * uma segunda lista dos mesmos tipos concorda no dia em que é escrita e
 * discorda no dia do próximo. Ela sai de `TIPOS_DE_IMPORTACAO`
 * (`@workspace/ingest/tipos`) — o que o produto de fato recebe —, menos o QLP.
 *
 * **Por que o QLP fica de fora.** Ele forma vigência própria, de outra família
 * de dataset (ver `TIPOS_DE_ANALISE` acima). O eixo de vigências desta tela é o
 * do equipamento, e percorrê-lo com as linhas do quadro de pessoal daria uma
 * série com furos que não são furos.
 *
 * **Por que CONJUNTO fica de fora.** Ele não é `entity_type` nenhum: é a
 * leitura de colunas da carreta que já embutem o cavalo, e uma linha do tempo
 * "do conjunto" contaria de novo o que a linha da carreta já conta.
 *
 * **Por que são seis e não três.** Cavalo, carreta e trecho são o que a
 * empurrada roda; a rota e o AS rodam com caminhão e carroceria, e o apoio com
 * empilhadeira. Esta é a lista do que o **recorte aceita**; qual deles cada
 * tela oferece é do ambiente aberto, e quem responde isso é
 * `EQUIPAMENTOS_DO_AMBIENTE`, no cliente. Aceitar aqui os seis é o que impede a
 * auditoria de rota de ter uma aba que o servidor recusa.
 *
 * O trecho é o único que exige tratamento: ele vive numa série própria que a
 * leitura de intervalo exclui de propósito (ver `getRangeAnalysis`), e o
 * recorte é o que o traz de volta — só quando alguém pede por ele.
 */
/**
 * O que sai da lista, escrito uma vez só.
 *
 * A mesma constante serve às duas metades — a união em tempo de compilação e o
 * filtro em tempo de execução —, para que tirar ou pôr um tipo daqui não possa
 * mover uma metade e deixar a outra para trás.
 */
const QLP = ["QLP_ADMINISTRATIVO", "QLP_OPERACIONAL"] as const;

/** Um equipamento: um tipo de importação que não é quadro de pessoal. */
export type TipoDaLinhaDoTempo = Exclude<TipoDeImportacao, (typeof QLP)[number]>;

export const TIPOS_DA_LINHA_DO_TEMPO: TipoDaLinhaDoTempo[] = TIPOS_DE_IMPORTACAO
  .map((t) => t.code)
  .filter((code): code is TipoDaLinhaDoTempo => !(QLP as readonly string[]).includes(code));

/**
 * Se um valor vindo da URL é um dos equipamentos.
 *
 * Mesma doutrina de `ehFiltroDeTipo`: endereço adulterado cai na leitura sem
 * recorte — a aba Geral — em vez de quebrar a tela ou, pior, devolver uma
 * leitura vazia que se pareceria com "não houve alteração nenhuma".
 */
export function ehTipoDaLinhaDoTempo(
  valor: string | null | undefined,
): valor is TipoDaLinhaDoTempo {
  if (valor === null || valor === undefined) return false;
  return (TIPOS_DA_LINHA_DO_TEMPO as string[]).includes(valor);
}
