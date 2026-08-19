import { Fragment } from "react";
import { NOME_DA_FROTA, type DiaAberto, type Viagem } from "@/lib/fechamento";
import { COLUNAS_DA_VIAGEM } from "./colunas-da-viagem";

/**
 * A tabela do dia — o 2Art daquele dia, linha a linha, com os totais por frota.
 *
 * É o que a aba diária da planilha mostra, e por isso ela é reproduzida aqui na
 * mesma forma: as viagens agrupadas por tipo de frota e, ao fim de cada grupo,
 * a linha `TOTAL PADRÃO` / `TOTAL SPOT`. Esses dois totais são os números que
 * quem fecha compara com o SRTrans — a conferência que hoje se faz olhando duas
 * telas ao mesmo tempo.
 *
 * **Os totais não são somados aqui.** Eles vêm de `porFrota`, calculado no
 * servidor pela mesma função que alimenta a apuração (`diario.ts`). Se a tela
 * somasse por conta própria, existiriam duas contas do mesmo dinheiro, e a
 * primeira divergência entre elas seria descoberta por quem menos deveria
 * descobri-la.
 *
 * **A rolagem é horizontal e o cabeçalho fica.** São sessenta colunas; sem o
 * cabeçalho grudado, a coluna do meio deixa de ter nome três telas à direita.
 */
export function TabelaDoDia({ dia }: { dia: DiaAberto }) {
  if (dia.viagens.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma viagem do 2Art neste dia. Se a operação rodou, o relatório da
        quinzena ainda não chegou — ou este dia ficou de fora dele.
      </p>
    );
  }

  return (
    <div className="overflow-auto max-h-[70vh] rounded-lg border">
      <table className="text-xs border-collapse">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            {COLUNAS_DA_VIAGEM.map((coluna) => (
              <th
                key={coluna.rotulo}
                className={`whitespace-nowrap border-b border-r px-2 py-2 font-semibold uppercase tracking-wide text-[0.625rem] text-muted-foreground ${
                  coluna.numerica ? "text-right" : "text-left"
                }`}
              >
                {coluna.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dia.porFrota.map((grupo) => (
            <Fragment key={grupo.frota}>
              {dia.viagens
                .filter((viagem) => viagem.frota === grupo.frota)
                .map((viagem) => (
                  <Linha key={`${viagem.linha}-${viagem.mapa}`} viagem={viagem} />
                ))}
              <tr className="bg-muted/60 font-semibold">
                {COLUNAS_DA_VIAGEM.map((coluna, i) => (
                  <td
                    key={coluna.rotulo}
                    className={`whitespace-nowrap border-b border-r px-2 py-1.5 ${
                      coluna.numerica ? "text-right tabular-nums" : "text-left"
                    }`}
                  >
                    {i === 0
                      ? `TOTAL ${(NOME_DA_FROTA[grupo.frota] ?? grupo.frota).toUpperCase()}`
                      : (coluna.total?.(grupo) ?? "")}
                  </td>
                ))}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Linha({ viagem }: { viagem: Viagem }) {
  return (
    <tr className="hover:bg-muted/40">
      {COLUNAS_DA_VIAGEM.map((coluna) => (
        <td
          key={coluna.rotulo}
          className={`whitespace-nowrap border-b border-r px-2 py-1.5 ${
            coluna.numerica ? "text-right tabular-nums" : "text-left"
          }`}
        >
          {coluna.valor(viagem)}
        </td>
      ))}
    </tr>
  );
}
