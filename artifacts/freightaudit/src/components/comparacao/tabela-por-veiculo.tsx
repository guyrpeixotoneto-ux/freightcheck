import { useState, type ReactNode } from "react";
import { ChevronRight, Info, MessageSquarePlus, PanelRightOpen } from "lucide-react";
import type {
  EstadoDaLinha,
  MedidaDaVariavel,
} from "@workspace/comparison/recorte-de-rubrica";
import type {
  LinhaAgrupavel,
  VeiculoDaRubrica,
} from "@workspace/comparison/agrupamento-por-veiculo";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import {
  CelulaDeJustificativa,
  alvoDaLinha,
  type AbrirJustificativa,
  type LinhaJustificavel,
} from "@/components/justificativas/coluna";
import type { Justificativa } from "@/lib/justificativas";

/**
 * A TABELA POR VEÍCULO — uma linha por placa, em toda auditoria de custo fixo.
 *
 * ---------------------------------------------------------------------------
 * Por que por veículo, e não por variável
 * ---------------------------------------------------------------------------
 * As quatro tabelas de custo fixo nasceram por variável: uma linha para cada par
 * (veículo × variável). No FINAME, com catorze variáveis, a mesma placa aparecia
 * catorze vezes, espalhada por três páginas — seis linhas de "Amortização"
 * seguidas de seis de "Parcela FINAME", das mesmas seis placas. Perguntar "o que
 * aconteceu com a QYW6D15?" era caçar as linhas dela na lista.
 *
 * Agora a placa é a linha, e ela responde de uma vez: quantas variáveis se
 * moveram, como o dinheiro da rubrica foi de uma vigência para a outra, qual o
 * estado mais grave e se já há justificativa. **Clicar abre as alterações
 * daquela placa**, ali mesmo, sem sair da página; o botão dentro da expansão
 * abre a gaveta com o diagnóstico e as variáveis que só existem no detalhe.
 *
 * ---------------------------------------------------------------------------
 * Por que uma tabela, e não quatro
 * ---------------------------------------------------------------------------
 * Porque a diferença entre as quatro telas é vocabulário, e vocabulário cabe num
 * parâmetro. O que muda de uma rubrica para a outra é como se escreve um valor
 * (o FINAME tem meses, o Lucro Fixo tem ciclo), de que lado fica o verde (nos
 * Impostos um tributo maior é perda, e a cor se inverte), e que colunas de
 * contexto a placa tem (só o FINAME tem prazo e fim de contrato). Tudo isso
 * entra por {@link EscritaDaRubrica}; a estrutura — o agrupamento, a expansão, a
 * fila de justificar, o estado mais grave — é a mesma, e agora existe uma vez.
 *
 * Quatro cópias seriam quatro tabelas livres para divergir, e a que divergisse
 * primeiro faria a mesma frota ser lida de dois jeitos em duas telas irmãs.
 *
 * ---------------------------------------------------------------------------
 * As duas coisas que esta tabela se recusa a fazer
 * ---------------------------------------------------------------------------
 * **Não soma variáveis de unidades diferentes.** Nenhuma célula junta reais com
 * meses ou com pontos percentuais. A contagem de alterações é contagem, e o
 * dinheiro da linha é **uma** variável — a que cada rubrica declara como
 * destaque em `agrupamento-por-veiculo.ts`.
 *
 * **Não inventa o que não está no recorte.** A placa cuja linha de destaque não
 * veio — porque não se moveu, ou porque um filtro por variável a tirou — mostra
 * `—` nas colunas do destaque, e não R$ 0,00. As contas todas vêm de
 * `agruparVeiculos`, no núcleo; aqui só se escolhe a cor e se escreve.
 */

const ROTULO_DO_TIPO: Record<string, string> = { CAVALO: "Cavalo", CARRETA: "Carreta" };

/**
 * A linha que esta tabela sabe desenhar — o que as quatro rubricas têm em comum.
 *
 * `LinhaAgrupavel` é o que o núcleo precisa para agrupar; o resto é o que a tela
 * precisa para escrever: o rótulo da variável, o motivo da recusa, o aviso da
 * coluna que não soma, e o que o diálogo de justificar pede
 * ({@link LinhaJustificavel}). As quatro linhas de custo fixo satisfazem isto
 * por construção, e nenhuma delas precisou mudar para caber.
 */
type LinhaDeRubrica = LinhaAgrupavel &
  LinhaJustificavel & {
    rotuloDaVariavel: string;
    motivo: string | null;
    foraDaSoma: string | null;
  };

/** Uma coluna de contexto da placa — o que só aquela rubrica tem a dizer. */
export interface ColunaDoVeiculo<V> {
  titulo: string;
  direita?: boolean;
  celula: (veiculo: V) => ReactNode;
}

/** Como uma rubrica escreve o que esta tabela desenha. */
export interface EscritaDaRubrica<L extends LinhaAgrupavel, V extends VeiculoDaRubrica<L>> {
  /** O nome da rubrica, para a legenda de leitor de tela. */
  rubrica: string;
  /**
   * O nome da variável de destaque, como as duas colunas de dinheiro a chamam:
   * "Parcela", "IPVA", "Lucro fixo", "PIS/COFINS". Vira "Parcela de" e
   * "Parcela para" — a placa e a vigência já estão ditas no seletor acima.
   */
  destaque: string;
  escreverValor: (valor: string | null, medida: MedidaDaVariavel) => string;
  escreverDiferenca: (diferenca: number | null, medida: MedidaDaVariavel) => string;
  escreverVariacao: (variacao: number | null) => string;
  corDaDiferenca: (diferenca: number | null, medida: MedidaDaVariavel) => string;
  selo: Record<EstadoDaLinha, string>;
  rotuloDoEstado: Record<EstadoDaLinha, string>;
  /** As colunas de contexto, entre "Tipo" e "Alterações". Nenhuma, por padrão. */
  colunasDoVeiculo?: readonly ColunaDoVeiculo<V>[];
  /**
   * A coluna que a expansão ganha **antes** da variável, quando a rubrica tem
   * uma dimensão que separa as linhas de uma mesma placa.
   *
   * Nos Impostos é o tributo: ICMS e PIS/COFINS não somam entre si, e sem a
   * coluna as duas rubricas se misturam numa lista ordenada por variável. Ela é
   * da linha, e não do veículo — a mesma placa tem linhas dos dois tributos.
   */
  colunaDaVariavel?: { titulo: string; celula: (linha: L) => ReactNode };
  /**
   * O aviso ⓘ ao lado do nome da variável, quando a rubrica tem um a dar.
   *
   * Nos Impostos é a alíquota: numa coluna de números em que a linha de cima é
   * R$ 37.890,84, o `12` da linha de baixo pede o aviso de que não é dinheiro e
   * não entra em soma nenhuma. Junto do nome, e não em coluna própria, pela
   * mesma razão do motivo da recusa.
   */
  avisoDaVariavel?: (linha: L) => { rotulo: string; texto: ReactNode } | null;
  /**
   * As variáveis que a expansão **não** repete porque já viraram coluna da
   * placa. Repeti-las seria mostrar o mesmo dado duas vezes na mesma linha.
   */
  foraDaExpansao?: readonly string[];
  /**
   * O aviso ⓘ ao lado da placa, quando a rubrica tem um a dar — no IPVA, o
   * valor negativo, que ou é estorno ou é erro e nos dois casos entra numa soma
   * e a distorce.
   *
   * Mora na coluna do veículo, e não numa coluna própria, pela mesma razão que o
   * motivo da recusa: existe em poucas linhas de cada cem, e uma coluna vazia em
   * noventa e oito por cento delas empurraria as úteis para fora da tela.
   */
  avisoDaPlaca?: (veiculo: V) => { rotulo: string; texto: ReactNode } | null;
}

/** A chave de uma placa na lista de expandidas. */
const chaveDaPlaca = (v: { entityLabel: string | null; entityType: string }) =>
  `${v.entityLabel}${v.entityType}`;

export function TabelaPorVeiculo<
  L extends LinhaDeRubrica,
  V extends VeiculoDaRubrica<L>,
>({
  veiculos,
  escrita,
  justificadaPor,
  onAbrir,
  onJustificar,
}: {
  veiculos: readonly V[];
  escrita: EscritaDaRubrica<L, V>;
  /** A justificativa mais recente de cada alteração, por `change.id`. */
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onAbrir: (veiculo: V) => void;
  /** Ausente, a coluna de justificativa fica só de leitura. */
  onJustificar?: AbrirJustificativa;
}) {
  const [expandidas, setExpandidas] = useState<ReadonlySet<string>>(new Set());

  const colunas: { titulo: string; direita?: boolean }[] = [
    { titulo: "Veículo" },
    { titulo: "Tipo" },
    ...(escrita.colunasDoVeiculo ?? []).map((c) => ({
      titulo: c.titulo,
      direita: c.direita,
    })),
    { titulo: "Alterações", direita: true },
    { titulo: `${escrita.destaque} de`, direita: true },
    { titulo: `${escrita.destaque} para`, direita: true },
    { titulo: "Diferença", direita: true },
    { titulo: "Variação %", direita: true },
    { titulo: "Status" },
    { titulo: "Justificativa" },
  ];

  function alternar(veiculo: V) {
    const chave = chaveDaPlaca(veiculo);
    setExpandidas((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(chave)) proximo.add(chave);
      return proximo;
    });
  }

  return (
    <div className="superficie overflow-x-auto">
      <table className="w-full min-w-[72rem] border-collapse text-sm">
        <caption className="sr-only">
          Comparação de {escrita.rubrica} entre as duas vigências do par, uma linha por
          veículo. Cada linha abre as variáveis que se moveram naquele veículo.
        </caption>
        <thead>
          <tr className="border-b bg-muted/60">
            {colunas.map((coluna) => (
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
              key={chaveDaPlaca(v)}
              veiculo={v}
              escrita={escrita}
              colunas={colunas.length}
              aberta={expandidas.has(chaveDaPlaca(v))}
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
function FragmentoDoVeiculo<
  L extends LinhaDeRubrica,
  V extends VeiculoDaRubrica<L>,
>({
  veiculo: v,
  escrita,
  colunas,
  aberta,
  justificadaPor,
  onJustificar,
  onAlternar,
  onAbrir,
}: {
  veiculo: V;
  escrita: EscritaDaRubrica<L, V>;
  colunas: number;
  aberta: boolean;
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onJustificar?: AbrirJustificativa;
  onAlternar: () => void;
  onAbrir: () => void;
}) {
  const diferenca = v.destaque?.diferenca ?? null;
  const fora = new Set(escrita.foraDaExpansao ?? []);
  const linhasDaExpansao = v.linhas.filter((l) => !fora.has(l.variavel));
  const aviso = escrita.avisoDaPlaca?.(v) ?? null;
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
            {aviso && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={aviso.rotulo}
                    onClick={(e) => e.stopPropagation()}
                    className="text-warning-foreground"
                  >
                    <Info className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">{aviso.texto}</TooltipContent>
              </Tooltip>
            )}
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
          {ROTULO_DO_TIPO[v.entityType] ?? v.entityType}
        </td>
        {(escrita.colunasDoVeiculo ?? []).map((coluna) => (
          <td
            key={coluna.titulo}
            className={cn(
              "whitespace-nowrap px-3 py-2 font-mono tabular-nums text-muted-foreground",
              coluna.direita ? "text-right" : "text-left",
            )}
          >
            {coluna.celula(v)}
          </td>
        ))}
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
          {escrita.escreverValor(v.destaque?.base?.toString() ?? null, "DINHEIRO")}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
          {escrita.escreverValor(v.destaque?.comparada?.toString() ?? null, "DINHEIRO")}
        </td>
        <td
          className={cn(
            "whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums",
            escrita.corDaDiferenca(diferenca, "DINHEIRO"),
          )}
        >
          {escrita.escreverDiferenca(diferenca, "DINHEIRO")}
        </td>
        <td
          className={cn(
            "whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums",
            escrita.corDaDiferenca(diferenca, "DINHEIRO"),
          )}
        >
          {escrita.escreverVariacao(v.destaque?.variacao ?? null)}
        </td>
        <td className="whitespace-nowrap px-3 py-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
              escrita.selo[v.estado],
            )}
          >
            {escrita.rotuloDoEstado[v.estado]}
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
              {/* Justificar a placa inteira: abre a fila com as alterações
                  dela, uma justificativa por variável — duas variáveis da mesma
                  placa não se explicam com a mesma frase, e a caixa pergunta
                  cada uma na sua etapa (ver `justificar-dialog.tsx`). O clique
                  não pode subir para a linha, ou abriria a expansão junto. */}
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
          <td colSpan={colunas} className="px-3 py-3">
            <AlteracoesDoVeiculo
              linhas={linhasDaExpansao}
              escrita={escrita}
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
 * placa, tipo e o contexto da rubrica já estão na linha de cima, e repeti-los
 * aqui seria escrevê-los uma vez por variável.
 *
 * A ordem das linhas é a do catálogo, e `agruparVeiculos` já a aplica: a
 * variável que a tela resume primeiro, o que a compõe logo abaixo.
 */
function AlteracoesDoVeiculo<
  L extends LinhaDeRubrica,
  V extends VeiculoDaRubrica<L>,
>({
  linhas,
  escrita,
  justificadaPor,
  onJustificar,
  onAbrir,
}: {
  linhas: readonly L[];
  escrita: EscritaDaRubrica<L, V>;
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
              {escrita.colunaDaVariavel && (
                <th scope="col" className="px-3 py-2 text-left font-bold">
                  {escrita.colunaDaVariavel.titulo}
                </th>
              )}
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
                  {escrita.colunaDaVariavel && (
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                      {escrita.colunaDaVariavel.celula(l)}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <span className="flex items-center gap-1.5">
                      {l.rotuloDaVariavel}
                      {(() => {
                        const aviso = escrita.avisoDaVariavel?.(l) ?? null;
                        return aviso === null ? null : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                aria-label={aviso.rotulo}
                                onClick={(e) => e.stopPropagation()}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <Info className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs">
                              {aviso.texto}
                            </TooltipContent>
                          </Tooltip>
                        );
                      })()}
                      {/*
                        A coluna continua aqui porque confere a linha ao lado, e
                        quem lê precisa saber, sem abrir nada, que ela não entrou
                        no total desta tela.
                      */}
                      {l.foraDaSoma && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label={`Esta coluna não entra na soma deste módulo: ${l.foraDaSoma}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <Info className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            <strong className="font-semibold">Fora do total daqui.</strong>{" "}
                            {l.foraDaSoma}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums">
                    {escrita.escreverValor(l.base, l.medida)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums">
                    {escrita.escreverValor(l.comparada, l.medida)}
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums",
                      escrita.corDaDiferenca(l.diferenca, l.medida),
                    )}
                  >
                    {escrita.escreverDiferenca(l.diferenca, l.medida)}
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums",
                      escrita.corDaDiferenca(l.diferenca, l.medida),
                    )}
                  >
                    {escrita.escreverVariacao(l.variacao)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[0.7rem] font-semibold",
                          escrita.selo[l.estado],
                        )}
                      >
                        {escrita.rotuloDoEstado[l.estado]}
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
