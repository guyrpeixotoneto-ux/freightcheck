import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import {
  ROTULO_DA_PRIORIDADE,
  type AtivoNaEvolucao,
  type EvolucaoPorPlaca,
  type Prioridade,
  type RubricaAlterada,
} from "@/lib/evolucao-por-placa";

/**
 * O ranking de atenção e as rubricas — os dois blocos abaixo da matriz.
 *
 * **O ranking não é "ordene por maior perda".** Ele lê o score do domínio
 * (`pontuarAtivo`), que soma cinco parcelas documentadas — impacto, vigências
 * negativas, piora consecutiva, pendência e recência —, e mostra as parcelas
 * junto com o resultado. É o que permite responder, na própria tela, "por que
 * esta placa está em primeiro?" sem ninguém precisar abrir o código.
 *
 * As **rubricas** respeitam o escopo: sem placa escolhida, são as do recorte
 * inteiro; com uma placa aberta, são as daquela placa — a pergunta muda de "o
 * que mais mudou na frota" para "o que explica a perda desta placa", que é a
 * pergunta seguinte de quem acabou de clicar nela.
 */

export const CLASSE_DA_PRIORIDADE: Record<Prioridade, string> = {
  CRITICA: "bg-red-100 text-red-700 border-red-200",
  MONITORAR: "bg-amber-100 text-amber-700 border-amber-200",
  ATENCAO: "bg-slate-100 text-slate-700 border-slate-200",
  POSITIVO: "bg-emerald-100 text-emerald-700 border-emerald-200",
  NEUTRA: "bg-muted text-muted-foreground border-input",
};

export function SeloDePrioridade({
  prioridade,
  className,
}: {
  prioridade: Prioridade;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide",
        CLASSE_DA_PRIORIDADE[prioridade],
        className,
      )}
    >
      {ROTULO_DA_PRIORIDADE[prioridade]}
    </span>
  );
}

export function RankingDeAtencao({
  evolucao,
  selecionada,
  onEscolherPlaca,
}: {
  evolucao: EvolucaoPorPlaca;
  selecionada: string | null;
  onEscolherPlaca: (entityId: string) => void;
}) {
  const sufixo = periodicitySuffix(evolucao.periodicidade);
  const fila = evolucao.ativos.filter((a) => a.score > 0).slice(0, 5);

  return (
    <section className="bg-card border rounded-xl shadow-sm p-5">
      <div className="flex items-center gap-1.5">
        <h2 className="text-base font-bold leading-tight">Ranking de atenção</h2>
        <span
          title={
            "A ordem sai de um score de 0 a 100, somado de cinco parcelas com peso fixo e escrito no produto:\n" +
            "· até 50 — impacto acumulado, na proporção da maior perda do recorte;\n" +
            "· até 20 — em quantas das vigências comparadas a placa perdeu;\n" +
            "· até 15 — piora em vigências consecutivas;\n" +
            "· até 10 — alterações ainda sem valoração;\n" +
            "· 5 — mexeu-se na vigência mais recente.\n" +
            "Ganho não pontua: o ranking é de atenção, não de tamanho."
          }
        >
          <Info className="w-3.5 h-3.5 text-muted-foreground" />
        </span>
      </div>
      <p className="text-sm text-muted-foreground mt-0.5">
        Placas com maior prioridade de análise — e por quê.
      </p>

      {fila.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nenhuma placa deste recorte acumula perda, pendência ou recorrência. Não há
          fila de atenção a montar — e um ranking vazio é a resposta honesta.
        </p>
      ) : (
        <ol className="mt-4 space-y-2">
          {fila.map((ativo, indice) => (
            <li key={ativo.entityId}>
              <button
                onClick={() => onEscolherPlaca(ativo.entityId)}
                className={cn(
                  "w-full flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left hover:bg-muted/50 transition-colors",
                  selecionada === ativo.entityId && "border-primary/40 bg-primary/5",
                )}
              >
                <span className="mt-0.5 grid place-items-center w-6 h-6 shrink-0 rounded-md bg-muted text-xs font-bold tabular-nums">
                  {indice + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{ativo.rotulo}</span>
                    <SeloDePrioridade prioridade={ativo.prioridade} />
                    <span
                      className={cn(
                        "ml-auto font-bold tabular-nums",
                        ativo.acumulado === null
                          ? "text-amber-700"
                          : ativo.acumulado < 0
                            ? "text-red-700"
                            : "text-emerald-700",
                      )}
                    >
                      {ativo.acumulado === null
                        ? "sem valoração"
                        : `${formatBrlShort(ativo.acumulado)}${sufixo}`}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {ativo.motivos.map((m) => `${m.rotulo} (${m.pontos})`).join(" · ") ||
                      "sem sinais de atenção"}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    score {ativo.score} · {ativo.vigenciasAfetadas}{" "}
                    {ativo.vigenciasAfetadas === 1 ? "vigência" : "vigências"} ·{" "}
                    {ativo.alteracoes} {ativo.alteracoes === 1 ? "alteração" : "alterações"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function DistribuicaoDoImpacto({ evolucao }: { evolucao: EvolucaoPorPlaca }) {
  const { totais } = evolucao;
  const sufixo = periodicitySuffix(evolucao.periodicidade);
  const grupos = [
    { rotulo: "Perda", quantidade: totais.comPerda, classe: "bg-red-500" },
    { rotulo: "Ganho", quantidade: totais.comGanho, classe: "bg-emerald-500" },
    {
      rotulo: "Sem valoração",
      quantidade: totais.comPendencia,
      classe: "bg-amber-400",
    },
  ];
  const total = grupos.reduce((soma, g) => soma + g.quantidade, 0);

  return (
    <section className="bg-card border rounded-xl shadow-sm p-5">
      <h2 className="text-base font-bold leading-tight">Distribuição do impacto</h2>
      <p className="text-sm text-muted-foreground mt-0.5">
        Como as placas do recorte se dividem. Uma placa com perda e pendência aparece
        nas duas barras — são perguntas diferentes, e não fatias de um bolo.
      </p>

      {total === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nenhuma placa no recorte.</p>
      ) : (
        <>
          <div className="mt-4 flex gap-1">
            {grupos.map((grupo) => (
              <div
                key={grupo.rotulo}
                className="min-w-0"
                style={{ flexGrow: Math.max(grupo.quantidade, 0.15) }}
              >
                <p className="text-center text-sm font-bold tabular-nums">
                  {grupo.quantidade}
                </p>
                <div className={cn("h-1.5 rounded-full mt-1", grupo.classe)} />
                <p className="mt-1 text-center text-xs text-muted-foreground truncate">
                  {grupo.rotulo}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Faixa
              rotulo="Perda total"
              valor={`${formatBrlShort(totais.perda)}${sufixo}`}
              classe="border-red-200 bg-red-50 text-red-700"
            />
            <Faixa
              rotulo="Ganho total"
              valor={`+${formatBrlShort(totais.ganho)}${sufixo}`}
              classe="border-emerald-200 bg-emerald-50 text-emerald-700"
            />
            <Faixa
              rotulo="Sem valoração"
              valor={`${totais.alteracoesSemValoracao} ${totais.alteracoesSemValoracao === 1 ? "alteração" : "alterações"}`}
              classe="border-amber-200 bg-amber-50 text-amber-700"
            />
          </div>
        </>
      )}
    </section>
  );
}

function Faixa({
  rotulo,
  valor,
  classe,
}: {
  rotulo: string;
  valor: string;
  classe: string;
}) {
  return (
    <div className={cn("rounded-lg border px-2 py-2", classe)}>
      <p className="text-[0.625rem] uppercase tracking-wide opacity-80">{rotulo}</p>
      <p className="text-sm font-bold tabular-nums mt-0.5">{valor}</p>
    </div>
  );
}

export function RubricasAlteradas({
  rubricas,
  periodicidade,
  placa,
}: {
  rubricas: RubricaAlterada[];
  periodicidade: string;
  /** A placa aberta, quando há uma — o escopo desta tabela. */
  placa: AtivoNaEvolucao | null;
}) {
  const sufixo = periodicitySuffix(periodicidade);

  return (
    <section className="bg-card border rounded-xl shadow-sm p-5">
      <h2 className="text-base font-bold leading-tight">
        Principais rubricas alteradas{" "}
        <span className="font-normal text-muted-foreground">
          ({placa ? placa.rotulo : "no período"})
        </span>
      </h2>
      <p className="text-sm text-muted-foreground mt-0.5">
        {placa
          ? "As rubricas que explicam o acumulado desta placa. Elas somam exatamente o valor da linha dela na matriz."
          : "As rubricas do recorte inteiro. Elas somam exatamente o impacto líquido da faixa executiva."}
      </p>

      {rubricas.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nenhuma rubrica alterada.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                <th className="font-semibold px-2 pb-2">Rubrica</th>
                <th className="font-semibold px-2 pb-2 text-right">Alterações</th>
                <th className="font-semibold px-2 pb-2 text-right">Impacto (R${sufixo})</th>
                <th className="font-semibold px-2 pb-2 text-right">Sentido</th>
              </tr>
            </thead>
            <tbody>
              {rubricas.slice(0, 8).map((rubrica) => (
                <tr key={rubrica.parameterKey} className="border-t">
                  <td className="px-2 py-2">
                    <span className="font-medium">{rubrica.nome}</span>
                    <span className="block text-xs text-muted-foreground">
                      {rubrica.familyName}
                      {!placa && ` · ${rubrica.ativos} ${rubrica.ativos === 1 ? "placa" : "placas"}`}
                      {` · ${rubrica.vigencias} ${rubrica.vigencias === 1 ? "vigência" : "vigências"}`}
                      {rubrica.semValoracao > 0 &&
                        ` · ${rubrica.semValoracao} sem valoração`}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {rubrica.alteracoes}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2 text-right tabular-nums font-medium",
                      rubrica.impacto === null
                        ? "text-amber-700"
                        : rubrica.impacto < 0
                          ? "text-red-700"
                          : "text-emerald-700",
                    )}
                  >
                    {rubrica.impacto === null
                      ? "sem valoração"
                      : formatBrlShort(rubrica.impacto)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {/*
                      O "sentido" é o sinal do impacto acumulado desta rubrica no
                      período — e é isso que a seta diz, nem mais nem menos. Uma
                      seta que prometesse tendência futura seria previsão, e este
                      produto não prevê nada: ele mede.
                    */}
                    <span
                      title="Sentido do impacto acumulado no período. Não é previsão."
                      className={cn(
                        rubrica.impacto === null
                          ? "text-amber-600"
                          : rubrica.impacto < 0
                            ? "text-red-600"
                            : "text-emerald-600",
                      )}
                    >
                      {rubrica.impacto === null ? "—" : rubrica.impacto < 0 ? "↘" : "↗"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
