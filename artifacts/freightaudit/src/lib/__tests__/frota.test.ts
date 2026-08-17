import { describe, expect, it } from "vitest";
import {
  EQUIPAMENTOS,
  equipamentoValido,
  flexoesDe,
  frasesDoEscopo,
  lerPlaca,
  linkDaFrota,
  paramsDaTela,
  paramsDoEscopo,
  TELA_DO_EQUIPAMENTO,
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
  it("são os dois que têm tela, e nada além", () => {
    expect(EQUIPAMENTOS).toEqual(["CAVALO", "CARRETA"]);
    expect(equipamentoValido("CAVALO")).toBe(true);
    expect(equipamentoValido("CARRETA")).toBe(true);
    // Um terceiro tipo vindo do Freightech aparece nas outras telas sozinho —
    // `entity_type` é texto livre no banco. Ganhar uma tela 360° é decisão de
    // produto, com entrada de menu e nome.
    expect(equipamentoValido("REBOQUE")).toBe(false);
    expect(equipamentoValido(null)).toBe(false);
  });

  it("cada um sabe onde mora", () => {
    expect(TELA_DO_EQUIPAMENTO.CAVALO.href).toBe("/cavalo-360");
    expect(TELA_DO_EQUIPAMENTO.CARRETA.href).toBe("/carreta-360");
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

  it("flexiona tudo o que a tela escreve, nos dois gêneros", () => {
    /*
      As duas telas são o mesmo componente, então toda frase montada no
      masculino vaza para a carreta. Estiveram no ar: "cada carreta … quanto
      **ele** custa" e "ver as alterações de todos **os** carretas".

      O caso compara os dois lados campo a campo em vez de conferir um só: uma
      flexão nova acrescentada para o cavalo e esquecida para a carreta é
      exatamente o defeito que se repetiu, e ele passa despercebido num teste
      que olha um gênero de cada vez.
    */
    const m = flexoesDe("CAVALO");
    const f = flexoesDe("CARRETA");

    expect(m).toEqual({
      pronome: "ele",
      nele: "nele",
      este: "este",
      os: "os",
      todos: "todos os",
      aos: "aos",
      nenhum: "Nenhum",
    });
    expect(f).toEqual({
      pronome: "ela",
      nele: "nela",
      este: "esta",
      os: "as",
      todos: "todas as",
      aos: "às",
      nenhum: "Nenhuma",
    });

    // Nenhuma flexão pode ser igual nos dois: uma que fosse já não seria flexão,
    // e estaria ali só esperando alguém escrevê-la à mão de novo.
    for (const chave of Object.keys(m) as (keyof typeof m)[]) {
      expect(m[chave], chave).not.toBe(f[chave]);
    }
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
