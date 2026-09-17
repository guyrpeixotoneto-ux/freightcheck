/**
 * UMA RÉGUA SÓ PARA O DINHEIRO — positivo é ganho, negativo é perda.
 *
 * ---------------------------------------------------------------------------
 * O defeito que este arquivo existe para não deixar voltar
 * ---------------------------------------------------------------------------
 * O produto tinha **duas** réguas de cor para o mesmo sinal, e elas conviviam
 * em telas vizinhas sobre o mesmo dado:
 *
 * - FINAME, IPVA, Lucro Fixo, Seguro e Manutenção liam positivo como ganho —
 *   verde;
 * - Aluguel, Impostos, Km Rodado, Pneu, Consumo e QLP Comparação liam positivo
 *   como custo — vermelho.
 *
 * Cada uma tinha a sua justificativa escrita no próprio arquivo ("o aluguel é o
 * que a operação paga", "esta tela é do lado de quem paga o frete", "o quadro
 * de pessoal é custo"), e cada justificativa era defensável sozinha. Juntas,
 * faziam a mesma alteração de R$ 300 aparecer **verde numa tela e vermelha na
 * outra** — o Monitor Custo Fixo consolida Aluguel e Impostos, e era ali que as
 * duas réguas se encontravam e se contradiziam.
 *
 * A régua do produto é uma só, e `docs/PROVA-DA-EVOLUCAO-DE-FINAME.md` já a
 * tinha escrito: as rubricas são linhas da tabela de frete que a transportadora
 * **recebe**, e "negativo é vermelho e positivo é verde, aqui como em toda tela
 * do produto".
 *
 * ---------------------------------------------------------------------------
 * Por que um arquivo só, e não um caso em cada suíte
 * ---------------------------------------------------------------------------
 * Porque o defeito **não é de nenhuma tela**: é da distância entre elas. Um
 * caso dentro de `pneu.test.ts` prova que o pneu é coerente consigo mesmo, que
 * é exatamente o que cada uma das seis já era. O que faltava era o caso que lê
 * as doze de uma vez, e é este.
 *
 * Quem acrescentar uma auditoria nova entra na lista abaixo. Quem inverter uma
 * das que estão nela reprova aqui, com o nome da tela na mensagem.
 */
import { describe, expect, it } from "vitest";

import { corDaDiferenca as aluguel } from "@/lib/aluguel";
import { corDaDiferenca as consumo } from "@/lib/consumo";
import { corDaDiferenca as finame } from "@/lib/finame";
import { corDaDiferenca as impostos } from "@/lib/impostos";
import { corDaDiferenca as ipva } from "@/lib/ipva";
import { corDaDiferenca as kmRodado } from "@/lib/km-rodado";
import { corDaDiferenca as lucroFixo } from "@/lib/lucro-fixo";
import { corDaDiferenca as manutencao } from "@/lib/manutencao";
import { corDaDiferenca as pneu } from "@/lib/pneu";
import { corDaDiferenca as qlp } from "@/lib/qlp-comparacao";
import { corDoValor } from "@/lib/monitor-custo-fixo";

const VERDE = "text-success";
const VERMELHO = "text-destructive";

/**
 * Cada tela com a chamada que a faz falar de **dinheiro**.
 *
 * O segundo argumento não é decoração: é o que separa a coluna de reais das
 * outras da mesma tela. `consumo` e `pneu` só pintam dinheiro em `RAZAO`,
 * `POR_VIAGEM` e `UNITARIO`; fora disso a régua é outra, e os casos de baixo
 * cuidam disso.
 */
const TELAS: [nome: string, cor: (d: number | null) => string][] = [
  ["Aluguel de Frota", (d) => aluguel(d, "DINHEIRO")],
  ["Consumo (R$/l)", (d) => consumo(d, "RAZAO")],
  ["FINAME", (d) => finame(d, "DINHEIRO")],
  ["Impostos", (d) => impostos(d, "DINHEIRO")],
  ["IPVA", (d) => ipva(d, "DINHEIRO")],
  ["Km Rodado (R$/km)", (d) => kmRodado(d, "RAZAO")],
  ["Lucro Fixo", (d) => lucroFixo(d, "DINHEIRO")],
  ["Manutenção", (d) => manutencao(d, "DINHEIRO")],
  ["Manutenção (R$/km)", (d) => manutencao(d, "REAIS_POR_KM")],
  ["Pneu (R$/km)", (d) => pneu(d, "RAZAO")],
  ["Pneu (unitário)", (d) => pneu(d, "UNITARIO")],
  ["QLP Comparação", (d) => qlp(d, "DINHEIRO")],
];

describe("a régua da cor do dinheiro, em toda tela que pinta dinheiro", () => {
  it.each(TELAS)("%s: positivo é ganho, e sai em verde", (_nome, cor) => {
    expect(cor(7238.85)).toBe(VERDE);
    expect(cor(0.01)).toBe(VERDE);
  });

  it.each(TELAS)("%s: negativo é perda, e sai em vermelho", (_nome, cor) => {
    expect(cor(-21064.41)).toBe(VERMELHO);
    expect(cor(-0.01)).toBe(VERMELHO);
  });

  /*
    Zero não é ganho nem perda — e ausência de número menos ainda. Nenhuma das
    duas ganha cor de direção, e a distinção entre elas mora na célula, que
    escreve `R$ 0,00` num caso e `—` no outro.
  */
  it.each(TELAS)("%s: zero e ausência não ganham cor de direção", (_nome, cor) => {
    expect(cor(0)).toBe("");
    expect(cor(null)).toBe("");
  });

  /*
    O Monitor consolida cinco destas telas, e por isso a régua dele tem de ser
    a mesma — foi ali que as duas se encontravam. Ele fala em classe de Tailwind
    própria (`text-emerald-700`, com a variante escura) por vir de outro
    componente, então o que se confere é o **sentido**, não a string.
  */
  it("o Monitor Custo Fixo lê pela mesma régua", () => {
    expect(corDoValor(7238.85)).toContain("emerald");
    expect(corDoValor(-21064.41)).toBe(VERMELHO);
    expect(corDoValor(0)).toBe("text-muted-foreground");
    expect(corDoValor(null)).toBe("text-muted-foreground");
  });
});

/**
 * As grandezas que **não** são dinheiro — e que por isso não seguem esta régua.
 *
 * Está aqui para que a lista de cima não seja lida como "tudo que sobe é
 * verde". Rendimento, perda e vida útil não têm sinal de dinheiro para ler: são
 * km/l, % e km, e cada uma tem a régua do que ela mede. Apagar a distinção
 * pintaria de verde uma perda de diesel que cresceu.
 */
describe("as grandezas físicas, que têm régua própria", () => {
  it("rendimento (km/l) que sobe é verde, e que cai é vermelho", () => {
    expect(consumo(0.2, "RENDIMENTO")).toBe(VERDE);
    expect(consumo(-0.2, "RENDIMENTO")).toBe(VERMELHO);
  });

  it("perda de diesel que sobe é vermelha — mais perda é menos rendimento", () => {
    expect(consumo(0.2, "PERDA")).toBe(VERMELHO);
    expect(consumo(-0.2, "PERDA")).toBe(VERDE);
  });

  it("vida útil (km) que sobe é verde — a carcaça barateia o quilômetro", () => {
    expect(pneu(5000, "VIDA")).toBe(VERDE);
    expect(pneu(-5000, "VIDA")).toBe(VERMELHO);
  });

  /* E o que não tem lado bom nenhum continua sem cor, em vez de ganhar uma. */
  it("quantidade, distância e alíquota continuam sem cor", () => {
    expect(pneu(4, "QUANTIDADE")).toBe("");
    expect(kmRodado(18, "DISTANCIA")).toBe("");
    expect(impostos(0.75, "PERCENTUAL")).toBe("");
    expect(qlp(3, "QUANTIDADE")).toBe("");
  });
});
