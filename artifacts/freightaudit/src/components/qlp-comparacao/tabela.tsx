import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CelulaDeJustificativa,
  COLUNA_DE_JUSTIFICATIVA,
  type AbrirJustificativa,
} from "@/components/justificativas/coluna";
import type { Justificativa } from "@/lib/justificativas";
import { cn } from "@/lib/utils";
import {
  ROTULO_DO_ESTADO,
  SELO_DO_ESTADO,
  corDaDiferenca,
  escreverCargo,
  escreverDiferenca,
  escreverValor,
  escreverVariacao,
  type LinhaDeQlpComparado,
} from "@/lib/qlp-comparacao";

/**
 * A tabela da comparação — uma linha por cargo e variável.
 *
 * É a mesma forma das seis auditorias de rubrica, com a coluna do ativo
 * trocada: onde elas escrevem placa, esta escreve **cargo**, e o cargo tem duas
 * metades — a unidade e o posto —, porque a chave do quadro é composta. Escrevê-
 * las juntas numa célula só faria a coluna dobrar de largura para repetir o
 * mesmo CNPJ em quarenta linhas.
 *
 * **O selo de estado tem texto, e não só cor**: quem não distingue o verde do
 * vermelho continua lendo "Alterado" e "Conflito".
 *
 * **A coluna que não entra em soma diz isso no ⓘ.** Um subtotal muda junto com
 * as parcelas dele, e a linha do subtotal ao lado das linhas das parcelas é a
 * forma mais fácil de contar a mesma mudança duas vezes.
 *
 * **A coluna de justificativa é a mesma das outras seis** — mesmo componente,
 * mesmo `change.id`, mesmo POST. Uma queda de efetivo se explica olhando a linha
 * que caiu, e era exatamente ali que não dava para escrever.
 */
export function TabelaDaComparacaoDeQlp({
  linhas,
  rotulos,
  justificadaPor,
  onAbrir,
  onJustificar,
}: {
  linhas: LinhaDeQlpComparado[];
  rotulos: Record<string, string>;
  /** A justificativa mais recente de cada alteração, por `change.id`. */
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  /** Abrir a gaveta do cargo desta linha. */
  onAbrir: (cargo: string) => void;
  /** Sem ele a coluna é só de leitura — ver `CelulaDeJustificativa`. */
  onJustificar?: AbrirJustificativa;
}) {
  return (
    <div className="superficie overflow-x-auto">
      <table className="w-full min-w-[64rem] border-collapse text-sm">
        <caption className="sr-only">
          Comparação do quadro entre as duas vigências, por cargo, classificação e
          variável.
        </caption>
        <thead>
          <tr className="border-b bg-muted/60">
            {[
              "Cargo",
              "Classificação",
              "Variável",
              "De",
              "Para",
              "Diferença",
              "Variação %",
              "Status",
              COLUNA_DE_JUSTIFICATIVA,
            ].map((titulo, i) => (
                <th
                  key={titulo}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap px-3 py-2.5 text-[0.65rem] font-bold uppercase tracking-[0.07em] text-muted-foreground",
                    i >= 3 && i <= 6 ? "text-right" : "text-left",
                  )}
              >
                {titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, indice) => {
            const { unidade, cargo, classificacao, outros } = escreverCargo(
              linha.entityLabel,
              rotulos,
            );
            return (
              <tr
                key={`${linha.entityLabel}-${linha.variavel}-${linha.id ?? indice}`}
                className="cursor-pointer border-b border-superficie-borda hover:bg-muted/40"
                onClick={() => linha.entityLabel && onAbrir(linha.entityLabel)}
                tabIndex={0}
                role="button"
                aria-label={`Abrir as variáveis de ${cargo}`}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && linha.entityLabel) {
                    e.preventDefault();
                    onAbrir(linha.entityLabel);
                  }
                }}
              >
                <td className="px-3 py-2">
                  <div className="font-medium">{cargo}</div>
                  {unidade && (
                    <div className="font-mono text-[0.7rem] text-muted-foreground">
                      {unidade}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {classificacao ?? "—"}
                  {outros.map((campo) => (
                    <div key={campo.rotulo} className="text-[0.7rem]">
                      {campo.rotulo}: {campo.valor}
                    </div>
                  ))}
                </td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    {linha.rotuloDaVariavel}
                    {linha.foraDaSoma && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info
                            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            aria-label={`Por que ${linha.rotuloDaVariavel} não entra em soma`}
                          />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-sm">
                          {linha.foraDaSoma}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {escreverValor(linha.base, linha.medida)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {escreverValor(linha.comparada, linha.medida)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums font-medium",
                    corDaDiferenca(linha.diferenca, linha.medida),
                  )}
                >
                  {escreverDiferenca(linha.diferenca, linha.medida)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {escreverVariacao(linha.variacao)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      "inline-block rounded-full px-2 py-0.5 text-[0.7rem] font-semibold",
                      SELO_DO_ESTADO[linha.estado],
                    )}
                  >
                    {ROTULO_DO_ESTADO[linha.estado]}
                  </span>
                  {linha.motivo && (
                    <p className="mt-1 max-w-xs text-[0.7rem] text-muted-foreground">
                      {linha.motivo}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {/*
                    O cargo entra legível no diálogo, e não pela chave.

                    `entityLabel` é o que a caixa de justificar escreve no topo,
                    e o motor grava ali a chave normalizada
                    (`07526557001505CARGOMANOBRISTA…`). Quem vai explicar uma
                    alteração precisa ler de que cargo ela é; o que identifica a
                    gravação é o `change.id`, que não muda com isto.
                  */}
                  <CelulaDeJustificativa
                    linha={{ ...linha, entityLabel: unidade ? `${unidade} · ${cargo}` : cargo }}
                    justificativa={
                      linha.id === null ? undefined : justificadaPor?.get(linha.id)
                    }
                    {...(onJustificar ? { onJustificar } : {})}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
