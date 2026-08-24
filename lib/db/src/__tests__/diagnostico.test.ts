/**
 * Os cinco estados do banco, na função que os decide.
 *
 * Este arquivo existe porque a classificação passou a ter um dono só. Enquanto
 * ela vivia em dois lugares — o `/api/healthz` e as frases fixas das rotas —
 * não havia o que testar: cada lado tinha a sua versão, e a versão que a pessoa
 * lia na tela dependia de qual parágrafo ela olhasse primeiro.
 *
 * O caso do fim é o que aconteceu de verdade, e é o que nunca mais pode voltar.
 */
import { describe, expect, it } from "vitest";
import {
  diagnosticar,
  textoDoDiagnostico,
  type EstadoObservado,
} from "../diagnostico";

const observado = (estado: Partial<EstadoObservado>): EstadoObservado => ({
  configurada: true,
  alcancavel: true,
  pendentes: [],
  aplicadas: 18,
  ...estado,
});

describe("diagnosticar", () => {
  it("SAUDAVEL: nada pendente, e nenhuma ação a pedir de ninguém", () => {
    const d = diagnosticar(observado({}));

    expect(d.estado).toBe("SAUDAVEL");
    expect(d.acao).toBeNull();
    expect(d.risco.emRisco).toBe(false);
    expect(textoDoDiagnostico(d)).toMatch(/Nenhuma ação é necessária/);
  });

  it("MIGRATIONS_PENDENTES: faltam migrations e ninguém tentou aplicá-las", () => {
    const d = diagnosticar(
      observado({ aplicadas: 16, pendentes: ["0016_a", "0017_b"] }),
    );

    expect(d.estado).toBe("MIGRATIONS_PENDENTES");
    expect(d.acao?.codigo).toBe("APLICAR_MIGRATIONS");
    expect(d.acao?.comando).toBe("pnpm --filter @workspace/db run migrate");
    expect(d.acao?.quem).toBe("operador");
    expect(d.resumo).toMatch(/0016_a e 0017_b/);
    expect(d.risco.emRisco).toBe(false);
  });

  /**
   * A distinção que o pedido exigia manter: os dois deixam telas quebradas, mas
   * a pergunta seguinte é outra. Aqui a migration rodou e o banco a recusou —
   * repetir o comando sem ler o motivo dá no mesmo erro, e por isso este estado
   * é o único cuja ação **não** traz comando.
   */
  it("MIGRATION_FALHOU: é estado próprio, e não uma pendência com adjetivo", () => {
    const d = diagnosticar(
      observado({
        aplicadas: 9,
        pendentes: ["0009_entity_type_correction"],
        falha: { tag: "0009_entity_type_correction", code: "42501" },
      }),
    );

    expect(d.estado).toBe("MIGRATION_FALHOU");
    expect(d.estado).not.toBe("MIGRATIONS_PENDENTES");
    expect(d.acao?.codigo).toBe("INVESTIGAR_FALHA");
    expect(d.acao?.comando).toBeUndefined();
    expect(d.evidencia).toMatch(/42501/);
    // Uma transação por migration: a que falhou não entrou pela metade.
    expect(d.risco.emRisco).toBe(false);
  });

  /**
   * O estado que só o teste ponta a ponta revelou: com a tabela do Book
   * renomeada por fora, o registro dava as 18 por aplicadas e a rota respondia
   * "não tem onde guardar" — enquanto o diagnóstico dizia "nenhuma ação é
   * necessária", no mesmo corpo.
   */
  it("SCHEMA_DIVERGENTE: registro completo e objeto faltando não é SAUDAVEL", () => {
    const d = diagnosticar(observado({ objetoAusenteAgora: true }));

    expect(d.estado).toBe("SCHEMA_DIVERGENTE");
    expect(d.acao?.codigo).toBe("CONFERIR_SCHEMA");
    /*
      Rodar as migrations não resolve — elas já constam como aplicadas — e é
      isso que continua travado: o comando oferecido é a conferência, que só
      lê, e nunca o `migrate`. A ação dizia "compare" sem dizer com o quê; o
      `conferir-schema` nasceu para ela e agora é citado por ela.
    */
    expect(d.acao?.comando).toBe(
      "pnpm --filter @workspace/db run conferir-schema",
    );
    expect(d.acao?.comando).not.toMatch(/\brun migrate\b/);
    expect(textoDoDiagnostico(d)).not.toMatch(/Nenhuma ação é necessária/);
  });

  it("com migrations pendentes, elas explicam a ausência — e o estado não muda", () => {
    const d = diagnosticar(
      observado({
        aplicadas: 12,
        pendentes: ["0013_chamados_por_parametro"],
        objetoAusenteAgora: true,
      }),
    );

    expect(d.estado).toBe("MIGRATIONS_PENDENTES");
    expect(d.acao?.codigo).toBe("APLICAR_MIGRATIONS");
  });

  it("banco em dia e sem consulta falhando continua sendo SAUDAVEL", () => {
    expect(diagnosticar(observado({})).estado).toBe("SAUDAVEL");
  });

  it("INDISPONIVEL: sem a variável, a ação é da plataforma e não do operador", () => {
    const d = diagnosticar(
      observado({ configurada: false, alcancavel: false, aplicadas: 0 }),
    );

    expect(d.estado).toBe("INDISPONIVEL");
    expect(d.acao?.codigo).toBe("CONFIGURAR_DATABASE_URL");
    expect(d.acao?.quem).toBe("plataforma");
  });

  it("INDISPONIVEL: banco fora explica pelo código, sem mensagem de driver", () => {
    const d = diagnosticar(
      observado({ alcancavel: false, codigoDeConexao: "28P01", aplicadas: 0 }),
    );

    expect(d.estado).toBe("INDISPONIVEL");
    expect(d.resumo).toMatch(/credenciais/i);
    expect(d.acao?.quem).toBe("plataforma");
  });

  /**
   * **O caso vivido.** Registro de migrations vazio, schema inteiro no banco, a
   * fila parando na `0000` com `42710`.
   *
   * O ambiente ficou travado nisto porque a tela dizia duas coisas ao mesmo
   * tempo: o `/healthz` mandava adotar e a rota de Chamados mandava reiniciar
   * ou rodar `migrate`. Reiniciar repetia a mesma falha, indefinidamente.
   *
   * Este teste fixa as duas metades da regra: o estado é `REGISTRO_PERDIDO`, e
   * `migrate` puro não pode aparecer em canto nenhum do diagnóstico.
   */
  it("REGISTRO_PERDIDO: só adotar resolve, e `migrate` não é oferecido", () => {
    const d = diagnosticar(
      observado({
        aplicadas: 0,
        pendentes: [
          "0000_freightcheck_foundation",
          "0012_chamados",
          "0013_chamados_por_parametro",
        ],
        falha: { tag: "0000_freightcheck_foundation", code: "42710" },
      }),
    );

    expect(d.estado).toBe("REGISTRO_PERDIDO");
    expect(d.acao?.codigo).toBe("ADOTAR_MIGRATIONS");
    expect(d.acao?.comando).toBe(
      "pnpm --filter @workspace/db run migrate:adotar",
    );

    // Nada se perdeu — é a pergunta que quem subiu um arquivo faz primeiro.
    expect(d.risco.emRisco).toBe(false);
    expect(d.risco.texto).toMatch(/nada se perdeu/i);

    // E a recomendação que travou o ambiente não pode reaparecer por nenhuma
    // fresta do diagnóstico, nem no resumo, nem na ação, nem na evidência.
    const tudo = textoDoDiagnostico(d) + (d.evidencia ?? "");
    expect(tudo).not.toMatch(/run migrate`/);
    expect(tudo).not.toMatch(/suba o servidor/i);
    expect(tudo).toMatch(/migrate:adotar/);
    expect(tudo).toMatch(/falha igual|não resolve/i);
  });

  /**
   * A janela que só o teste contra o servidor revelou: registro apagado,
   * processo recém subido, nenhuma tentativa de migrar ainda — então não há
   * `falha` nenhuma para servir de evidência. Pela contagem parecia pendência
   * comum, e o conselho saía `migrate`, que naquele banco falha por duplicata.
   *
   * O schema existir com o registro zerado é conclusivo sozinho: banco novo não
   * tem objeto nenhum.
   */
  it("REGISTRO_PERDIDO: schema presente e registro zerado basta, sem falha registrada", () => {
    const d = diagnosticar(
      observado({
        aplicadas: 0,
        pendentes: ["0000_freightcheck_foundation", "0012_chamados"],
        temSchema: true,
      }),
    );

    expect(d.estado).toBe("REGISTRO_PERDIDO");
    expect(d.acao?.comando).toBe(
      "pnpm --filter @workspace/db run migrate:adotar",
    );
  });

  it("banco genuinamente novo — sem schema — é pendência comum, e `migrate` resolve", () => {
    const d = diagnosticar(
      observado({
        aplicadas: 0,
        pendentes: ["0000_freightcheck_foundation"],
        temSchema: false,
      }),
    );

    expect(d.estado).toBe("MIGRATIONS_PENDENTES");
    expect(d.acao?.comando).toBe("pnpm --filter @workspace/db run migrate");
  });

  /**
   * A assinatura tem três condições, e cada uma exclui um vizinho. Sem elas,
   * "adote" seria oferecido a bancos genuinamente incompletos — e adotar um
   * banco pela metade faz o registro afirmar um estado que o banco não tem.
   */
  describe("a assinatura do registro perdido não vale por aproximação", () => {
    it("com migrations já registradas, é falha comum e não registro perdido", () => {
      const d = diagnosticar(
        observado({
          aplicadas: 5,
          pendentes: ["0005_x"],
          falha: { tag: "0005_x", code: "42710" },
        }),
      );
      expect(d.estado).toBe("MIGRATION_FALHOU");
    });

    it("parando no meio da fila, é falha comum", () => {
      const d = diagnosticar(
        observado({
          aplicadas: 0,
          pendentes: ["0000_a", "0001_b"],
          falha: { tag: "0001_b", code: "42710" },
        }),
      );
      expect(d.estado).toBe("MIGRATION_FALHOU");
    });

    it("falhando por outro motivo que não duplicata, é falha comum", () => {
      const d = diagnosticar(
        observado({
          aplicadas: 0,
          pendentes: ["0000_a"],
          falha: { tag: "0000_a", code: "42501" },
        }),
      );
      expect(d.estado).toBe("MIGRATION_FALHOU");
    });
  });

  it("toda ação é ou um comando ou uma instrução — nunca vazia", () => {
    const casos: EstadoObservado[] = [
      observado({}),
      observado({ aplicadas: 1, pendentes: ["0001_x"] }),
      observado({
        aplicadas: 0,
        pendentes: ["0000_a"],
        falha: { tag: "0000_a", code: "42710" },
      }),
      observado({
        aplicadas: 1,
        pendentes: ["0001_x"],
        falha: { tag: "0001_x", code: "42501" },
      }),
      observado({ objetoAusenteAgora: true }),
      observado({ configurada: false, alcancavel: false, aplicadas: 0 }),
    ];

    const estados = casos.map((caso) => diagnosticar(caso).estado);
    expect(new Set(estados).size).toBe(6);

    for (const caso of casos) {
      const d = diagnosticar(caso);
      if (d.acao) expect(d.acao.texto.length).toBeGreaterThan(0);
      expect(d.resumo.length).toBeGreaterThan(0);
      expect(d.risco.texto.length).toBeGreaterThan(0);
    }
  });
});

/**
 * O bridge pela metade — o estado que não precisa de sintoma para aparecer.
 *
 * Todos os outros ramos desta função leem sintoma e concluem: uma contagem que
 * não fecha, uma consulta que morreu. Este lê uma **declaração** que o
 * `bridgeDown` deixou no banco dentro da própria transação, e que só o
 * `bridgeUp` apaga. É por isso que ele decide antes de todos — quando existe,
 * não há o que inferir.
 *
 * O que ele impede, concretamente: em 16/08/2026 um bridge sem `up` deixou
 * `attribute.definition` fora do banco, e a primeira notícia disso foi uma tela
 * em 500. Entre uma coisa e outra, `/healthz` respondeu SAUDAVEL o tempo todo.
 */
describe("a conferência de schema no diagnóstico", () => {
  /*
   * O caso vivido, na ordem em que doeu: registro completo, coluna a menos, e
   * o `/healthz` respondendo SAUDAVEL até uma tela morrer com 42703 — sem que
   * nada, nem a tela, soubesse dizer **qual** coluna. `objetosAusentes` é a
   * conferência entrando na observação, e estes casos fixam as três semânticas
   * do campo: ausente (ninguém conferiu), vazio (conferido e limpo), não vazio
   * (conferido, e falta exatamente isto).
   */
  it("nomeia a divergência sem esperar nenhuma consulta morrer", () => {
    const d = diagnosticar(
      observado({ aplicadas: 35, objetosAusentes: ["attribute.cost_class"] }),
    );

    expect(d.estado).toBe("SCHEMA_DIVERGENTE");
    expect(d.evidencia).toContain("attribute.cost_class");
    expect(d.evidencia).not.toMatch(/um objeto de schema falta/);
  });

  it("a ação diz com o quê comparar — o comando que sempre existiu para ela", () => {
    const d = diagnosticar(
      observado({ objetosAusentes: ["attribute.cost_class"] }),
    );

    expect(d.acao?.codigo).toBe("CONFERIR_SCHEMA");
    expect(d.acao?.comando).toBe(
      "pnpm --filter @workspace/db run conferir-schema",
    );
  });

  it("a consulta que morreu também ganha o comando, mesmo sem conferência", () => {
    const d = diagnosticar(observado({ objetoAusenteAgora: true }));

    expect(d.estado).toBe("SCHEMA_DIVERGENTE");
    expect(d.acao?.comando).toBe(
      "pnpm --filter @workspace/db run conferir-schema",
    );
    /* Sem conferência não se nomeia nada: a frase é a de contagem. */
    expect(d.evidencia).toMatch(/um objeto de schema falta/);
  });

  it("a lista longa sai limitada, com o resto contado", () => {
    const ausentes = Array.from({ length: 8 }, (_, i) => `tabela.coluna_${i}`);
    const d = diagnosticar(observado({ objetosAusentes: ausentes }));

    expect(d.evidencia).toContain("tabela.coluna_4");
    expect(d.evidencia).not.toContain("tabela.coluna_5");
    expect(d.evidencia).toContain("e mais 3");
  });

  it("conferido e limpo é um SAUDAVEL que diz que conferiu", () => {
    const d = diagnosticar(observado({ aplicadas: 35, objetosAusentes: [] }));

    expect(d.estado).toBe("SAUDAVEL");
    expect(d.evidencia).toMatch(/o schema confere/);
  });

  it("sem conferência, SAUDAVEL não afirma conferência que não houve", () => {
    const d = diagnosticar(observado({ aplicadas: 35 }));

    expect(d.estado).toBe("SAUDAVEL");
    expect(d.evidencia).not.toMatch(/confere/);
  });

  it("com migrations pendentes, elas explicam a ausência — a conferência não reclassifica", () => {
    /* Mesma regra do `objetoAusenteAgora`: divergência só é dizível quando a
       contagem afirma que nada falta. */
    const d = diagnosticar(
      observado({
        pendentes: ["0030_classe_de_custo_no_atributo"],
        objetosAusentes: ["attribute.cost_class"],
      }),
    );

    expect(d.estado).toBe("MIGRATIONS_PENDENTES");
  });

  it("o bridge pendente continua decidindo antes: ele é declaração, não dedução", () => {
    const d = diagnosticar(
      observado({
        bridgePendente: {},
        objetosAusentes: ["snapshot.canonical_snapshot_key"],
      }),
    );

    expect(d.estado).toBe("BRIDGE_PENDENTE");
  });
});

/**
 * BANCO_A_FRENTE_DO_BUILD — o sentido inverso, e o caso do rollback.
 *
 * Até esta prova, um banco cujo registro tem carimbos que o build não carrega
 * saía classificado SAUDAVEL — a contagem só media o que **falta**. É o estado
 * normal depois de publicar de novo um build anterior sobre um banco que já
 * avançou, e ele nunca teve nome.
 */
describe("BANCO_A_FRENTE_DO_BUILD", () => {
  it("banco à frente: estado próprio, e não SAUDAVEL", () => {
    const d = diagnosticar(observado({ aFrente: [1787601247252] }));
    expect(d.estado).toBe("BANCO_A_FRENTE_DO_BUILD");
  });

  it("não oferece comando — desfazer migration não é uma ação segura", () => {
    const d = diagnosticar(observado({ aFrente: [1787601247252] }));
    expect(d.acao?.codigo).toBe("ALINHAR_BUILD");
    expect(d.acao?.comando).toBeUndefined();
  });

  it("não afirma risco a dados — nada foi perdido, e nada é revertido", () => {
    const d = diagnosticar(observado({ aFrente: [1787601247252] }));
    expect(d.risco.emRisco).toBe(false);
  });

  it("a evidência nomeia quantas, e a mais recente por carimbo", () => {
    const d = diagnosticar(
      observado({ aFrente: [1787594537100, 1787601247252] }),
    );
    expect(d.evidencia).toContain("2");
    expect(d.evidencia).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("schema conferido e vazio continua sendo pré-condição do ramo", () => {
    // Sem objetosAusentes/objetoAusenteAgora, cai direto no ramo de baixo —
    // o mesmo lugar de onde SAUDAVEL sai hoje.
    const d = diagnosticar(observado({ aFrente: [1] }));
    expect(d.estado).toBe("BANCO_A_FRENTE_DO_BUILD");
  });

  it("objeto ausente ainda vence — SCHEMA_DIVERGENTE é mais urgente", () => {
    const d = diagnosticar(
      observado({ aFrente: [1], objetosAusentes: ["attribute.cost_class"] }),
    );
    expect(d.estado).toBe("SCHEMA_DIVERGENTE");
  });

  it("o que falta ainda vence — atrás e à frente ao mesmo tempo é classificado pelo que quebra", () => {
    const d = diagnosticar(
      observado({ pendentes: ["0058_algo"], aFrente: [1] }),
    );
    expect(d.estado).not.toBe("BANCO_A_FRENTE_DO_BUILD");
  });

  it("aFrente vazio ou ausente não muda nada — continua SAUDAVEL", () => {
    expect(diagnosticar(observado({ aFrente: [] })).estado).toBe("SAUDAVEL");
    expect(diagnosticar(observado({})).estado).toBe("SAUDAVEL");
  });
});

describe("BRIDGE_PENDENTE", () => {
  it("nomeia o estado em vez de deixar deduzir por schema ausente", () => {
    const d = diagnosticar(observado({ bridgePendente: {} }));

    expect(d.estado).toBe("BRIDGE_PENDENTE");
    expect(d.acao?.codigo).toBe("CONCLUIR_BRIDGE");
    expect(d.acao?.comando).toContain("bridge:up");
  });

  it("aparece sem que nenhuma consulta tenha falhado — é o ponto todo", () => {
    // Nada pendente, nada quebrado: exatamente o que o /healthz via como
    // SAUDAVEL enquanto faltavam colunas no banco.
    const d = diagnosticar(
      observado({ pendentes: [], objetoAusenteAgora: false }),
    );
    expect(d.estado).toBe("SAUDAVEL");

    const comBridge = diagnosticar(
      observado({ bridgePendente: { desde: "2026-08-16T18:00:00.000Z" } }),
    );
    expect(comBridge.estado).toBe("BRIDGE_PENDENTE");
    expect(comBridge.evidencia).toContain("2026-08-16");
  });

  it("explica o objeto ausente em vez de mandar conferir o schema", () => {
    // Sem o marcador este mesmo estado é SCHEMA_DIVERGENTE, cuja ação é
    // "compare o schema". Com ele, a causa está dada e a ação é específica.
    const semMarcador = diagnosticar(observado({ objetoAusenteAgora: true }));
    expect(semMarcador.estado).toBe("SCHEMA_DIVERGENTE");
    expect(semMarcador.acao?.codigo).toBe("CONFERIR_SCHEMA");

    const comMarcador = diagnosticar(
      observado({ objetoAusenteAgora: true, bridgePendente: {} }),
    );
    expect(comMarcador.estado).toBe("BRIDGE_PENDENTE");
    expect(comMarcador.acao?.codigo).toBe("CONCLUIR_BRIDGE");
  });

  it("não manda rodar migrations, que não repõem nada do que o bridge tirou", () => {
    const d = diagnosticar(
      observado({ aplicadas: 16, pendentes: ["0022_x"], bridgePendente: {} }),
    );

    expect(d.estado).toBe("BRIDGE_PENDENTE");
    expect(d.acao?.comando).not.toContain("migrate");
  });

  it("diz que nenhum dado se perdeu: o bridge tira estrutura, não fato", () => {
    const d = diagnosticar(observado({ bridgePendente: {} }));

    expect(d.risco.emRisco).toBe(false);
    expect(textoDoDiagnostico(d)).toMatch(/bridge:up/);
  });
});

/**
 * A frase principal, e a régua que a mantém sendo uma frase principal.
 *
 * `humano` existe porque `resumo` tem outro público. Ele nomeia migrations,
 * conta carimbos e cita SQLSTATE — o que quem opera o ambiente precisa, e o que
 * transformou a tela de login num parágrafo vermelho de doze linhas entregue a
 * quem tinha digitado a senha certa. A interface passou a mostrar `humano` e a
 * guardar o resto atrás de "Detalhes técnicos".
 *
 * Sem esta régua, a separação dura uma revisão: a primeira pessoa que quiser
 * ser prestativa acrescenta o nome da migration à frase de cima, e o defeito
 * volta com cara de melhoria. O teste percorre **todos** os estados, e é por
 * isso que ele não pode ser satisfeito consertando um caso.
 */
describe("a frase de quem está na tela", () => {
  /** Um observado por estado — a lista tem de continuar cobrindo os oito. */
  const CASOS: { nome: string; estado: EstadoObservado }[] = [
    { nome: "sem DATABASE_URL", estado: observado({ configurada: false }) },
    {
      nome: "banco fora",
      estado: observado({ alcancavel: false, codigoDeConexao: "ECONNREFUSED" }),
    },
    { nome: "saudável", estado: observado({}) },
    {
      nome: "migrations pendentes",
      estado: observado({ aplicadas: 16, pendentes: ["0055_x"] }),
    },
    {
      nome: "migration falhou",
      estado: observado({
        aplicadas: 16,
        pendentes: ["0055_x"],
        falha: { tag: "0055_x", code: "42P01" },
      }),
    },
    {
      nome: "registro perdido",
      estado: observado({
        aplicadas: 0,
        pendentes: ["0000_freightcheck_foundation"],
        temSchema: true,
      }),
    },
    {
      nome: "schema divergente",
      estado: observado({ objetosAusentes: ["attribute.cost_class"] }),
    },
    { nome: "bridge pendente", estado: observado({ bridgePendente: {} }) },
  ];

  it("cobre os oito estados — a lista não pode envelhecer em silêncio", () => {
    const cobertos = new Set(CASOS.map((c) => diagnosticar(c.estado).estado));
    expect([...cobertos].sort()).toEqual([
      "BRIDGE_PENDENTE",
      "INDISPONIVEL",
      "MIGRATIONS_PENDENTES",
      "MIGRATION_FALHOU",
      "REGISTRO_PERDIDO",
      "SAUDAVEL",
      "SCHEMA_DIVERGENTE",
    ]);
  });

  it("nenhuma delas carrega jargão: migration, comando, SQLSTATE ou endpoint", () => {
    /*
      A lista é do vocabulário que **não** pertence à linha que se lê com
      pressa. Cada item já apareceu numa tela de produto, e o `/api/healthz` é
      o que motivou este trabalho inteiro: um endpoint técnico oferecido como
      resposta a quem só queria entrar.
    */
    const PROIBIDO =
      /migration|migrate|pnpm|SQLSTATE|DATABASE_URL|healthz|readyz|drizzle|schema `|\/api\//i;

    for (const caso of CASOS) {
      const d = diagnosticar(caso.estado);
      expect(d.humano, `${caso.nome}: ${d.humano}`).not.toMatch(PROIBIDO);
      /* E nunca é o nome de um arquivo de migration disfarçado de frase. */
      expect(d.humano, caso.nome).not.toMatch(/\b\d{4}_[a-z_]+\b/);
    }
  });

  it("é uma frase de verdade, e não um rótulo", () => {
    for (const caso of CASOS) {
      const d = diagnosticar(caso.estado);
      expect(d.humano.length, caso.nome).toBeGreaterThan(40);
      expect(d.humano.trim().endsWith("."), caso.nome).toBe(true);
    }
  });

  it("toda falha responde a pergunta que se faz primeiro: perdi o que eu fiz?", () => {
    /*
      Quem acabou de clicar em Entrar, ou de subir um arquivo, pergunta isso
      antes de qualquer outra coisa. Deixar implícito faz alguém reenviar por
      medo, que é como um upload vira dois.
    */
    for (const caso of CASOS) {
      const d = diagnosticar(caso.estado);
      if (d.estado === "SAUDAVEL") continue;
      expect(d.humano, caso.nome).toMatch(/gravad|perde|inteiro|íntegr/i);
    }
  });

  it("o texto corrido continua sendo o técnico — quem lê por curl não perde nada", () => {
    const d = diagnosticar(
      observado({
        aplicadas: 16,
        pendentes: ["0055_disponibilidade_por_frota"],
      }),
    );

    /* A frase de cima não nomeia a migration; o texto para o log e o `curl`,
       sim, e é ele que vai no campo `error` das respostas. */
    expect(d.humano).not.toContain("0055_disponibilidade_por_frota");
    expect(textoDoDiagnostico(d)).toContain("0055_disponibilidade_por_frota");
    expect(textoDoDiagnostico(d)).toContain("run migrate");
  });
});
