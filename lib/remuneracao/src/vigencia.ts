import { periodLabel } from "@workspace/comparison";

/**
 * COMO A VIGÊNCIA SE ESCREVE AQUI — e por que "agosto/2026" não bastava.
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

/** Uma vigência é sempre `aaaa-mm-dd`; o que não for passa direto. */
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A quinzena a que o dia pertence: 1 do dia 1 ao 15, 2 do 16 em diante.
 *
 * Exportada porque `contrato.ts` decide por ela qual planilha responde por uma
 * quinzena — e reescrever a régua lá abriria a porta para as duas divergirem
 * num dia 15 qualquer.
 */
export function quinzenaDe(data: string): 1 | 2 {
  return Number(data.slice(8, 10)) <= 15 ? 1 : 2;
}

/** `2026-08-16` → `16/08/2026`, o mesmo formato do rótulo de competência. */
function comoDia(data: string): string {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

/**
 * O rótulo de uma vigência, dentro do que o contexto dela entregou.
 *
 * `doContexto` são as vigências da mesma unidade e canal — `periodosDisponiveis`.
 * A própria `data` entra na conta mesmo que não esteja na lista: é o que impede
 * o rótulo de afirmar "2ª quinzena" para duas datas ao mesmo tempo quando a
 * chamada vem de fora do conjunto.
 */
export function rotuloDaVigencia(data: string, doContexto: readonly string[]): string {
  if (!DATA.test(data)) return periodLabel(data);

  const mes = data.slice(0, 7);
  const doMes = new Set(doContexto.filter((d) => DATA.test(d) && d.slice(0, 7) === mes));
  doMes.add(data);
  if (doMes.size < 2) return periodLabel(data);

  const quinzenas = new Set([...doMes].map(quinzenaDe));
  return quinzenas.size === doMes.size
    ? `${quinzenaDe(data)}ª quinzena de ${periodLabel(data)}`
    : comoDia(data);
}
