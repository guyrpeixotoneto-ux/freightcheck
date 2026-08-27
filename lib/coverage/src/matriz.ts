import type { Database } from "@workspace/db";
import { esperadoDaVigencia, type PresencaNaVigencia } from "./esperado";
import { descobertas, type Descoberta } from "./descoberta";
import { rosterDasVigencias, type EntidadeAusente } from "./frota";
import {
  atributosObservados,
  vigenciasObservadas,
  type AtributoObservado,
  type VigenciaObservada,
} from "./observado";
import {
  classificar,
  contar,
  ehDeclarado,
  medirAtributo,
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
  /**
   * Os equipamentos que eram esperados nesta célula e não vieram.
   *
   * Lista, e não contagem, porque a pergunta seguinte de quem lê é sempre
   * "quais?" — e a placa é a resposta que deixa a pessoa ir conferir.
   */
  entidadesAusentes: EntidadeAusente[];
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
  /** A operação de quem pergunta — escopo, e não filtro. Ver `vigenciasObservadas`. */
  operacao?: string | null;
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
    operacao: filtro.operacao,
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

  /*
    O roster de todas as vigências numa chamada, e não uma por volta do laço.

    A continuidade de cada vigência olha as anteriores do mesmo recorte, de modo
    que perguntar por vigência é quadrático — e o custo aparecia antes de
    qualquer volume: a suíte sobre o export real passou de 7s para 18s. O par
    (vigência, entidade) é pequeno o bastante para caber inteiro em memória, e é
    ali que a diferença entre vigências é feita.
  */
  const rosters = await rosterDasVigencias(
    db,
    vigencias,
    new Map(
      vigencias.map((v) => [
        v.snapshotId,
        new Map(v.equipamentos.map((e) => [e.entityType, e.entidades] as const)),
      ]),
    ),
  );

  for (const vigencia of vigencias) {
    if (vigencia.equipamentos.length === 0) {
      incompleto.push({
        vigencia: vigencia.sourceLabel,
        motivo:
          "A vigência não tem agregado de cobertura gravado. O que ela traz não está contado como presente — é piso, não retrato. Nada se perdeu: a contagem sai dos fatos, que continuam no banco, e refazer a medição a devolve.",
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

    /*
      O roster entra **antes** de resolver o esperado, e não depois.

      `resolverEsperado` usa a contagem de entidades como denominador de cada
      atributo declarado. Se ela continuasse sendo "quantos chegaram", uma
      carreta que sumisse do arquivo sairia dos dois lados da fração e o
      percentual não se mexeria — o modo de falhar que este módulo inteiro
      existe para não ter. Passando o esperado, a mesma carreta some só do
      numerador, e a célula cai.
    */
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

    /*
      As células são a união do que chegou com o que era esperado — não só do
      que chegou.

      Enquanto o laço percorria `vigencia.equipamentos`, a matriz só conseguia
      falar de tipos presentes: um tipo inteiro que não veio não ganhava linha,
      e um tipo sem linha não tem como estar ausente na tela. Era o buraco mais
      caro do módulo, porque ele escondia exatamente o pior caso — o conjunto
      que não existe é mais grave do que o conjunto incompleto, e era o único
      que a matriz não sabia desenhar.

      A união é sobre o **declarado**, e não sobre toda origem: histórico e
      estrutura são inferidos a partir do que chegou, e um tipo que nunca chegou
      não tem nem histórico nem estrutura. Só uma declaração pode afirmar que
      ele deveria estar aqui — que é a razão de o catálogo existir.
    */
    const tiposEsperados = new Set(
      esperados.filter((e) => ehDeclarado(e.justificativa.origem)).map((e) => e.entityType),
    );
    const equipamentos: { entityType: string; entidades: number }[] = [
      ...vigencia.equipamentos.map((e) => ({ entityType: e.entityType, entidades: e.entidades })),
      ...[...tiposEsperados]
        .filter((t) => !entidadesPorTipo.has(t))
        .sort()
        .map((entityType) => ({ entityType, entidades: 0 })),
    ];

    for (const equipamento of equipamentos) {
      if (filtro.entityType && equipamento.entityType !== filtro.entityType) continue;

      const resultado = medirCelula({
        esperados: esperados.filter((e) => e.entityType === equipamento.entityType),
        observados: doSnapshot.filter((o) => o.entityType === equipamento.entityType),
        dispensados,
        entidadesNaVigencia: equipamento.entidades,
        entidadesEsperadas: roster.esperadasPorTipo.get(equipamento.entityType),
        ausentes: roster.ausentes.filter((a) => a.entityType === equipamento.entityType),
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
        entidadesAusentes: resultado.entidadesAusentes,
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
    resumo: resumir(celulas, lacunas, achados.length, {
      incompletas: incompleto.length,
      vigencias: vigencias.length,
    }),
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
  /** Quantas entidades deste tipo a vigência de fato trouxe. */
  entidadesNaVigencia: number;
  /**
   * Quantas deveriam existir — o roster.
   *
   * Ausente quer dizer "o mesmo que chegou", que era a única resposta possível
   * antes de `frota.ts` e continua sendo a certa para quem chama esta função
   * sem roster (os testes puros). Quando ela vem maior, a diferença é gente que
   * falta, e é o que faz a cobertura cair em vez de encolher com o arquivo.
   */
  entidadesEsperadas?: number;
  /** Quem falta, com a evidência de que era esperado. */
  ausentes?: EntidadeAusente[];
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
  entidadesAusentes: EntidadeAusente[];
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
    /*
      A aritmética de um atributo mora em `medirAtributo`, e não aqui.

      Ela é a mesma que a matriz de atributos mostra linha a linha — o piso da
      expectativa, o não aplicável saindo dos dois lados da fração, a
      classificação do estado. Enquanto ela morava neste laço, o drill-down por
      atributo só podia refazê-la, e duas aritméticas para a mesma pergunta são
      como a tela acaba mostrando 88,1% na célula e um atributo completo dentro
      dela que a célula conta como lacuna.
    */
    const medida = medirAtributo({ esperado, observado });

    combinacoesEsperadas += medida.entidadesEsperadas;
    combinacoesEncontradas += medida.entidadesPresentes;
    combinacoesNaoAplicaveis += medida.naoAplicaveis;
    if (medida.entidadesPresentes > 0) atributosEncontrados++;

    const critico = esperado.criticidade === "CRITICO";
    if (critico) {
      atributosCriticos++;
      criticasEsperadas += medida.entidadesEsperadas;
      criticasEncontradas += medida.entidadesPresentes;
      criticasNaoAplicaveis += medida.naoAplicaveis;
      if (medida.entidadesPresentes > 0) atributosCriticosEncontrados++;
    }

    if (medida.entidadesFaltando === 0) continue;

    lacunas.push({
      attributeCode: esperado.attributeCode,
      attributeLabel: observado?.attributeLabel ?? esperado.attributeCode,
      entityType: esperado.entityType,
      estado: medida.estado,
      criticidade: esperado.criticidade,
      entidadesEsperadas: medida.entidadesEsperadas,
      entidadesPresentes: medida.entidadesPresentes,
      entidadesFaltando: medida.entidadesFaltando,
      justificativa: esperado.justificativa,
      possivelSucessor: null,
    });
  }

  const novos = entrada.novos ?? 0;

  /*
    Três candidatos, e o maior vence.

    O roster e o observado são os dois óbvios. O terceiro é o piso que
    `resolverEsperado` já aplicou por atributo: num conjunto declarado do qual
    nenhuma entidade chegou, cada atributo espera uma entidade, e a célula
    precisa dizer o mesmo — senão ela anuncia "0 entidades esperadas" ao lado de
    "110 combinações esperadas", dois números da mesma conta que não fecham.
  */
  const entidadesEsperadas = Math.max(
    entrada.entidadesEsperadas ?? 0,
    entrada.entidadesNaVigencia,
    ...entrada.esperados
      .filter((e) => !entrada.dispensados.has(e.attributeCode))
      .map((e) => e.entidadesEsperadas),
    0,
  );

  const conta = contar({
    entidadesEsperadas,
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
    entidadesEsperadas,
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
    entidadesAusentes: entrada.ausentes ?? [],
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

function zerado(): Contagem {
  return contar({
    entidadesEsperadas: 0,
    entidadesEncontradas: 0,
    atributosEsperados: 0,
    atributosEncontrados: 0,
    combinacoesEsperadas: 0,
    combinacoesEncontradas: 0,
    combinacoesNaoAplicaveis: 0,
  });
}

function resumoVazio(): ResumoDaCobertura {
  const zero = zerado();
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
 * Há vigência, e nenhuma delas pôde ser medida.
 *
 * O veredito continua `SEM_DADO` — porque não há número em que confiar —, mas a
 * frase diz a verdade diferente: o dado está no banco e é a **medição** que
 * falta. É a diferença entre "importe a primeira planilha" e "refaça a
 * medição", e mandar fazer a primeira coisa quando é a segunda custa uma
 * reimportação inteira para terminar exatamente onde se começou.
 */
function resumoNaoMedido(incompletas: number): ResumoDaCobertura {
  const zero = zerado();
  return {
    geral: zero,
    critica: zero,
    lacunas: { total: 0, critico: 0, relevante: 0, informativo: 0 },
    conjuntosParciais: 0,
    conjuntosAusentes: 0,
    novos: 0,
    veredito: {
      estado: "SEM_DADO",
      frase:
        incompletas === 1
          ? "A vigência importada está sem agregado de cobertura — há dado, e não há medição."
          : `As ${incompletas} vigências importadas estão sem agregado de cobertura — há dado, e não há medição.`,
    },
  };
}

/**
 * Há vigência, e o filtro do pedido não deixou nenhuma célula.
 *
 * Acontece quando o equipamento pedido não existe na janela escolhida — trocar
 * para "últimas 3" com o filtro em carreta, num recorte que só teve cavalo. É a
 * terceira maneira de a matriz ficar vazia, e a única das três em que não há
 * nada a consertar: o que mudou foi a pergunta.
 */
function resumoFiltrado(): ResumoDaCobertura {
  const zero = zerado();
  return {
    geral: zero,
    critica: zero,
    lacunas: { total: 0, critico: 0, relevante: 0, informativo: 0 },
    conjuntosParciais: 0,
    conjuntosAusentes: 0,
    novos: 0,
    veredito: {
      estado: "SEM_DADO",
      frase: "Nenhuma vigência atende a este filtro — há dado importado fora dele.",
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
 *
 * **Zero células tem três causas, e elas não são a mesma notícia.** Não há
 * vigência; há vigência e nenhuma pôde ser medida; ou o filtro do pedido não
 * deixou nada de pé. Dizer "nenhuma vigência importada" nas duas últimas manda
 * quem opera importar de novo o que já está importado — foi o que a tela fez,
 * com o seletor de unidade ao lado mostrando a vigência que ela dizia não
 * existir. O contexto é o que separa as três, e é por isso que ele chega aqui.
 */
function resumir(
  celulas: CelulaDaMatriz[],
  lacunas: Lacuna[],
  novos: number,
  contexto: { incompletas: number; vigencias: number },
): ResumoDaCobertura {
  if (celulas.length === 0) {
    if (contexto.incompletas > 0) return resumoNaoMedido(contexto.incompletas);
    if (contexto.vigencias > 0) return resumoFiltrado();
    return resumoVazio();
  }

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

  /*
    Um conjunto inteiro ausente vale mais do que a conta de críticos diz.

    A cobertura crítica mede os atributos que alimentam componentes
    `essencial` da DRE **e que têm coluna declarada na fonte**. Quando um tipo
    de linha inteiro não chega, esses dois filtros conspiram para o silêncio:
    Diesel, Arla, Pneus e Manutenção são componentes essenciais e estão em
    `plano.ts` com `fontes: []`, porque a coluna que os alimentaria é de trecho
    e nenhum arquivo de trecho jamais chegou. Zero fonte declarada é zero
    atributo crítico, e zero atributo crítico faltando é 100% de cobertura
    crítica — sobre um conjunto que não existe.

    O veredito é a única frase que a tela mostra antes dos números, e ela não
    pode dizer "pode analisar" enquanto um conjunto declarado está inteiramente
    ausente. Ele não deixa de ser verdade sobre os atributos críticos que
    existem; ele deixa de ser a resposta à pergunta que quem lê está fazendo.

    Por tipo, e não por célula: nove vigências sem trecho são um conjunto que
    falta, e não nove problemas.
  */
  const tiposAusentes = [
    ...new Set(
      celulas
        .filter((c) => c.estado === "AUSENTE")
        .map((c) => c.entityType)
        .filter((tipo) =>
          celulas.every((c) => c.entityType !== tipo || c.estado === "AUSENTE"),
        ),
    ),
  ].sort();

  const veredito: ResumoDaCobertura["veredito"] =
    critica.combinacoesEsperadas === 0
      ? {
          estado: "SEM_DADO",
          frase:
            "Nenhum atributo crítico está declarado para este recorte — não há análise financeira a garantir aqui.",
        }
      : critica.percentual < 100
        ? {
            estado: "COMPROMETIDA",
            frase: pior
              ? `Análise comprometida: falta ${pior.attributeLabel} para ${pior.entidadesFaltando} ${
                  pior.entidadesFaltando === 1 ? "equipamento" : "equipamentos"
                } em ${pior.entityType.toLowerCase()}.`
              : "Análise comprometida: há dado crítico faltando.",
          }
        : tiposAusentes.length > 0
          ? {
              estado: "COMPROMETIDA",
              frase:
                `Análise comprometida: ${listar(tiposAusentes)} não chegou em nenhuma vigência ` +
                `deste recorte. O dado crítico que temos está completo, mas ele não cobre o que falta.`,
            }
          : {
              estado: "CONFIAVEL",
              frase: "Análises financeiras disponíveis: todo dado crítico está presente.",
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

/** "trecho", "trecho e carreta", "trecho, carreta e cavalo". */
function listar(tipos: string[]): string {
  const nomes = tipos.map((t) => t.toLowerCase());
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}
