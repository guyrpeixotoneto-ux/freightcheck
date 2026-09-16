import type { RascunhoDaJustificativa } from "@workspace/comparison/justificativa-estruturada";

/**
 * O que foi digitado e ainda não foi gravado — guardado no navegador, por
 * alteração.
 *
 * Justificar deixou de ser uma caixa e passou a ser uma fila: quatro variáveis
 * alteradas na mesma placa são quatro justificativas, cada uma com a sua
 * fórmula e a sua regra. Escrever as quatro de uma sentada é raro — quem
 * justifica a Parcela FINAME costuma ter de perguntar o prazo a alguém antes de
 * escrever a Amortização —, e sem lugar nenhum para deixar o meio do caminho a
 * única saída era gravar uma justificativa incompleta (que a rota recusa) ou
 * fechar e redigitar depois.
 *
 * O rascunho **não** é uma justificativa: nada aqui vai para o banco, nada aqui
 * conta como explicação dada, e a auditoria não o enxerga. É o papel de
 * rascunho em cima da mesa — some se a mesa for outra (outro navegador, outra
 * máquina), e é exatamente por isso que ele não pode ser confundido com o
 * registro: a cobertura de Chamados continua contando só o que a rota gravou.
 *
 * A chave é o `change.id`, que é único no acervo inteiro (é o serial da tabela
 * `change`), e não o par vigência+atributo: dois rascunhos da mesma variável em
 * comparações diferentes são dois textos diferentes, e uma chave que os
 * confundisse abriria a caixa de setembro com o que se escreveu em agosto.
 *
 * Todo acesso é embrulhado: `localStorage` lança em janela anônima, com dados
 * de site bloqueados e em ambiente de teste sem DOM. Um rascunho que não pôde
 * ser lido é um rascunho que não existe — nunca um erro em tela, porque o
 * trabalho de verdade (escrever e salvar a justificativa) não depende dele.
 */
const PREFIXO = "freightcheck:rascunho-de-justificativa:";

const chave = (changeId: number) => `${PREFIXO}${changeId}`;

function deposito(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** O rascunho desta alteração, ou `null` quando não há — nem quando não dá para ler. */
export function lerRascunho(changeId: number): RascunhoDaJustificativa | null {
  const onde = deposito();
  if (!onde) return null;
  try {
    const bruto = onde.getItem(chave(changeId));
    if (!bruto) return null;
    const lido = JSON.parse(bruto) as Record<string, unknown>;
    /*
      Campo a campo, e não o objeto inteiro: o que está no navegador foi
      escrito por uma versão anterior desta tela e pode ter qualquer forma.
      Semear um `conforme` que veio como string faria o formulário abrir com
      uma resposta que ninguém deu.
    */
    return {
      formula: typeof lido.formula === "string" ? lido.formula : "",
      regra: typeof lido.regra === "string" ? lido.regra : "",
      conformidade:
        lido.conformidade === "CONFORME" ||
        lido.conformidade === "EXCECAO" ||
        lido.conformidade === "DESCUMPRIMENTO"
          ? lido.conformidade
          : null,
      motivoExcecao: typeof lido.motivoExcecao === "string" ? lido.motivoExcecao : "",
      responsavelAprovacao:
        typeof lido.responsavelAprovacao === "string" ? lido.responsavelAprovacao : "",
    };
  } catch {
    return null;
  }
}

export function gravarRascunho(changeId: number, rascunho: RascunhoDaJustificativa): void {
  const onde = deposito();
  if (!onde) return;
  try {
    onde.setItem(chave(changeId), JSON.stringify(rascunho));
  } catch {
    /* Cota estourada ou escrita bloqueada: o rascunho não fica, e a
       justificativa em tela continua inteira. */
  }
}

/** Some quando a justificativa é gravada: o papel de rascunho não sobrevive ao registro. */
export function apagarRascunho(changeId: number): void {
  const onde = deposito();
  if (!onde) return;
  try {
    onde.removeItem(chave(changeId));
  } catch {
    /* Ver `gravarRascunho`. */
  }
}

/** Um rascunho em que ninguém escreveu nada ainda — não vale guardar. */
export function rascunhoVazio(rascunho: RascunhoDaJustificativa): boolean {
  return (
    !rascunho.formula?.trim() &&
    !rascunho.regra?.trim() &&
    !rascunho.conformidade &&
    !rascunho.motivoExcecao?.trim() &&
    !rascunho.responsavelAprovacao?.trim()
  );
}
