import { useState } from "react";
import { ChevronRight, Info, MessageSquarePlus, PanelRightOpen } from "lucide-react";
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
import type { AlvoDaJustificativa } from "@/components/justificativas/justificar-dialog";
import type { Justificativa } from "@/lib/justificativas";

/**
 * Justificar a partir da tabela — o que o componente pede de fora.
 *
 * A tela não grava nada: ela **abre o diálogo** que a página já sabe gravar, o
 * mesmo de Chamados. `alvos` são as alterações que vão receber o texto (uma, ou
 * todas as da placa), e `atual` é o que já está gravado, quando se está
 * reescrevendo — o diálogo abre com ele no campo, porque quem reabre uma linha
 * explicada quase sempre quer corrigir, não redigir do zero.
 */
export type AbrirJustificativa = (
  alvos: AlvoDaJustificativa[],
  atual?: Justificativa | null,
) => void;

/** Uma linha do motor como o diálogo de justificar a enxerga. */
const alvoDaLinha = (l: LinhaDeFiname): AlvoDaJustificativa => ({
  id: l.id!,
  entityLabel: l.entityLabel,
  attributeCode: l.attributeCode,
  attributeName: l.rotuloDaVariavel,
});

const ROTULO_DO_TIPO: Record<string, string> = { CAVALO: "Cavalo", CARRETA: "Carreta" };

/** As colunas da placa, na ordem da tela — e de que lado cada número encosta. */
const COLUNAS: { titulo: string; direita?: boolean }[] = [
  { titulo: "Veículo" },
  { titulo: "Tipo" },
  { titulo: "Período FINAME", direita: true },
  { titulo: "Data de cadastro", direita: true },
  { titulo: "Fim do contrato", direita: true },
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
  onJustificar,
}: {
  veiculos: VeiculoDeFiname[];
  /** A justificativa mais recente de cada alteração, por `change.id`. */
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onAbrir: (veiculo: { entityLabel: string | null; entityType: string }) => void;
  /** Abre o diálogo de justificar. Ausente, a coluna fica só de leitura. */
  onJustificar?: AbrirJustificativa;
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
      <table className="w-full min-w-[84rem] border-collapse text-sm">
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
              onJustificar={onJustificar}
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
  onJustificar,
  onAlternar,
  onAbrir,
}: {
  veiculo: VeiculoDeFiname;
  aberta: boolean;
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onJustificar?: AbrirJustificativa;
  onAlternar: () => void;
  onAbrir: () => void;
}) {
  const diferenca = v.parcela?.diferenca ?? null;
  /*
    O fim do contrato é do veículo, e não uma variável da comparação: ele é a
    resposta da coluna, não uma linha no meio das outras treze. Quando ele se
    moveu — e mover-se é o caso comum, porque o contrato que acabou é o que a
    tela está lendo —, a outra ponta fica no tooltip da célula, que é o que
    permite tirar a linha da expansão sem perder o "de".
  */
  const linhaDoFim = v.linhas.find((l) => l.variavel === "data_fim_contrato") ?? null;
  const fim = v.fimDoContrato ?? linhaDoFim?.comparada ?? linhaDoFim?.base ?? null;
  const fimAnterior =
    linhaDoFim?.estado === "ALTERADO" && linhaDoFim.base !== linhaDoFim.comparada
      ? linhaDoFim.base
      : null;
  /* As linhas da expansão são as variáveis comparadas; o fim do contrato saiu
     delas para a coluna, e repeti-lo aqui seria mostrá-lo duas vezes. */
  const linhasDaExpansao = v.linhas.filter((l) => l.variavel !== "data_fim_contrato");
  /*
    O que se justifica nesta tela é **o que se moveu**.

    Duas exclusões, e as duas pela mesma razão: uma justificativa explica uma
    alteração. A linha "sem alteração" não tem `change.id` — não há alteração
    sobre a qual gravar. E conflito e dado incompleto não são alterações: são a
    recusa do motor em afirmar que houve uma, e o que elas pedem é o conserto do
    dado, não uma frase. Contá-las no denominador poria a placa em "2 de 5" para
    sempre, com três linhas que ninguém pode fechar — e a coluna deixaria de
    dizer o que falta fazer.
  */
  const justificaveis = v.linhas.filter((l) => l.id !== null && l.estado === "ALTERADO");
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
        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
          {fimAnterior === null ? (
            escreverDataDeCadastro(fim)
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="underline decoration-dotted underline-offset-2">
                  {escreverDataDeCadastro(fim)}
                </span>
              </TooltipTrigger>
              <TooltipContent className="text-xs">
                {`Fim do contrato: de ${escreverDataDeCadastro(
                  fimAnterior,
                )} para ${escreverDataDeCadastro(fim)}`}
              </TooltipContent>
            </Tooltip>
          )}
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
          ) : (
            <span className="flex items-center gap-2">
              <span className={cn(justificadas === 0 && "text-muted-foreground/70")}>
                {justificadas === 0
                  ? "Sem justificativa"
                  : `${formatNumber(justificadas, 0)} de ${formatNumber(justificaveis.length, 0)}`}
              </span>
              {/* Justificar a placa inteira: o mesmo texto para todas as
                  alterações dela, que é como a auditoria de fato explica uma
                  queda — o contrato acabou, e isso vale para a parcela, para os
                  juros e para a amortização da mesma placa. O clique não pode
                  subir para a linha, ou abriria a expansão junto. */}
              {onJustificar && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onJustificar(justificaveis.map(alvoDaLinha));
                  }}
                  aria-label={
                    /* Singular e plural, porque a placa de uma alteração só é
                       comum: "Justificar as 1 alterações" é o tipo de frase que
                       um leitor de tela lê inteira, em voz alta. */
                    `${
                      justificaveis.length === 1
                        ? "Justificar a 1 alteração"
                        : `Justificar as ${justificaveis.length} alterações`
                    } de ${v.entityLabel ?? "veículo sem placa"}`
                  }
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[0.7rem] font-semibold hover:bg-muted"
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
                  Justificar
                </button>
              )}
            </span>
          )}
        </td>
      </tr>

      {aberta && (
        <tr className="border-b border-superficie-borda bg-muted/20">
          <td colSpan={COLUNAS.length} className="px-3 py-3">
            <AlteracoesDoVeiculo
              linhas={linhasDaExpansao}
              justificadaPor={justificadaPor}
              onJustificar={onJustificar}
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
 * placa, tipo, prazo, data de cadastro e fim do contrato já estão na linha de
 * cima, e repeti-las aqui seria escrevê-las catorze vezes.
 *
 * A ordem das linhas é a do catálogo, e `agruparPorVeiculo` já a aplica: a
 * parcela FINAME primeiro, juros e amortização logo abaixo. A parcela é a soma
 * dos dois, e lê-la no meio deles convidava a somar as três.
 */
function AlteracoesDoVeiculo({
  linhas,
  justificadaPor,
  onJustificar,
  onAbrir,
}: {
  linhas: readonly LinhaDeFiname[];
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onJustificar?: AbrirJustificativa;
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
                        que sugerisse pendência — nem com um botão que gravaria
                        sobre coisa nenhuma. */}
                    <CelulaDeJustificativa
                      linha={l}
                      justificativa={justificativa}
                      onJustificar={onJustificar}
                    />
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

/**
 * A justificativa de uma alteração — lida e escrita na mesma célula.
 *
 * Três estados, e nenhum deles é decorativo:
 *
 * - **sem `change.id`** (a linha "sem alteração", que o alternador traz): não há
 *   o que justificar, e a célula fica vazia;
 * - **sem texto**: um botão "Justificar", porque a pendência é a informação;
 * - **com texto**: o texto, clicável para reescrever. Gravar de novo não edita a
 *   anterior — o histórico é o que torna a justificativa auditável —, e por isso
 *   o diálogo abre com o texto atual à vista, dizendo o que vai substituir.
 *
 * **Só a linha alterada ganha botão**, a mesma régua da contagem da placa: um
 * conflito ou um dado incompleto é a recusa do motor em afirmar que houve
 * alteração, e o que ele pede é o conserto do dado. Se o botão existisse aqui, o
 * numerador da placa contaria uma linha que o denominador não conta — "4 de 3".
 * O texto já gravado numa dessas linhas continua à vista, só de leitura, porque
 * apagá-lo da tela seria esconder o histórico.
 *
 * Sem `onJustificar` a célula é só de leitura: é o que mantém a tabela usável
 * onde justificar não faz sentido, sem um botão que não grava.
 */
function CelulaDeJustificativa({
  linha: l,
  justificativa,
  onJustificar,
}: {
  linha: LinhaDeFiname;
  justificativa: Justificativa | undefined;
  onJustificar?: AbrirJustificativa;
}) {
  /* Nem toda linha é justificável: ver o cabeçalho. A que não é não escreve
     "Sem justificativa" — não há pendência ali para ser cobrada. */
  if (l.id === null) return null;
  const alterada = l.estado === "ALTERADO";
  const abrir = alterada ? onJustificar : undefined;

  if (!justificativa) {
    if (!alterada) return null;
    if (!abrir) return <span className="text-muted-foreground/70">Sem justificativa</span>;
    return (
      <button
        type="button"
        onClick={() => abrir([alvoDaLinha(l)])}
        aria-label={`Justificar ${l.rotuloDaVariavel} de ${l.entityLabel ?? "veículo sem placa"}`}
        className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[0.7rem] font-semibold hover:bg-muted"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
        Justificar
      </button>
    );
  }

  const texto = (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block max-w-[16rem] truncate text-left">{justificativa.texto}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm text-xs">
        {justificativa.texto}
        <span className="mt-1 block text-muted-foreground">{justificativa.criadoPor}</span>
      </TooltipContent>
    </Tooltip>
  );

  if (!abrir) return texto;
  return (
    <button
      type="button"
      onClick={() => abrir([alvoDaLinha(l)], justificativa)}
      aria-label={`Reescrever a justificativa de ${l.rotuloDaVariavel} de ${
        l.entityLabel ?? "veículo sem placa"
      }`}
      className="max-w-full text-left underline decoration-dotted underline-offset-2 hover:text-foreground"
    >
      {texto}
    </button>
  );
}
