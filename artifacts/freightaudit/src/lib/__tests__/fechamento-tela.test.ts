import { describe, expect, it } from "vitest";

import {
  anoAceito,
  avisoDoEnvio,
  chaveDaCompetencia,
  chaveDoDia,
  chaveDoDiagnostico,
  chaveDoDiario,
  chaveDoPainel,
  estadoDaFonte,
  oQueDizerDoSemVerba,
} from "@/lib/fechamento-tela";
import type { DiagnosticoDoPagamento, Documento, DocumentoRecebido } from "@/lib/fechamento";

/**
 * As duas decisões que a tela do Fechamento toma antes de desenhar.
 *
 * Nenhuma delas era testável enquanto morava dentro do JSX — e as duas erravam
 * de um jeito que só aparecia com o produto na mão: o painel servido do cache
 * negando um arquivo que a lista mostrava, e o `202` da quarentena passando por
 * sucesso mudo.
 */

const DOCUMENTO: Documento = {
  id: "d1",
  tipo: "PAGAMENTO",
  nomeDoArquivo: "03.08.20_1Q_JUL.txt",
  linhasLidas: 14,
  recusas: [],
  vigente: true,
  enviadoEm: "2026-08-20T12:00:00.000Z",
  verbas: 10,
};

const RECEBIDO: DocumentoRecebido = {
  id: "d1",
  tipo: "PAGAMENTO",
  nomeDoArquivo: "03.08.20_1Q_JUL.txt",
  linhasLidas: 14,
  recusas: [],
  enviadoEm: "2026-08-20T12:00:00.000Z",
  desfecho: "PROMOVIDO",
  motivoDaQuarentena: null,
  substituiu: null,
};

/**
 * A régua do ano, agora lida por dois formulários.
 *
 * Ela veio de `pages/fechamento/competencias.tsx` no dia em que o cadastro da
 * unidade passou a pedir a quinzena com os mesmos três campos — ano digitado,
 * mês e quinzena escolhidos. Duas cópias da faixa seriam duas telas capazes de
 * discordar sobre o mesmo ano sem que o compilador percebesse.
 */
describe("anoAceito", () => {
  it("aceita o ano dentro da faixa que a rota aceita", () => {
    expect(anoAceito("2026")).toBe(true);
    expect(anoAceito("2000")).toBe(true);
    expect(anoAceito("2100")).toBe(true);
  });

  it("recusa fora da faixa, nas duas pontas", () => {
    expect(anoAceito("1999")).toBe(false);
    expect(anoAceito("2101")).toBe(false);
  });

  it("recusa o campo vazio em vez de o ler como ano zero", () => {
    expect(anoAceito("")).toBe(false);
    expect(anoAceito("   ")).toBe(false);
  });

  it("recusa o que não é número, e o número que não é inteiro", () => {
    expect(anoAceito("dois mil")).toBe(false);
    expect(anoAceito("2026,5")).toBe(false);
    expect(anoAceito("2026.5")).toBe(false);
  });

  it("aceita o ano com espaço em volta — quem digita não apaga o espaço", () => {
    expect(anoAceito(" 2026 ")).toBe(true);
  });
});

describe("a chave de uma competência", () => {
  const id = "c1";

  /*
    A afirmação que fecha a porta. Invalidar por chave, no react-query, é por
    prefixo: enquanto o painel era `["fechamento", "painel", id]`, nenhuma das
    invalidações da competência o alcançava — e a próxima consulta que alguém
    escrevesse nasceria irmã do mesmo jeito. Aqui a relação é afirmada uma vez,
    e uma chave nova que não a cumpra quebra este teste antes de ir para a tela.
  */
  it("é prefixo de tudo que se pergunta sobre ela", () => {
    const raiz = chaveDaCompetencia(id);
    for (const filha of [chaveDoPainel(id), chaveDoDiario(id), chaveDoDia(id, "2026-07-03")]) {
      expect(filha.slice(0, raiz.length)).toEqual([...raiz]);
      expect(filha.length).toBeGreaterThan(raiz.length);
    }
  });

  it("não alcança o diagnóstico de um documento, e é de propósito", () => {
    /* Ele responde sobre bytes que não mudam nunca; refazê-lo a cada envio seria
       pagar a releitura de um arquivo para receber a mesma resposta. */
    expect(chaveDoDiagnostico("d1").slice(0, 3)).not.toEqual([...chaveDaCompetencia(id)]);
  });

  it("distingue duas competências", () => {
    expect(chaveDaCompetencia("c1")).not.toEqual([...chaveDaCompetencia("c2")]);
  });
});

describe("o que a lista de relatórios diz de uma fonte", () => {
  it("sem documento vigente, a fonte está ausente", () => {
    expect(estadoDaFonte(undefined)).toBe("AUSENTE");
  });

  it("com documento e verbas, está importada", () => {
    expect(estadoDaFonte(DOCUMENTO)).toBe("IMPORTADA");
  });

  it("com documento e nenhuma verba, é um estado próprio — nem ausente nem importada", () => {
    /* O caso relatado da tela: visto verde e "14 linhas" ao lado de um painel
       dizendo que o arquivo não tinha sido importado. */
    expect(estadoDaFonte({ ...DOCUMENTO, verbas: 0 })).toBe("SEM_VERBA");
  });

  it("as cinco fontes sem verba a ter não são acusadas", () => {
    /* `verbas` é `null` nelas, e `null` não é zero: um `!documento.verbas`
       poria o triângulo âmbar no 2Art, no 03.08.15 e nas outras três. */
    expect(estadoDaFonte({ ...DOCUMENTO, tipo: "OPERACAO", verbas: null })).toBe("IMPORTADA");
  });
});

describe("o aviso depois de um envio aceito", () => {
  it("o arquivo promovido não gera aviso — a lista já mostra o resultado", () => {
    expect(avisoDoEnvio(RECEBIDO)).toBeNull();
  });

  it("o arquivo em quarentena gera aviso, com o nome e o motivo do servidor", () => {
    /* O `202` é `ok` para o `fetch` e não é sucesso. Tratá-lo como o `201` foi
       o que fez alguém subir o 03.08.20, não ver aviso nenhum e concluir que
       estava importado. */
    const aviso = avisoDoEnvio({
      ...RECEBIDO,
      desfecho: "EM_QUARENTENA",
      motivoDaQuarentena: '"03.08.20 (truncado).txt" trouxe 4 registro(s), mas nenhuma verba.',
    });
    expect(aviso).toEqual({
      nomeDoArquivo: "03.08.20_1Q_JUL.txt",
      motivo: '"03.08.20 (truncado).txt" trouxe 4 registro(s), mas nenhuma verba.',
    });
  });

  it("quarentena sem motivo escrito ainda avisa que o arquivo não valeu", () => {
    const aviso = avisoDoEnvio({ ...RECEBIDO, desfecho: "EM_QUARENTENA", motivoDaQuarentena: null });
    expect(aviso?.motivo).toContain("não virou a conta");
  });
});

/**
 * A frase que a lista mostra sobre o 03.08.20 sem verba no banco.
 *
 * O caso que estes testes trancam é o do arquivo real da 1ª quinzena: 14 linhas
 * lidas, que são **10 verbas e 4 descontos**, e uma tela que dizia serem todas
 * descontos porque o `count(*)` do banco voltara zero. A tela não tinha lido o
 * arquivo, e mesmo assim afirmava o que havia dentro dele.
 */
describe("o que a lista diz do 03.08.20 que não sustenta verba", () => {
  const SEM_VERBA: Documento = { ...DOCUMENTO, verbas: 0 };

  const diagnostico = (parcial: Partial<DiagnosticoDoPagamento>): DiagnosticoDoPagamento => ({
    causa: "LEU_NORMALMENTE",
    resumo: "",
    lido: { verbas: 10, descontos: 4, totais: 2 },
    cabecalho: { periodo: { inicio: null, fim: null }, unidade: null, transportadora: null },
    secoes: { canal: true, bloco: true, verbasBemFormatadas: 10 },
    suspeitas: [],
    ...parcial,
  });

  it("sem o diagnóstico, não afirma nada sobre o conteúdo do arquivo", () => {
    const { frase, reimportar } = oQueDizerDoSemVerba(SEM_VERBA, undefined);
    /* A afirmação que estava errada, e que a tela não tem como sustentar. */
    expect(frase).not.toContain("que são descontos");
    expect(frase).toContain("14 linha(s)");
    expect(frase).toContain("nenhuma verba dele sustenta");
    expect(reimportar).toBe(false);
  });

  it("quando o arquivo guardado tem verba, a culpa vai para a importação", () => {
    const { frase, reimportar } = oQueDizerDoSemVerba(
      SEM_VERBA,
      diagnostico({ causa: "LEU_NORMALMENTE" }),
    );
    expect(frase).toContain("10 verba(s)");
    expect(frase).toContain("4 desconto(s)");
    expect(frase).toContain("quem não as gravou foi a importação");
    /* E o conserto é refazer a leitura, não pedir outro arquivo a quem opera. */
    expect(frase).toContain("Não é caso de trocar o arquivo");
    expect(reimportar).toBe(true);
  });

  it("quando o arquivo é mesmo o problema, não oferece reimportar", () => {
    /* Reimportar aqui repetiria o mesmo resultado e ainda tiraria o documento
       de vigente — o que resolve é reexportar o relatório. */
    for (const causa of [
      "NAO_E_O_03_08_20",
      "SEM_CABECALHO_DE_SECAO",
      "LINHA_DE_VERBA_RECUSADA",
      "SEM_CORPO_DE_VERBA",
    ] as const) {
      const { frase, reimportar } = oQueDizerDoSemVerba(SEM_VERBA, diagnostico({ causa }));
      expect(reimportar).toBe(false);
      expect(frase).toContain("não tirou verba nenhuma dele");
      expect(frase).not.toContain("que são descontos");
    }
  });
});
