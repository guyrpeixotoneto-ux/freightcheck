/**
 * As caras do cartão de upload, uma por estado do pipeline.
 *
 * O defeito que este arquivo fixa foi visto na tela: um run recusado por
 * VALIDATION_ERROR aparecia como "Lendo o arquivo…" com o nome interno do
 * enum vazando embaixo ("validation_error… nada entra sem sua aprovação"),
 * sem o motivo gravado, e com o polling rodando para sempre.
 *
 * A lista abaixo é uma cópia do enum `import_run_status`
 * (lib/db/src/schema/enums.ts), para que um estado criado lá sem cara aqui
 * falhe este teste em vez de vazar cru na tela.
 */
import { describe, expect, it } from "vitest";
import {
  estadoDaImportacao,
  faceDoCartao,
  historicoDoArquivo,
  leituraDoRun,
  type RunNoHistorico,
} from "@/lib/importacoes";

const IMPORT_RUN_STATUS = [
  "PENDING",
  "READING",
  "STAGED",
  "PREVIEWED",
  "PROMOTING",
  "PROMOTED",
  "FAILED",
  "ABORTED",
  "SKIPPED_DUPLICATE",
  "SKIPPED_DUPLICATE_DATA",
  "VALIDATION_ERROR",
] as const;

/** Os únicos estados em que o run ainda muda sozinho. */
const EM_ANDAMENTO = new Set(["PENDING", "READING", "STAGED", "PROMOTING"]);

describe("faceDoCartao", () => {
  it("trata a recusa por validação como fim de linha, não como leitura", () => {
    const cara = faceDoCartao("VALIDATION_ERROR");
    expect(cara.face).toBe("recusada");
    expect(cara.emAndamento).toBe(false);
    expect(cara.titulo).toMatch(/não fecha/i);
  });

  it("só continua perguntando ao servidor enquanto o pipeline trabalha", () => {
    for (const status of IMPORT_RUN_STATUS) {
      expect(faceDoCartao(status).emAndamento, status).toBe(
        EM_ANDAMENTO.has(status),
      );
    }
    // Sem resposta ainda não há estado nenhum: continua perguntando.
    expect(faceDoCartao(undefined).emAndamento).toBe(true);
  });

  it("nenhum título vaza o nome interno do enum", () => {
    for (const status of IMPORT_RUN_STATUS) {
      const { titulo } = faceDoCartao(status);
      expect(titulo, status).not.toMatch(/_/);
      expect(titulo, status).not.toContain(status);
    }
  });

  it("duplicata não é erro: cara própria, dizendo que nada entrou de novo", () => {
    expect(faceDoCartao("SKIPPED_DUPLICATE").face).toBe("duplicata");
    expect(faceDoCartao("SKIPPED_DUPLICATE_DATA").face).toBe("duplicata");
  });

  it("todo desfecho sem resumo tem o que dizer quando o run não gravou motivo", () => {
    for (const status of IMPORT_RUN_STATUS) {
      const cara = faceDoCartao(status);
      if (cara.face !== "lendo" && cara.face !== "conferida") {
        expect(cara.motivoPadrao, status).toBeTruthy();
      }
    }
  });

  it("um estado que o cartão não conhece espera, em vez de recusar", () => {
    // O pipeline pode ganhar estados intermediários; o cartão espera e mostra
    // o rótulo de estadoDaImportacao — nunca o nome interno.
    expect(faceDoCartao("REBALANCING").face).toBe("lendo");
    expect(faceDoCartao("REBALANCING").emAndamento).toBe(true);
  });
});

describe("estadoDaImportacao", () => {
  it("nomeia todo estado do pipeline para quem opera", () => {
    for (const status of IMPORT_RUN_STATUS) {
      const estado = estadoDaImportacao(status);
      expect(estado.rotulo, status).not.toMatch(/_/);
    }
  });

  it("um estado desconhecido cai no rótulo minúsculo, em tom de espera", () => {
    expect(estadoDaImportacao("REBALANCING")).toEqual({
      rotulo: "rebalancing",
      tom: "espera",
    });
  });
});

/**
 * O que o cartão pode afirmar sobre a leitura — e o que ele não pode.
 *
 * O defeito que este bloco fixa foi visto na tela, e custou uma investigação
 * inteira do lado errado. Um `SKIPPED_DUPLICATE` mostrava seis contadores em
 * zero **e** a frase "as células foram gravadas, mas nenhuma aba foi
 * reconhecida como fonte de fatos". Os zeros estavam certos; a frase estava
 * errada — o SHA-256 decide antes de abrir o arquivo, e nenhuma célula foi
 * gravada. O operador foi conferir as colunas de uma planilha que o leitor
 * nunca tinha aberto.
 */
describe("leituraDoRun", () => {
  const run = (sobrepor: Partial<Parameters<typeof leituraDoRun>[0]> = {}) => ({
    status: "PROMOTED",
    rawCells: 5000,
    stagedFacts: 400,
    ...sobrepor,
  });

  it("a duplicata não afirma leitura nenhuma: o arquivo não foi aberto", () => {
    const leitura = leituraDoRun(
      run({ status: "SKIPPED_DUPLICATE", rawCells: 0, stagedFacts: 0 }),
    );
    expect(leitura.leitura).toBe("NAO_ABERTO_DUPLICATA");
    // E, em especial, não é o estado que autoriza a frase das células gravadas.
    expect(leitura.leitura).not.toBe("LIDO_SEM_FATOS");
  });

  it("o arquivo que foi lido e não virou nada continua avisando", () => {
    // O caso real que a frase existe para pegar: 440 células, zero fato, zero
    // erro, zero aviso — uma planilha de trecho inteira passando despercebida.
    expect(leituraDoRun(run({ rawCells: 440, stagedFacts: 0 })).leitura).toBe(
      "LIDO_SEM_FATOS",
    );
  });

  it("um run terminal sem célula nenhuma não afirma que gravou células", () => {
    for (const status of ["FAILED", "ABORTED", "VALIDATION_ERROR"]) {
      expect(
        leituraDoRun(run({ status, rawCells: 0, stagedFacts: 0 })).leitura,
        status,
      ).toBe("NAO_LIDO");
    }
  });

  it("nenhum estado em andamento é acusado de não ter produzido fato", () => {
    for (const status of IMPORT_RUN_STATUS) {
      if (!EM_ANDAMENTO.has(status) && status !== "PREVIEWED") continue;
      expect(
        leituraDoRun(run({ status, rawCells: 0, stagedFacts: 0 })).leitura,
        status,
      ).toBe("EM_ANDAMENTO");
    }
  });

  it("nenhum estado do pipeline afirma célula gravada sem célula gravada", () => {
    // A garantia geral, e a que sobrevive a um estado novo no enum: com
    // `rawCells` em zero, nenhum status pode produzir a frase das células.
    for (const status of IMPORT_RUN_STATUS) {
      expect(
        leituraDoRun(run({ status, rawCells: 0, stagedFacts: 0 })).leitura,
        status,
      ).not.toBe("LIDO_SEM_FATOS");
    }
  });

  it("leu e produziu fato é o caso comum, e não avisa nada", () => {
    expect(leituraDoRun(run()).leitura).toBe("LIDO");
  });
});

/**
 * Três cartões do mesmo arquivo são três coisas diferentes.
 *
 * Sem esta leitura, a lista mostrava o recebimento, o reenvio recusado e a
 * releitura como três cartões parecidos em ordem cronológica inversa — sem
 * dizer que falavam do mesmo arquivo, quanto mais qual era qual.
 */
describe("historicoDoArquivo", () => {
  const SHA = "168d211b7d3a6b9f";

  const recebimento: RunNoHistorico = {
    importRunId: "run-1",
    contentSha256: SHA,
    status: "PROMOTED",
    startedAt: "2026-08-18T22:22:18.000Z",
    reprocessOfRunId: null,
    reprocessReason: null,
  };
  const recusado: RunNoHistorico = {
    importRunId: "run-2",
    contentSha256: SHA,
    status: "SKIPPED_DUPLICATE",
    startedAt: "2026-08-19T10:00:00.000Z",
    reprocessOfRunId: null,
    reprocessReason: null,
  };
  const releitura: RunNoHistorico = {
    importRunId: "run-3",
    contentSha256: SHA,
    status: "PREVIEWED",
    startedAt: "2026-08-19T11:00:00.000Z",
    reprocessOfRunId: "run-1",
    reprocessReason: "o leitor aprendeu o grão do QLP",
  };
  const outroArquivo: RunNoHistorico = {
    importRunId: "run-4",
    contentSha256: "outro-sha",
    status: "PROMOTED",
    startedAt: "2026-08-19T09:00:00.000Z",
    reprocessOfRunId: null,
    reprocessReason: null,
  };

  const todos = [releitura, recusado, outroArquivo, recebimento];

  it("dá a cada um o seu papel", () => {
    expect(historicoDoArquivo(todos, recebimento).papel).toBe("RECEBIMENTO");
    expect(historicoDoArquivo(todos, recusado).papel).toBe("TENTATIVA_RECUSADA");
    expect(historicoDoArquivo(todos, releitura).papel).toBe("REPROCESSAMENTO");
  });

  it("agrupa pelo conteúdo, e em ordem cronológica", () => {
    const historico = historicoDoArquivo(todos, recusado);
    expect(historico.leituras.map((r) => r.importRunId)).toEqual([
      "run-1",
      "run-2",
      "run-3",
    ]);
    // O arquivo diferente não entra, ainda que tenha entrado no meio.
    expect(historico.leituras).not.toContain(outroArquivo);
  });

  it("aponta o recebimento original a partir da tentativa recusada", () => {
    // A pergunta que o cartão de duplicata precisa responder: "então onde
    // está o que este conteúdo produziu?".
    expect(historicoDoArquivo(todos, recusado).recebimento).toBe(recebimento);
  });

  it("o recebimento nunca é uma recusa nem uma releitura", () => {
    // Mesmo quando a recusa é a mais antiga da lista recortada — o que
    // acontece quando o original entrou por outra aba.
    const semOriginal = [recusado, releitura];
    expect(historicoDoArquivo(semOriginal, recusado).recebimento).toBeNull();
  });

  it("a releitura aponta o run que ela releu", () => {
    expect(historicoDoArquivo(todos, releitura).releu).toBe(recebimento);
    expect(historicoDoArquivo(todos, recebimento).releu).toBeNull();
  });

  it("um arquivo com uma leitura só não inventa história", () => {
    const historico = historicoDoArquivo([outroArquivo], outroArquivo);
    expect(historico.leituras).toHaveLength(1);
    expect(historico.papel).toBe("RECEBIMENTO");
    expect(historico.releu).toBeNull();
  });
});

/**
 * Contra quem a releitura se compara — e por que não contra o cartão clicado.
 *
 * O clique quase sempre sai da tentativa recusada: é nela que a frase "este
 * arquivo já havia sido recebido" aparece. Mas quem o servidor relê é a última
 * leitura que abriu o arquivo. Medir a troca de tipo contra o cartão clicado
 * deixaria a caixa calada exatamente no caso do QLP — a recusa foi enviada pela
 * aba do QLP, o recebimento original não declarava nada, e a releitura muda a
 * família do dataset sem ninguém ser avisado.
 */
describe("alvoDaReleitura", () => {
  const SHA = "abc123";
  const base = {
    contentSha256: SHA,
    reprocessOfRunId: null,
    reprocessReason: null,
  };

  const recebimento: RunNoHistorico = {
    ...base,
    importRunId: "run-1",
    status: "PROMOTED",
    startedAt: "2026-08-18T22:22:18.000Z",
  };
  const recusado: RunNoHistorico = {
    ...base,
    importRunId: "run-2",
    status: "SKIPPED_DUPLICATE",
    startedAt: "2026-08-19T10:00:00.000Z",
  };

  it("a partir da tentativa recusada, o alvo é o recebimento", () => {
    expect(historicoDoArquivo([recebimento, recusado], recusado).alvoDaReleitura).toBe(
      recebimento,
    );
  });

  it("com uma releitura já feita, o alvo é ela — a história é uma corrente", () => {
    const releitura: RunNoHistorico = {
      contentSha256: SHA,
      importRunId: "run-3",
      status: "PROMOTED",
      startedAt: "2026-08-19T11:00:00.000Z",
      reprocessOfRunId: "run-1",
      reprocessReason: "o leitor aprendeu o grão do QLP",
    };
    const todos = [recebimento, recusado, releitura];
    // Pedida de qualquer cartão do arquivo, a próxima releitura relê a última.
    for (const partida of todos) {
      expect(
        historicoDoArquivo(todos, partida).alvoDaReleitura,
        partida.importRunId,
      ).toBe(releitura);
    }
  });

  it("um arquivo só com tentativas recusadas não tem o que reler", () => {
    expect(historicoDoArquivo([recusado], recusado).alvoDaReleitura).toBeNull();
  });
});
