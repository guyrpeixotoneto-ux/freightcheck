import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { identidadeNaTela } from "@/components/qlp/apresentacao";
import {
  ROTULO_DO_VEREDITO_DA_LINHA,
  SELO_DO_VEREDITO,
  escreverConta,
  escreverDiferenca,
  type ConferenciaDaLinha,
} from "@/lib/qlp-auditoria";

/**
 * A tabela de cargos — uma linha por cargo, e as contas dele numa gaveta.
 *
 * **A gaveta abre na própria linha, e não numa lateral**, e é a única tela desta
 * série em que isso acontece. Nas auditorias por placa e por trecho, o detalhe é
 * a história de um ativo — muitas variáveis, um diagnóstico em texto, um painel
 * de conferência. Aqui o detalhe de um cargo são três a seis contas com quatro
 * números cada: cabe embaixo da linha, e abrir uma gaveta lateral para isso
 * tiraria da vista justamente a lista que dá contexto ao número.
 *
 * **Cada conta mostra o esperado ao lado do declarado**, sempre os dois. Mostrar
 * só a diferença deixaria "−R$ 2.400,00" sem escala: sobre uma despesa de
 * R$ 4.800 é metade da rubrica, e sobre uma de R$ 480 mil é ruído.
 *
 * **A identidade vem em colunas, e não numa frase.** A chave legível do quadro é
 * a emenda das colunas de identidade do tipo — unidade + cargo no
 * administrativo, unidade + cargo + turno no operacional —, e mostrá-la inteira
 * numa célula só produzia títulos como
 * `07526557001505_CERV · Cargo: MOTORISTA 28 · Cargo: EQUIPE ATIVA 8x16`: três
 * campos diferentes sob o cabeçalho "Cargo", impossíveis de varrer com o olho e
 * de comparar entre linhas. Cada pedaço agora tem a sua coluna.
 *
 * As colunas de unidade e de turno **aparecem quando existem**, e por isso o
 * administrativo não ganha uma coluna "Turno" vazia: a lista é dos dois quadros,
 * e o que decide é o que as linhas trazem, não o que o quadro poderia trazer.
 *
 * **O prefixo `Cargo:` que a origem repete dentro do valor sai só daqui.** Sob os
 * cabeçalhos "Cargo" e "Turno" ele é ruído — repete o nome da coluna numa e mente
 * o nome dela na outra —, mas o dado importado, a chave normalizada embaixo do
 * cargo e o CSV continuam com o valor como ele veio. Ver `semPrefixoDeCargo`.
 */
export function TabelaDeCargos({ linhas }: { linhas: ConferenciaDaLinha[] }) {
  const [aberto, setAberto] = useState<string | null>(null);

  const identidades = linhas.map((l) => identidadeNaTela(l.nome ?? l.chave));
  const temUnidade = identidades.some((i) => i.unidade !== "");
  const temTurno = identidades.some((i) => i.turno !== "");
  const colunas = [
    "",
    ...(temUnidade ? ["Unidade"] : []),
    "Cargo",
    ...(temTurno ? ["Turno"] : []),
    "Fecham",
    "Não fecham",
    "Sem base",
    "Leitura",
  ];
  /* Onde começam as três colunas numéricas, que são as alinhadas à direita. */
  const primeiraNumerica = colunas.indexOf("Fecham");

  return (
    <div className="superficie overflow-x-auto">
      <table className="w-full min-w-[58rem] border-collapse text-sm">
        <caption className="sr-only">
          Cargos do quadro e o resultado das contas que a tabela declara para cada um.
        </caption>
        <thead>
          <tr className="border-b bg-muted/60">
            {colunas.map((titulo, i) => (
              <th
                key={titulo || `vazio-${i}`}
                scope="col"
                className={cn(
                  "whitespace-nowrap px-3 py-2.5 text-[0.65rem] font-bold uppercase tracking-[0.07em] text-muted-foreground",
                  i >= primeiraNumerica && i <= primeiraNumerica + 2
                    ? "text-right"
                    : "text-left",
                )}
              >
                {titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, indice) => {
            const estaAberto = aberto === l.chave;
            const { unidade, cargo, turno } = identidades[indice];
            return (
              <Fragment key={l.chave}>
                <tr
                  className="cursor-pointer border-b border-superficie-borda hover:bg-muted/50"
                  onClick={() => setAberto(estaAberto ? null : l.chave)}
                  tabIndex={0}
                  role="button"
                  aria-expanded={estaAberto}
                  aria-label={`${estaAberto ? "Fechar" : "Abrir"} as contas de ${
                    l.nome ?? l.chave
                  }`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setAberto(estaAberto ? null : l.chave);
                    }
                  }}
                >
                  <td className="w-8 px-3 py-2 text-muted-foreground">
                    {estaAberto ? (
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    )}
                  </td>
                  {temUnidade && (
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[0.75rem] text-muted-foreground">
                      {unidade || "—"}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    {/*
                      O nome legível manda, e a chave normalizada fica embaixo em
                      letra menor: a chave identifica, mas
                      `20618821000799AUXILIARADM` não se lê, e uma lista de trinta
                      delas é uma lista que ninguém distingue.

                      A chave inteira fica sob o cargo, e não repartida entre as
                      colunas: ela é uma coisa só — o que o resto do produto usa
                      para se referir a esta linha — e cortá-la em pedaços
                      inventaria três chaves que não existem.
                    */}
                    <span className="flex flex-col">
                      <span className="font-semibold">{cargo}</span>
                      {l.nome && (
                        <span className="font-mono text-[0.7rem] text-muted-foreground">
                          {l.chave}
                        </span>
                      )}
                    </span>
                  </td>
                  {temTurno && (
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {turno || "—"}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-success">
                    {formatNumber(l.conferem, 0)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-mono tabular-nums",
                      l.divergem > 0 ? "text-warning-foreground" : "text-muted-foreground",
                    )}
                  >
                    {l.divergem > 0 ? formatNumber(l.divergem, 0) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {l.semBase > 0 ? formatNumber(l.semBase, 0) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        SELO_DO_VEREDITO[l.veredito],
                      )}
                    >
                      {ROTULO_DO_VEREDITO_DA_LINHA[l.veredito]}
                    </span>
                  </td>
                </tr>

                {estaAberto && (
                  <tr className="border-b border-superficie-borda bg-muted/20">
                    <td colSpan={colunas.length} className="px-3 py-3">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr className="text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
                            <th scope="col" className="py-1 text-left font-bold">Conta</th>
                            <th scope="col" className="py-1 text-left font-bold">Forma</th>
                            <th scope="col" className="py-1 text-right font-bold">Esperado</th>
                            <th scope="col" className="py-1 text-right font-bold">Declarado</th>
                            <th scope="col" className="py-1 text-right font-bold">Diferença</th>
                            <th scope="col" className="py-1 text-left font-bold">Leitura</th>
                          </tr>
                        </thead>
                        <tbody>
                          {l.contas.map((c) => (
                            <tr key={c.conta} className="border-t border-superficie-borda">
                              <td className="py-1.5 font-semibold">{c.rotulo}</td>
                              <td className="py-1.5 text-muted-foreground">
                                {c.forma === "PRODUTO"
                                  ? "quantidade × valor"
                                  : "soma das parcelas"}
                              </td>
                              <td className="py-1.5 text-right font-mono tabular-nums">
                                {escreverConta(c.esperado)}
                              </td>
                              <td className="py-1.5 text-right font-mono tabular-nums">
                                {escreverConta(c.declarado)}
                              </td>
                              <td
                                className={cn(
                                  "py-1.5 text-right font-mono tabular-nums",
                                  c.confere === false && "text-warning-foreground",
                                )}
                              >
                                {escreverDiferenca(c.diferenca)}
                              </td>
                              <td className="py-1.5">
                                {c.confere === null ? (
                                  <span className="text-muted-foreground">Base insuficiente</span>
                                ) : c.confere ? (
                                  <span className="text-success">Fecha</span>
                                ) : (
                                  <span className="font-semibold text-warning-foreground">
                                    Não fecha
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
