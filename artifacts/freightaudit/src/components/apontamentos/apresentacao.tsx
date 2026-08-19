import { Fragment, type ReactNode } from "react";
import {
  CODIGOS_QUE_BLOQUEIAM_PROMOCAO,
  CODIGOS_QUE_ISOLAM_A_CHAVE,
  rotuloDoSelo,
  type ApresentacaoDeApontamento,
} from "@workspace/ingest/apontamentos";
import { cn } from "@/lib/utils";

/**
 * Como um apontamento de importação se desenha — em um lugar só.
 *
 * ---------------------------------------------------------------------------
 * Por que isto saiu da tela de Importações
 * ---------------------------------------------------------------------------
 * Estas seções nasceram dentro de `pages/importacoes.tsx`, e enquanto o
 * apontamento só era lido lá isso estava certo. Com a quarentena por chave ele
 * passou a ser lido em dois lugares: a importação continua mostrando o que
 * aconteceu com o arquivo, e o QLP passou a mostrar, na aba de Inconsistências,
 * quais registros ficaram de fora do quadro. É o **mesmo** apontamento, com a
 * mesma evidência, e duas telas desenhando-o de dois jeitos seria a forma mais
 * cara de descobrir que elas discordam sobre o que um conflito é.
 *
 * O que ficou em Importações: o que é da importação — o cartão do arquivo, o
 * agrupamento por código, os detalhes técnicos com o `detail` cru. O que veio
 * para cá: as seções que respondem as perguntas de quem precisa **corrigir a
 * planilha**, que são as mesmas em qualquer tela que as mostre.
 */

/** "12", "12 e 87", "12, 87 e 90" — a enumeração como se escreve. */
export const listarComE = (itens: string[]): string =>
  itens.length <= 1
    ? (itens[0] ?? "")
    : `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;

/**
 * O selo que diz o que o apontamento **faz**, não só de que cor ele é.
 *
 * A cor do cartão já separa erro de aviso para quem enxerga as três lado a
 * lado; o selo escreve a consequência — e ela depende do código, não só da
 * severidade. São três consequências: uma linha sem placa recusa aquela linha
 * ("Erro"); uma chave repetida com valores que discordam retira o registro e
 * deixa o arquivo entrar ("Registro não importado"); uma aba que prometia um
 * tipo e entregou outro segura o arquivo inteiro ("Erro bloqueante"). Chamar de
 * bloqueante o que não bloqueou faria a pessoa procurar um impedimento que não
 * existe — e chamar de "Erro" o registro que ficou de fora faria ela procurar
 * na planilha uma linha suja, quando o que falta está no quadro.
 */
export function SeloDeSeveridade({
  severity,
  code,
}: {
  severity: string;
  code: string;
}) {
  const rotulo = rotuloDoSelo(severity, code);
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wider whitespace-nowrap",
        severity === "ERROR"
          ? "border-red-300 bg-red-100/70"
          : severity === "WARNING"
            ? "border-amber-300 bg-amber-100/70"
            : "border-border bg-muted/50",
      )}
    >
      {rotulo}
    </span>
  );
}

/** Uma seção do apontamento: o rótulo pequeno em cima, o conteúdo embaixo. */
export function SecaoDoApontamento({
  titulo,
  children,
}: {
  titulo: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wider opacity-60">
        {titulo}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * O encabeçamento do "por quê", pela consequência real do código.
 *
 * Não pela severidade crua: o mesmo ERROR pode ter segurado o arquivo, retirado
 * um registro ou recusado uma linha, e um encabeçamento maior que o fato manda
 * a pessoa procurar um impedimento que não existe.
 */
export function tituloDoPorQue(severity: string, code: string): string {
  if (severity !== "ERROR") {
    return severity === "WARNING" ? "Por que este aviso" : "Por que registramos";
  }
  if (CODIGOS_QUE_BLOQUEIAM_PROMOCAO.has(code)) return "Por que a importação foi bloqueada";
  if (CODIGOS_QUE_ISOLAM_A_CHAVE.has(code)) return "Por que este registro ficou de fora";
  return "Por que recusamos";
}

/**
 * As seções de um apontamento, na ordem das perguntas de quem acabou de vê-lo:
 * o que aconteceu (o resumo), onde, de que registro se trata, o que difere, o
 * que eu faço, por quê.
 *
 * As divergências saem como lista estruturada — um bloco por coluna, cada valor
 * com a linha de onde veio — porque três campos divergentes num parágrafo era
 * exatamente o que a tela tinha antes de o contrato de apresentação existir.
 *
 * `rodape` é o que cada tela acrescenta e a outra não tem: em Importações, os
 * detalhes técnicos com o `detail` cru; no QLP, nada.
 */
export function SecoesDaApresentacao({
  apresentacao,
  severity,
  code,
  rodape,
}: {
  apresentacao: ApresentacaoDeApontamento;
  severity: string;
  code: string;
  rodape?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <p className="leading-relaxed">{apresentacao.resumo}</p>

      {((apresentacao.onde?.length ?? 0) > 0 ||
        (apresentacao.registro?.length ?? 0) > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(apresentacao.onde?.length ?? 0) > 0 && (
            <SecaoDoApontamento titulo="Onde encontramos">
              <ul className="space-y-0.5 text-xs leading-relaxed">
                {apresentacao.onde!.map((onde, i) => (
                  <li key={i}>
                    Aba <span className="font-medium">{onde.aba}</span>
                    {(onde.linhas?.length ?? 0) > 0 && (
                      <>
                        {" — "}
                        {onde.linhas!.length === 1 ? "linha " : "linhas "}
                        <span className="font-medium tabular-nums">
                          {listarComE(onde.linhas!.map(String))}
                        </span>
                      </>
                    )}
                    {onde.coluna && (
                      <>
                        {" — coluna "}
                        <span className="font-medium">{onde.coluna}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </SecaoDoApontamento>
          )}
          {(apresentacao.registro?.length ?? 0) > 0 && (
            <SecaoDoApontamento titulo="Registro envolvido">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                {apresentacao.registro!.map((campo) => (
                  <Fragment key={campo.campo}>
                    <dt className="opacity-70">{campo.campo}</dt>
                    <dd className="font-medium break-words">{campo.valor}</dd>
                  </Fragment>
                ))}
              </dl>
            </SecaoDoApontamento>
          )}
        </div>
      )}

      {(apresentacao.diferencas?.length ?? 0) > 0 && (
        <SecaoDoApontamento titulo="O que está diferente">
          <div className="space-y-1.5">
            {apresentacao.diferencas!.map((diferenca) => {
              const abas = new Set(
                diferenca.versoes.map((v) => v.aba).filter(Boolean),
              );
              return (
                <div
                  key={diferenca.campo}
                  className="rounded-lg border border-current/15 bg-background/50 px-3 py-2"
                >
                  <p className="text-xs font-semibold">{diferenca.campo}</p>
                  <ul className="mt-1 space-y-0.5">
                    {diferenca.versoes.map((versao, i) => (
                      <li
                        key={i}
                        className="flex items-baseline justify-between gap-3 text-xs"
                      >
                        <span className="opacity-70">
                          {versao.linha !== undefined
                            ? `Linha ${versao.linha}`
                            : `Valor ${i + 1}`}
                          {versao.aba && abas.size > 1 && <> — aba {versao.aba}</>}
                        </span>
                        <span className="font-mono break-all text-right">
                          {versao.valor}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </SecaoDoApontamento>
      )}

      {apresentacao.comoCorrigir && (
        <SecaoDoApontamento titulo="Como corrigir">
          <p className="text-xs leading-relaxed">{apresentacao.comoCorrigir}</p>
        </SecaoDoApontamento>
      )}

      {apresentacao.porQueImporta && (
        <SecaoDoApontamento titulo={tituloDoPorQue(severity, code)}>
          <p className="text-xs leading-relaxed opacity-90">
            {apresentacao.porQueImporta}
          </p>
        </SecaoDoApontamento>
      )}

      {rodape}
    </div>
  );
}
