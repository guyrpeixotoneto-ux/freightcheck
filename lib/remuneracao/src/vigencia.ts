import { quinzenaDe, rotuloDaVigencia } from "@workspace/comparison";

/**
 * COMO A VIGÊNCIA SE ESCREVE AQUI — e por que "agosto/2026" não bastava.
 *
 * **A régua mudou de casa, e não de conteúdo.** `rotuloDaVigencia` e
 * `quinzenaDe` nasceram neste arquivo e hoje moram em
 * `@workspace/comparison/labels`, reexportadas daqui: a Auditoria passou a
 * precisar da mesma garantia — o seletor da tela de Parâmetros oferecia duas
 * opções escritas "agosto/2026" quando a unidade entregava duas vigências no
 * mês —, e duas implementações da mesma régua concordariam só no dia em que
 * fossem escritas. O texto abaixo continua sendo a explicação de por que ela
 * existe; o corpo dela está lá.
 *
 * `periodLabel` responde `2026-08-01` → `agosto/2026`, e é a resposta certa em
 * quase todo o produto: as telas da Auditoria comparam vigências de meses
 * diferentes, e o mês é o que as separa. Neste módulo não é. A planilha de
 * remuneração é **quinzenal** — a mesma unidade entrega `2026-08-01` e
 * `2026-08-16` —, e pelo mês as duas viram o mesmo texto: dois itens idênticos
 * no seletor de vigência, duas colunas com o mesmo título na comparação, e uma
 * coluna "vigência mais recente" que não diz qual das duas respondeu.
 *
 * O custo disso não é estético. Quem abre o formulário para digitar a segunda
 * quinzena escolhe entre dois rótulos iguais, e cair na certa é sorte — a outra
 * metade das vezes é a primeira quinzena que se sobrescreve, sem que nada na
 * tela tenha avisado que eram duas.
 *
 * **A régua da quinzena é a que o produto já tem.** Do dia 1 ao 15 é a
 * primeira, do 16 ao fim do mês é a segunda: é `competenciaDoDia`, em
 * `@workspace/fechamento`. Ela está restatada aqui, e não importada, pela
 * fronteira que o módulo mantém em toda parte (ver `index.ts`) — a Auditoria
 * não depende do Fechamento, e uma linha de calendário não paga trazer o
 * ambiente inteiro para dentro do leitor do acervo.
 *
 * **O rótulo é do conjunto, e não da data sozinha.** Uma unidade que entrega
 * uma vigência por mês não tem quinzena nenhuma, e chamar o `2026-08-01` dela
 * de "1ª quinzena" inventaria um grão que os arquivos não têm — a inferência
 * que este módulo recusa em todo o resto. Por isso a função recebe as vigências
 * do contexto: mês com uma entrega continua sendo `agosto/2026`, e só o mês
 * partido ganha a ordinal.
 *
 * E quando o mês tem entregas que a quinzena não separa — três vigências, ou
 * duas caídas na mesma metade —, o rótulo é o **dia**, em `dd/mm/aaaa`, que é
 * como o produto inteiro escreve um dia. É a saída honesta das duas pontas:
 * distingue sempre, porque duas vigências do mesmo contexto nunca têm a mesma
 * data, e não afirma uma quinzena que o calendário não sustenta.
 */

/** Os dois dias em que uma quinzena começa, e os meses que existem. */
const INICIO_DE_QUINZENA = /^\d{4}-(0[1-9]|1[0-2])-(01|16)$/;

export function ehInicioDeQuinzena(data: string): boolean {
  if (!INICIO_DE_QUINZENA.test(data)) return false;
  const ano = Number(data.slice(0, 4));
  return ano >= 2000 && ano <= 2100;
}

/**
 * A quinzena a que o dia pertence: 1 do dia 1 ao 15, 2 do 16 em diante.
 *
 * Reexportada de `@workspace/comparison`, onde a régua mora desde que a
 * Auditoria passou a escrever vigências com ela. Continua saindo daqui porque
 * `contrato.ts` decide por ela qual planilha responde por uma quinzena, e o
 * módulo não deveria ter de saber em que pacote a linha de calendário mora.
 */
export { quinzenaDe, rotuloDaVigencia };
