import { describe, expect, it } from "vitest";
import {
  aoPlural,
  EQUIPAMENTOS,
  EQUIPAMENTOS_DO_AMBIENTE,
  equipamentosDoAmbiente,
  equipamentoValido,
  temTrecho,
  frasesDoEscopo,
  lerPlaca,
  linkDaFrota,
  outrasTelas,
  palavrasDoTipo,
  paramsDaTela,
  paramsDoEscopo,
  pluralEmMaiuscula,
  rotuloDoTipo,
  rotuloEmFrase,
  TELA_DO_EQUIPAMENTO,
  todosOsPlural,
  type EscopoDeFrota,
} from "../frota";
import { RECORTE_VAZIO, type Recorte } from "../recorte";

/**
 * O contrato das telas 360°.
 *
 * O defeito que estes casos existem para impedir é o mesmo de `recorte.test.ts`,
 * numa versão pior: não um link quebrado, mas **uma tela que responde por outra
 * população com o nome certo no título**. Cavalo 360° mostrando 1.218 chamados
 * porque o escopo não chegou até os cartões é indistinguível, a olho, de uma
 * tela correta — e quem a lê sai dela com um número que vai para uma reunião.
 *
 * Daí as três regras que cada bloco abaixo cobre:
 *
 * 1. **O escopo se declara** — `escopo=1` acompanha o `entityType` sempre. Sem
 *    essa chave, o mesmo parâmetro quer dizer "filtre a lista" na rota antiga e
 *    "esta tela é do cavalo" na nova, e um link antigo da Visão geral mudaria de
 *    significado sozinho.
 * 2. **A placa viaja no endereço** — ela é o assunto, como a aba: mandar o link
 *    do QYW2D78 tem de abrir no QYW2D78.
 * 3. **A frase acompanha a população** — na frota a tela promete uma coisa, num
 *    ativo promete outra, e dizer a primeira mostrando a segunda é o começo de
 *    toda leitura errada desta tela.
 */

const escopo = (patch: Partial<EscopoDeFrota> = {}): EscopoDeFrota => ({
  entityType: "CAVALO",
  placa: null,
  ...patch,
});

const recorte = (patch: Partial<Recorte> = {}): Recorte => ({
  ...RECORTE_VAZIO,
  ...patch,
});

describe("os equipamentos", () => {
  it("são os seis que têm tela, e nada além", () => {
    expect(EQUIPAMENTOS).toEqual([
      "CAVALO",
      "CARRETA",
      "TRECHO",
      "CAMINHAO",
      "CARROCERIA",
      "EMPILHADEIRA",
    ]);
    expect(equipamentoValido("CAVALO")).toBe(true);
    expect(equipamentoValido("CARRETA")).toBe(true);
    expect(equipamentoValido("TRECHO")).toBe(true);
    expect(equipamentoValido("CAMINHAO")).toBe(true);
    expect(equipamentoValido("CARROCERIA")).toBe(true);
    expect(equipamentoValido("EMPILHADEIRA")).toBe(true);
    // Um quarto tipo vindo do Freightech aparece nas outras telas sozinho —
    // `entity_type` é texto livre no banco. Ganhar uma tela 360° é decisão de
    // produto, com entrada de menu e nome.
    expect(equipamentoValido("REBOQUE")).toBe(false);
    expect(equipamentoValido(null)).toBe(false);
  });

  it("cada um sabe onde mora", () => {
    expect(TELA_DO_EQUIPAMENTO.CAVALO.href).toBe("/cavalo-360");
    expect(TELA_DO_EQUIPAMENTO.CARRETA.href).toBe("/carreta-360");
    expect(TELA_DO_EQUIPAMENTO.TRECHO.href).toBe("/trecho-360");
    expect(TELA_DO_EQUIPAMENTO.CAMINHAO.href).toBe("/caminhao-360");
    expect(TELA_DO_EQUIPAMENTO.CARROCERIA.href).toBe("/carroceria-360");
    expect(TELA_DO_EQUIPAMENTO.EMPILHADEIRA.href).toBe("/empilhadeira-360");
  });

  /*
    O endereço e a chave não têm acento; o rótulo tem. É a distinção que impede
    um link colado num e-mail de deixar de abrir — e a que impede a tela de
    escrever "CAMINHAO" para quem lê.
  */
  it("põe o acento no rótulo, e nunca na chave nem no endereço", () => {
    expect(TELA_DO_EQUIPAMENTO.CAMINHAO.titulo).toBe("Caminhão 360°");
    expect(TELA_DO_EQUIPAMENTO.CAMINHAO.plural).toBe("caminhões");
    expect(TELA_DO_EQUIPAMENTO.CAMINHAO.href).toMatch(/^[a-z0-9/-]+$/);
  });

  /*
    Cada auditoria mostra os ativos da operação dela — é a única seção da
    lateral que muda de um ambiente para o outro. O Apoio é o caso que prova a
    regra: uma tela só, sem carreta e sem trecho.

    O trecho é da Empurrada, e só dela: é o export dela que traz a perna de
    rota, e é lá que ele é importado (`TIPOS_DO_AMBIENTE`, em
    `lib/importacoes.ts`). As duas listas concordam sobre ele de propósito —
    uma tela 360° de um tipo que o ambiente não recebe é uma promessa que a
    importação não pode cumprir.
  */
  it("dá a cada auditoria os ativos da operação dela", () => {
    expect(EQUIPAMENTOS_DO_AMBIENTE.auditoria).toEqual(["CAVALO", "CARRETA", "TRECHO"]);
    expect(EQUIPAMENTOS_DO_AMBIENTE["auditoria-rota"]).toEqual([
      "CAMINHAO",
      "CARROCERIA",
    ]);
    expect(EQUIPAMENTOS_DO_AMBIENTE["auditoria-as"]).toEqual(
      EQUIPAMENTOS_DO_AMBIENTE["auditoria-rota"],
    );
    expect(EQUIPAMENTOS_DO_AMBIENTE["auditoria-apoio"]).toEqual(["EMPILHADEIRA"]);

    /* Nenhum ambiente inventa um tipo que não tenha tela. */
    for (const lista of Object.values(EQUIPAMENTOS_DO_AMBIENTE)) {
      expect(lista.filter((tipo) => !EQUIPAMENTOS.includes(tipo))).toEqual([]);
    }
  });

  it("sabe qual auditoria trabalha com trecho: só a Empurrada", () => {
    expect(temTrecho("auditoria")).toBe(true);
    expect(temTrecho("auditoria-rota")).toBe(false);
    expect(temTrecho("auditoria-as")).toBe(false);
    expect(temTrecho("auditoria-apoio")).toBe(false);
  });

  /* Fora das auditorias — num fechamento — vale a lista da Empurrada. */
  it("cai na lista da Empurrada fora das auditorias", () => {
    expect(equipamentosDoAmbiente("fechamento-rota")).toEqual(
      EQUIPAMENTOS_DO_AMBIENTE.auditoria,
    );
    expect(equipamentosDoAmbiente("auditoria-apoio")).toEqual(["EMPILHADEIRA"]);
  });

  /*
    O trecho não se escolhe por placa, e é a única coisa que o distingue das
    outras duas telas do lado de fora. O rótulo do campo é dele; o parâmetro do
    endereço continua sendo `?placa=` para os três, porque do lado de dentro ele
    sempre foi a chave de grão da linha — trocá-lo quebraria todo link já
    mandado em troca de nada.
  */
  it("chama o identificador pelo nome que o tipo tem", () => {
    expect(TELA_DO_EQUIPAMENTO.CAVALO.identificador).toBe("Placa");
    expect(TELA_DO_EQUIPAMENTO.CARRETA.identificador).toBe("Placa");
    expect(TELA_DO_EQUIPAMENTO.TRECHO.identificador).toBe("Trecho");

    expect(linkDaFrota("TRECHO", { placa: "SP-CAMACARI" })).toBe(
      "/trecho-360?placa=SP-CAMACARI",
    );
    expect(lerPlaca("placa=SP-CAMACARI")).toBe("SP-CAMACARI");
  });

  /*
    "todos os carretas" e "voltar aos carretas" estavam escritos à mão no
    seletor, e o defeito é o mesmo que fez `pronome` e `este` existirem. Um
    terceiro tipo não o cria — só torna impossível continuar ignorando.
  */
  it("concorda em gênero no plural, artigo e crase inclusos", () => {
    expect(todosOsPlural(TELA_DO_EQUIPAMENTO.CAVALO)).toBe("todos os cavalos");
    expect(todosOsPlural(TELA_DO_EQUIPAMENTO.CARRETA)).toBe("todas as carretas");
    expect(todosOsPlural(TELA_DO_EQUIPAMENTO.TRECHO)).toBe("todos os trechos");

    expect(aoPlural(TELA_DO_EQUIPAMENTO.CAVALO)).toBe("aos cavalos");
    expect(aoPlural(TELA_DO_EQUIPAMENTO.CARRETA)).toBe("às carretas");
  });

  /*
    As abas de Alterações recebem o tipo como texto livre, e precisam escrever
    frases sobre ele sem um ternário que fique errado no dia em que chega um
    `DOLLY`. Na frase corrida o desconhecido vira "ativo"; num rótulo, onde ele
    é a única nomeação, ele volta como veio — "Ativos" numa fileira que já tem
    Cavalos e Carretas some dentro das outras duas.
  */
  it("dá palavras a um tipo que não tem tela, sem inventar um nome", () => {
    expect(palavrasDoTipo("DOLLY").singular).toBe("ativo");
    expect(palavrasDoTipo(null).plural).toBe("ativos");
    expect(pluralEmMaiuscula("DOLLY")).toBe("DOLLY");
    expect(pluralEmMaiuscula("TRECHO")).toBe("Trechos");
  });

  /*
    O tipo sem tela 360° que **a importação conhece** tem nome escrito, e é ele
    que a pílula usa: `QLP_ADMINISTRATIVO` em caixa alta é o nome do banco
    vazando para a tela. O plural não se inventa — um quadro de lotação não se
    conta em peças.
  */
  it("escreve o tipo importado pelo nome que a importação lhe dá", () => {
    expect(rotuloDoTipo("QLP_ADMINISTRATIVO")).toBe("QLP Administrativo");
    expect(rotuloDoTipo("QLP_OPERACIONAL")).toBe("QLP Operacional");
    expect(pluralEmMaiuscula("QLP_ADMINISTRATIVO")).toBe("QLP Administrativo");
  });

  /*
    Dentro de uma frase — "Baixar modelo de …" — a palavra comum desce de caixa
    e a sigla não. `rotuloDoTipo(...).toLowerCase()`, que era o que a chamada
    fazia, escrevia "modelo de qlp administrativo".
  */
  it("baixa a caixa do nome comum na frase, e deixa a sigla em pé", () => {
    expect(rotuloEmFrase("CAVALO")).toBe("cavalo");
    expect(rotuloEmFrase("QLP_ADMINISTRATIVO")).toBe("QLP Administrativo");
    expect(rotuloEmFrase("DOLLY")).toBe("DOLLY");
  });

  /*
    O link para "a outra tela" era um ternário entre duas, e um ternário é
    exatamente o que não sobrevive à terceira: ele escolheria uma das outras e
    esconderia a outra sem dizer.
  */
  it("oferece todas as outras telas, e nunca a própria", () => {
    expect(outrasTelas("CAVALO")).toEqual(["CARRETA", "TRECHO"]);
    expect(outrasTelas("TRECHO")).toEqual(["CAVALO", "CARRETA"]);
  });

  /*
    "As outras" são as do ambiente aberto, e não as outras cinco: no Apoio não
    há nenhuma, e oferecer carretas ali levaria a uma tela que o menu de lá não
    lista, sobre um ativo que aquela operação não tem.
  */
  it("oferece só as outras telas da operação auditada", () => {
    expect(outrasTelas("CAMINHAO", EQUIPAMENTOS_DO_AMBIENTE["auditoria-rota"])).toEqual([
      "CARROCERIA",
    ]);
    // O trecho não é oferecido de dentro da Rota: ele não é ativo de lá.
    expect(
      outrasTelas("CAVALO", EQUIPAMENTOS_DO_AMBIENTE.auditoria),
    ).toEqual(["CARRETA", "TRECHO"]);
    expect(
      outrasTelas("EMPILHADEIRA", EQUIPAMENTOS_DO_AMBIENTE["auditoria-apoio"]),
    ).toEqual([]);
  });
});

describe("o escopo como a API o recebe", () => {
  it("declara-se sempre, e não só quando há placa", () => {
    const params = paramsDoEscopo(escopo());
    expect(params.get("escopo")).toBe("1");
    expect(params.get("entityType")).toBe("CAVALO");
    expect(params.has("placa")).toBe(false);
  });

  it("leva a placa quando há uma", () => {
    const params = paramsDoEscopo(escopo({ placa: "QYW2D78" }));
    expect(params.get("placa")).toBe("QYW2D78");
    expect(params.get("escopo")).toBe("1");
  });

  it("leva o recorte de unidade junto, e a vigência só onde ela vale", () => {
    const cheio = recorte({ period: "2026-08-01", scopeHash: "abc", canal: "EMPURRADA" });

    const planilha = paramsDaTela(escopo(), cheio);
    expect(planilha.get("period")).toBe("2026-08-01");
    expect(planilha.get("scopeHash")).toBe("abc");
    expect(planilha.get("canal")).toBe("EMPURRADA");

    // Impacto e Cliente leem a série inteira: uma vigência ali estreitaria a
    // leitura a uma coluna sem que ninguém tivesse pedido.
    const serie = paramsDaTela(escopo(), cheio, { comPeriodo: false });
    expect(serie.has("period")).toBe(false);
    expect(serie.get("scopeHash")).toBe("abc");
  });
});

describe("o endereço da tela", () => {
  it("é limpo na aba padrão, sem placa", () => {
    expect(linkDaFrota("CAVALO")).toBe("/cavalo-360");
    expect(linkDaFrota("CARRETA")).toBe("/carreta-360");
  });

  it("carrega a aba e a placa, que são o assunto", () => {
    expect(linkDaFrota("CAVALO", { placa: "QYW2D78", aba: "impacto" })).toBe(
      "/cavalo-360?aba=impacto&placa=QYW2D78",
    );
  });

  it("não escreve a aba padrão — um ?aba=planilha em todo link é ruído", () => {
    expect(linkDaFrota("CAVALO", { aba: "planilha", placa: "QYW2D78" })).toBe(
      "/cavalo-360?placa=QYW2D78",
    );
  });

  it("é lido de volta pela mesma gramática com que foi escrito", () => {
    const href = linkDaFrota("CARRETA", { placa: "QYW4C69" });
    expect(lerPlaca(href.split("?")[1])).toBe("QYW4C69");
  });

  it("trata placa vazia como frota, e não como uma placa chamada ''", () => {
    expect(lerPlaca("placa=")).toBeNull();
    expect(lerPlaca("")).toBeNull();
  });
});

describe("o que a tela promete", () => {
  /*
    Três níveis, três promessas — e a que mais custa confundir é a do meio: um
    número da frota lido como se fosse de um ativo parece pequeno e vai para uma
    reunião.
  */
  it("promete a situação de cada ativo na grade, que é a porta", () => {
    const { titulo, subtitulo } = frasesDoEscopo(escopo());
    expect(titulo).toBe("Cavalo 360°");
    expect(subtitulo).toContain("cada cavalo da operação");
    expect(subtitulo).toContain("Clique num card");
  });

  it("promete a leitura da frota quando é a frota inteira", () => {
    const { titulo, subtitulo } = frasesDoEscopo(escopo(), "frota");
    expect(titulo).toBe("Cavalo 360° · todos");
    expect(subtitulo).toContain("cavalos");
    expect(subtitulo).toContain("nunca somam");
  });

  it("promete o ativo quando é o ativo, com a placa no título", () => {
    const { titulo, subtitulo } = frasesDoEscopo(escopo({ placa: "QYW2D78" }));
    expect(titulo).toBe("Cavalo 360° · QYW2D78");
    expect(subtitulo).toContain("este cavalo");
  });

  /*
    A frase que o trecho não pode herdar.

    Cavalo e carreta recebem por mês: o custo fixo é do calendário, e é isso que
    a Composição apura. O trecho é pago **por viagem** — é a perna rodada que
    dispara o pagamento. Reaproveitar "quanto ele custa por mês" aqui daria
    periodicidade mensal a um número que não a tem, que é exatamente o erro que
    `change_set.impacto_oficial_by_periodicity` existe para não repetir, agora
    escrito no subtítulo em vez de na coluna.
  */
  it("não promete mês na tela do trecho, porque trecho se paga por viagem", () => {
    const grade = frasesDoEscopo({ entityType: "TRECHO", placa: null });
    expect(grade.titulo).toBe("Trecho 360°");
    expect(grade.subtitulo).toContain("cada trecho da operação");
    expect(grade.subtitulo).toContain("quanto ele paga por viagem");
    expect(grade.subtitulo).not.toContain("por mês");

    const ativo = frasesDoEscopo({ entityType: "TRECHO", placa: "SP-CAMACARI" });
    expect(ativo.titulo).toBe("Trecho 360° · SP-CAMACARI");
    expect(ativo.subtitulo).toContain("este trecho");
  });

  it("fala de carreta na tela da carreta, e no gênero certo", () => {
    const frota = frasesDoEscopo({ entityType: "CARRETA", placa: null }, "frota");
    expect(frota.titulo).toBe("Carreta 360° · todos");
    expect(frota.subtitulo).toContain("carretas");

    // "cada carreta … quanto **ele** custa" é o que sai de um texto montado no
    // masculino e reaproveitado. O gênero é dado do equipamento.
    const grade = frasesDoEscopo({ entityType: "CARRETA", placa: null });
    expect(grade.subtitulo).toContain("quanto ela custa");
    expect(grade.subtitulo).toContain("mudou nela");

    const ativo = frasesDoEscopo({ entityType: "CARRETA", placa: "QYW4C69" });
    expect(ativo.subtitulo).toContain("esta carreta");
    expect(ativo.subtitulo).toContain("quanto ela custou");
  });
});
