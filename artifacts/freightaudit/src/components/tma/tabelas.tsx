import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  DEFINICAO_DA_PORTA,
  ROTULO_DA_FOLGA,
  ROTULO_DA_PORTA,
  ROTULO_DO_VEREDITO_DO_LOCAL,
  SELO_DA_FOLGA,
  SELO_DO_LOCAL,
  escreverDiferencaDeTempo,
  escreverFracao,
  escreverMinutos,
  type LocalDeTma,
  type TrechoDeTma,
} from "@/lib/tma";
import { formatNumber } from "@/lib/format";

/**
 * As duas tabelas dos dois grãos — e nenhuma conta dentro do JSX.
 *
 * Tudo o que aparece aqui chega decidido do núcleo: as médias, as amplitudes, as
 * folgas e os vereditos. O componente escolhe a cor e escreve.
 *
 * **Os selos têm texto, e não só cor.** Quem não distingue o âmbar do verde
 * continua lendo "Tempo varia conforme o trecho" e "Paga mais porta do que
 * pratica".
 */

function Cabecalho({ colunas }: { colunas: { titulo: string; direita?: boolean }[] }) {
  return (
    <thead>
      <tr className="border-b bg-muted/60">
        {colunas.map((c) => (
          <th
            key={c.titulo}
            scope="col"
            className={cn(
              "whitespace-nowrap px-3 py-2.5 text-[0.65rem] font-bold uppercase tracking-[0.07em] text-muted-foreground",
              c.direita ? "text-right" : "text-left",
            )}
          >
            {c.titulo}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** O ⓘ que carrega uma explicação sem roubar o clique da linha. */
function Explicacao({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={rotulo}
          onClick={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:text-foreground"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{children}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A tabela do grão do local.
 *
 * **A coluna Porta não é decoração.** Sem ela, o mesmo CDD aparece duas vezes
 * com números diferentes e quem lê acha que é duplicidade — quando são as duas
 * operações que ele de fato tem. A definição de cada uma está no ⓘ, com as
 * palavras do dicionário da tabela de frete.
 *
 * **A amplitude vem ao lado do médio**, e não escondida numa gaveta: é o número
 * que diz se aquela média descreve alguma coisa. Noventa minutos de média entre
 * trechos que declaram 30 e 150 não é um tempo de porta, é uma discordância.
 */
export function TabelaDeLocais({
  locais,
  duasPontas,
  rotuloBase,
  rotuloComparada,
}: {
  locais: LocalDeTma[];
  /** Com as duas pontas à vista, a tabela ganha a coluna que diz qual é qual. */
  duasPontas: boolean;
  rotuloBase: string;
  rotuloComparada: string;
}) {
  return (
    <div className="superficie overflow-x-auto">
      <table className="w-full min-w-[64rem] border-collapse text-sm">
        <caption className="sr-only">
          Tempo de porta por local e por operação — carregamento e descarga separados.
        </caption>
        <Cabecalho
          colunas={[
            { titulo: "Local" },
            { titulo: "Porta" },
            ...(duasPontas ? [{ titulo: "Vigência" }] : []),
            { titulo: "Trechos", direita: true },
            { titulo: "Mínimo", direita: true },
            { titulo: "Médio", direita: true },
            { titulo: "Máximo", direita: true },
            { titulo: "Amplitude", direita: true },
            { titulo: "Pago", direita: true },
            { titulo: "Folga", direita: true },
            { titulo: "% do ciclo", direita: true },
            { titulo: "Leitura" },
          ]}
        />
        <tbody>
          {locais.map((l) => (
            <tr
              key={`${l.ponta}-${l.porta}-${l.local}`}
              className="border-b border-superficie-borda last:border-0 hover:bg-muted/50"
            >
              <td className="max-w-[16rem] truncate px-3 py-2 font-semibold">{l.local}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 font-semibold",
                      l.porta === "ORIGEM"
                        ? "border-brand/25 bg-brand/10 text-brand"
                        : "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {l.porta === "ORIGEM" ? "Carga" : "Descarga"}
                  </span>
                  <Explicacao rotulo={`O que é ${ROTULO_DA_PORTA[l.porta]}`}>
                    <strong className="font-semibold">{ROTULO_DA_PORTA[l.porta]}.</strong>{" "}
                    {DEFINICAO_DA_PORTA[l.porta]}
                  </Explicacao>
                </span>
              </td>
              {duasPontas && (
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                  {l.ponta === "BASE" ? rotuloBase : rotuloComparada}
                </td>
              )}
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {formatNumber(l.trechos, 0)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {escreverMinutos(l.minimo)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold tabular-nums">
                {escreverMinutos(l.medio)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {escreverMinutos(l.maximo)}
              </td>
              <td
                className={cn(
                  "whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums",
                  l.veredito === "VARIA_POR_TRECHO" && "font-semibold text-warning-foreground",
                )}
              >
                {escreverMinutos(l.amplitude)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {escreverMinutos(l.pagoMedio)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                {escreverDiferencaDeTempo(l.folgaMedia)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                {escreverFracao(l.pesoNoCiclo)}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    SELO_DO_LOCAL[l.veredito],
                  )}
                >
                  {ROTULO_DO_VEREDITO_DO_LOCAL[l.veredito]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A tabela do grão do trecho.
 *
 * A coluna **Porta** aqui é a soma das duas pontas do percurso, e é a única soma
 * que esta tela faz entre elas — porque aqui elas de fato se somam: é o mesmo
 * caminhão, no mesmo ciclo, parado nos dois lugares. Quando falta qualquer das
 * duas ela fica em branco, e não na metade que veio: meia soma não é um tempo de
 * porta menor, é um tempo de porta que não se sabe.
 */
export function TabelaDeTrechos({
  trechos,
  duasPontas,
  rotuloBase,
  rotuloComparada,
}: {
  trechos: TrechoDeTma[];
  duasPontas: boolean;
  rotuloBase: string;
  rotuloComparada: string;
}) {
  return (
    <div className="superficie overflow-x-auto">
      <table className="w-full min-w-[66rem] border-collapse text-sm">
        <caption className="sr-only">
          Tempo de porta por trecho — as duas pontas do percurso e o peso delas no ciclo.
        </caption>
        <Cabecalho
          colunas={[
            { titulo: "Trecho" },
            ...(duasPontas ? [{ titulo: "Vigência" }] : []),
            { titulo: "Carga (origem)", direita: true },
            { titulo: "Descarga (destino)", direita: true },
            { titulo: "Tempo de porta", direita: true },
            { titulo: "Pago", direita: true },
            { titulo: "Folga", direita: true },
            { titulo: "Ciclo", direita: true },
            { titulo: "% do ciclo", direita: true },
            { titulo: "Leitura" },
          ]}
        />
        <tbody>
          {trechos.map((t, indice) => (
            <tr
              key={`${t.ponta}-${t.entityLabel ?? indice}`}
              className="border-b border-superficie-borda last:border-0 hover:bg-muted/50"
            >
              <td className="max-w-[18rem] px-3 py-2">
                <span className="block truncate font-mono text-xs font-semibold">
                  {t.entityLabel ?? "—"}
                </span>
                {(t.origem || t.destino) && (
                  <span className="block truncate text-[0.7rem] text-muted-foreground">
                    {t.origem ?? "—"} → {t.destino ?? "—"}
                  </span>
                )}
              </td>
              {duasPontas && (
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                  {t.ponta === "BASE" ? rotuloBase : rotuloComparada}
                </td>
              )}
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                {escreverMinutos(t.tmaOrigem)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                {escreverMinutos(t.tmaDestino)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold tabular-nums">
                <span className="flex items-center justify-end gap-1.5">
                  {escreverMinutos(t.tempoDePorta)}
                  {t.tempoDePorta === null && (
                    <Explicacao rotulo="Por que o tempo de porta está em branco">
                      Falta uma das duas pontas. Meia soma não é um tempo de porta menor — é um
                      tempo de porta que não se sabe, e escrevê-lo pela metade diria que o
                      caminhão só para de um lado.
                    </Explicacao>
                  )}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {escreverMinutos(t.pagoDePorta)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                {escreverDiferencaDeTempo(t.folga)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {escreverMinutos(t.ciclo)}
              </td>
              <td
                className={cn(
                  "whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums",
                  t.pesoNoCiclo !== null && t.pesoNoCiclo >= 0.4 && "font-semibold text-warning-foreground",
                )}
              >
                {escreverFracao(t.pesoNoCiclo)}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    SELO_DA_FOLGA[t.veredito],
                  )}
                >
                  {ROTULO_DA_FOLGA[t.veredito]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
