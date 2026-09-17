/**
 * A CONCILIAÇÃO TEMPORAL — como uma competência mensal se liga às vigências.
 *
 * ---------------------------------------------------------------------------
 * O problema, dito por inteiro
 * ---------------------------------------------------------------------------
 * O realizado existe por **mês**. O remunerado existe por **vigência**, e o
 * acervo entrega duas vigências no mesmo mês — as quinzenas. Confrontar os dois
 * exige responder uma pergunta que nenhuma das duas fontes responde sozinha:
 * *qual é o remunerado de setembro/2026, quando setembro tem duas entregas?*
 *
 * Havia três respostas plausíveis, e duas delas estão erradas:
 *
 * 1. **Somar as duas quinzenas.** Errada, e a evidência está no acervo.
 * 2. **Usar uma vigência mensal consolidada já existente.** Não existe: o
 *    acervo não tem esse artefato. Ver `snapshot`, em `lib/db/src/schema`.
 * 3. **Comparar quinzena a quinzena.** Só valeria se o realizado tivesse
 *    divisão quinzenal confiável, e ele não tem — é mensal.
 *
 * ---------------------------------------------------------------------------
 * Por que somar as duas quinzenas conta o dinheiro duas vezes
 * ---------------------------------------------------------------------------
 * Porque **a parcela FINAME é mensal**, e não quinzenal. Isso não é suposição:
 * está medido em `docs/AUDITORIA-PERIODICIDADE.md`, por duas cadeias
 * independentes.
 *
 * - `custo_fixo = finame + lucroFixomodeloNovoCiclo` fecha em 611 de 657 linhas
 *   das 9 vigências. Uma soma não muda de periodicidade no meio: se o total é
 *   mensal, a parcela é mensal.
 * - A aritmética do financiamento confirma: `amortizacao ÷ (valorNF × (1 −
 *   entrada) ÷ prazoEmMeses)` dá razão média 1,08–1,11 — compatível com
 *   amortização **mensal** e com o prazo em meses. Lida como quinzenal ou
 *   anual, a conta erra por um fator inteiro.
 * - `cavalo.finame_cavalo`, `carreta.finame_implemento` e as parcelas delas
 *   estão na tabela de periodicidade daquele documento como **MENSAL**.
 *
 * Então a vigência da 1ª quinzena de setembro **não** diz "metade de setembro":
 * ela diz "a parcela mensal deste veículo, como ela está valendo agora". A da
 * 2ª quinzena diz a mesma coisa, medida quinze dias depois. Somá-las diria que
 * o veículo custou duas parcelas em setembro — e um confronto contra o
 * realizado apareceria como um déficit de 100% que nunca existiu.
 *
 * ---------------------------------------------------------------------------
 * A regra, então
 * ---------------------------------------------------------------------------
 * **O remunerado de uma competência é a parcela mensal vigente naquele mês, por
 * placa — e nunca uma soma.**
 *
 * Quando as vigências do mês dizem o mesmo valor para a placa, esse é o valor
 * do mês, e o mês está consolidado. Quando dizem valores diferentes, o
 * financiamento daquele veículo mudou no meio do mês, e **não há um número só**
 * que represente o mês: a placa sai como {@link SituacaoDoConsolidado}
 * `DIVERGENCIA_INTRAMENSAL`, com os dois valores à mão, e fica fora de todo
 * total. Escolher uma das duas caladamente — a última, a maior, a média —
 * responderia com precisão inventada a uma pergunta que o dado não responde.
 *
 * O mesmo vale para a placa que aparece numa quinzena e não na outra: o mês
 * dela não é um mês inteiro, e confrontá-lo com um realizado mensal compararia
 * intervalos econômicos diferentes. Sai como `COBERTURA_PARCIAL`.
 *
 * As duas situações são **informadas**, nunca escondidas: é o que alimenta o
 * "6 placas sem correspondência" da tela.
 */

/** Uma competência mensal, escrita `YYYY-MM`. Ordenável como texto. */
export type Competencia = string;

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** Se o texto é uma competência bem formada. Não diz que ela existe no acervo. */
export function ehCompetencia(valor: unknown): valor is Competencia {
  if (typeof valor !== "string") return false;
  const m = /^(\d{4})-(\d{2})$/.exec(valor);
  if (!m) return false;
  const mes = Number(m[2]);
  return mes >= 1 && mes <= 12;
}

/**
 * A competência de uma data de vigência — `2026-09-16` → `2026-09`.
 *
 * Devolve `null` para o que não é data: uma competência derivada de lixo seria
 * um mês que não existe, e um mês que não existe agrega valores de verdade.
 */
export function competenciaDe(effectiveDate: string | null | undefined): Competencia | null {
  if (typeof effectiveDate !== "string") return null;
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(effectiveDate);
  if (!m) return null;
  const competencia = `${m[1]}-${m[2]}`;
  return ehCompetencia(competencia) ? competencia : null;
}

/**
 * A competência como quem fala dela — `setembro/2026`.
 *
 * Uma função só, pela razão de `rotulosDasVigencias`: duas funções montando o
 * mesmo nome dariam "setembro/2026" numa tela e "09/2026" na outra, e a mesma
 * competência pareceria duas.
 */
export function rotuloDaCompetencia(competencia: Competencia): string {
  const m = /^(\d{4})-(\d{2})$/.exec(competencia);
  if (!m) return competencia;
  return `${MESES[Number(m[2]) - 1]}/${m[1]}`;
}

/** As competências que um conjunto de datas cobre, da mais antiga para a mais nova. */
export function competenciasDasDatas(datas: readonly string[]): Competencia[] {
  const vistas = new Set<Competencia>();
  for (const d of datas) {
    const c = competenciaDe(d);
    if (c) vistas.add(c);
  }
  return [...vistas].sort();
}

// ---------------------------------------------------------------------------
// A consolidação mensal do remunerado
// ---------------------------------------------------------------------------

/**
 * O que a consolidação pôde afirmar sobre a placa naquele mês.
 *
 * Os quatro estados são disjuntos e nenhum deles é "zero": é a mesma doutrina
 * de `fact.is_null` — ausência não é zero, e uma situação que colapsasse as
 * quatro num número faria a tela escrever R$ 0,00 sobre quatro realidades
 * diferentes.
 */
export type SituacaoDoConsolidado =
  /** As vigências do mês concordam. Há um valor mensal, e ele vale. */
  | "CONSOLIDADO"
  /** Elas discordam: o financiamento mudou no meio do mês. Não há valor único. */
  | "DIVERGENCIA_INTRAMENSAL"
  /** A placa está em parte do mês apenas — entrou ou saiu no meio. */
  | "COBERTURA_PARCIAL"
  /** A placa está nas vigências do mês, e a parcela não foi informada em nenhuma. */
  | "SEM_VALOR";

/** Uma leitura de parcela numa vigência, como a consolidação a recebe. */
export interface ParcelaNaVigencia {
  /** `2026-09-16` — a data da vigência que sustenta esta leitura. */
  effectiveDate: string;
  /** A placa. É por ela que o realizado concilia. */
  entityLabel: string;
  entityType: string;
  /**
   * A parcela mensal, ou `null` quando a vigência não a informou.
   *
   * `0` e `null` são **coisas diferentes** e chegam diferentes: zero é um zero
   * econômico (o implemento alugado tem amortização zero), `null` é ausência.
   */
  valor: number | null;
}

/** O remunerado mensal de uma placa, com o que a consolidação pôde afirmar. */
export interface RemuneradoDaCompetencia {
  competencia: Competencia;
  entityLabel: string;
  entityType: string;
  /** O valor mensal — `null` sempre que `situacao !== "CONSOLIDADO"`. */
  valor: number | null;
  situacao: SituacaoDoConsolidado;
  /** As datas de vigência do mês em que esta placa apareceu. */
  vigencias: string[];
  /**
   * Os valores distintos encontrados, quando divergem.
   *
   * Vazio fora de `DIVERGENCIA_INTRAMENSAL`. Existe para a tela poder dizer
   * *quais* são os dois números em vez de só afirmar que discordam — um aviso
   * que não mostra a evidência manda quem audita reabrir a planilha.
   */
  valoresDivergentes: number[];
}

/**
 * Meio centavo. Abaixo disto, dois valores são o mesmo valor.
 *
 * Não é frouxidão: `fact.value_numeric` é `numeric(18,6)` e chega aqui como
 * `number`, e a conversão de duas vigências pode diferir na sexta casa sem que
 * nada tenha mudado. A tolerância é **menor que a menor unidade monetária**, de
 * modo que ela nunca esconde uma divergência de dinheiro — só o ruído do tipo.
 */
export const TOLERANCIA_DO_CENTAVO = 0.005;

/**
 * O remunerado mensal de cada placa, a partir das vigências do mês.
 *
 * `vigenciasDoMes` são **todas** as datas de vigência que o mês tem no acervo —
 * e não só aquelas em que a placa apareceu. É o que permite distinguir "a placa
 * está no mês inteiro" de "a placa está em metade dele": sem a lista completa,
 * uma placa presente numa única entrega de um mês de duas pareceria consolidada.
 */
export function consolidarCompetencia(entrada: {
  competencia: Competencia;
  vigenciasDoMes: readonly string[];
  parcelas: readonly ParcelaNaVigencia[];
}): RemuneradoDaCompetencia[] {
  const { competencia, parcelas } = entrada;
  const doMes = [...new Set(entrada.vigenciasDoMes)].sort();

  /* Uma gaveta por (placa, tipo): a identidade do ativo dentro do mês. */
  const porVeiculo = new Map<string, ParcelaNaVigencia[]>();
  for (const p of parcelas) {
    if (competenciaDe(p.effectiveDate) !== competencia) continue;
    const chave = `${p.entityLabel}${p.entityType}`;
    const lista = porVeiculo.get(chave) ?? [];
    lista.push(p);
    porVeiculo.set(chave, lista);
  }

  const consolidado: RemuneradoDaCompetencia[] = [];
  for (const [chave, leituras] of porVeiculo) {
    const [entityLabel, entityType] = chave.split("");
    const vigencias = [...new Set(leituras.map((l) => l.effectiveDate))].sort();

    const base = {
      competencia,
      entityLabel,
      entityType,
      vigencias,
      valoresDivergentes: [] as number[],
    };

    /*
      A cobertura vem antes do valor, e de propósito.

      Uma placa que só existe na 1ª quinzena pode ter valor perfeitamente
      legível — e ainda assim o mês dela não é um mês. Perguntar o valor
      primeiro produziria um número consolidado sobre meio intervalo econômico,
      que é exatamente o que a comparação contra um realizado mensal não pode
      receber.
    */
    if (vigencias.length < doMes.length) {
      consolidado.push({ ...base, valor: null, situacao: "COBERTURA_PARCIAL" });
      continue;
    }

    const informados = leituras
      .map((l) => l.valor)
      .filter((v): v is number => v !== null && Number.isFinite(v));

    if (informados.length === 0) {
      consolidado.push({ ...base, valor: null, situacao: "SEM_VALOR" });
      continue;
    }

    /*
      Informado em uma entrega e ausente na outra é divergência, não valor.

      É o caso mais fácil de errar para o lado errado: a tentação é usar "o que
      existe". Mas uma quinzena que não informa a parcela não está dizendo que
      ela é a mesma — está dizendo que não disse. Tomar o valor da outra
      afirmaria continuidade que ninguém declarou.
    */
    if (informados.length !== leituras.length) {
      consolidado.push({
        ...base,
        valor: null,
        situacao: "DIVERGENCIA_INTRAMENSAL",
        valoresDivergentes: distintos(informados),
      });
      continue;
    }

    const valores = distintos(informados);
    if (valores.length > 1) {
      consolidado.push({
        ...base,
        valor: null,
        situacao: "DIVERGENCIA_INTRAMENSAL",
        valoresDivergentes: valores,
      });
      continue;
    }

    /*
      Concordam: o valor do mês é a parcela mensal — **uma** delas, não a soma.
      É aqui que a regra deste arquivo se cumpre, e é a linha que o teste
      `nao-soma-quinzenas` amarra.
    */
    consolidado.push({ ...base, valor: valores[0], situacao: "CONSOLIDADO" });
  }

  return consolidado.sort(
    (a, b) =>
      a.entityType.localeCompare(b.entityType) || a.entityLabel.localeCompare(b.entityLabel),
  );
}

/** Os valores distintos de uma lista, ao centavo, na ordem em que apareceram. */
function distintos(valores: readonly number[]): number[] {
  const saida: number[] = [];
  for (const v of valores) {
    if (!saida.some((j) => Math.abs(j - v) < TOLERANCIA_DO_CENTAVO)) saida.push(v);
  }
  return saida;
}
