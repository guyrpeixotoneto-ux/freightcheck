import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A leitura da aba por imagem é um rascunho, e é isso que estes testes prendem.
 *
 * Ela não grava, não confere e não decide nada: transcreve o que está escrito
 * num print e devolve para os campos do formulário, que continuam esperando o
 * "Salvar" de quem cadastra. As fronteiras que a mantêm barata, e que quebram
 * aqui antes de quebrarem em produção:
 *
 * - **Nunca lança.** O formulário existia antes deste botão e funciona inteiro
 *   sem ele; uma exceção vinda daqui derrubaria um pedido que não depende dela.
 * - **Nada entra sem estar no catálogo.** Chave inventada, valor que não é
 *   número e linha repetida são descartados antes de virarem campo preenchido —
 *   um número no campo errado é pior do que um campo vazio.
 * - **A lacuna é nomeada.** O que a imagem não mostrou volta como chave em
 *   `naoEncontradas`, e não como silêncio — silêncio, num formulário, é lido
 *   como "a aba diz zero".
 *
 * A chamada de rede é substituída por um cliente de mentira. O caminho com
 * modelo de verdade não é testado aqui de propósito: um teste que precisa de
 * crédito para passar não roda no CI de ninguém.
 */

const { criar } = vi.hoisted(() => ({ criar: vi.fn() }));

vi.mock("../llm", async (original) => {
  const real = await original<typeof import("../llm")>();
  return { ...real, obterCliente: () => ({ beta: { messages: { create: criar } } }) };
});

const { lerPlanilhaDaImagem, ehMimeDeImagem } = await import("../planilha-por-imagem");

const LINHAS = [
  { chave: "aliquota_pis", rotulo: "Alíquota PIS no Estado", medida: "PERCENTUAL" as const, bloco: "ALÍQUOTAS" },
  { chave: "frota_fixa_ativos", rotulo: "Total Frota Fixa Ativos", medida: "QUANTIDADE" as const, bloco: "ALÍQUOTAS" },
  { chave: "van_custo_fixo", rotulo: "Custo Fixo", medida: "DINHEIRO" as const, bloco: "VANS (SRTRANS FIXO)" },
];

const IMAGEM = { mimeType: "image/png" as const, dados: "aGVsbG8=" };

/** A resposta que a API devolveria, com a ferramenta chamada como se pediu. */
function respostaCom(input: unknown, extra: Record<string, unknown> = {}) {
  return {
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 5 },
    content: [{ type: "tool_use", name: "registrar_leitura", id: "t1", input }],
    ...extra,
  };
}

beforeEach(() => {
  criar.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-de-mentira");
});

afterEach(() => vi.unstubAllEnvs());

describe("o que nem chega a virar chamada", () => {
  it("diz que não há leitura quando não há chave, em vez de tentar a rede", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");

    const r = await lerPlanilhaDaImagem({ imagem: IMAGEM, linhas: LINHAS });

    expect(r.motivo).toBe("SEM_CHAVE");
    expect(r.valores).toEqual([]);
    expect(criar).not.toHaveBeenCalled();
  });

  it("recusa o pedido sem catálogo antes de gastar uma chamada", async () => {
    /*
      Sem linhas a procurar, o pedido vira "leia esta imagem e devolva o que
      achar" — e o que ele devolveria não teria onde encaixar. O corte é aqui
      para que a falha não custe uma imagem inteira de tokens de entrada.
    */
    const r = await lerPlanilhaDaImagem({ imagem: IMAGEM, linhas: [] });

    expect(r.motivo).toBe("ERRO");
    expect(criar).not.toHaveBeenCalled();
  });
});

describe("o que a chamada leva", () => {
  it("manda a imagem antes do texto, e obriga a ferramenta", async () => {
    criar.mockResolvedValue(respostaCom({ valores: [], naoEncontradas: [] }));

    await lerPlanilhaDaImagem({ imagem: IMAGEM, linhas: LINHAS });

    const params = criar.mock.calls[0]![0];
    const conteudo = params.messages[0].content;

    // A ordem é a que a API recomenda para anexo, e o texto termina apontando
    // para "a imagem" — um ponteiro só aponta para a frente.
    expect(conteudo[0].type).toBe("image");
    expect(conteudo[0].source.media_type).toBe("image/png");
    expect(conteudo[1].type).toBe("text");

    expect(params.tool_choice).toEqual({ type: "tool", name: "registrar_leitura" });
  });

  it("fecha o esquema nas chaves do catálogo, para não haver chave a inventar", async () => {
    criar.mockResolvedValue(respostaCom({ valores: [], naoEncontradas: [] }));

    await lerPlanilhaDaImagem({ imagem: IMAGEM, linhas: LINHAS });

    const esquema = criar.mock.calls[0]![0].tools[0].input_schema;
    expect(esquema.properties.valores.items.properties.chave.enum).toEqual([
      "aliquota_pis",
      "frota_fixa_ativos",
      "van_custo_fixo",
    ]);
  });

  it("agrupa as linhas pela faixa da aba, que é o que desempata rótulo repetido", async () => {
    criar.mockResolvedValue(respostaCom({ valores: [], naoEncontradas: [] }));

    await lerPlanilhaDaImagem({ imagem: IMAGEM, linhas: LINHAS });

    const texto = criar.mock.calls[0]![0].messages[0].content[1].text;
    expect(texto).toContain("## ALÍQUOTAS");
    expect(texto).toContain("## VANS (SRTRANS FIXO)");
    // "Custo Fixo" existe em mais de um bloco na aba de verdade: é o rótulo
    // sozinho que troca o número de faixa, e por isso ele nunca viaja sozinho.
    expect(texto).toContain('`van_custo_fixo` — "Custo Fixo"');
  });
});

describe("o que volta, e o que é descartado no caminho", () => {
  it("entrega o número interpretado e guarda o texto que estava na célula", async () => {
    criar.mockResolvedValue(
      respostaCom({
        valores: [{ chave: "aliquota_pis", valor: 5.9, comoEstaNaImagem: "5,90%" }],
        naoEncontradas: [],
      }),
    );

    const r = await lerPlanilhaDaImagem({ imagem: IMAGEM, linhas: LINHAS });

    expect(r.motivo).toBe("IA");
    expect(r.valores).toEqual([
      { chave: "aliquota_pis", valor: 5.9, comoEstaNaImagem: "5,90%" },
    ]);
  });

  it("descarta chave que não é do catálogo", async () => {
    /*
      O `enum` do esquema já barra isso na API, mas o esquema não é a única
      coisa entre o modelo e o campo — e a última linha de defesa é a que roda
      quando a primeira mudar.
    */
    criar.mockResolvedValue(
      respostaCom({
        valores: [
          { chave: "linha_que_nao_existe", valor: 1, comoEstaNaImagem: "1" },
          { chave: "frota_fixa_ativos", valor: 42, comoEstaNaImagem: "42" },
        ],
        naoEncontradas: [],
      }),
    );

    const r = await lerPlanilhaDaImagem({ imagem: IMAGEM, linhas: LINHAS });

    expect(r.valores.map((v) => v.chave)).toEqual(["frota_fixa_ativos"]);
  });

  it("fica com a primeira leitura de uma chave repetida", async () => {
    // Repetição é sinal de que a mesma linha foi vista em dois lugares da
    // imagem; a segunda é a duvidosa.
    criar.mockResolvedValue(
      respostaCom({
        valores: [
          { chave: "van_custo_fixo", valor: 1424, comoEstaNaImagem: "R$ 1.424,00" },
          { chave: "van_custo_fixo", valor: 9999, comoEstaNaImagem: "R$ 9.999,00" },
        ],
        naoEncontradas: [],
      }),
    );

    const r = await lerPlanilhaDaImagem({ imagem: IMAGEM, linhas: LINHAS });

    expect(r.valores).toHaveLength(1);
    expect(r.valores[0]!.valor).toBe(1424);
  });

  it("descarta o que não é número finito, em vez de mandar NaN para o campo", async () => {
    criar.mockResolvedValue(
      respostaCom({
        valores: [
          { chave: "aliquota_pis", valor: "5,90", comoEstaNaImagem: "5,90%" },
          { chave: "frota_fixa_ativos", valor: Number.POSITIVE_INFINITY, comoEstaNaImagem: "∞" },
          { chave: "van_custo_fixo", valor: 10, comoEstaNaImagem: "R$ 10,00" },
        ],
        naoEncontradas: [],
      }),
    );

    const r = await lerPlanilhaDaImagem({ imagem: IMAGEM, linhas: LINHAS });

    expect(r.valores.map((v) => v.chave)).toEqual(["van_custo_fixo"]);
  });

  it("nomeia a lacuna, sem repetir o que já foi lido", async () => {
    criar.mockResolvedValue(
      respostaCom({
        valores: [{ chave: "aliquota_pis", valor: 5.9, comoEstaNaImagem: "5,90%" }],
        naoEncontradas: ["frota_fixa_ativos", "frota_fixa_ativos", "aliquota_pis", "inventada"],
      }),
    );

    const r = await lerPlanilhaDaImagem({ imagem: IMAGEM, linhas: LINHAS });

    // Sem duplicata, sem chave de fora do catálogo, e sem a que foi lida: uma
    // linha não pode estar preenchida e faltando ao mesmo tempo.
    expect(r.naoEncontradas).toEqual(["frota_fixa_ativos"]);
  });
});

describe("os desfechos que não são leitura", () => {
  it("trata a recusa como recusa, sem ler o conteúdo vazio", async () => {
    criar.mockResolvedValue({
      stop_reason: "refusal",
      usage: { input_tokens: 10, output_tokens: 0 },
      content: [],
    });

    const r = await lerPlanilhaDaImagem({ imagem: IMAGEM, linhas: LINHAS });

    expect(r.motivo).toBe("RECUSA");
    expect(r.valores).toEqual([]);
  });

  it("diz que o teto cortou, quando foi o teto que cortou", async () => {
    /*
      Sem bloco de ferramenta e com `tool_choice` obrigatório, o caso comum é a
      chamada cortada no meio pelo teto de saída. Ela chega como JSON inválido e
      viraria "não consegui ler" numa imagem perfeitamente legível — o motivo
      precisa sobreviver até a tela.
    */
    criar.mockResolvedValue({
      stop_reason: "max_tokens",
      usage: { input_tokens: 10, output_tokens: 12000 },
      content: [{ type: "text", text: "{\"valores\": [" }],
    });

    const r = await lerPlanilhaDaImagem({ imagem: IMAGEM, linhas: LINHAS });

    expect(r.motivo).toBe("ERRO");
    expect(r.erro).toContain("teto");
  });

  it("não lança quando a rede cai — devolve o motivo e deixa o formulário de pé", async () => {
    criar.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const r = await lerPlanilhaDaImagem({ imagem: IMAGEM, linhas: LINHAS });

    expect(r.motivo).toBe("ERRO");
    expect(r.erro).toContain("ECONNREFUSED");
    expect(r.valores).toEqual([]);
  });
});

describe("os formatos que a leitura enxerga", () => {
  it("aceita os quatro que o modelo lê como imagem, e recusa o resto", async () => {
    // O PDF é o engano provável: ele é anexo de aba tanto quanto o print, e
    // passa por outro caminho da API — não por este.
    expect(ehMimeDeImagem("image/png")).toBe(true);
    expect(ehMimeDeImagem("image/jpeg")).toBe(true);
    expect(ehMimeDeImagem("image/webp")).toBe(true);
    expect(ehMimeDeImagem("image/gif")).toBe(true);
    expect(ehMimeDeImagem("application/pdf")).toBe(false);
    expect(ehMimeDeImagem("image/svg+xml")).toBe(false);
    expect(ehMimeDeImagem(undefined)).toBe(false);
  });
});
