import { useState } from "react";
import { ChevronRight, Info, PanelRightOpen } from "lucide-react";
import type { LinhaDeFiname, VeiculoDeFiname } from "@workspace/comparison/finame";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ROTULO_DO_ESTADO,
  SELO_DO_ESTADO,
  corDaDiferenca,
  escreverDataDeCadastro,
  escreverDiferenca,
  escreverPeriodo,
  escreverValor,
  escreverVariacao,
} from "@/lib/finame";
import { formatNumber } from "@/lib/format";
import type { Justificativa } from "@/lib/justificativas";

const ROTULO_DO_TIPO: Record<string, string> = { CAVALO: "Cavalo", CARRETA: "Carreta" };

/** As colunas da placa, na ordem da tela — e de que lado cada número encosta. */
const COLUNAS: { titulo: string; direita?: boolean }[] = [
  { titulo: "Veículo" },
  { titulo: "Tipo" },
  { titulo: "Período FINAME", direita: true },
  { titulo: "Data de cadastro", direita: true },
  { titulo: "Alterações", direita: true },
  { titulo: "Parcela de", direita: true },
  { titulo: "Parcela para", direita: true },
  { titulo: "Diferença", direita: true },
  { titulo: "Variação %", direita: true },
  { titulo: "Status" },
  { titulo: "Justificativa" },
];

/** A chave de uma placa na lista de expandidas. */
const chaveDoVeiculo = (v: { entityLabel: string | null; entityType: string }) =>
  `${v.entityLabel}${v.entityType}`;

/**
 * A tabela da comparação — **uma linha por placa**, e as variáveis por dentro.
 *
 * ---------------------------------------------------------------------------
 * Por que por veículo, e não por variável
 * ---------------------------------------------------------------------------
 * A tabela nasceu por variável: uma linha para cada par (veículo × variável).
 * Com catorze variáveis de FINAME, a mesma placa aparecia catorze vezes,
 * espalhada por três páginas — seis linhas de "Amortização" seguidas de seis de
 * "Parcela FINAME", das mesmas seis placas. Perguntar "o que aconteceu com a
 * QYW6D15?" era caçar as linhas dela na lista.
 *
 * Agora a placa é a linha, e ela responde de uma vez: quantas variáveis se
 * moveram, como a parcela foi de uma vigência para a outra, qual o estado mais
 * grave e se já há justificativa. **Clicar abre as alterações daquela placa**,
 * ali mesmo, sem sair da página; o botão dentro da expansão abre a gaveta com o
 * diagnóstico e as variáveis que só existem no detalhe.
 *
 * ---------------------------------------------------------------------------
 * As duas coisas que esta tabela se recusa a fazer
 * ---------------------------------------------------------------------------
 * **Não soma variáveis de unidades diferentes.** Nenhuma célula junta reais com
 * meses ou com pontos percentuais. A contagem de alterações é contagem, e o
 * dinheiro da linha é **a parcela FINAME** — uma variável, a mesma que o gráfico
 * de totais soma. Somar parcela, juros e amortização numa célula contaria o
 * mesmo dinheiro duas vezes, porque a parcela é a soma dos outros dois.
 *
 * **Não inventa o que não está no recorte.** A placa cuja linha de parcela não
 * veio — porque ela não se moveu, ou porque um filtro por variável a tirou —
 * mostra `—` nas colunas da parcela, e não R$ 0,00. As contas todas vêm de
 * `agruparPorVeiculo`, no núcleo; aqui só se escolhe a cor e se escreve.
 */
export function TabelaDeFiname({
  veiculos,
  justificadaPor,
  onAbrir,
}: {
  veiculos: VeiculoDeFiname[];
  /** A justificativa mais recente de cada alteração, por `change.id`. */
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onAbrir: (veiculo: { entityLabel: string | null; entityType: string }) => void;
}) {
  const [expandidas, setExpandidas] = useState<ReadonlySet<string>>(new Set());

  function alternar(veiculo: VeiculoDeFiname) {
    const chave = chaveDoVeiculo(veiculo);
    setExpandidas((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(chave)) proximo.add(chave);
      return proximo;
    });
  }

  return (
    <div className="superficie overflow-x-auto">
      <table className="w-full min-w-[78rem] border-collapse text-sm">
        <caption className="sr-only">
          Comparação de FINAME entre as duas vigências do par, uma linha por veículo.
          Cada linha abre as variáveis que se moveram naquele veículo.
        </caption>
        <thead>
          <tr className="border-b bg-muted/60">
            {COLUNAS.map((coluna) => (
              <th
                key={coluna.titulo}
                scope="col"
                className={cn(
                  "whitespace-nowrap px-3 py-2.5 text-[0.65rem] font-bold uppercase tracking-[0.07em] text-muted-foreground",
                  coluna.direita ? "text-right" : "text-left",
                )}
              >
                {coluna.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {veiculos.map((v) => (
            <FragmentoDoVeiculo
              key={chaveDoVeiculo(v)}
              veiculo={v}
              aberta={expandidas.has(chaveDoVeiculo(v))}
              justificadaPor={justificadaPor}
              onAlternar={() => alternar(v)}
              onAbrir={() => onAbrir(v)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A linha da placa e, quando aberta, a das alterações dela. */
function FragmentoDoVeiculo({
  veiculo: v,
  aberta,
  justificadaPor,
  onAlternar,
  onAbrir,
}: {
  veiculo: VeiculoDeFiname;
  aberta: boolean;
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onAlternar: () => void;
  onAbrir: () => void;
}) {
  const diferenca = v.parcela?.diferenca ?? null;
  /* Justificar é sobre uma alteração do motor: a linha "sem alteração" não tem
     `change.id`, e portanto não entra nem no numerador nem no denominador. */
  const justificaveis = v.linhas.filter((l) => l.id !== null);
  const justificadas = justificaveis.filter((l) => justificadaPor?.has(l.id!)).length;

  return (
    <>
      <tr
        className={cn(
          "cursor-pointer border-b border-superficie-borda hover:bg-muted/50",
          aberta && "bg-muted/40",
        )}
        onClick={onAlternar}
        tabIndex={0}
        role="button"
        aria-expanded={aberta}
        aria-label={`${aberta ? "Fechar" : "Abrir"} as alterações de ${
          v.entityLabel ?? "veículo sem placa"
        }`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onAlternar();
          }
        }}
      >
        <td className="whitespace-nowrap px-3 py-2 font-mono font-semibold">
          <span className="flex items-center gap-1.5">
            <ChevronRight
              className={cn(
                "h-4 w-4 flex-none text-muted-foreground transition-transform",
                aberta && "rotate-90",
              )}
              aria-hidden="true"
            />
            {v.entityLabel ?? "—"}
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
          {ROTULO_DO_TIPO[v.entityType] ?? v.entityType}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
          {escreverPeriodo(v.periodoFiname)}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
          {escreverDataDeCadastro(v.dataDeCadastro)}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right">
          <span className="font-mono font-semibold tabular-nums">
            {formatNumber(v.alteracoes, 0)}
          </span>
          {/* Quantas das alterações são dinheiro — o resto é prazo, taxa, ano e
              data, que não viram reais e não entram em soma nenhuma. */}
          {v.alteracoes > v.alteracoesEmDinheiro && (
            <span className="ml-1 text-[0.7rem] text-muted-foreground">
              ({formatNumber(v.alteracoesEmDinheiro, 0)} em R$)
            </span>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
          {escreverValor(v.parcela?.base?.toString() ?? null, "DINHEIRO")}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
          {escreverValor(v.parcela?.comparada?.toString() ?? null, "DINHEIRO")}
        </td>
        <td
          className={cn(
            "whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums",
            corDaDiferenca(diferenca, "DINHEIRO"),
          )}
        >
          {escreverDiferenca(diferenca, "DINHEIRO")}
        </td>
        <td
          className={cn(
            "whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums",
            corDaDiferenca(diferenca, "DINHEIRO"),
          )}
        >
          {escreverVariacao(v.parcela?.variacao ?? null)}
        </td>
        <td className="whitespace-nowrap px-3 py-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
              SELO_DO_ESTADO[v.estado],
            )}
          >
            {ROTULO_DO_ESTADO[v.estado]}
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
          {justificaveis.length === 0 ? (
            ""
          ) : justificadas === 0 ? (
            <span className="text-muted-foreground/70">Sem justificativa</span>
          ) : (
            `${formatNumber(justificadas, 0)} de ${formatNumber(justificaveis.length, 0)}`
          )}
        </td>
      </tr>

      {aberta && (
        <tr className="border-b border-superficie-borda bg-muted/20">
          <td colSpan={COLUNAS.length} className="px-3 py-3">
            <AlteracoesDoVeiculo
              linhas={v.linhas}
              justificadaPor={justificadaPor}
              onAbrir={onAbrir}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * As alterações de uma placa — a tabela de antes, agora por dentro da linha.
 *
 * As mesmas colunas que a tabela plana tinha (a variável, as duas pontas, a
 * diferença na unidade certa, o status e a justificativa), sem as do veículo:
 * placa, tipo, prazo e data de cadastro já estão na linha de cima, e repeti-las
 * aqui seria escrevê-las catorze vezes.
 */
function AlteracoesDoVeiculo({
  linhas,
  justificadaPor,
  onAbrir,
}: {
  linhas: readonly LinhaDeFiname[];
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onAbrir: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-lg border bg-background">
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
              <th scope="col" className="px-3 py-2 text-left font-bold">
                Variável
              </th>
              <th scope="col" className="px-3 py-2 text-right font-bold">
                De
              </th>
              <th scope="col" className="px-3 py-2 text-right font-bold">
                Para
              </th>
              <th scope="col" className="px-3 py-2 text-right font-bold">
                Diferença
              </th>
              <th scope="col" className="px-3 py-2 text-right font-bold">
                Variação %
              </th>
              <th scope="col" className="px-3 py-2 text-left font-bold">
                Status
              </th>
              <th scope="col" className="px-3 py-2 text-left font-bold">
                Justificativa
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, indice) => {
              const justificativa = l.id === null ? undefined : justificadaPor?.get(l.id);
              return (
                <tr
                  key={`${l.id ?? "igual"}-${l.variavel}-${indice}`}
                  className="border-b last:border-0"
                >
                  <td className="whitespace-nowrap px-3 py-1.5">{l.rotuloDaVariavel}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverValor(l.base, l.medida)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums">
                    {escreverValor(l.comparada, l.medida)}
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums",
                      corDaDiferenca(l.diferenca, l.medida),
                    )}
                  >
                    {escreverDiferenca(l.diferenca, l.medida)}
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums",
                      corDaDiferenca(l.diferenca, l.medida),
                    )}
                  >
                    {escreverVariacao(l.variacao)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[0.7rem] font-semibold",
                          SELO_DO_ESTADO[l.estado],
                        )}
                      >
                        {ROTULO_DO_ESTADO[l.estado]}
                      </span>
                      {/* O motivo da recusa fica num ⓘ, e não numa coluna: ele
                          existe em duas linhas de cada cem. */}
                      {l.motivo && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label={`Por que esta linha não foi comparada: ${l.motivo}`}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <Info className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            {l.motivo}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    {/* Linha "sem alteração" não tem `change.id`, e portanto não
                        tem o que justificar: fica em branco, e não com um traço
                        que sugerisse pendência. */}
                    {!justificativa ? (
                      l.id === null ? (
                        ""
                      ) : (
                        <span className="text-muted-foreground/70">Sem justificativa</span>
                      )
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block max-w-[16rem] truncate text-left">
                            {justificativa.texto}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-sm text-xs">
                          {justificativa.texto}
                          <span className="mt-1 block text-muted-foreground">
                            {justificativa.criadoPor}
                          </span>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAbrir}
        className="gap-2 self-start"
      >
        <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
        Abrir detalhe completo
      </Button>
    </div>
  );
}
