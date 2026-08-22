import type { Database } from "@workspace/db";
import { atributoDeclarado, entraNaDRE } from "@workspace/curation/catalogo-declarado";
import { descobertas } from "./descoberta";
import { esperadoDaVigencia, type PresencaNaVigencia } from "./esperado";
import { rosterDasVigencias } from "./frota";
import {
  periodoDe,
  rotuloDaFamilia,
  rotuloDoEquipamento,
  type ColunaDaMatriz,
} from "./matriz";
import {
  medirAtributo,
  ORDEM_DA_CRITICIDADE,
  ORDEM_DO_ESTADO,
  type Criticidade,
  type EstadoDeCobertura,
  type Esperado,
  type Justificativa,
  type MedidaDoAtributo,
  type OrigemDoEsperado,
} from "./modelo";
import {
  atributosObservados,
  vigenciasObservadas,
  type AtributoObservado,
} from "./observado";

/**
 * A linha da matriz, aberta por dentro: atributo × vigência.
 *
 * A matriz responde "onde tem problema"; a célula responde "quanto falta ali".
 * Faltava o degrau entre os dois — **o quê** falta, e desde quando. Quem lê
 * "88,1% · 1 crít." numa célula de Jun/26 e a mesma coisa em Jul e Ago não
 * consegue dizer, olhando a matriz, se é o mesmo atributo faltando há três
 * meses ou três atributos diferentes se revezando; e essas duas situações têm
 * causas e donos diferentes. Esta é a tabela que responde: uma linha por
 * atributo, uma coluna por vigência, e a mesma leitura de relance.
 *
 * **A conta é a mesma da célula, e não uma segunda.** Cada cruzamento sai de
 * `medirAtributo` — a função que `medirCelula` também usa, atributo a atributo,
 * para somar o percentual que a matriz exibe. É isso que garante que a soma das
 * linhas desta tabela seja o número da célula que a abriu: se aqui houvesse uma
 * aritmética própria, a tela teria dois valores para a mesma pergunta, e a
 * regra que este módulo inteiro defende é que exista um.
 *
 * **O que chegou também aparece, e não só o que falta.** A tabela é a união do
 * esperado com o observado. Um atributo que veio para toda a frota não é
 * esperado por nenhuma inferência — a regra estrutural exige presença *abaixo*
 * de 100%, ver `esperado.ts` — e mostrar só o esperado o esconderia justamente
 * na tela feita para dizer o que existe. Ele aparece com `esperado: false`, que
 * é a informação honesta: está aqui, e ninguém o cobra.
 */

/** Um cruzamento atributo × vigência. */
export interface CelulaDoAtributo extends MedidaDoAtributo {
  snapshotId: string;
  effectiveDate: string;
  periodo: string;
  sourceLabel: string;
  /** A criticidade **nesta** vigência: uma decisão de curadoria pode mudá-la. */
  criticidade: Criticidade;
  /** Por que era esperado aqui. `null` quando não era. */
  justificativa: Justificativa | null;
}

/** Um atributo, ao longo da janela. */
export interface LinhaDeAtributo {
  attributeCode: string;
  attributeLabel: string;
  /** O cabeçalho literal da coluna no arquivo. Nunca reescrito. */
  sourceName: string | null;
  entityType: string;
  /**
   * A linha da DRE que este atributo alimenta, quando ele alimenta alguma.
   *
   * Está aqui porque transforma "falta `cavalo.seguro`" em "falta o que
   * alimenta Custos Fixos", que é a diferença entre uma lacuna e uma
   * consequência. Sai do catálogo declarado, nunca de inferência.
   *
   * `null` no cadastral. O catálogo carimba a string "Não entra na DRE" nele, e
   * devolvê-la faria a tela ter de conhecer esse carimbo para não repeti-lo em
   * cem linhas — uma constante do servidor copiada para dentro de um componente
   * React, que é a classe de duplicação que este módulo inteiro existe para não
   * ter. Quem alimenta a DRE tem seção; quem não alimenta não tem.
   */
  secaoDaDRE: string | null;
  /** A pior criticidade que ele teve na janela. */
  criticidade: Criticidade;
  /** A origem mais forte da expectativa na janela. `null`: nunca foi esperado. */
  origem: OrigemDoEsperado | null;
  declarado: boolean;
  /** A frase da vigência mais recente em que ele foi esperado. */
  motivo: string | null;
  /** O pior estado na janela. A ordem das linhas sai daqui. */
  pior: EstadoDeCobertura;
  /** Em quantas vigências da janela ele era esperado. */
  vigenciasEsperado: number;
  /** Em quantas ficou faltando para alguma entidade. */
  vigenciasComFalta: number;
  /** Entidades sem o dado, somadas na janela. */
  entidadesFaltando: number;
  celulas: Record<string, CelulaDoAtributo>;
}

/**
 * A coluna da tabela de atributos: um período, e a vigência que o conjunto teve
 * nele.
 *
 * `snapshotId` é `null` quando o conjunto não veio naquele período — e é o que
 * separa "este atributo não foi cobrado aqui" de "esta vigência não trouxe este
 * conjunto". As duas desenham o mesmo traço na tela, e são coisas diferentes;
 * sem isto, a gaveta não teria como dizer qual das duas ela está abrindo.
 */
export interface ColunaDoConjunto extends ColunaDaMatriz {
  snapshotId: string | null;
  sourceLabel: string | null;
  revision: number | null;
}

export interface MatrizDeAtributos {
  conjunto: {
    datasetFamily: string;
    familiaLabel: string;
    entityType: string;
    equipamentoLabel: string;
    scopeHash: string;
    scopeLabel: string;
    canal: string;
    rotulo: string;
  };
  colunas: ColunaDoConjunto[];
  linhas: LinhaDeAtributo[];
  resumo: {
    atributos: number;
    /** Atributos com alguma falta em alguma vigência da janela. */
    comFalta: number;
    /** Destes, os críticos. */
    criticosComFalta: number;
    /** Esperados em alguma vigência e que nunca apareceram na janela. */
    nuncaChegaram: number;
    /** Chegaram e nenhuma origem os cobra. Não são lacuna, e não são erro. */
    semExpectativa: number;
  };
}

export interface FiltroDosAtributos {
  /** O conjunto — a linha da matriz que está sendo aberta. */
  datasetFamily: string;
  entityType: string;
  scopeHash: string;
  canal: string;
  /**
   * A janela, em número de vigências.
   *
   * Calculada sobre **todas** as vigências ativas, e não sobre as do conjunto,
   * pela mesma regra de `visaoDaCobertura` — que é o que faz as colunas daqui
   * serem exatamente as colunas da matriz que abriu esta tabela. Uma janela
   * calculada só sobre o conjunto puxaria vigências mais antigas para dentro
   * quando ele faltasse numa recente, e as duas tabelas deixariam de se
   * sobrepor justo no mês em que o conjunto não veio.
   */
  vigencias?: number;
}

export async function matrizDeAtributos(
  db: Database,
  filtro: FiltroDosAtributos,
): Promise<MatrizDeAtributos> {
  const conjunto = {
    datasetFamily: filtro.datasetFamily,
    familiaLabel: rotuloDaFamilia(filtro.datasetFamily),
    entityType: filtro.entityType,
    equipamentoLabel: rotuloDoEquipamento(filtro.entityType),
    scopeHash: filtro.scopeHash,
    scopeLabel: filtro.scopeHash.slice(0, 8),
    canal: filtro.canal,
    rotulo: `${rotuloDaFamilia(filtro.datasetFamily)} · ${rotuloDoEquipamento(filtro.entityType)}`,
  };

  const todas = await vigenciasObservadas(db);
  const janela = filtro.vigencias ?? 6;
  const datas = [...new Set(todas.map((v) => v.effectiveDate))].sort();
  const recentes = new Set(datas.slice(-janela));

  const naJanela = todas.filter((v) => recentes.has(v.effectiveDate));
  const doConjunto = naJanela.filter(
    (v) =>
      v.datasetFamily === filtro.datasetFamily &&
      v.scopeHash === filtro.scopeHash &&
      v.canal === filtro.canal,
  );

  const colunas = montarColunas(naJanela, doConjunto);
  if (doConjunto.length === 0) {
    return { conjunto, colunas, linhas: [], resumo: resumoVazio() };
  }
  conjunto.scopeLabel = doConjunto[doConjunto.length - 1]!.scopeLabel;

  const observados = await atributosObservados(
    db,
    doConjunto.map((v) => v.snapshotId),
  );
  const porSnapshot = new Map<string, AtributoObservado[]>();
  for (const o of observados) {
    const lista = porSnapshot.get(o.snapshotId) ?? [];
    lista.push(o);
    porSnapshot.set(o.snapshotId, lista);
  }

  /*
    A estreia vem de `descobertas`, e não de "observado menos esperado".

    É a mesma razão pela qual `medirCelula` recebe `novos` de fora: deduzir aqui
    criaria uma segunda definição de "novo" convivendo com a que a tela lista em
    Descobertas, e duas definições do mesmo rótulo discordam. Um atributo que
    chegou no mês passado e que a inferência ainda não cobra não é novidade
    hoje — ele já era conhecido ontem.
  */
  const estreias = new Map<string, string>();
  for (const d of await descobertas(db, {
    datasetFamily: filtro.datasetFamily,
    scopeHash: filtro.scopeHash,
    canal: filtro.canal,
  })) {
    if (d.entityType === filtro.entityType) {
      estreias.set(d.attributeCode, d.primeiraVigencia);
    }
  }

  const rosters = await rosterDasVigencias(
    db,
    doConjunto,
    new Map(
      doConjunto.map((v) => [
        v.snapshotId,
        new Map(v.equipamentos.map((e) => [e.entityType, e.entidades] as const)),
      ]),
    ),
  );

  const linhas = new Map<string, LinhaDeAtributo>();

  for (const vigencia of doConjunto) {
    const doSnapshot = porSnapshot.get(vigencia.snapshotId) ?? [];
    const entidadesPorTipo = new Map(
      vigencia.equipamentos.map((e) => [e.entityType, e.entidades] as const),
    );
    const presenca: PresencaNaVigencia[] = doSnapshot.map((o) => ({
      attributeCode: o.attributeCode,
      entityType: o.entityType,
      entidadesComAtributo: o.comValor + o.vazias,
    }));
    const roster = rosters.get(vigencia.snapshotId) ?? {
      esperadasPorTipo: entidadesPorTipo,
      ausentes: [],
    };

    const { esperados, dispensados } = await esperadoDaVigencia(
      db,
      vigencia,
      presenca,
      roster.esperadasPorTipo,
    );

    const esperadoPorCodigo = new Map<string, Esperado>(
      esperados
        .filter((e) => e.entityType === filtro.entityType)
        .map((e) => [e.attributeCode, e] as const),
    );
    const observadoPorCodigo = new Map<string, AtributoObservado>(
      doSnapshot
        .filter((o) => o.entityType === filtro.entityType)
        .map((o) => [o.attributeCode, o] as const),
    );

    /*
      A união do esperado com o observado — os dois lados da pergunta.

      Só o esperado esconderia o que chegou sem ser cobrado; só o observado
      esconderia exatamente o que a tela existe para mostrar, que é a coluna
      que não veio. O atributo dispensado entra pelo lado observado quando ele
      chegou assim mesmo, e some quando não chegou: uma dispensa que não
      produziu dado nenhum não tem o que dizer numa tabela de cobertura.
    */
    const codigos = new Set([...esperadoPorCodigo.keys(), ...observadoPorCodigo.keys()]);

    for (const code of codigos) {
      const esperado = esperadoPorCodigo.get(code);
      const observado = observadoPorCodigo.get(code);
      const medida = medirAtributo({
        esperado,
        observado,
        dispensado: dispensados.has(code),
        novo: estreias.get(code) === vigencia.effectiveDate,
      });

      const criticidade = esperado?.criticidade ?? "INFORMATIVO";
      const celula: CelulaDoAtributo = {
        ...medida,
        snapshotId: vigencia.snapshotId,
        effectiveDate: vigencia.effectiveDate,
        periodo: periodoDe(vigencia.effectiveDate),
        sourceLabel: vigencia.sourceLabel,
        criticidade,
        justificativa: esperado?.justificativa ?? null,
      };

      const declarado = atributoDeclarado(code);
      let linha = linhas.get(code);
      if (!linha) {
        linha = {
          attributeCode: code,
          attributeLabel:
            observado?.attributeLabel ??
            declarado?.nomeGerencial ??
            declarado?.sourceName ??
            code,
          sourceName: observado?.sourceName ?? declarado?.sourceName ?? null,
          entityType: filtro.entityType,
          secaoDaDRE: declarado && entraNaDRE(declarado) ? declarado.secaoDaDRE : null,
          criticidade,
          origem: null,
          declarado: false,
          motivo: null,
          pior: medida.estado,
          vigenciasEsperado: 0,
          vigenciasComFalta: 0,
          entidadesFaltando: 0,
          celulas: {},
        };
        linhas.set(code, linha);
      }

      linha.celulas[vigencia.effectiveDate] = celula;
      linha.entidadesFaltando += medida.entidadesFaltando;
      if (medida.esperado) linha.vigenciasEsperado++;
      if (medida.entidadesFaltando > 0) linha.vigenciasComFalta++;
      if (ORDEM_DA_CRITICIDADE[criticidade] < ORDEM_DA_CRITICIDADE[linha.criticidade]) {
        linha.criticidade = criticidade;
      }
      if (ORDEM_DO_ESTADO[medida.estado] < ORDEM_DO_ESTADO[linha.pior]) {
        linha.pior = medida.estado;
      }
      /*
        A explicação é a da vigência mais recente que a produziu, e o laço anda
        do mais antigo para o mais novo — `vigenciasObservadas` já ordena por
        `effective_date`. Guardar a primeira faria a tela explicar uma lacuna de
        agosto com o motivo de junho, que pode ter sido outro.
      */
      if (esperado) {
        linha.origem = esperado.justificativa.origem;
        linha.declarado = esperado.justificativa.declarado;
        linha.motivo = esperado.justificativa.motivo;
      }
      /* O rótulo melhora quando uma vigência mais nova traz um de verdade. */
      if (observado && linha.attributeLabel === code) {
        linha.attributeLabel = observado.attributeLabel;
      }
    }
  }

  const ordenadas = [...linhas.values()].sort(
    (a, b) =>
      ORDEM_DO_ESTADO[a.pior] - ORDEM_DO_ESTADO[b.pior] ||
      ORDEM_DA_CRITICIDADE[a.criticidade] - ORDEM_DA_CRITICIDADE[b.criticidade] ||
      b.entidadesFaltando - a.entidadesFaltando ||
      a.attributeLabel.localeCompare(b.attributeLabel, "pt-BR"),
  );

  return {
    conjunto,
    colunas,
    linhas: ordenadas,
    resumo: {
      atributos: ordenadas.length,
      comFalta: ordenadas.filter((l) => l.vigenciasComFalta > 0).length,
      criticosComFalta: ordenadas.filter(
        (l) => l.vigenciasComFalta > 0 && l.criticidade === "CRITICO",
      ).length,
      nuncaChegaram: ordenadas.filter(
        (l) =>
          l.vigenciasEsperado > 0 &&
          Object.values(l.celulas).every((c) => c.entidadesPresentes === 0),
      ).length,
      semExpectativa: ordenadas.filter((l) => l.vigenciasEsperado === 0).length,
    },
  };
}

/**
 * As colunas, montadas sobre a janela inteira e não sobre o conjunto.
 *
 * Um conjunto que faltou em Jul/26 precisa de uma coluna vazia em Jul/26 — sem
 * ela, a tabela pularia o buraco e mostraria Jun ao lado de Ago como se nada
 * tivesse acontecido. É a mesma regra do histórico do atributo em `detalhe.ts`:
 * a vigência sem dado aparece vazia em vez de sumir.
 */
function montarColunas(
  vigencias: { effectiveDate: string; sourceLabel: string }[],
  doConjunto: { effectiveDate: string; sourceLabel: string; snapshotId: string; revision: number }[],
): ColunaDoConjunto[] {
  const doConjuntoPorData = new Map(doConjunto.map((v) => [v.effectiveDate, v] as const));
  const porData = new Map<string, ColunaDoConjunto>();
  for (const v of vigencias) {
    const atual = porData.get(v.effectiveDate);
    if (atual) {
      if (!atual.rotulos.includes(v.sourceLabel)) atual.rotulos.push(v.sourceLabel);
      continue;
    }
    const dele = doConjuntoPorData.get(v.effectiveDate);
    porData.set(v.effectiveDate, {
      chave: v.effectiveDate,
      effectiveDate: v.effectiveDate,
      periodo: periodoDe(v.effectiveDate),
      rotulos: [v.sourceLabel],
      snapshotId: dele?.snapshotId ?? null,
      sourceLabel: dele?.sourceLabel ?? null,
      revision: dele?.revision ?? null,
    });
  }
  return [...porData.values()].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

function resumoVazio(): MatrizDeAtributos["resumo"] {
  return {
    atributos: 0,
    comFalta: 0,
    criticosComFalta: 0,
    nuncaChegaram: 0,
    semExpectativa: 0,
  };
}
