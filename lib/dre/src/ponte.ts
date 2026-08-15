/**
 * A ponte — **parâmetro → alteração → impacto → linha da DRE → resultado** (§11, §12, §13).
 *
 * É a vantagem que o pedido chama de "a grande vantagem do módulo", e ela só
 * existe porque o motor de comparação já é a autoridade sobre o que mudou:
 * natureza, comparabilidade, versão de semântica dos dois lados, impacto com
 * confiança declarada e rastro até a célula são todos dele. Este arquivo **não
 * recalcula nada disso**. Ele acrescenta a única coisa que faltava: a leitura de
 * DRE — *esta alteração mexeu em qual linha da demonstração, e quanto disso
 * chegou ao resultado?*
 *
 * A disciplina que o arquivo respeita, herdada de `getAlteracoesDoEquipamento` e
 * de docs/ARQUITETURA.md §7: **a decomposição tem de fechar.** O que as
 * alterações não explicam vira `naoAtribuido`, com a lista do que ficou de fora.
 * Uma ponte que não fecha passa confiança falsa, e é pior do que não existir.
 */

import type { Database } from "@workspace/db";
import type { SeriesContext } from "@workspace/comparison";
import { getAlteracoesDoEquipamento, type AlteracaoDoEquipamento } from "@workspace/composition";
import { getDREDoVeiculo, type EscopoApuravel } from "./apuracao";
import {
  normalizarParaCompetencia,
  type CompetenciaDaDRE,
  type Transformacao,
} from "./normalizacao";
import {
  componenteDoAtributo,
  ROTULO_DO_SUBTOTAL,
  type ComponenteDaDRE,
  type EscopoDeAlocacao,
} from "./plano";
import type { ApuracaoDaDRE } from "./motor";

/** Uma alteração já lida pelas regras da DRE. */
export interface AlteracaoNaDRE {
  changeId: number;
  attributeCode: string | null;
  attributeName: string | null;
  entityId: string | null;
  entityLabel: string | null;
  entityType: string | null;
  valorAntes: string | null;
  valorDepois: string | null;
  /** O impacto como o motor de comparação o apurou, na periodicidade dele. */
  impacto: number | null;
  impactoPeriodicidade: string | null;
  impactoConfianca: string;
  impactoMotivo: string | null;
  /** A linha da DRE que este atributo alimenta, quando alimenta alguma. */
  linhaDaDRE: { code: string; titulo: string; secao: string; sinal: 1 | -1 } | null;
  /**
   * O efeito **no resultado**, já na competência da DRE e já com o sinal da
   * linha aplicado. Positivo melhora o resultado; negativo piora.
   *
   * Nulo quando a alteração não toca a DRE, ou quando o impacto não é
   * convertível para a competência — e aí `motivoDaExclusao` diz qual dos dois.
   */
  efeitoNoResultado: number | null;
  transformacao: Transformacao | null;
  motivoDaExclusao: string | null;
}

export interface PonteDaDRE {
  entityId: string;
  escopo: EscopoApuravel;
  competencia: CompetenciaDaDRE;
  de: { effectiveDate: string; periodLabel: string } | null;
  para: { effectiveDate: string; periodLabel: string };
  /** Quantas alterações o motor de comparação achou para esta unidade. */
  alteracoes: AlteracaoNaDRE[];
  /** Só as que mexeram em alguma linha da DRE, da que mais pesa para a que menos. */
  queMexeramNaDRE: AlteracaoNaDRE[];
  /** A soma dos efeitos: o saldo das alterações sobre o resultado. */
  saldo: number | null;
  /** A variação real do resultado entre as duas vigências. */
  variacaoDoResultado: number | null;
  /**
   * O que as alterações **não** explicam da variação.
   *
   * Zero é o caso saudável. Diferente de zero é informação de auditoria — pode
   * ser entrada ou saída de ativo do conjunto, componente que passou a existir,
   * ou alteração cujo impacto o motor recusou monetizar.
   */
  naoAtribuido: number | null;
  /** A ponte agregada por linha da DRE, que é o que a tela desenha. */
  porLinha: {
    code: string;
    titulo: string;
    secao: string;
    efeito: number;
    alteracoes: number;
  }[];
}

/**
 * A ponte de uma unidade econômica entre a vigência escolhida e a anterior.
 *
 * Lê o motor de comparação uma vez por lado — um conjunto tem dois — e junta os
 * resultados. Juntar é legítimo aqui e não é dupla contagem: cavalo e carreta
 * têm atributos disjuntos, e a decomposição do conjunto foi medida como
 * exaustiva e disjunta (ver `docs/DRE-DIAGNOSTICO.md` §A.3).
 */
export async function getPonteDaDRE(
  db: Database,
  entityId: string,
  escopo: EscopoApuravel,
  opcoes: { period?: string; context?: Partial<SeriesContext>; competencia?: CompetenciaDaDRE } = {},
): Promise<PonteDaDRE | null> {
  const competencia = opcoes.competencia ?? "MENSAL";
  const dre = await getDREDoVeiculo(db, entityId, escopo, opcoes);
  if (!dre) return null;

  /*
    Em série, e não em `Promise.all`.

    Os dois lados de um conjunto compartilham o par de vigências, e
    `getAlteracoesDoEquipamento` calcula a comparação quando ela ainda não
    existe. Em paralelo, os dois não encontram nada, os dois calculam, e o
    segundo bate no índice `change_set_pair_uq` — que é o banco fazendo o seu
    trabalho. Serializar é o custo de uma consulta e faz o primeiro lado gravar
    a comparação que o segundo então reaproveita.
  */
  const porLado: Awaited<ReturnType<typeof getAlteracoesDoEquipamento>>[] = [];
  for (const lado of dre.unidade.lados) {
    porLado.push(
      await getAlteracoesDoEquipamento(db, lado.entityId, {
        ...(opcoes.period !== undefined ? { period: opcoes.period } : {}),
        ...(opcoes.context !== undefined ? { context: opcoes.context } : {}),
      }),
    );
  }

  const alteracoes: AlteracaoNaDRE[] = [];
  for (const resultado of porLado) {
    if (!resultado) continue;
    for (const alteracao of resultado.alteracoes) {
      alteracoes.push(
        lerPelaDRE(
          alteracao,
          resultado.entityId,
          dre.unidade.escopo as EscopoDeAlocacao,
          competencia,
        ),
      );
    }
  }

  const queMexeram = alteracoes
    .filter((a) => a.efeitoNoResultado !== null && a.efeitoNoResultado !== 0)
    .sort((a, b) => Math.abs(b.efeitoNoResultado!) - Math.abs(a.efeitoNoResultado!));

  const saldo =
    queMexeram.length === 0
      ? alteracoes.some((a) => a.linhaDaDRE !== null)
        ? 0
        : null
      : Number(queMexeram.reduce((s, a) => s + a.efeitoNoResultado!, 0).toFixed(2));

  const variacao = variacaoDoResultado(dre.atual, dre.anterior);

  const porLinha = new Map<string, { code: string; titulo: string; secao: string; efeito: number; alteracoes: number }>();
  for (const a of queMexeram) {
    const chave = a.linhaDaDRE!.code;
    const atual = porLinha.get(chave) ?? {
      code: chave,
      titulo: a.linhaDaDRE!.titulo,
      secao: a.linhaDaDRE!.secao,
      efeito: 0,
      alteracoes: 0,
    };
    atual.efeito = Number((atual.efeito + a.efeitoNoResultado!).toFixed(2));
    atual.alteracoes += 1;
    porLinha.set(chave, atual);
  }

  return {
    entityId,
    escopo,
    competencia,
    de: dre.vigencias.anterior,
    para: dre.vigencias.alvo,
    alteracoes,
    queMexeramNaDRE: queMexeram,
    saldo,
    variacaoDoResultado: variacao,
    naoAtribuido:
      variacao === null || saldo === null ? null : Number((variacao - saldo).toFixed(2)),
    porLinha: [...porLinha.values()].sort((a, b) => Math.abs(b.efeito) - Math.abs(a.efeito)),
  };
}

/**
 * A leitura de DRE de uma alteração.
 *
 * Três perguntas, nesta ordem — e a ordem é a que explica melhor:
 *
 * 1. **O atributo alimenta alguma linha da DRE deste escopo?** A maioria não:
 *    dos 138 atributos, 10 alimentam. Um chassi que mudou é uma alteração real e
 *    não é uma alteração de resultado.
 * 2. **O motor de comparação monetizou o impacto?** Se ele recusou, a DRE
 *    respeita a recusa — reproduzir o cálculo aqui seria criar a segunda lógica
 *    financeira que §30 proíbe.
 * 3. **O impacto converte para a competência?** Um impacto anual entra dividido
 *    por doze, marcado como projeção; um pontual não entra.
 */
function lerPelaDRE(
  alteracao: AlteracaoDoEquipamento,
  entityIdDoLado: string,
  escopo: EscopoDeAlocacao,
  competencia: CompetenciaDaDRE,
): AlteracaoNaDRE {
  const base = {
    changeId: alteracao.id,
    attributeCode: alteracao.attributeCode,
    attributeName: alteracao.attributeName,
    /* O motor de comparação denormaliza a entidade pelo rótulo, não pelo id.
       Quem sabe de que lado a alteração veio é quem a pediu. */
    entityId: entityIdDoLado,
    entityLabel: alteracao.entityLabel,
    entityType: alteracao.entityType,
    valorAntes: alteracao.valueBefore,
    valorDepois: alteracao.valueAfter,
    impacto: alteracao.impactAmount,
    impactoPeriodicidade: alteracao.impactPeriodicity,
    impactoConfianca: alteracao.impactConfidence,
    impactoMotivo: alteracao.impactReason,
  };

  const componente: ComponenteDaDRE | null = alteracao.attributeCode
    ? componenteDoAtributo(escopo, alteracao.attributeCode)
    : null;

  if (!componente) {
    return {
      ...base,
      linhaDaDRE: null,
      efeitoNoResultado: null,
      transformacao: null,
      motivoDaExclusao:
        "Este atributo não alimenta nenhuma linha da DRE neste escopo — a alteração " +
        "é real e não mexe no resultado apurado.",
    };
  }

  const linhaDaDRE = {
    code: componente.code,
    titulo: componente.titulo,
    secao: componente.secao,
    sinal: componente.sinal,
  };

  if (alteracao.impactAmount === null || alteracao.impactConfidence !== "CALCULATED") {
    return {
      ...base,
      linhaDaDRE,
      efeitoNoResultado: null,
      transformacao: null,
      motivoDaExclusao:
        alteracao.impactReason ??
        "O motor de comparação não monetizou esta alteração, e a DRE não a monetiza por conta própria.",
    };
  }

  const normalizado = normalizarParaCompetencia(
    alteracao.impactAmount,
    alteracao.impactPeriodicity,
    competencia,
  );
  if (!normalizado.ok) {
    return {
      ...base,
      linhaDaDRE,
      efeitoNoResultado: null,
      transformacao: null,
      motivoDaExclusao: normalizado.explicacao,
    };
  }

  return {
    ...base,
    linhaDaDRE,
    /*
      O sinal da linha aplicado ao impacto. Um custo que **subiu** R$ 100 tem
      impacto +100 no motor de comparação (o valor cresceu) e efeito −100 no
      resultado, porque a linha é negativa. Trocar os dois é o erro que faria a
      ponte somar ao contrário e ainda assim parecer plausível.
    */
    efeitoNoResultado: Number((normalizado.valor * componente.sinal).toFixed(2)),
    transformacao: normalizado.transformacao,
    motivoDaExclusao: null,
  };
}

function variacaoDoResultado(
  atual: ApuracaoDaDRE,
  anterior: ApuracaoDaDRE | null,
): number | null {
  if (!anterior) return null;
  const agora = atual.subtotais.find((s) => s.id === "RESULTADO_ECONOMICO")!.valorParcial;
  const antes = anterior.subtotais.find((s) => s.id === "RESULTADO_ECONOMICO")!.valorParcial;
  if (agora === null || antes === null) return null;
  return Number((agora - antes).toFixed(2));
}

// ---------------------------------------------------------------------------
// A explicação derivada (§13)
// ---------------------------------------------------------------------------

export interface ExplicacaoDoResultado {
  /** A frase de abertura, montada do número. */
  resumo: string;
  /** Os responsáveis, do que mais pesa para o que menos. */
  responsaveis: { titulo: string; efeito: number; frase: string }[];
  /** O que a decomposição não explicou, quando não explicou tudo. */
  ressalva: string | null;
}

/**
 * A explicação de por que o resultado mudou, **derivada dos dados**.
 *
 * Nenhuma frase aqui existe antes do número que a sustenta: a função monta o
 * texto a partir da ponte, e devolve `null` quando não há ponte. É a exigência
 * de §13 — "não gerar explicações sem evidência" — cumprida por construção, e
 * não por disciplina de quem escreve o prompt.
 */
export function explicarResultado(ponte: PonteDaDRE): ExplicacaoDoResultado | null {
  if (ponte.variacaoDoResultado === null || ponte.de === null) return null;

  const variacao = ponte.variacaoDoResultado;
  const direcao = variacao < 0 ? "caiu" : variacao > 0 ? "subiu" : "não mudou";
  const rotulo = ROTULO_DO_SUBTOTAL.RESULTADO_ECONOMICO.toLowerCase();

  if (ponte.porLinha.length === 0) {
    return {
      resumo:
        variacao === 0
          ? `O ${rotulo} não mudou entre ${ponte.de.periodLabel} e ${ponte.para.periodLabel}.`
          : `O ${rotulo} ${direcao} ${brl(Math.abs(variacao))} entre ${ponte.de.periodLabel} e ` +
            `${ponte.para.periodLabel}, e nenhuma alteração de parâmetro explica a variação.`,
      responsaveis: [],
      ressalva:
        variacao === 0
          ? null
          : "A variação veio de entrada, saída ou mudança de composição do conjunto, e não " +
            "de alteração em parâmetro já existente.",
    };
  }

  /* Os que empurram no mesmo sentido da variação vêm primeiro: são a causa. */
  const sentido = variacao < 0 ? -1 : 1;
  const causas = ponte.porLinha.filter((l) => Math.sign(l.efeito) === sentido);
  const compensacoes = ponte.porLinha.filter((l) => Math.sign(l.efeito) === -sentido);

  const responsaveis = [
    ...causas.map((l) => ({
      titulo: l.titulo,
      efeito: l.efeito,
      frase: `${l.titulo}: ${brl(l.efeito)}`,
    })),
    ...compensacoes.map((l) => ({
      titulo: l.titulo,
      efeito: l.efeito,
      frase: `${l.titulo} compensou parcialmente: ${brl(l.efeito)}`,
    })),
  ];

  return {
    resumo:
      `O ${rotulo} deste ${escopoPorExtenso(ponte.escopo)} ${direcao} ${brl(Math.abs(variacao))} ` +
      `em relação a ${ponte.de.periodLabel}.`,
    responsaveis,
    ressalva:
      ponte.naoAtribuido === null || Math.abs(ponte.naoAtribuido) < 0.01
        ? null
        : `${brl(Math.abs(ponte.naoAtribuido))} da variação não foram atribuídos a ` +
          `nenhuma alteração de parâmetro — pode ser entrada ou saída de ativo, ou ` +
          `alteração cujo impacto não pôde ser monetizado.`,
  };
}

function escopoPorExtenso(escopo: EscopoApuravel): string {
  return escopo === "CAVALO" ? "cavalo" : escopo === "CARRETA" ? "implemento" : "conjunto";
}

function brl(valor: number): string {
  const sinal = valor < 0 ? "−" : valor > 0 ? "+" : "";
  return `${sinal}R$ ${Math.abs(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
