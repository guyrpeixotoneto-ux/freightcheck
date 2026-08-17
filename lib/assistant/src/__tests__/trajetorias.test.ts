/**
 * A métrica que quase inverteu uma decisão.
 *
 * **O que ela mede.** "Perguntas diferentes produzem investigações diferentes"
 * — a tese inteira do caminho do agente, reduzida a um número que a bateria
 * imprime ao lado dos desfechos.
 *
 * **Como ela mentiu.** A versão anterior era
 * `consultas.slice().sort().join(",")`. Ordenar apaga a ordem das chamadas e
 * colapsa as repetidas, e as duas perdas atingem justamente o que distingue uma
 * investigação de uma consulta: encadear e voltar. Na primeira rodada real do
 * PR 7 ela relatou trajetórias caindo de 2 para 1, enquanto o relatório de
 * trajetórias ao lado mostrava nove caminhos distintos, um deles com onze
 * chamadas encadeadas. Não foi contar a menos — foi afirmar o contrário do que
 * havia acontecido, sobre a única pergunta que a bateria existe para responder.
 *
 * Uma métrica errada é pior do que métrica nenhuma: ela é lida com a mesma
 * confiança de uma certa, e é o que sobra no relatório depois que a memória da
 * rodada acaba.
 */

import { describe, expect, it } from "vitest";
import { assinaturaDeTrajetoria, trajetoriasDistintas } from "../medicao";

describe("trajetórias distintas", () => {
  it("a ordem das chamadas distingue duas investigações", () => {
    const descobrirEntaoOlhar = ["recortes", "alteracoes"];
    const olharEntaoSituar = ["alteracoes", "recortes"];

    expect(
      assinaturaDeTrajetoria(descobrirEntaoOlhar),
      "a assinatura não pode ser invariante à ordem",
    ).not.toBe(assinaturaDeTrajetoria(olharEntaoSituar));
    expect(trajetoriasDistintas([descobrirEntaoOlhar, olharEntaoSituar])).toBe(2);
  });

  it("voltar a uma ferramenta é um gesto, e não ruído", () => {
    /*
      Listar e depois abrir um grupo é `alteracoes` duas vezes com argumentos
      diferentes — o gesto que separa "listou" de "investigou". A versão
      ordenada colapsava os dois numa assinatura só.
    */
    const listou = ["alteracoes", "ordenacao"];
    const investigou = ["alteracoes", "ordenacao", "alteracoes"];

    expect(trajetoriasDistintas([listou, investigou])).toBe(2);
  });

  it("o defeito exato que existia — sort colapsa o que a métrica deveria separar", () => {
    const a = ["recortes", "alteracoes", "parametros"];
    const b = ["parametros", "alteracoes", "recortes"];

    const comoEra = new Set([a, b].map((c) => c.slice().sort().join(","))).size;
    expect(comoEra, "a versão anterior via um caminho só onde havia dois").toBe(1);
    expect(trajetoriasDistintas([a, b]), "a versão atual vê os dois").toBe(2);
  });

  it("trajetórias iguais continuam iguais — a métrica não infla", () => {
    const mesma = ["recortes", "alteracoes"];
    expect(trajetoriasDistintas([mesma, [...mesma], [...mesma]])).toBe(1);
  });

  it("nenhuma consulta é uma trajetória, e todas as vazias são a mesma", () => {
    expect(trajetoriasDistintas([[], []])).toBe(1);
    expect(trajetoriasDistintas([[], ["alteracoes"]])).toBe(2);
  });

  /**
   * O caso que reproduz a inversão, com a forma que a rodada real tinha.
   *
   * A construção é sintética — o relatório daquela rodada não sobreviveu à
   * limpeza da pasta, e inventar números e chamá-los de gravação seria o mesmo
   * defeito que este produto inteiro existe para não cometer. O que se
   * reproduz aqui é a **forma**: investigações longas que voltam às mesmas
   * ferramentas com argumentos diferentes, que é como as trajetórias do agente
   * se pareciam.
   *
   * É nessa forma que a métrica antiga colapsa, e o colapso piora quanto mais
   * rica a investigação — ela erra mais justamente onde acertar importa mais.
   */
  it("investigações longas que revisitam ferramentas colapsavam em uma só", () => {
    const listouEDesceu = ["alteracoes", "alteracoes", "ordenacao"];
    const ordenouEAbriuDuas = ["ordenacao", "alteracoes", "alteracoes"];
    const alternou = ["alteracoes", "ordenacao", "alteracoes"];

    const caminhos = [listouEDesceu, ordenouEAbriuDuas, alternou];

    expect(
      new Set(caminhos.map((c) => c.slice().sort().join(","))).size,
      "as três têm o mesmo multiconjunto de ferramentas, e a versão anterior " +
        "via um caminho só — a leitura era «o agente convergiu», o oposto do " +
        "que os dados mostravam",
    ).toBe(1);

    expect(trajetoriasDistintas(caminhos), "são três investigações diferentes").toBe(3);
  });
});
