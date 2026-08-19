import { Fragment, useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatBrl } from "@/lib/format";
import type { Apuracao, Fonte, VerbaApurada } from "@/lib/fechamento";

/**
 * A conta da quinzena — os três números, a conversão medida e as verbas.
 *
 * Vive aqui, e não dentro da competência aberta, porque duas telas fazem a
 * mesma pergunta: a competência aberta (`pages/fechamento/competencia.tsx`),
 * onde o fechamento acontece, e a linha expandida de Apurações
 * (`pages/fechamento/apuracoes.tsx`), onde se confere sem sair da fila. Duas
 * cópias do mesmo bloco seriam duas opiniões sobre o mesmo número — e a
 * segunda envelheceria calada.
 *
 * **Nada é recomposto aqui.** `emitido`, `esperado` e `naoConferido` são o que
 * a apuração gravou quando rodou; a memória de cada verba é a que ela mesma
 * registrou, parcela a parcela. Ver o cabeçalho de `lib/fechamento.ts`: a
 * interface lê a conta, não a refaz.
 */
export function ContaApurada({
  apuracao,
  fontes,
}: {
  apuracao: Apuracao;
  /** O catálogo das cinco fontes, para nomear pela rotina o que faltou. */
  fontes: Fonte[];
}) {
  /*
    Qual verba está aberta é estado desta conta, e não de quem a mostra: em
    Apurações há várias contas na tela ao mesmo tempo, e uma verba aberta numa
    delas não diz nada sobre as outras.
  */
  const [verbaAberta, setVerbaAberta] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Numero titulo="Emitido em CT-e" valor={apuracao.totais.emitido} />
        <Numero
          titulo="Conferido pela apuração"
          valor={apuracao.totais.esperado}
          nota="Reconstruído das fontes, verba a verba."
        />
        <Numero
          titulo="Sem fonte que confira"
          valor={apuracao.totais.naoConferido}
          nota="Emitido que nenhuma das cinco fontes sustenta — a parte fixa do contrato."
        />
      </div>

      {apuracao.fontesAusentes.length > 0 && (
        <Alert>
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>
            Esta apuração rodou sem {apuracao.fontesAusentes.length} fonte(s):{" "}
            {apuracao.fontesAusentes
              .map((t) => fontes.find((f) => f.tipo === t)?.rotina ?? t)
              .join(", ")}
            . As verbas que dependiam delas ficaram sem conferência.
          </AlertDescription>
        </Alert>
      )}

      {apuracao.aliquotas.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Conversão medida dos próprios arquivos:{" "}
          {apuracao.aliquotas
            .map((a) => `${a.canal} ${a.percentual.toFixed(4)}%`)
            .join(" · ")}
          . Nenhuma alíquota é presumida — o fator sai da razão entre a
          requisição aprovada e o CT-e emitido nas verbas que só podem ter vindo
          de requisição.
        </p>
      )}

      <TabelaDeVerbas
        verbas={apuracao.verbas}
        aberta={verbaAberta}
        onAbrir={(vbz) => setVerbaAberta(verbaAberta === vbz ? null : vbz)}
      />
    </div>
  );
}

function Numero({
  titulo,
  valor,
  nota,
}: {
  titulo: string;
  valor: number;
  nota?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {titulo}
      </p>
      <p className="text-xl font-bold tabular-nums mt-1">{formatBrl(valor)}</p>
      {nota && <p className="text-xs text-muted-foreground mt-1">{nota}</p>}
    </div>
  );
}

/**
 * As verbas, e a memória de cálculo de cada uma.
 *
 * O que a planilha nunca teve: clicar numa verba abre de onde cada real dela
 * saiu — a rubrica da conciliação, o complementar de perfil, as requisições
 * aprovadas e o fator que as converteu. É o que permite discordar de um número
 * sem precisar refazê-lo.
 */
function TabelaDeVerbas({
  verbas,
  aberta,
  onAbrir,
}: {
  verbas: VerbaApurada[];
  aberta: number | null;
  onAbrir: (vbz: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Verba</th>
            <th className="py-2 px-3 font-medium text-right">Emitido</th>
            <th className="py-2 px-3 font-medium text-right">Apurado</th>
            <th className="py-2 pl-3 font-medium text-right">Diferença</th>
          </tr>
        </thead>
        <tbody>
          {verbas.map((v) => (
            <Fragment key={v.vbz}>
              <tr
                className="border-b hover:bg-muted/50 cursor-pointer"
                onClick={() => onAbrir(v.vbz)}
                aria-expanded={aberta === v.vbz}
              >
                <td className="py-2 pr-3">
                  <span className="inline-flex items-center gap-1.5">
                    <ChevronRight
                      className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${
                        aberta === v.vbz ? "rotate-90" : ""
                      }`}
                    />
                    <span className="font-mono text-xs text-muted-foreground">
                      {v.vbz}
                    </span>
                    <span>
                      {v.canal} · {v.nome}
                    </span>
                  </span>
                </td>
                <td className="py-2 px-3 text-right tabular-nums">
                  {formatBrl(v.emitido)}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                  {v.esperado === null ? "—" : formatBrl(v.esperado)}
                </td>
                <td className="py-2 pl-3 text-right tabular-nums">
                  {v.diferenca === null ? (
                    <span className="text-xs text-muted-foreground">
                      sem fonte
                    </span>
                  ) : (
                    formatBrl(v.diferenca)
                  )}
                </td>
              </tr>
              {aberta === v.vbz && (
                <tr className="border-b bg-muted/30">
                  <td colSpan={4} className="py-3 px-8">
                    {v.memoria.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nenhuma das cinco fontes sustenta esta verba — ela
                        entrou na conta pelo que foi emitido, e ninguém a
                        conferiu. É o caso da parcela fixa do contrato.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {v.memoria.map((m, i) => (
                          <li
                            key={i}
                            className="flex items-baseline justify-between gap-4 text-sm"
                          >
                            <span className="text-muted-foreground">
                              {m.descricao}
                              {m.fator != null && m.semImposto != null && (
                                <span className="font-mono text-xs">
                                  {" "}
                                  ({formatBrl(m.semImposto)} ×{" "}
                                  {m.fator.toFixed(6)})
                                </span>
                              )}
                            </span>
                            <span className="tabular-nums shrink-0">
                              {formatBrl(m.comImposto)}
                            </span>
                          </li>
                        ))}
                        <li className="flex items-baseline justify-between gap-4 text-sm font-medium border-t pt-1.5">
                          <span>Total apurado</span>
                          <span className="tabular-nums">
                            {formatBrl(v.esperado ?? 0)}
                          </span>
                        </li>
                      </ul>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
