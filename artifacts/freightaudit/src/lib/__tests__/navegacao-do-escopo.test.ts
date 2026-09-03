import { describe, expect, it } from "vitest";
import {
  enderecoDe,
  enderecoDeVisaoGeral,
  enderecoDoAno,
  visaoGeralAtiva,
} from "../navegacao-do-escopo";

/**
 * Para onde o seletor de unidade leva — a regressão que este arquivo guarda.
 *
 * O sintoma que trouxe estes testes: estando no **Painel de Unidades**, escolher
 * "Visão Geral" na lateral jogava quem escolheu para o Resumo executivo, e
 * escolher uma unidade mantinha o Painel mas não filtrava nada. As duas metades
 * do mesmo seletor erravam em direções opostas, e nenhuma tinha teste porque as
 * funções moravam dentro do componente.
 *
 * O que roda aqui é o contrato do seletor, e nada de pixel:
 *
 * 1. o Painel honra os dois modos e não expulsa ninguém;
 * 2. quem não sabe ler o recorte continua sendo desviado, que é o que impede um
 *    filtro prometido e não aplicado;
 * 3. o tempo sobrevive à troca de escopo — e é `ano` no Painel, `period` fora
 *    dele;
 * 4. a caixa da lateral diz "Visão Geral" quando é isso que a tela está
 *    mostrando.
 */

const PAINEL = "/visao-gerencial";
const CAMACARI = { scopeHash: "scope-camacari", channel: "EMPURRADA" };
const consulta = (endereco: string) =>
  Object.fromEntries(new URLSearchParams(endereco.split("?")[1] ?? ""));
const tela = (endereco: string) => endereco.split("?")[0];

describe("escolher uma unidade", () => {
  /*
    O requisito 2: continuar no Painel, com o escopo escrito no endereço. Antes
    o escopo também era escrito — e a tela o ignorava; o que garante o filtro é
    o teste de `resumirEscopo`, em `auditoria-gerencial.test.ts`. Aqui garante-se
    só que a unidade chega lá.
  */
  it("mantém o Painel de Unidades e leva o escopo junto", () => {
    const destino = enderecoDe(CAMACARI, PAINEL, "?ano=2026");

    expect(tela(destino)).toBe(PAINEL);
    expect(consulta(destino)).toEqual({
      scopeHash: "scope-camacari",
      canal: "EMPURRADA",
      ano: "2026",
    });
  });

  /* O requisito 4, pela outra ponta: o ano lido continua sendo o ano aberto. */
  it("preserva o ano que estava aberto", () => {
    expect(consulta(enderecoDe(CAMACARI, PAINEL, "?ano=2025")).ano).toBe(
      "2025",
    );
  });

  /*
    Sem canal no contexto, sem `canal` no endereço: a ausência da chave quer
    dizer "as vigências sem canal legível", e um `canal=` vazio seria uma
    partição diferente. Ver `Recorte`, em `lib/recorte.ts`.
  */
  it("omite o canal quando o contexto não tem um", () => {
    const destino = enderecoDe(
      { scopeHash: "scope-x", channel: null },
      PAINEL,
      "",
    );

    expect(consulta(destino)).toEqual({ scopeHash: "scope-x" });
  });

  it("desvia para Parâmetros nas telas que não sabem ler o escopo", () => {
    expect(tela(enderecoDe(CAMACARI, "/importacoes", ""))).toBe("/parametros");
  });

  /*
    `ano` é o recorte temporal do Painel e de mais nenhuma tela. Levá-lo para
    Parâmetros seria sujar todo link colado por aí com um parâmetro que ninguém
    lê do outro lado.
  */
  it("não leva o ano para uma tela que fala de quinzena", () => {
    const destino = enderecoDe(CAMACARI, "/parametros", "?ano=2026");

    expect(consulta(destino).ano).toBeUndefined();
  });
});

describe("escolher a Visão Geral", () => {
  /*
    O requisito 3, e o sintoma original: `/visao-gerencial` fora de
    `TELAS_QUE_HONRAM_VISAO_GERAL` mandava para `/resumo-executivo` a pessoa que
    pediu justamente a tela em que já estava.
  */
  it("mantém o Painel de Unidades em vez de expulsar para o Resumo executivo", () => {
    const destino = enderecoDeVisaoGeral(
      PAINEL,
      "?scopeHash=scope-camacari&ano=2026",
    );

    expect(tela(destino)).toBe(PAINEL);
    expect(consulta(destino)).toEqual({ visaoGeral: "1", ano: "2026" });
  });

  /* O escopo tem de sumir do endereço: é o que faz voltarem todos os cartões. */
  it("larga o escopo da unidade que estava aberta", () => {
    const destino = enderecoDeVisaoGeral(
      PAINEL,
      "?scopeHash=scope-camacari&canal=EMPURRADA",
    );

    expect(consulta(destino).scopeHash).toBeUndefined();
    expect(consulta(destino).canal).toBeUndefined();
  });

  /*
    Parâmetros era o caso que este teste travava pelo avesso: ele afirmava que
    escolher "Visão Geral" ali levava para outra tela, e era exatamente essa a
    reclamação — trocar de recorte não pode trocar de assunto. A tela entrou em
    `TELAS_QUE_HONRAM_VISAO_GERAL` quando passou a existir a soma que ela lê
    (`FamiliesOverview.parametros`), e a vigência vai junto: quem estava em
    agosto quer todas as unidades **em agosto**.
  */
  it("mantém Parâmetros, com a vigência aberta", () => {
    const destino = enderecoDeVisaoGeral(
      "/parametros",
      "?period=2026-08-01&scopeHash=scope-pernambuco&canal=EMPURRADA",
    );

    expect(tela(destino)).toBe("/parametros");
    expect(consulta(destino)).toEqual({
      visaoGeral: "1",
      period: "2026-08-01",
    });
  });

  it("continua desviando para o Resumo executivo onde não há Visão Geral", () => {
    const destino = enderecoDeVisaoGeral("/composicao", "?period=2026-08-01");

    expect(tela(destino)).toBe("/resumo-executivo");
    expect(consulta(destino)).toEqual({
      visaoGeral: "1",
      period: "2026-08-01",
    });
  });
});

describe("o Painel de Justificativas", () => {
  /*
    A reclamação, nas palavras de quem a fez: "estou mudando de PERNAMBUCO para
    Visão Geral e está saindo do módulo Painel de Justificativas". Saía porque a
    tela estava fora das duas listas — e o desvio para o Resumo executivo é
    justamente o que sobra quando a tela não sabe ler o recorte.

    As duas metades do seletor têm de manter a tela: a Visão Geral porque a rota
    sem `scopeHash` soma a operação inteira, a unidade porque as duas consultas
    do painel levam o `scopeHash` (`lib/painel-de-justificativas.ts`). Sem estes
    dois testes, tirar a tela de qualquer uma das listas volta a ser silencioso.
  */
  const PAINEL_DE_JUSTIFICATIVAS = "/painel-de-justificativas";

  it("não expulsa quem escolhe a Visão Geral", () => {
    const destino = enderecoDeVisaoGeral(
      PAINEL_DE_JUSTIFICATIVAS,
      "?scopeHash=scope-pernambuco&canal=EMPURRADA&period=2026-08-01",
    );

    expect(tela(destino)).toBe(PAINEL_DE_JUSTIFICATIVAS);
    expect(consulta(destino)).toEqual({
      visaoGeral: "1",
      period: "2026-08-01",
    });
  });

  it("não expulsa quem escolhe uma unidade, e leva o escopo junto", () => {
    const destino = enderecoDe(
      CAMACARI,
      PAINEL_DE_JUSTIFICATIVAS,
      "?visaoGeral=1&period=2026-08-01",
    );

    expect(tela(destino)).toBe(PAINEL_DE_JUSTIFICATIVAS);
    expect(consulta(destino)).toEqual({
      scopeHash: "scope-camacari",
      canal: "EMPURRADA",
      period: "2026-08-01",
    });
  });
});

describe("o Monitoramento de Chamados", () => {
  /*
    A mesma reclamação do Painel de Justificativas, dita de novo e sobre outra
    tela: "eu mudo de PERNAMBUCO para CAMAÇARI e muda o módulo, mas eu quero ver
    justamente os chamados que importei de Camaçari". Saía porque a tela estava
    fora das duas listas — e o desvio para Parâmetros é o que sobra quando a
    tela não sabe ler o recorte.

    Que a tela cumpra a promessa depois de entrar aqui é o que
    `serie-da-unidade.test.ts` trava, do outro lado.
  */
  const MONITORAMENTO = "/monitoramento-de-chamados";

  it("não expulsa quem escolhe uma unidade, e leva o escopo junto", () => {
    const destino = enderecoDe(CAMACARI, MONITORAMENTO, "?dia=2026-08-28");

    expect(tela(destino)).toBe(MONITORAMENTO);
    expect(consulta(destino)).toEqual({
      scopeHash: "scope-camacari",
      canal: "EMPURRADA",
      dia: "2026-08-28",
    });
  });

  it("não expulsa quem escolhe a Visão Geral", () => {
    const destino = enderecoDeVisaoGeral(
      MONITORAMENTO,
      "?scopeHash=scope-pernambuco&canal=EMPURRADA&dia=2026-08-28",
    );

    expect(tela(destino)).toBe(MONITORAMENTO);
    expect(consulta(destino)).toEqual({ visaoGeral: "1", dia: "2026-08-28" });
  });

  /*
    O tempo desta tela é o **dia** da importação, não a quinzena: quem está
    olhando 28/08 e troca de unidade quer 28/08 na unidade nova. `period` não
    tem leitor aqui e ficaria sujando todo link colado por aí.
  */
  it("preserva o dia aberto, e não a quinzena", () => {
    const destino = enderecoDe(
      CAMACARI,
      MONITORAMENTO,
      "?dia=2026-08-28&period=2026-08-01",
    );

    expect(consulta(destino).dia).toBe("2026-08-28");
    expect(consulta(destino).period).toBeUndefined();
  });

  /* E o dia não viaja para as telas que falam de quinzena. */
  it("não leva o dia para uma tela de vigência", () => {
    const destino = enderecoDe(CAMACARI, "/parametros", "?dia=2026-08-28");

    expect(consulta(destino).dia).toBeUndefined();
  });
});

describe("trocar o ano no Painel", () => {
  /* O requisito 4: trocar de ano é uma pergunta sobre tempo, não sobre escopo. */
  it("não perde a unidade selecionada", () => {
    const destino = enderecoDoAno(
      "2025",
      "?ano=2026&scopeHash=scope-camacari&canal=EMPURRADA",
    );

    expect(tela(destino)).toBe(PAINEL);
    expect(consulta(destino)).toEqual({
      ano: "2025",
      scopeHash: "scope-camacari",
      canal: "EMPURRADA",
    });
  });

  it("não perde a Visão Geral quando é ela que está aberta", () => {
    expect(consulta(enderecoDoAno("2025", "?visaoGeral=1&ano=2026"))).toEqual({
      visaoGeral: "1",
      ano: "2025",
    });
  });
});

describe("o que a caixa da lateral mostra", () => {
  /*
    O requisito 1, pelo lado da lateral. A caixa resolvia a unidade com
    `contextos[0]` e nunca perguntava se a tela estava mostrando todas — então
    abrir o produto pintava PERNAMBUCO na lateral enquanto o Painel listava as
    cinco unidades.
  */
  it("diz Visão Geral no Painel sem escopo — a porta de entrada", () => {
    expect(visaoGeralAtiva(PAINEL, "")).toBe(true);
    expect(visaoGeralAtiva(PAINEL, "?ano=2026")).toBe(true);
  });

  it("nomeia a unidade quando há escopo no Painel", () => {
    expect(visaoGeralAtiva(PAINEL, "?scopeHash=scope-camacari&ano=2026")).toBe(
      false,
    );
  });

  it("segue lendo o `visaoGeral=1` das outras telas", () => {
    expect(visaoGeralAtiva("/resumo-executivo", "?visaoGeral=1")).toBe(true);
    expect(visaoGeralAtiva("/resumo-executivo", "?period=2026-08-01")).toBe(
      false,
    );
  });
});
