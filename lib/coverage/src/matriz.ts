import type { Database } from "@workspace/db";
import { esperadoDaVigencia, type PresencaNaVigencia } from "./esperado";
import { descobertas, type Descoberta } from "./descoberta";
import {
  atributosObservados,
  vigenciasObservadas,
  type AtributoObservado,
  type VigenciaObservada,
} from "./observado";
import {
  classificar,
  contar,
  ORDEM_DA_CRITICIDADE,
  ORDEM_DO_ESTADO,
  type Contagem,
  type Criticidade,
  type EstadoDeCobertura,
  type Esperado,
  type Lacuna,
} from "./modelo";

/**
 * A autoridade única da cobertura.
 *
 * Todo número que a tela mostra sai daqui, e sai de uma passagem só. Não há
 * neste módulo dois caminhos para a mesma pergunta: o resumo é a soma das
 * células, a célula é a soma dos atributos, e o atributo é a comparação entre o
 * esperado e o observado. Uma rota que quisesse "o percentual geral" e
 * calculasse à parte teria a chance de discordar — e é assim que um produto
 * acaba mostrando 96,8% no topo e 94% embaixo, na mesma tela, sem que nenhum
 * dos dois esteja errado no seu próprio termo.
 *
 * **O eixo da matriz.** Linha é (família · equipamento), coluna é vigência. A
 * escolha não é estética: família e equipamento são as duas dimensões em que
 * uma entrega chega ou não chega inteira — o export real entrega
 * `REMUNERACAO_EQUIPAMENTO · CARRETA` e `REMUNERACAO_EQUIPAMENTO · CAVALO` em
 * arquivos separados, e é exatamente aí que uma metade pode faltar sem que a
 * outra denuncie.
 *
 * **Por que o percentual é de combinações e não de atributos.** Contar
 * atributos diria 100% quando uma coluna chegou para um único veículo dos 144.
 * Contar entidades diria 100% quando todos os veículos vieram com metade das
 * colunas. Só entidades × atributos responde "quanto do universo esperado nós
 * temos", que é a pergunta do módulo.
 */

export interface CelulaDaMatriz {
  vigencia: {
    snapshotId: string;
    effectiveDate: string;
    sourceLabel: string;
    periodo: string;
    revision: number;
  };
  datasetFamily: string;
  entityType: string;
  scopeHash: string;
  scopeLabel: string;
  canal: string;
  estado: EstadoDeCobertura;
  conta: Contagem;
  /** A mesma conta, restrita ao que é crítico. */
  contaCritica: Contagem;
  /** Quantas lacunas, por criticidade. A lista fica no drill-down. */
  lacunas: { critico: number; relevante: number; informativo: number };
  novos: number;
}

export interface LinhaDaMatriz {
  chave: string;
  datasetFamily: string;
  entityType: string;
  scopeHash: string;
  scopeLabel: string;
  canal: string;
  rotulo: string;
  celulas: Record<string, CelulaDaMatriz>;
}

export interface ColunaDaMatriz {
  chave: string;
  effectiveDate: string;
  periodo: string;
  rotulos: string[];
}

export interface ResumoDaCobertura {
  /** Cobertura geral: todas as combinações esperadas contra as encontradas. */
  geral: Contagem;
  /** A mesma conta, restrita aos atributos críticos. */
  critica: Contagem;
  lacunas: { total: number; critico: number; relevante: number; informativo: number };
  conjuntosParciais: number;
  conjuntosAusentes: number;
  novos: number;
  /** O veredito em uma frase, para o topo da tela. */
  veredito: {
    estado: "CONFIAVEL" | "COMPROMETIDA" | "SEM_DADO";
    frase: string;
  };
}

export interface VisaoDaCobertura {
  resumo: ResumoDaCobertura;
  colunas: ColunaDaMatriz[];
  linhas: LinhaDaMatriz[];
  /** As piores lacunas, já ordenadas. A tela mostra exceção, não inventário. */
  lacunas: (Lacuna & {
    snapshotId: string;
    effectiveDate: string;
    periodo: string;
    datasetFamily: string;
    scopeLabel: string;
  })[];
  descobertas: Descoberta[];
  /**
   * O que a medição não alcançou.
   *
   * Vazio no caso normal. Uma vigência sem agregado — um banco cuja `0020`
   * ainda não rodou o backfill, por exemplo — entra aqui em vez de entrar na
   * conta como zero: uma cobertura que ignora o que não conseguiu medir é
   * otimista, e otimismo aqui manda parar de procurar dado que existe.
   */
  incompleto: { vigencia: string; motivo: string }[];
}

/** Mai/26 — o rótulo curto que a matriz usa como cabeçalho de coluna. */
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function periodoDe(effectiveDate: string): string {
  const [ano, mes] = effectiveDate.split("-");
  const nome = MESES[Number(mes) - 1] ?? mes;
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)}/${ano!.slice(2)}`;
}

export interface FiltroDaCobertura {
  datasetFamily?: string;
  scopeHash?: string;
  canal?: string | null;
  entityType?: string;
  /** Só as N vigências mais recentes. A matriz não é um arquivo histórico. */
  vigencias?: number;
  /** Só lacunas desta criticidade ou pior. */
  criticidadeMinima?: Criticidade;
  /** Quantas lacunas devolver. A tela mostra exceções. */
  limiteDeLacunas?: number;
}

/**
 * A visão inteira da cobertura, montada numa passagem.
 *
 * O custo é dominado por duas consultas — `vigenciasObservadas` e
 * `atributosObservados` — que leem tabelas cujo tamanho é (vigências) e
 * (vigências × colunas), e por uma consulta de histórico por vigência sobre a
 * segunda. Nenhuma delas toca a fact table, exceto a subconsulta do não
 * aplicável, que roda por índice parcial. É isso que torna a tela abrível com a
 * fact table em milhões de linhas.
 */
export async function visaoDaCobertura(
  db: Database,
  filtro: FiltroDaCobertura = {},
): Promise<VisaoDaCobertura> {
  const todas = await vigenciasObservadas(db, {
    datasetFamily: filtro.datasetFamily,
    scopeHash: filtro.scopeHash,
    canal: filtro.canal,
  });

  const janela = filtro.vigencias ?? 6;
  const datas = [...new Set(todas.map((v) => v.effectiveDate))].sort();
  const recentes = new Set(datas.slice(-janela));
  const vigencias = todas.filter((v) => recentes.has(v.effectiveDate));

  if (vigencias.length === 0) {
    return {
      resumo: resumoVazio(),
      colunas: [],
      linhas: [],
      lacunas: [],
      descobertas: [],
      incompleto: [],
    };
  }

  const observados = await atributosObservados(
    db,
    vigencias.map((v) => v.snapshotId),
  );
  const porSnapshot = new Map<string, AtributoObservado[]>();
  for (const o of observados) {
    const lista = porSnapshot.get(o.snapshotId) ?? [];
    lista.push(o);
    porSnapshot.set(o.snapshotId, lista);
  }

  /*
    Descoberta é por recorte, e vem **antes** da medição.

    Por recorte porque um atributo que a unidade A passou a entregar em março
    não é novidade da unidade B, que nunca o teve — sem isso, a cobertura de B
    ficava azul por causa de um dado que não é dela. Antes da medição porque é
    daqui que sai o `novos` de cada célula: a matriz e a lista de novidades
    passam a ter uma definição só de "novo", em vez de duas que podem divergir.

    O custo é uma consulta por recorte sobre `snapshot_attribute` — a tabela
    pequena —, e não sobre `fact`.
  */
  const recortes = new Map<string, { datasetFamily: string; scopeHash: string; canal: string }>();
  for (const v of vigencias) {
    recortes.set(`${v.datasetFamily}|${v.scopeHash}|${v.canal}`, {
      datasetFamily: v.datasetFamily,
      scopeHash: v.scopeHash,
      canal: v.canal,
    });
  }

  const achados: Descoberta[] = [];
  const novosPorCelula = new Map<string, number>();
  for (const recorte of recortes.values()) {
    const doRecorte = await descobertas(db, recorte);
    achados.push(...doRecorte);
    for (const d of doRecorte) {
      const chave = `${recorte.scopeHash}|${recorte.canal}|${d.entityType}|${d.primeiraVigencia}`;
      novosPorCelula.set(chave, (novosPorCelula.get(chave) ?? 0) + 1);
    }
  }

  const incompleto: VisaoDaCobertura["incompleto"] = [];
  const celulas: CelulaDaMatriz[] = [];
  const lacunas: VisaoDaCobertura["lacunas"] = [];

  for (const vigencia of vigencias) {
    if (vigencia.equipamentos.length === 0) {
      incompleto.push({
        vigencia: vigencia.sourceLabel,
        motivo:
          "A vigência não tem agregado de cobertura gravado. O que ela traz não está contado como presente — é piso, não retrato.",
      });
      continue;
    }

    const doSnapshot = porSnapshot.get(vigencia.snapshotId) ?? [];
    const entidadesPorTipo = new Map(
      vigencia.equipamentos.map((e) => [e.entityType, e.entidades] as const),
    );
    const presenca: PresencaNaVigencia[] = doSnapshot.map((o) => ({
      attributeCode: o.attributeCode,
      entityType: o.entityType,
      entidadesComAtributo: o.comValor + o.vazias,
    }));

    const { esperados, dispensados } = await esperadoDaVigencia(
      db,
      vigencia,
      presenca,
      entidadesPorTipo,
    );

    for (const equipamento of vigencia.equipamentos) {
      if (filtro.entityType && equipamento.entityType !== filtro.entityType) continue;

      const resultado = medirCelula({
        esperados: esperados.filter((e) => e.entityType === equipamento.entityType),
        observados: doSnapshot.filter((o) => o.entityType === equipamento.entityType),
        dispensados,
        entidadesNaVigencia: equipamento.entidades,
        novos:
          novosPorCelula.get(
            `${vigencia.scopeHash}|${vigencia.canal}|${equipamento.entityType}|${vigencia.effectiveDate}`,
          ) ?? 0,
      });

      celulas.push({
        vigencia: {
          snapshotId: vigencia.snapshotId,
          effectiveDate: vigencia.effectiveDate,
          sourceLabel: vigencia.sourceLabel,
          periodo: periodoDe(vigencia.effectiveDate),
          revision: vigencia.revision,
        },
        datasetFamily: vigencia.datasetFamily,
        entityType: equipamento.entityType,
        scopeHash: vigencia.scopeHash,
        scopeLabel: vigencia.scopeLabel,
        canal: vigencia.canal,
        estado: resultado.estado,
        conta: resultado.conta,
        contaCritica: resultado.contaCritica,
        lacunas: resultado.contagemDeLacunas,
        novos: resultado.novos,
      });

      for (const lacuna of resultado.lacunas) {
        lacunas.push({
          ...lacuna,
          snapshotId: vigencia.snapshotId,
          effectiveDate: vigencia.effectiveDate,
          periodo: periodoDe(vigencia.effectiveDate),
          datasetFamily: vigencia.datasetFamily,
          scopeLabel: vigencia.scopeLabel,
        });
      }
    }
  }

  const minima = ORDEM_DA_CRITICIDADE[filtro.criticidadeMinima ?? "INFORMATIVO"];
  const lacunasFiltradas = lacunas
    .filter((l) => ORDEM_DA_CRITICIDADE[l.criticidade] <= minima)
    .sort(
      (a, b) =>
        ORDEM_DA_CRITICIDADE[a.criticidade] - ORDEM_DA_CRITICIDADE[b.criticidade] ||
        b.entidadesFaltando - a.entidadesFaltando ||
        a.attributeCode.localeCompare(b.attributeCode),
    );

  return {
    resumo: resumir(celulas, lacunas, achados.length),
    colunas: montarColunas(vigencias),
    linhas: montarLinhas(celulas),
    lacunas: lacunasFiltradas.slice(0, filtro.limiteDeLacunas ?? 50),
    descobertas: achados.sort(
      (a, b) =>
        (b.possivelSucessaoDe?.confianca ?? 0) - (a.possivelSucessaoDe?.confianca ?? 0) ||
        a.attributeCode.localeCompare(b.attributeCode),
    ),
    incompleto,
  };
}

/**
 * A conta de uma célula: um equipamento, numa vigência.
 *
 * Puro. Recebe o esperado, o observado e as dispensas e devolve a conta, o
 * estado e as lacunas. Os testes de "não aplicável não reduz cobertura",
 * "atributo esperado ausente vira lacuna" e "campo não crítico não bloqueia
 * análise" exercitam esta função sem banco.
 */
export function medirCelula(entrada: {
  esperados: Esperado[];
  observados: AtributoObservado[];
  dispensados: Set<string>;
  entidadesNaVigencia: number;
  /**
   * Quantos atributos **estrearam** nesta vigência, vindo de `descobertas`.
   *
   * Entra como parâmetro em vez de ser deduzido de "observado menos esperado",
   * e a diferença tem consequência. Um atributo que chegou na vigência passada
   * e que a inferência ainda não considera esperado — porque uma aparição só
   * não faz série — não é novo hoje: ele já era conhecido ontem. Deduzir aqui
   * fazia toda vigência posterior a uma novidade continuar marcada como NOVO
   * até a inferência alcançá-la, e o rótulo perdia o significado.
   *
   * Deduzir também criaria uma segunda definição de "novo" convivendo com a de
   * `descobertas` — que é a que a tela lista. Duas definições do mesmo rótulo
   * discordam, e o dia em que discordassem a matriz mostraria uma célula azul
   * com a seção de novidades vazia.
   */
  novos?: number;
}): {
  conta: Contagem;
  contaCritica: Contagem;
  estado: EstadoDeCobertura;
  lacunas: Lacuna[];
  contagemDeLacunas: { critico: number; relevante: number; informativo: number };
  novos: number;
} {
  const porCodigo = new Map(entrada.observados.map((o) => [o.attributeCode, o]));

  let combinacoesEsperadas = 0;
  let combinacoesEncontradas = 0;
  let combinacoesNaoAplicaveis = 0;
  let atributosEncontrados = 0;
  let criticasEsperadas = 0;
  let criticasEncontradas = 0;
  let criticasNaoAplicaveis = 0;
  let atributosCriticos = 0;
  let atributosCriticosEncontrados = 0;
  const lacunas: Lacuna[] = [];

  for (const esperado of entrada.esperados) {
    if (entrada.dispensados.has(esperado.attributeCode)) continue;

    const observado = porCodigo.get(esperado.attributeCode);
    const presentesBrutos = observado?.comValor ?? 0;
    /*
      A expectativa sobe quando a realidade a supera, e nunca desce.

      O esperado inferido do histórico é um **piso**: "veio para 100 carretas
      nas vigências anteriores". Se a vigência de hoje traz 144, não faltou
      nada — o universo cresceu. Sem este `max`, o numerador passava o
      denominador e a célula exibia 144% de cobertura, que é o tipo de número
      que faz o leitor deixar de acreditar na tela inteira. Foi um teste do
      cenário de arquivos complementares que o encontrou.

      Para uma expectativa declarada por contrato isto é inócuo: lá o esperado
      já é o total de entidades do equipamento, e nada pode superá-lo.
    */
    const esperadas = Math.max(
      esperado.entidadesEsperadas,
      presentesBrutos + (observado?.naoAplicaveis ?? 0),
    );
    /*
      O não aplicável sai dos dois lados da fração. Deixá-lo no denominador
      faria uma dispensa legítima derrubar o percentual; tirá-lo só do
      numerador faria o contrário. A única forma de ele não mexer no resultado é
      sair de ambos — que é o que "não aplicável" quer dizer.
    */
    const naoAplicaveis = observado?.naoAplicaveis ?? 0;
    const presentes = presentesBrutos;
    const faltando = Math.max(0, esperadas - presentes - naoAplicaveis);

    combinacoesEsperadas += esperadas;
    combinacoesEncontradas += presentes;
    combinacoesNaoAplicaveis += naoAplicaveis;
    if (presentes > 0) atributosEncontrados++;

    const critico = esperado.criticidade === "CRITICO";
    if (critico) {
      atributosCriticos++;
      criticasEsperadas += esperadas;
      criticasEncontradas += presentes;
      criticasNaoAplicaveis += naoAplicaveis;
      if (presentes > 0) atributosCriticosEncontrados++;
    }

    if (faltando === 0) continue;

    lacunas.push({
      attributeCode: esperado.attributeCode,
      attributeLabel: observado?.attributeLabel ?? esperado.attributeCode,
      entityType: esperado.entityType,
      estado: presentes === 0 ? "AUSENTE" : "PARCIAL",
      criticidade: esperado.criticidade,
      entidadesEsperadas: esperadas,
      entidadesPresentes: presentes,
      entidadesFaltando: faltando,
      justificativa: esperado.justificativa,
      possivelSucessor: null,
    });
  }

  const novos = entrada.novos ?? 0;

  const conta = contar({
    entidadesEsperadas: entrada.entidadesNaVigencia,
    entidadesEncontradas: entrada.entidadesNaVigencia,
    atributosEsperados: entrada.esperados.filter(
      (e) => !entrada.dispensados.has(e.attributeCode),
    ).length,
    atributosEncontrados,
    combinacoesEsperadas,
    combinacoesEncontradas,
    combinacoesNaoAplicaveis,
  });

  const contaCritica = contar({
    entidadesEsperadas: entrada.entidadesNaVigencia,
    entidadesEncontradas: entrada.entidadesNaVigencia,
    atributosEsperados: atributosCriticos,
    atributosEncontrados: atributosCriticosEncontrados,
    combinacoesEsperadas: criticasEsperadas,
    combinacoesEncontradas: criticasEncontradas,
    combinacoesNaoAplicaveis: criticasNaoAplicaveis,
  });

  const contagemDeLacunas = {
    critico: lacunas.filter((l) => l.criticidade === "CRITICO").length,
    relevante: lacunas.filter((l) => l.criticidade === "RELEVANTE").length,
    informativo: lacunas.filter((l) => l.criticidade === "INFORMATIVO").length,
  };

  return {
    conta,
    contaCritica,
    estado: classificar(conta, {
      temNovo: novos > 0,
      temAlterado: false,
      tudoDispensado:
        entrada.esperados.length > 0 &&
        entrada.esperados.every((e) => entrada.dispensados.has(e.attributeCode)),
    }),
    lacunas,
    contagemDeLacunas,
    novos,
  };
}

function montarColunas(vigencias: VigenciaObservada[]): ColunaDaMatriz[] {
  const porData = new Map<string, ColunaDaMatriz>();
  for (const v of vigencias) {
    const atual = porData.get(v.effectiveDate);
    if (atual) {
      if (!atual.rotulos.includes(v.sourceLabel)) atual.rotulos.push(v.sourceLabel);
      continue;
    }
    porData.set(v.effectiveDate, {
      chave: v.effectiveDate,
      effectiveDate: v.effectiveDate,
      periodo: periodoDe(v.effectiveDate),
      rotulos: [v.sourceLabel],
    });
  }
  return [...porData.values()].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

function montarLinhas(celulas: CelulaDaMatriz[]): LinhaDaMatriz[] {
  const linhas = new Map<string, LinhaDaMatriz>();
  for (const c of celulas) {
    const chave = `${c.datasetFamily}|${c.entityType}|${c.scopeHash}|${c.canal}`;
    let linha = linhas.get(chave);
    if (!linha) {
      linha = {
        chave,
        datasetFamily: c.datasetFamily,
        entityType: c.entityType,
        scopeHash: c.scopeHash,
        scopeLabel: c.scopeLabel,
        canal: c.canal,
        rotulo: `${rotuloDaFamilia(c.datasetFamily)} · ${rotuloDoEquipamento(c.entityType)}`,
        celulas: {},
      };
      linhas.set(chave, linha);
    }
    linha.celulas[c.vigencia.effectiveDate] = c;
  }

  /* Pior primeiro: quem lê a matriz procura problema, não ordem alfabética. */
  return [...linhas.values()].sort((a, b) => {
    const pior = (l: LinhaDaMatriz) =>
      Math.min(...Object.values(l.celulas).map((c) => ORDEM_DO_ESTADO[c.estado]), 99);
    return pior(a) - pior(b) || a.rotulo.localeCompare(b.rotulo);
  });
}

/**
 * O nome que a família recebe na tela.
 *
 * `REMUNERACAO_EQUIPAMENTO` é o identificador; "Remuneração" é o que o cliente
 * chama. Quando um identificador não tem tradução, ele aparece como está — a
 * regra é a mesma de `families.ts`: nada é descartado, nada é inventado.
 */
export function rotuloDaFamilia(datasetFamily: string): string {
  const conhecidas: Record<string, string> = {
    REMUNERACAO_EQUIPAMENTO: "Remuneração",
  };
  return conhecidas[datasetFamily] ?? datasetFamily;
}

export function rotuloDoEquipamento(entityType: string): string {
  return entityType.charAt(0) + entityType.slice(1).toLowerCase();
}

function somar(contas: Contagem[]): Contagem {
  return contar({
    entidadesEsperadas: contas.reduce((s, c) => s + c.entidadesEsperadas, 0),
    entidadesEncontradas: contas.reduce((s, c) => s + c.entidadesEncontradas, 0),
    atributosEsperados: contas.reduce((s, c) => s + c.atributosEsperados, 0),
    atributosEncontrados: contas.reduce((s, c) => s + c.atributosEncontrados, 0),
    combinacoesEsperadas: contas.reduce((s, c) => s + c.combinacoesEsperadas, 0),
    combinacoesEncontradas: contas.reduce((s, c) => s + c.combinacoesEncontradas, 0),
    combinacoesNaoAplicaveis: contas.reduce((s, c) => s + c.combinacoesNaoAplicaveis, 0),
  });
}

function resumoVazio(): ResumoDaCobertura {
  const zero = contar({
    entidadesEsperadas: 0,
    entidadesEncontradas: 0,
    atributosEsperados: 0,
    atributosEncontrados: 0,
    combinacoesEsperadas: 0,
    combinacoesEncontradas: 0,
    combinacoesNaoAplicaveis: 0,
  });
  return {
    geral: zero,
    critica: zero,
    lacunas: { total: 0, critico: 0, relevante: 0, informativo: 0 },
    conjuntosParciais: 0,
    conjuntosAusentes: 0,
    novos: 0,
    veredito: {
      estado: "SEM_DADO",
      frase: "Nenhuma vigência importada ainda — não há cobertura a medir.",
    },
  };
}

/**
 * O resumo, somado das células e não recalculado.
 *
 * A frase do veredito é o que responde "temos todos os dados necessários para
 * confiar nesta análise?". Ela é dura de propósito: cobertura crítica abaixo de
 * 100% diz que a análise está comprometida, e diz **qual** lacuna a compromete —
 * um percentual sozinho manda o leitor adivinhar.
 */
function resumir(
  celulas: CelulaDaMatriz[],
  lacunas: Lacuna[],
  novos: number,
): ResumoDaCobertura {
  if (celulas.length === 0) return resumoVazio();

  const geral = somar(celulas.map((c) => c.conta));
  const critica = somar(celulas.map((c) => c.contaCritica));
  const criticas = lacunas.filter((l) => l.criticidade === "CRITICO");

  const contagem = {
    total: lacunas.length,
    critico: criticas.length,
    relevante: lacunas.filter((l) => l.criticidade === "RELEVANTE").length,
    informativo: lacunas.filter((l) => l.criticidade === "INFORMATIVO").length,
  };

  const pior = criticas.sort((a, b) => b.entidadesFaltando - a.entidadesFaltando)[0];
  const veredito: ResumoDaCobertura["veredito"] =
    critica.combinacoesEsperadas === 0
      ? {
          estado: "SEM_DADO",
          frase:
            "Nenhum atributo crítico está declarado para este recorte — não há análise financeira a garantir aqui.",
        }
      : critica.percentual >= 100
        ? {
            estado: "CONFIAVEL",
            frase: "Análises financeiras disponíveis: todo dado crítico está presente.",
          }
        : {
            estado: "COMPROMETIDA",
            frase: pior
              ? `Análise comprometida: falta ${pior.attributeLabel} para ${pior.entidadesFaltando} ${
                  pior.entidadesFaltando === 1 ? "equipamento" : "equipamentos"
                } em ${pior.entityType.toLowerCase()}.`
              : "Análise comprometida: há dado crítico faltando.",
          };

  return {
    geral,
    critica,
    lacunas: contagem,
    conjuntosParciais: celulas.filter((c) => c.estado === "PARCIAL").length,
    conjuntosAusentes: celulas.filter((c) => c.estado === "AUSENTE").length,
    novos,
    veredito,
  };
}
