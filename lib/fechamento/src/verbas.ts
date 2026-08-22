import type { Canal } from "./dominio";

/**
 * A VBZ — a verba orçamentária — é a chave semântica do fechamento inteiro.
 *
 * Ela é o único código que atravessa as três fontes financeiras: a requisição
 * de despesa nasce apontando uma VBZ (`000009`), o CT-e é emitido naquela VBZ
 * (`9`), e a conciliação do Promax soma as VBZs em rubricas (`Freteiro`,
 * `Frota Fixa`, `S.Diversos/Comodatos/Eventos`). Sem esse fio, comparar as
 * três é comparar totais — e total que não fecha não diz onde não fechou.
 *
 * **Por que um catálogo em código e não uma tabela de para-de.** Os códigos
 * são do Promax da Ambev, não nossos: mudam quando a Ambev muda, e mudam para
 * todos os clientes ao mesmo tempo. Um catálogo versionado com o código é
 * revisável em diff e testável; uma tabela editável seria mais um lugar onde
 * um erro de digitação vira dinheiro errado sem deixar rastro. O que a tabela
 * ganharia — VBZ nova sem deploy — o `verbaDesconhecida` já dá: a apuração não
 * quebra, a verba entra pelo nome que veio no arquivo, e a tela pede o
 * enquadramento.
 */

/**
 * O que a verba é na conta do fechamento.
 *
 * Esta é a classificação que decide **de onde o FreightCheck reconstrói** cada
 * parcela — e é o motivo de o catálogo existir:
 *
 * - `VARIAVEL` — nasce da operação, viagem a viagem. Confere-se contra o 2Art.
 * - `FIXO` — a parcela contratada da frota. Confere-se contra a
 *   disponibilidade, que é quem a desconta.
 * - `COMPLEMENTAR` — despesa extra aprovada. Confere-se contra as requisições.
 * - `ADMINISTRATIVO` — repasse fixo que não tem realizado a conferir; entra na
 *   conta pelo que foi emitido, e o módulo diz que é assim.
 */
export type NaturezaDaVerba = "VARIAVEL" | "FIXO" | "COMPLEMENTAR" | "ADMINISTRATIVO";

export interface Verba {
  /** O código como o CT-e o traz: inteiro, sem zeros à esquerda. */
  vbz: number;
  canal: Canal;
  /** O nome curto, nosso, estável — o que a tela mostra. */
  nome: string;
  natureza: NaturezaDaVerba;
  /**
   * A rubrica da conciliação (03.02.59.02) em que esta verba desemboca.
   *
   * `null` quando a verba não entra na conciliação de variável — é o caso de
   * todo o fixo e do administrativo, que o relatório do Promax não cobre. Ter
   * isso explícito é o que impede a conferência de acusar divergência onde
   * simplesmente não há o que conciliar.
   */
  rubricaDaConciliacao: RubricaDaConciliacao | null;
}

/**
 * As rubricas em que a conciliação do Promax soma as verbas.
 *
 * São exatamente as linhas do "RESUMO DA QUINZENA ATUAL" do relatório, em cada
 * uma das duas seções (ROTA e AS).
 */
export type RubricaDaConciliacao = "FROTA_FIXA" | "FRETEIRO" | "SERVICOS_DIVERSOS";

/**
 * O catálogo, conferido contra um fechamento real (CDD Belém, 2ª quinzena de
 * julho/2026, transportadora 036). Toda VBZ que apareceu naquele arquivo está
 * aqui; as que não apareceram não foram inventadas.
 */
export const VERBAS: Verba[] = [
  // --- ROTA ---------------------------------------------------------------
  { vbz: 1, canal: "ROTA", nome: "Frota Fixa Ativa", natureza: "FIXO", rubricaDaConciliacao: null },
  { vbz: 2, canal: "ROTA", nome: "Equipe Entrega Ativa", natureza: "FIXO", rubricaDaConciliacao: null },
  { vbz: 3, canal: "ROTA", nome: "Despesa Administrativa", natureza: "ADMINISTRATIVO", rubricaDaConciliacao: null },
  { vbz: 4, canal: "ROTA", nome: "Frota Fixa Inativa", natureza: "FIXO", rubricaDaConciliacao: null },
  /*
    A VBZ 5 é a maior do arquivo em número de linhas — 19.392 CT-es na
    quinzena conferida, um por nota fiscal. É ela que carrega o frete das
    viagens da frota fixa, e por isso é a que se confere contra o 2Art.
  */
  { vbz: 5, canal: "ROTA", nome: "Frota Fixa Variável", natureza: "VARIAVEL", rubricaDaConciliacao: "FROTA_FIXA" },
  { vbz: 6, canal: "ROTA", nome: "Rem. Variável Equipe Entrega", natureza: "COMPLEMENTAR", rubricaDaConciliacao: null },
  { vbz: 7, canal: "ROTA", nome: "Freteiro", natureza: "VARIAVEL", rubricaDaConciliacao: "FRETEIRO" },
  { vbz: 8, canal: "ROTA", nome: "Frete Serviços Diversos/Comodato", natureza: "COMPLEMENTAR", rubricaDaConciliacao: "SERVICOS_DIVERSOS" },
  { vbz: 9, canal: "ROTA", nome: "Outras Despesas", natureza: "COMPLEMENTAR", rubricaDaConciliacao: null },

  // --- AS -----------------------------------------------------------------
  { vbz: 20, canal: "AS", nome: "Frota Fixa Ativa", natureza: "FIXO", rubricaDaConciliacao: null },
  { vbz: 23, canal: "AS", nome: "Frota Fixa Inativa", natureza: "FIXO", rubricaDaConciliacao: null },
  { vbz: 24, canal: "AS", nome: "Frota Fixa Variável", natureza: "VARIAVEL", rubricaDaConciliacao: "FROTA_FIXA" },
  { vbz: 26, canal: "AS", nome: "Freteiro", natureza: "VARIAVEL", rubricaDaConciliacao: "FRETEIRO" },
  { vbz: 29, canal: "AS", nome: "Estadias", natureza: "COMPLEMENTAR", rubricaDaConciliacao: null },
  { vbz: 30, canal: "AS", nome: "Outras Despesas", natureza: "COMPLEMENTAR", rubricaDaConciliacao: null },
];

/**
 * A `VBZ 06` — `Rota - Rem. Variável Equipe Entrega`.
 *
 * O número é do domínio e não da tela: é ele que separa o quarto quadro dos
 * outros custos, dos dois lados da conferência — no 03.08.12.09, que é de onde
 * o devido dela sai, e no bloco `OUTROS CUSTOS` do 03.08.20, que é de onde sai
 * o demonstrado. Escrevê-lo solto nos dois deixaria os dois livres para
 * divergir, e é por isso que ele mora aqui, no catálogo das verbas, e não em
 * nenhum dos dois lados.
 *
 * A natureza não serve para separá-la: a `VBZ 06`, a `08` e a `09` são todas
 * `COMPLEMENTAR`. O corte é mesmo por código.
 */
export const VBZ_DA_EQUIPE_DE_ENTREGA = 6;

const PORVBZ = new Map<number, Verba>(VERBAS.map((v) => [v.vbz, v]));

/** A verba de um código, ou `null` se o catálogo não a conhece. */
export function verbaDe(vbz: number): Verba | null {
  return PORVBZ.get(vbz) ?? null;
}

/**
 * A verba de um código que o catálogo não conhece.
 *
 * Uma VBZ nova não pode derrubar o fechamento nem sumir dele: ela entra com o
 * nome que veio no arquivo, natureza indefinida e sem rubrica, e a apuração a
 * soma no total emitido enquanto a tela pede o enquadramento. O contrário
 * — ignorar — faria a conta fechar contra um total menor do que a Ambev
 * emitiu, que é exatamente o erro que este produto existe para não cometer.
 */
export function verbaDesconhecida(vbz: number, canal: Canal, nomeNoArquivo: string): Verba {
  return {
    vbz,
    canal,
    nome: nomeNoArquivo.trim() || `VBZ ${vbz}`,
    natureza: "COMPLEMENTAR",
    rubricaDaConciliacao: null,
  };
}

/**
 * O canal que o próprio nome da verba declara.
 *
 * O 03.08.15 traz `Desc VBZ` prefixado — `Rota - Freteiro`, `AS - Estadias` —
 * e esse prefixo é a única declaração de canal do arquivo (não há coluna de
 * canal). Ler o prefixo é, portanto, ler um dado, não inferir um: o que não
 * começar com um dos dois prefixos devolve `null` e vira recusa.
 */
export function canalDoNomeDaVerba(desc: string): Canal | null {
  const texto = desc.trim().toLowerCase();
  if (texto.startsWith("rota -") || texto.startsWith("rota-")) return "ROTA";
  if (texto.startsWith("as -") || texto.startsWith("as-")) return "AS";
  return null;
}
