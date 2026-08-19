/**
 * O botão "Aprovar e importar", e a única pergunta que ele tem direito de fazer.
 *
 * ---------------------------------------------------------------------------
 * O caso que este arquivo existe para não deixar voltar
 * ---------------------------------------------------------------------------
 * `QLP ADM_Remunerado Camaçari_V@.xlsx`: 12.765 células, 11.760 fatos, 8 chaves
 * que aparecem duas vezes na mesma vigência com valores que discordam. O
 * pipeline leu o arquivo inteiro, classificou os 8 conflitos como quarentena de
 * chave — o registro fica de fora, o resto entra — e gravou o run como
 * PREVIEWED, que é como ele diz "conferido, nada impede aprovar".
 *
 * A tela, olhando o mesmo run, desabilitou o botão e escreveu "8 erros —
 * corrija a origem antes de aprovar". Ela perguntava `errors > 0`, e `errors` é
 * o total de apontamentos de severidade ERRO: uma pergunta parecida com "isto
 * impede aprovar?", que deixou de ser a mesma no dia em que o conflito de chave
 * parou de segurar o arquivo. Oito registros seguravam onze mil setecentos e
 * sessenta, e a única saída oferecida era corrigir a planilha.
 *
 * O que os testes abaixo prendem não é o número 8: é a separação entre *contar
 * erros* e *decidir aprovação*. Por isso `ContadoresDaAprovacao` não tem campo
 * `errors` — não há como a decisão voltar a depender do total bruto sem que
 * este arquivo pare de compilar.
 */
import { describe, expect, it } from "vitest";
import {
  decisaoDaAprovacao,
  ressalvaDaQuarentena,
  type ContadoresDaAprovacao,
} from "@/lib/importacoes";

/** Um run conferido e sem nenhuma ressalva — o caso comum. */
const conferido = (patch: Partial<ContadoresDaAprovacao> = {}): ContadoresDaAprovacao => ({
  status: "PREVIEWED",
  blockingErrors: 0,
  chavesEmQuarentena: 0,
  identidadesNaoDeclaradas: 0,
  ...patch,
});

/**
 * O run de Camaçari como o servidor o descreve hoje.
 *
 * `blockingErrors: 0` não é escolha deste teste: é o que a pré-visualização
 * calcula para este arquivo, e é por isso que o run chegou a PREVIEWED em vez
 * de VALIDATION_ERROR. As 8 aparecem como chaves retidas, que é a consequência
 * que elas de fato têm.
 */
const camacari = conferido({ chavesEmQuarentena: 8 });

describe("o que habilita aprovar", () => {
  it("conferido e sem ressalva nenhuma: aprova", () => {
    const decisao = decisaoDaAprovacao(conferido());
    expect(decisao.podeAprovar).toBe(true);
    expect(decisao.impedimento).toBeNull();
    expect(decisao.ressalva).toBeNull();
  });

  it("conferido com as 8 chaves de Camaçari em quarentena: aprova", () => {
    const decisao = decisaoDaAprovacao(camacari);
    expect(decisao.podeAprovar).toBe(true);
    expect(decisao.impedimento).toBeNull();
  });

  it("uma chave em quarentena não vale menos que oito: aprova igual", () => {
    // O caso de uma chave só é o que aparece primeiro numa origem que começou
    // a duplicar. Travar nele seria travar mais cedo, não menos.
    expect(decisaoDaAprovacao(conferido({ chavesEmQuarentena: 1 })).podeAprovar).toBe(
      true,
    );
  });
});

describe("o que continua impedindo", () => {
  it("o arquivo que não é o que disse ser: não aprova", () => {
    /*
      A recusa por impedimento chega à tela como estado, e não como contador: a
      pré-visualização grava VALIDATION_ERROR e escreve o motivo. As duas metades
      são conferidas — o estado, que é o caminho real, e o contador, que é a
      trava de segurança para o dia em que um estado novo chegar aqui com
      impedimento.
    */
    const recusado = decisaoDaAprovacao(
      conferido({ status: "VALIDATION_ERROR", blockingErrors: 3 }),
    );
    expect(recusado.podeAprovar).toBe(false);
    expect(recusado.impedimento).toBe("NAO_CONFERIDO");

    const impeditivo = decisaoDaAprovacao(conferido({ blockingErrors: 1 }));
    expect(impeditivo.podeAprovar).toBe(false);
    expect(impeditivo.impedimento).toBe("ERRO_BLOQUEANTE");
  });

  it("o arquivo ainda sendo lido, e o que já foi aprovado: não aprova", () => {
    for (const status of ["PENDING", "READING", "STAGED", "PROMOTING", "PROMOTED"]) {
      const decisao = decisaoDaAprovacao(conferido({ status }));
      expect(decisao.podeAprovar, status).toBe(false);
      expect(decisao.impedimento, status).toBe("NAO_CONFERIDO");
    }
  });

  it("equipamento novo não declarado: não aprova, mesmo conferido", () => {
    const decisao = decisaoDaAprovacao(conferido({ identidadesNaoDeclaradas: 2 }));
    expect(decisao.podeAprovar).toBe(false);
    expect(decisao.impedimento).toBe("IDENTIDADE_NAO_DECLARADA");

    // Declarada, o mesmo run aprova: a caixa da tela é a única decisão daqui.
    expect(decisaoDaAprovacao(conferido()).podeAprovar).toBe(true);
  });

  it("a quarentena não empresta impedimento à identidade, nem o contrário", () => {
    // Os dois juntos: quem impede é a identidade, e a quarentena continua
    // sendo ressalva — não vira um segundo motivo de trava.
    const decisao = decisaoDaAprovacao(
      conferido({ chavesEmQuarentena: 8, identidadesNaoDeclaradas: 1 }),
    );
    expect(decisao.impedimento).toBe("IDENTIDADE_NAO_DECLARADA");
    expect(decisao.ressalva).not.toBeNull();
  });
});

describe("a decisão não depende do total bruto de erros", () => {
  /*
    Esta é a prova estrutural, e ela é mais forte que qualquer asserção: o
    contrato de entrada não tem onde receber `errors`. O que o teste consegue
    acrescentar é a prova de que nada *equivalente* entrou pela porta dos
    fundos — a quarentena, que é ERRO e é o número que a tela mostrava.
  */
  it("oito conflitos decidem igual a nenhum conflito", () => {
    expect(decisaoDaAprovacao(camacari).podeAprovar).toBe(
      decisaoDaAprovacao(conferido()).podeAprovar,
    );
  });

  it("cem chaves em quarentena continuam aprovando", () => {
    // Não há limiar escondido: quarentena não é erro do arquivo em quantidade
    // nenhuma. O que ela é — vigência incompleta — a ressalva diz.
    expect(decisaoDaAprovacao(conferido({ chavesEmQuarentena: 100 })).podeAprovar).toBe(
      true,
    );
  });
});

describe("a ressalva, dita antes do clique", () => {
  it("nomeia quantos registros ficam de fora e que o resto entra", () => {
    const { ressalva } = decisaoDaAprovacao(camacari);
    expect(ressalva).not.toBeNull();
    expect(ressalva!.frase).toContain("8 registros ficarão de fora por conflito");
    expect(ressalva!.frase).toContain("O restante do arquivo pode ser importado");

    // E o que a frase antiga dizia — corrija antes de aprovar — não aparece
    // mais, porque aprovar deixou de depender disso.
    expect(ressalva!.frase).not.toMatch(/corrija a origem antes de aprovar/i);
    expect(ressalva!.frase).not.toMatch(/8 erros/);
  });

  it("diz que a vigência nasce incompleta, e o que fazer para tê-la inteira", () => {
    const { consequencia } = ressalvaDaQuarentena(8)!;
    expect(consequencia).toMatch(/incompleta/);
    expect(consequencia).toMatch(/nessas chaves/);
    // O caminho continua existindo — deixou de ser condição, não de ser caminho.
    expect(consequencia).toMatch(/corrija a origem e importe de novo/i);
  });

  it("concorda em número quando é uma chave só", () => {
    const uma = ressalvaDaQuarentena(1)!;
    expect(uma.frase).toContain("1 registro ficará de fora");
    expect(uma.consequencia).toMatch(/Uma chave aparece/);
    expect(uma.consequencia).toMatch(/nessa chave/);
  });

  it("cala quando não há o que ressalvar", () => {
    expect(ressalvaDaQuarentena(0)).toBeNull();
    expect(decisaoDaAprovacao(conferido()).ressalva).toBeNull();
  });
});
