/**
 * AS FAMÍLIAS DE DATASET — a que documento uma vigência pertence.
 *
 * Mora em módulo próprio, e sem importar nada, por um motivo de empacotamento:
 * o navegador precisa do nome das famílias (as telas de trecho pedem a sua a
 * `/snapshots`) e não pode arrastar o pipeline de importação junto. `@workspace/ingest`
 * pela raiz traz `pipeline.ts`, e com ele `pg` e `xlsx` — quem é do cliente
 * importa `@workspace/ingest/familias`.
 *
 * `canonical-identity.ts` reexporta tudo daqui, de modo que nenhum importador
 * do servidor mudou de linha.
 */

/**
 * A família do dataset: o *contrato* da importação, não o que veio no arquivo.
 *
 * CAVALO e CARRETA são componentes de uma mesma família. Um arquivo só de
 * cavalos e um arquivo de cavalos+carretas descrevem a mesma remuneração da
 * mesma vigência — antes disto, viravam duas identidades ativas, e os cavalos
 * passavam a existir em duplicidade. A família é declarada por tipo de
 * equipamento e não conta quantas abas foram lidas.
 */
export const DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO = "REMUNERACAO_EQUIPAMENTO";

/**
 * O quadro de lotação de pessoal — administrativo e operacional, uma família.
 *
 * **Por que não a mesma família do equipamento.** A identidade da vigência é
 * (sistema, família, canal, data, escopo). Sem família própria, um arquivo de
 * QLP da mesma unidade, mesma data e mesmo canal teria a mesma identidade da
 * remuneração de equipamento — e entraria como *revisão* dela, superpondo uma
 * vigência que fala de caminhão com uma que fala de gente. A família existe
 * para essa distinção; usá-la é o que impede a confusão, não uma formalidade.
 *
 * **Por que uma só para os dois QLPs.** Pelo mesmo argumento que junta CAVALO e
 * CARRETA: os dois arquivos descrevem o mesmo quadro da mesma vigência, cada um
 * com uma parte da população. Em famílias separadas, cada um abriria a sua
 * vigência e nunca se reconheceriam como partes de um todo; na mesma, o segundo
 * entra como revisão que herda os fatos do primeiro — a máquina de fato herdado
 * (`0017`) foi escrita exatamente para o arquivo parcial.
 */
export const DATASET_FAMILY_QUADRO_DE_PESSOAL = "QUADRO_DE_PESSOAL";

/**
 * A tabela de frete — o lado variável, por trecho.
 *
 * **Por que ela precisou existir.** `TRECHO` não tinha entrada em
 * {@link FAMILY_BY_ENTITY_TYPE} e caía no padrão inclusivo, que é a família do
 * equipamento. Como a identidade de uma vigência é (sistema, família, canal,
 * data, escopo), a tabela de frete de uma unidade e o export de equipamento da
 * **mesma data e mesmo canal** eram a mesma vigência: o segundo arquivo a
 * chegar não abria vigência nenhuma — entrava como revisão do primeiro e
 * herdava os fatos dele, e a cobertura gravada virava `CAVALO+TRECHO`.
 *
 * O efeito foi medido na Auditoria de Km Rodado: dois meses da mesma unidade
 * com coberturas diferentes (`TRECHO` num, `CAVALO+TRECHO` no outro), que
 * `engine.ts` recusa comparar entre si. O seletor oferecia as duas e não havia
 * par possível. Ver `lib/ingest/src/__tests__/fusao-de-cobertura.test.ts`, que
 * reproduz a fusão pelo pipeline real.
 *
 * **Por que família própria, e não um remendo na regra de par.** O argumento é
 * o mesmo que o quadro de pessoal usou: o padrão inclusivo existe para que um
 * equipamento novo — um DOLLY — seja componente da vigência que já existe. A
 * tabela de frete não é um equipamento a mais na mesma vigência; é outro
 * documento, de outro grão, que só por acaso partilha unidade, canal e data com
 * o export de equipamento. Ela é uma entrega própria, e entrega própria tem
 * identidade própria.
 */
export const DATASET_FAMILY_TABELA_DE_FRETE = "TABELA_DE_FRETE";

const FAMILY_BY_ENTITY_TYPE: Record<string, string> = {
  CAVALO: DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO,
  CARRETA: DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO,
  TRECHO: DATASET_FAMILY_TABELA_DE_FRETE,
  QLP_ADMINISTRATIVO: DATASET_FAMILY_QUADRO_DE_PESSOAL,
  QLP_OPERACIONAL: DATASET_FAMILY_QUADRO_DE_PESSOAL,
};

/**
 * A família a que um tipo de equipamento pertence.
 *
 * Um tipo ainda não mapeado cai na família de remuneração de equipamento. O
 * padrão é deliberadamente *inclusivo*: um equipamento novo (um DOLLY, digamos)
 * tem de entrar como componente da vigência que já existe, e não abrir uma
 * segunda identidade ativa para a mesma data — que é exatamente a falha que
 * este módulo fecha.
 *
 * O espelho em SQL (`freightcheck_dataset_family`, na `0015`) devolve a família
 * de equipamento para qualquer entrada, e continua assim de propósito: ele
 * serve ao *backfill* daquela migration, sobre uma base que só tinha
 * equipamento. Quem decide daqui para frente é esta função — a coluna
 * `snapshot.dataset_family` é escrita por ela, e a chave canônica gerada pelo
 * banco lê a coluna, não a função.
 */
export function datasetFamilyFor(entityType: string): string {
  return (
    FAMILY_BY_ENTITY_TYPE[entityType.trim().toUpperCase()] ??
    DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO
  );
}

/** A família de um conjunto de tipos. Erro se o run misturar famílias. */
export function datasetFamilyOfSet(entityTypes: readonly string[]): string {
  const families = [...new Set(entityTypes.map(datasetFamilyFor))].sort();
  if (families.length === 0) return DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO;
  if (families.length > 1) {
    throw new Error(
      `Uma mesma vigência não pode misturar famílias de dataset: ${families.join(", ")}.`,
    );
  }
  return families[0];
}

/**
 * As famílias que respondem por "o que esta unidade entregou".
 *
 * A tela de Vigências e a de Comparar listam entregas, não equipamento: antes
 * da família própria do trecho elas recebiam a tabela de frete de graça, por
 * ela estar na família do equipamento. Pedir as duas é o que mantém a lista
 * sendo o que ela sempre foi — e agora por escolha, não por acidente.
 *
 * O quadro de pessoal fica de fora de propósito: ele tem tela própria, e foi
 * para não aparecer nestas que ganhou família em primeiro lugar.
 */
export const FAMILIAS_QUE_A_UNIDADE_ENTREGA: readonly string[] = [
  DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO,
  DATASET_FAMILY_TABELA_DE_FRETE,
];
