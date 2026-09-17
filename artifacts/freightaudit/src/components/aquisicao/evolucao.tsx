import { ShoppingCart } from "lucide-react";
import {
  CODIGOS_DA_TABELA_DE_AQUISICAO,
  codigosDoRecorteDeAquisicao,
} from "@workspace/comparison/aquisicao";
import type { RubricaDaEvolucao } from "@/components/comparacao/evolucao/painel";

/**
 * A Auditoria de Aquisição na aba Evolução — o que só ela tem a dizer.
 *
 * A tela inteira (a matriz, os cartões, o seletor de ano, a gaveta da placa)
 * mora em `comparacao/evolucao/painel.tsx`, com as outras rubricas de custo
 * fixo. Daqui saem o nome, o ícone, os códigos de atributo e as palavras.
 *
 * ---------------------------------------------------------------------------
 * A aba que costuma abrir vazia — e por que isso é a resposta
 * ---------------------------------------------------------------------------
 * `docs/ACHADO-AQUISICAO.md` mede: no acervo de hoje, cada ativo tem um único
 * valor de nota, um único percentual de entrada e uma única data ao longo das 18
 * vigências. Então esta aba abre, quase sempre, na tela de "nada se moveu" — e é
 * exatamente essa a leitura que ela publica: o ano inteiro conferido de uma vez,
 * com as colunas que existem nomeadas.
 *
 * Houve aqui a decisão oposta — não ter aba, para não prometer movimento onde
 * não há. Ela caía num vão: quem precisa afirmar que a base de compra não se
 * mexeu no ano não tinha onde ler isso, e ficava reabrindo a comparação par a
 * par. A tela vazia diz a mesma coisa em uma tela, e no dia em que uma nota for
 * retificada a matriz mostra qual ativo e em que vigência — que é o dia para o
 * qual esta auditoria existe.
 *
 * ---------------------------------------------------------------------------
 * Duas das três colunas não viram reais
 * ---------------------------------------------------------------------------
 * O percentual de entrada e a data de entrada contam como alteração e nunca
 * viram R$ — os cartões as citam por extenso. E o valor de nota, quando se move,
 * aparece com o valor dele: ter tela onde ser conferido e ter total onde ser
 * somado continuam sendo duas coisas diferentes, e esta tela só faz a primeira.
 */
export const EVOLUCAO_DA_AQUISICAO: RubricaDaEvolucao = {
  nome: "aquisição",
  icone: ShoppingCart,
  idPrefixo: "aquisicao",
  codigosDaTabela: CODIGOS_DA_TABELA_DE_AQUISICAO,
  codigosDoRecorte: (recorte) => codigosDoRecorteDeAquisicao(recorte),
  leitura: {
    titulo: "Variação da base de compra por ativo ao longo do ano",
    acumulado: "Variação no ano",
  },
  semValoracao: "percentual de entrada, data de entrada",
  descricaoSemMovimento: (colunas) =>
    `As ${colunas} ${colunas === 1 ? "vigência comparada" : "vigências comparadas"} deste ` +
    `recorte têm o mesmo valor de nota, a mesma entrada e a mesma data em todos os ` +
    `ativos — que é o resultado esperado de uma base de compra. Uma linha aqui seria ` +
    `nota retificada ou cadastro corrigido.`,
};
