/**
 * O vínculo cavalo–carreta: **quem puxa quem, nesta vigência**.
 *
 * A regra mora aqui, sozinha, porque ela já era usada em dois lugares e estava
 * escrita duas vezes: a DRE pareava os lados para apurar o escopo CONJUNTO, e a
 * ficha do cavalo resolvia o mesmo vínculo em SQL para oferecer o atalho da
 * carreta. Duas implementações da pergunta "qual carreta é desta placa?" são
 * duas chances de o produto responder coisas diferentes na mesma vigência — e é
 * a mesma razão pela qual `COMPOSITIONS` e `ESCOPOS_DE_CONJUNTO` moram num
 * lugar só.
 *
 * **O que o vínculo é, medido.** `cavalo.placa_carreta` liga os dois lados. Em
 * 14/08/2026, na última vigência do export real: os 62 cavalos têm o campo
 * preenchido, apontam 62 placas distintas, e as 62 casam com uma carreta que
 * existe no banco — um para um, sem sobra dos dois lados. E a aritmética
 * confirma o significado, não só a forma: `carreta.finame` menos
 * `carreta.finame_implemento` dá exatamente o `cavalo.finame_cavalo` do cavalo
 * apontado em 558 de 558 linhas.
 *
 * **O que este arquivo não faz.** Nada aqui lê o banco e nada aqui soma. São
 * funções puras sobre o que a vigência entregou — o que as torna exercitáveis
 * sem um export inteiro, e o que impede que uma decisão de pareamento vire, sem
 * querer, uma decisão de dinheiro.
 */

/** O atributo do cavalo que declara a carreta. Um só, e é este. */
export const CODIGO_DO_VINCULO = "cavalo.placa_carreta";

/** O mínimo que o pareamento precisa saber de um ativo. */
export interface AtivoDoVinculo {
  entityId: string;
  entityType: string;
  placa: string | null;
}

/** O mínimo que o pareamento precisa saber de um fato. */
export interface FatoDoVinculo {
  code: string;
  value_text: string | null;
  is_null: boolean;
}

export interface IndiceDeVinculos {
  /** `entityId do cavalo` → a placa que ele aponta. */
  carretaDoCavalo: Map<string, string>;
  /** `placa` → o cavalo que fica com ela quando mais de um a aponta. */
  cavaloPorCarreta: Map<string, string>;
  /** `placa` → `entityId` da carreta. */
  carretaPorPlaca: Map<string, string>;
  /**
   * As placas apontadas por mais de um cavalo, com todos os que as apontam.
   *
   * Vazio nos dados reais das 9 vigências. Existe porque o efeito de um empate
   * não é cosmético: a mesma carreta entraria em dois conjuntos e a remuneração
   * dela seria contada duas vezes na frota. Quando acontecer, o produto vai
   * dizer que aconteceu em vez de escolher em silêncio.
   */
  disputadas: Map<string, string[]>;
}

/**
 * O índice do vínculo, montado dos fatos **daquela vigência**.
 *
 * Da vigência, e não do estado de hoje: um cavalo que trocou de carreta em
 * agosto continuou puxando a antiga em julho, e uma leitura que usasse o
 * vínculo corrente para desenhar julho contaria a carreta errada num mês que já
 * foi pago.
 */
export function indexarVinculos(
  identidades: Iterable<AtivoDoVinculo>,
  fatosPorAtivo: ReadonlyMap<string, readonly FatoDoVinculo[]>,
): IndiceDeVinculos {
  const tipoPorAtivo = new Map<string, string>();
  const carretaPorPlaca = new Map<string, string>();

  for (const ativo of identidades) {
    tipoPorAtivo.set(ativo.entityId, ativo.entityType);
    /*
      Primeira a chegar fica com a placa. Não é desempate de verdade: quem
      garante "uma placa corrente, um equipamento" é `entity_identifier_current_uq`,
      um índice único parcial no banco. Isto aqui é só a forma de não depender da
      ordem em que as linhas voltaram do SELECT caso o índice caia.
    */
    if (ativo.entityType === "CARRETA" && ativo.placa && !carretaPorPlaca.has(ativo.placa)) {
      carretaPorPlaca.set(ativo.placa, ativo.entityId);
    }
  }

  const carretaDoCavalo = new Map<string, string>();
  const apontadores = new Map<string, string[]>();

  for (const [entityId, fatos] of fatosPorAtivo) {
    if (tipoPorAtivo.get(entityId) !== "CAVALO") continue;
    const fato = fatos.find((f) => f.code === CODIGO_DO_VINCULO);
    const placa = fato && !fato.is_null ? fato.value_text : null;
    if (!placa) continue;
    carretaDoCavalo.set(entityId, placa);
    const lista = apontadores.get(placa) ?? [];
    lista.push(entityId);
    apontadores.set(placa, lista);
  }

  const cavaloPorCarreta = new Map<string, string>();
  const disputadas = new Map<string, string[]>();
  for (const [placa, cavalos] of apontadores) {
    /*
      Ordenar antes de escolher. A ordem de `fatosPorAtivo` é a ordem em que as
      linhas voltaram do banco, que não é estável entre execuções — e um dono
      que muda de leitura para leitura faria a mesma vigência mostrar dois
      conjuntos diferentes sem nada ter mudado.
    */
    const ordenados = [...cavalos].sort();
    cavaloPorCarreta.set(placa, ordenados[0]);
    if (ordenados.length > 1) disputadas.set(placa, ordenados);
  }

  return { carretaDoCavalo, cavaloPorCarreta, carretaPorPlaca, disputadas };
}

/**
 * Como este conjunto se formou — ou por que não se formou.
 *
 * Cinco naturezas, e nenhuma delas é "erro" por si só. `CARRETA_ORFA` é o
 * estado normal de 9 das 71 carretas desta base, e pintá-la de alerta ensinaria
 * quem lê a ignorar o alerta. As duas que **são** defeito — `PLACA_SEM_CARRETA`
 * e `PLACA_DISPUTADA` — dizem que a fonte apontou algo que o banco não confirma.
 */
export type NaturezaDoVinculo =
  | "PAREADO"
  | "CAVALO_SEM_VINCULO"
  | "PLACA_SEM_CARRETA"
  | "PLACA_DISPUTADA"
  | "CARRETA_ORFA";

export const ROTULO_DA_NATUREZA: Record<NaturezaDoVinculo, string> = {
  PAREADO: "Cavalo + carreta",
  CAVALO_SEM_VINCULO: "Cavalo sem carreta declarada",
  PLACA_SEM_CARRETA: "Placa apontada sem carreta na vigência",
  PLACA_DISPUTADA: "Placa apontada por mais de um cavalo",
  CARRETA_ORFA: "Carreta sem cavalo",
};

export const FRASE_DA_NATUREZA: Record<NaturezaDoVinculo, string> = {
  PAREADO: "O cavalo declara a placa da carreta, e a carreta está nesta vigência.",
  CAVALO_SEM_VINCULO:
    "Este cavalo não declara placa de carreta nesta vigência. Sem os dois lados não há " +
    "total de conjunto na fonte para conferir — o que o cavalo recebe está na ficha dele.",
  PLACA_SEM_CARRETA:
    "O cavalo aponta uma placa que nenhuma carreta desta vigência tem. O vínculo está " +
    "na fonte e o destino não está: é pergunta para quem gerou a planilha.",
  PLACA_DISPUTADA:
    "Mais de um cavalo aponta esta mesma placa nesta vigência. A carreta ficou com o " +
    "primeiro deles e este conjunto ficou sem carreta, porque atribuí-la aos dois " +
    "contaria a remuneração dela duas vezes.",
  CARRETA_ORFA:
    "Nenhum cavalo desta vigência aponta esta carreta. Ela forma um conjunto sozinha — " +
    "é assim que a contagem fecha sem que nenhum ativo apareça duas vezes.",
};

/** Um conjunto, antes de qualquer número. */
export interface ParDoConjunto {
  /** A chave estável: o cavalo, ou a carreta quando ela é órfã. */
  id: string;
  cavalo: AtivoDoVinculo | null;
  carreta: AtivoDoVinculo | null;
  /** A placa que o cavalo declarou, mesmo quando ela não encontrou destino. */
  placaApontada: string | null;
  natureza: NaturezaDoVinculo;
  /** Os cavalos que disputam a placa, quando há disputa. Vazio no resto. */
  disputantes: string[];
}

/**
 * Os conjuntos de uma vigência: um por cavalo presente, mais um por carreta que
 * nenhum cavalo aponta.
 *
 * **A regra que não pode ser violada: cada ativo aparece em exatamente um
 * conjunto.** É ela que autoriza somar a coluna de remuneração desta lista sem
 * contar ninguém duas vezes — e é a mesma disciplina que tirou
 * `carreta.custo_fixo` do total da carreta. Na última vigência: 62 cavalos
 * pareados + 9 carretas órfãs = 71 carretas e 62 cavalos, cada um uma vez.
 */
export function parearConjuntos(
  indice: IndiceDeVinculos,
  presentes: readonly AtivoDoVinculo[],
): ParDoConjunto[] {
  const presentePorId = new Map(presentes.map((a) => [a.entityId, a]));
  const pares: ParDoConjunto[] = [];
  const carretasUsadas = new Set<string>();

  const cavalos = presentes
    .filter((a) => a.entityType === "CAVALO")
    .sort((a, b) => ordenarPorPlaca(a, b));

  for (const cavalo of cavalos) {
    const placa = indice.carretaDoCavalo.get(cavalo.entityId) ?? null;
    if (placa === null) {
      pares.push({
        id: cavalo.entityId,
        cavalo,
        carreta: null,
        placaApontada: null,
        natureza: "CAVALO_SEM_VINCULO",
        disputantes: [],
      });
      continue;
    }

    const disputantes = indice.disputadas.get(placa) ?? [];
    const dono = indice.cavaloPorCarreta.get(placa);
    if (disputantes.length > 1 && dono !== cavalo.entityId) {
      pares.push({
        id: cavalo.entityId,
        cavalo,
        carreta: null,
        placaApontada: placa,
        natureza: "PLACA_DISPUTADA",
        disputantes,
      });
      continue;
    }

    const carretaId = indice.carretaPorPlaca.get(placa);
    const carreta = carretaId ? (presentePorId.get(carretaId) ?? null) : null;
    if (carreta === null) {
      pares.push({
        id: cavalo.entityId,
        cavalo,
        carreta: null,
        placaApontada: placa,
        natureza: "PLACA_SEM_CARRETA",
        disputantes,
      });
      continue;
    }

    carretasUsadas.add(carreta.entityId);
    pares.push({
      id: cavalo.entityId,
      cavalo,
      carreta,
      placaApontada: placa,
      natureza: disputantes.length > 1 ? "PLACA_DISPUTADA" : "PAREADO",
      disputantes: disputantes.length > 1 ? disputantes : [],
    });
  }

  const orfas = presentes
    .filter((a) => a.entityType === "CARRETA" && !carretasUsadas.has(a.entityId))
    .sort((a, b) => ordenarPorPlaca(a, b));

  for (const carreta of orfas) {
    pares.push({
      id: carreta.entityId,
      cavalo: null,
      carreta,
      placaApontada: carreta.placa,
      natureza: "CARRETA_ORFA",
      disputantes: [],
    });
  }

  return pares;
}

function ordenarPorPlaca(a: AtivoDoVinculo, b: AtivoDoVinculo): number {
  return (a.placa ?? a.entityId).localeCompare(b.placa ?? b.entityId, "pt-BR", {
    numeric: true,
  });
}

/** O nome de leitura de um conjunto, um só no produto inteiro. */
export function rotuloDoPar(par: ParDoConjunto): string {
  if (par.cavalo && par.carreta) {
    return `${par.cavalo.placa ?? "sem placa"} + ${par.carreta.placa ?? "sem placa"}`;
  }
  if (par.cavalo) return par.cavalo.placa ?? par.cavalo.entityId;
  return par.carreta?.placa ?? par.id;
}
