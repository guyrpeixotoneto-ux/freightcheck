/**
 * O que é preciso guardar para explicar uma resposta **depois** dela.
 *
 * **A pergunta que este módulo responde.** Alguém diz "a IA respondeu errado
 * ontem". Hoje o que existe para investigar isso é um anel de 500 eventos em
 * memória — que some no restart — e a coluna `evidence`, que guarda as fontes e
 * as lacunas. Nenhum dos dois diz **de que unidade** a resposta falava, **o que**
 * foi consultado, **com que argumentos**, e **por que** o texto saiu do jeito
 * que saiu. Sem essas quatro coisas, reproduzir uma resposta ruim é reproduzir a
 * pergunta à mão e torcer para o banco estar no mesmo estado.
 *
 * **Por que uma forma declarada, e não `tecnico` inteiro.** `tecnico` é a
 * superfície de diagnóstico da tela e muda com ela; o que se persiste é um
 * contrato de auditoria, e ele precisa ser estável, pequeno e legível daqui a
 * seis meses por quem não tem o código aberto ao lado. Guardar o objeto inteiro
 * também guardaria o dossiê renderizado, que pode ter dezenas de milhares de
 * caracteres por turno.
 *
 * **O que deliberadamente não entra.** O texto do dossiê e o conteúdo das
 * evidências. Eles descrevem uma consulta de um instante, e reidratá-los meses
 * depois faria "de onde veio esse número?" apontar para um recorte que o banco
 * pode não ter mais. O que se guarda é a **rota** — quem foi consultado, com
 * quê, e o que voltou em tamanho —, que é o que permite refazer a consulta hoje
 * e comparar.
 */

/** A versão do formato. Um leitor futuro precisa saber o que está lendo. */
export const VERSAO_DO_RASTRO = 1;

export interface RastroDaResposta {
  v: number;
  /** ISO-8601, em UTC. */
  em: string;

  /**
   * De que recorte esta resposta falava — e **quem o escolheu**.
   *
   * `origem` é o campo que faltava: sem ele, uma resposta sobre a unidade
   * errada e uma resposta sobre a unidade certa são indistinguíveis no
   * histórico, porque as duas guardam só o rótulo do que foi consultado.
   */
  recorte: {
    scopeHash: string | null;
    canal: string | null;
    rotulo: string | null;
    origem: string;
    unidadeCitada: string | null;
    vigencia: string | null;
    /** Quando o período pedido não existia — a causa de um turno sem número. */
    periodoRecusado: { pedido: string; disponiveis: string[] } | null;
  };

  /** O que a pergunta virou antes de qualquer consulta. */
  leitura: {
    intencao: string;
    necessidades: string[];
    assunto: string | null;
    comoReconheceu: string | null;
    herdado: string[];
  };

  /**
   * Tudo o que foi consultado, na ordem, com os argumentos.
   *
   * No caminho do planejador os argumentos são o que o código decidiu; no do
   * agente, o que o modelo pediu. Guardar os dois na mesma forma é o que permite
   * comparar as duas trajetórias sobre a mesma pergunta seis meses depois.
   */
  consultas: {
    nome: string;
    argumentos: Record<string, unknown> | null;
    ok: boolean;
    erro: string | null;
    /** Quantas evidências citáveis esta consulta autorizou. */
    evidencias: number;
    /** Índice da consulta de cujo resultado esta saiu. `null` = não encadeada. */
    derivaDe: number | null;
  }[];

  /** Quantas idas ao modelo, e por que o laço parou. Só no caminho do agente. */
  agente: { rodadas: number; parou: string } | null;

  /**
   * O que aconteceu com o texto — a parte que explica a **forma** da resposta.
   *
   * `numerosRecusados` é o campo mais caro de perder: ele é a diferença entre
   * "o modelo escreveu mal" e "o dossiê não autorizava o número que ele
   * escreveu", e as duas pedem correções opostas.
   */
  grounding: {
    redigiu: string;
    causa: string;
    frasesPodadas: number;
    frasesTotais: number;
    numerosRecusados: string[];
    lacunas: string[];
  };

  /** O custo, para responder "por que estava lento/caro naquele dia?". */
  modelo: {
    nome: string | null;
    latenciaMs: number | null;
    tokensEntrada: number | null;
    tokensSaida: number | null;
    origemDosTokens: string | null;
    custoUsd: number | null;
    erro: string | null;
  };

  /** Onde o tempo foi, sem a chamada ao modelo. */
  orquestracao: { ms: number; etapas: { nome: string; ms: number }[] };
}

/**
 * A forma mínima de que `montarRastro` precisa.
 *
 * Declarada aqui, e não importada de `resposta.ts`, para que o contrato do
 * rastro não passe a depender de toda a superfície da resposta — é o mesmo
 * motivo por que ele não guarda `tecnico` inteiro.
 */
export interface RespostaParaRastro {
  /** O rótulo do recorte, como a tela o mostra. */
  recorte: string | null;
  lacunas: { explicacao: string }[];
  /** O plano, para o recorte e a vigência — o que a resposta não expõe hoje. */
  plano: {
    scopeHash: string | null;
    canal: string | null;
    origemDoRecorte: string;
    unidadeCitada: string | null;
    periodo: string | null;
    periodoImpossivel: { pedido: string; disponiveis: string[] } | null;
  };
  tecnico: {
    intencao: string;
    herdado: string[];
    ferramentas: string[];
    numerosRecusados: string[];
    agente: {
      rodadas: number;
      parou: string;
      chamadas: {
        nome: string;
        argumentos: Record<string, unknown>;
        ok: boolean;
        erro: string | null;
        evidencias: number;
        derivaDe: number | null;
      }[];
    } | null;
    motor: { redigiu: string; codigo: string };
    rastro: {
      assunto: string | null;
      comoReconheceu: string | null;
      necessidades: string[];
      etapas: { nome: string; ms: number }[];
      orquestracaoMs: number;
      frasesPodadas: number;
      frasesTotais: number;
    };
    ia: {
      modelo: string;
      latenciaMs: number;
      erro: string | null;
      tokensEntrada: number;
      tokensSaida: number;
      origemDosTokens: string;
      custoUsd: number;
    } | null;
  };
}

/**
 * O rastro desta resposta.
 *
 * `agora` entra por parâmetro para o teste poder fixá-lo — e porque um carimbo
 * de tempo lido de dentro de uma função pura é a forma mais comum de um teste
 * de igualdade ficar instável sem que ninguém entenda por quê.
 */
export function montarRastro(
  resposta: RespostaParaRastro,
  agora: Date = new Date(),
): RastroDaResposta {
  const t = resposta.tecnico;

  /*
    As consultas do planejador não têm argumentos declarados — ele decide o
    recorte e o período por conta própria, e é isso que `null` diz aqui. O que
    não se faz é inventar um objeto vazio, que se leria como "chamada sem
    argumento" e apagaria a diferença entre os dois caminhos.
  */
  const consultas: RastroDaResposta["consultas"] = t.agente
    ? t.agente.chamadas.map((c) => ({
        nome: c.nome,
        argumentos: c.argumentos,
        ok: c.ok,
        erro: c.erro,
        evidencias: c.evidencias,
        derivaDe: c.derivaDe,
      }))
    : t.ferramentas.map((nome) => ({
        nome: nome.replace(/ \(falhou\)$/, ""),
        argumentos: null,
        ok: !nome.endsWith("(falhou)"),
        erro: null,
        evidencias: 1,
        derivaDe: null,
      }));

  return {
    v: VERSAO_DO_RASTRO,
    em: agora.toISOString(),
    recorte: {
      scopeHash: resposta.plano.scopeHash,
      canal: resposta.plano.canal,
      rotulo: resposta.recorte,
      origem: resposta.plano.origemDoRecorte,
      unidadeCitada: resposta.plano.unidadeCitada,
      vigencia: resposta.plano.periodo,
      periodoRecusado: resposta.plano.periodoImpossivel,
    },
    leitura: {
      intencao: t.intencao,
      necessidades: t.rastro.necessidades,
      assunto: t.rastro.assunto,
      comoReconheceu: t.rastro.comoReconheceu,
      herdado: t.herdado,
    },
    consultas,
    agente: t.agente ? { rodadas: t.agente.rodadas, parou: t.agente.parou } : null,
    grounding: {
      redigiu: t.motor.redigiu,
      causa: t.motor.codigo,
      frasesPodadas: t.rastro.frasesPodadas,
      frasesTotais: t.rastro.frasesTotais,
      numerosRecusados: t.numerosRecusados,
      lacunas: resposta.lacunas.map((l) => l.explicacao),
    },
    modelo: {
      nome: t.ia?.modelo ?? null,
      latenciaMs: t.ia?.latenciaMs ?? null,
      tokensEntrada: t.ia?.tokensEntrada ?? null,
      tokensSaida: t.ia?.tokensSaida ?? null,
      origemDosTokens: t.ia?.origemDosTokens ?? null,
      custoUsd: t.ia?.custoUsd ?? null,
      erro: t.ia?.erro ?? null,
    },
    orquestracao: { ms: t.rastro.orquestracaoMs, etapas: t.rastro.etapas },
  };
}

/**
 * O rastro lido de volta, em prosa — a resposta a "por que ela saiu assim?".
 *
 * Existe para que reproduzir não dependa de alguém saber ler o JSON. É o texto
 * que se cola numa conversa quando alguém reclama de uma resposta, e ele é
 * montado só do que foi persistido: se uma linha aqui não puder ser escrita, é
 * porque falta campo no rastro, e é assim que se descobre.
 */
export function explicarRastro(rastro: RastroDaResposta): string {
  const linhas: string[] = [];
  const r = rastro.recorte;

  linhas.push(
    `Recorte: ${r.rotulo ?? "(nenhum)"} — escolhido por ${r.origem}` +
      (r.unidadeCitada ? ` (a pergunta nomeou ${r.unidadeCitada})` : "") +
      (r.vigencia ? ` · vigência ${r.vigencia}` : ""),
  );
  if (r.periodoRecusado) {
    linhas.push(
      `Período recusado: ${r.periodoRecusado.pedido} não existe neste recorte ` +
        `(disponíveis: ${r.periodoRecusado.disponiveis.join(", ") || "nenhuma"}). ` +
        "Nenhuma consulta de dado rodou por causa disso.",
    );
  }
  linhas.push(
    `Entendeu: ${rastro.leitura.intencao}` +
      (rastro.leitura.necessidades.length
        ? ` · plano [${rastro.leitura.necessidades.join(", ")}]`
        : "") +
      (rastro.leitura.assunto ? ` · assunto "${rastro.leitura.assunto}"` : "") +
      (rastro.leitura.herdado.length
        ? ` · herdou ${rastro.leitura.herdado.join(", ")}`
        : ""),
  );

  if (rastro.consultas.length === 0) linhas.push("Consultou: nada.");
  else {
    linhas.push(
      `Consultou ${rastro.consultas.length} vez(es)` +
        (rastro.agente ? ` em ${rastro.agente.rodadas} rodada(s) (parou: ${rastro.agente.parou})` : "") +
        ":",
    );
    rastro.consultas.forEach((c, i) => {
      const args = c.argumentos ? ` ${JSON.stringify(c.argumentos)}` : "";
      const de = c.derivaDe !== null ? ` ← deriva de #${c.derivaDe + 1}` : "";
      const falha = c.ok ? "" : ` — FALHOU: ${c.erro ?? "sem motivo declarado"}`;
      linhas.push(`  #${i + 1} ${c.nome}${args}${de}${falha}`);
    });
  }

  const g = rastro.grounding;
  linhas.push(
    `Texto: ${g.redigiu} (${g.causa})` +
      (g.frasesTotais ? ` · ${g.frasesPodadas}/${g.frasesTotais} frase(s) podadas` : "") +
      (g.numerosRecusados.length
        ? ` · recusados: ${g.numerosRecusados.join(", ")}`
        : " · nenhum número recusado"),
  );
  if (g.lacunas.length) linhas.push(`Lacunas declaradas: ${g.lacunas.length}`);

  const m = rastro.modelo;
  linhas.push(
    m.nome
      ? `Modelo: ${m.nome} · ${m.latenciaMs}ms · ${m.tokensEntrada}+${m.tokensSaida} tokens ` +
        `(${m.origemDosTokens}) · US$ ${m.custoUsd}` + (m.erro ? ` · erro: ${m.erro}` : "")
      : "Modelo: não houve chamada.",
  );
  linhas.push(`Orquestração: ${rastro.orquestracao.ms}ms`);
  return linhas.join("\n");
}
