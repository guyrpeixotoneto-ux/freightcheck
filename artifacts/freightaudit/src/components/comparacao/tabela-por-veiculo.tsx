import { useState, type ReactNode } from "react";
import { ChevronRight, Info, MessageSquarePlus, PanelRightOpen } from "lucide-react";
import {
  UNIDADE_DA_MEDIDA,
  type EstadoDaLinha,
  type MedidaDaVariavel,
} from "@workspace/comparison/recorte-de-rubrica";
import {
  medidaDoDestaque,
  rubricaTemDinheiro,
  type LinhaAgrupavel,
  type OpcoesDoAgrupamento,
  type VeiculoDaRubrica,
} from "@workspace/comparison/agrupamento-por-veiculo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  /**
   * O agrupamento da rubrica — o mesmo objeto que o núcleo usa para agrupar.
   *
   * Duas coisas a tela tira dele, e nenhuma das duas ela teria como saber
   * olhando o recorte: **a unidade do destaque** (nem toda rubrica de custo
   * mede em reais — a Manutenção resume a placa em R$/km, e escrever "R$ 0,34"
   * onde a fonte disse trinta e quatro centavos por quilômetro é o erro que a
   * coluna convida a cometer) e **se a rubrica tem alguma variável em reais**,
   * que é o que autoriza o complemento "(0 em R$)" da contagem.
   *
   * É o objeto da rubrica, e não uma cópia: uma variável que mude de unidade
   * muda no catálogo, e a tela acompanha sem edição nenhuma.
   */
  agrupamento?: OpcoesDoAgrupamento;
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

/**
 * O MODO EM LOTE — a coluna de caixas que só existe enquanto ele está ligado.
 *
 * A tabela desligada é exatamente a de antes: sem coluna a mais, sem linha mais
 * alta, sem nada deslocado. É o ponto — quem entra nesta tela para ler o que
 * mudou não deve pagar, em largura, por uma ação que não pediu.
 *
 * O que a caixa da linha marca são as **alterações** daquela placa, e não a
 * placa: é a alteração que recebe justificativa, e uma placa pode ter quatro.
 * As que não podem receber — conflito, dado incompleto, e a linha "sem
 * alteração", que não tem `change.id` — nunca entram, nem marcando a placa
 * inteira: é a mesma regra da coluna de justificar, lida da mesma função
 * (`justificavel`). A placa sem nenhuma alteração justificável recebe uma caixa
 * desabilitada, e não nenhuma caixa: a coluna vazia ali seria lida como
 * "esqueceram desta linha".
 */
export interface SelecaoEmLote {
  /** Os `change.id` marcados agora. */
  marcadas: ReadonlySet<number>;
  /** Marcar ou desmarcar um conjunto de alterações de uma vez. */
  onMarcar: (ids: readonly number[], marcar: boolean) => void;
}

/** A chave de uma placa na lista de expandidas. */
const chaveDaPlaca = (v: { entityLabel: string | null; entityType: string }) =>
  `${v.entityLabel}${v.entityType}`;

/** As alterações de uma placa que podem receber justificativa. */
const justificaveisDoVeiculo = <L extends LinhaDeRubrica>(
  linhas: readonly L[],
): number[] =>
  linhas.filter((l) => l.id !== null && l.estado === "ALTERADO").map((l) => l.id!);

export function TabelaPorVeiculo<
  L extends LinhaDeRubrica,
  V extends VeiculoDaRubrica<L>,
>({
  veiculos,
  escrita,
  justificadaPor,
  selecao,
  onAbrir,
  onJustificar,
}: {
  veiculos: readonly V[];
  escrita: EscritaDaRubrica<L, V>;
  /** A justificativa mais recente de cada alteração, por `change.id`. */
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  /** Ausente, a tabela é a de sempre — sem coluna de caixas. */
  selecao?: SelecaoEmLote;
  onAbrir: (veiculo: V) => void;
  /** Ausente, a coluna de justificativa fica só de leitura. */
  onJustificar?: AbrirJustificativa;
}) {
  const [expandidas, setExpandidas] = useState<ReadonlySet<string>>(new Set());

  /*
    As alterações justificáveis **desta página** — o universo da caixa do
    cabeçalho.

    "Selecionar os registros visíveis" é isto, e nada além: as linhas carregadas
    e exibidas agora. Quem quer o recorte inteiro tem o link da barra de ações,
    que é outra operação e é dita com outras palavras — a diferença entre as
    duas é o centro desta funcionalidade, e uma caixa de cabeçalho que
    silenciosamente alcançasse as outras páginas a apagaria.
  */
  const idsVisiveis = veiculos.flatMap((v) => justificaveisDoVeiculo(v.linhas));
  const marcadasVisiveis = selecao
    ? idsVisiveis.filter((id) => selecao.marcadas.has(id)).length
    : 0;
  const estadoDoCabecalho: boolean | "indeterminate" =
    marcadasVisiveis === 0
      ? false
      : marcadasVisiveis === idsVisiveis.length
        ? true
        : "indeterminate";

  const colunas: { titulo: string; direita?: boolean }[] = [
    ...(selecao ? [{ titulo: "Selecionar" }] : []),
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
            {selecao && (
              <th scope="col" className="w-10 px-3 py-2.5">
                <Checkbox
                  checked={estadoDoCabecalho}
                  disabled={idsVisiveis.length === 0}
                  onCheckedChange={(marcar) =>
                    /* Parcialmente marcada, o clique marca o resto — é o que
                       quem vê um traço no lugar do visto espera, e o contrário
                       (desmarcar tudo) desfaria a escolha de quem clicou linha
                       a linha. */
                    selecao.onMarcar(idsVisiveis, marcar !== false)
                  }
                  aria-label={
                    estadoDoCabecalho === true
                      ? "Desmarcar os registros visíveis"
                      : "Selecionar os registros visíveis"
                  }
                />
              </th>
            )}
            {colunas
              .filter((coluna) => coluna.titulo !== "Selecionar")
              .map((coluna) => (
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
              selecao={selecao}
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

/**
 * O nome da variável mostrada, com a unidade quando o rótulo não a traz.
 *
 * "R$/km do BID" já diz em que unidade está, e "R$/km do BID (R$/km)" só
 * gaguejaria; "Valor de NF" não diz, e sob um cabeçalho que promete outra coisa
 * o número seria lido como o da variável do cabeçalho.
 */
const nomeComUnidade = (rotulo: string, medida: MedidaDaVariavel): string => {
  const unidade = UNIDADE_DA_MEDIDA[medida];
  return rotulo.toLowerCase().includes(unidade.toLowerCase())
    ? rotulo
    : `${rotulo} (${unidade})`;
};

/**
 * As quatro colunas de destaque da linha-mãe — De, Para, Diferença e Variação.
 *
 * ---------------------------------------------------------------------------
 * Os três símbolos, e a diferença entre eles
 * ---------------------------------------------------------------------------
 * Esta tabela já confundiu dois deles, e a confusão custou a leitura de uma
 * placa inteira. Aqui eles são três, e cada um diz uma coisa só:
 *
 * - `—` é **não há valor aplicável no recorte**. Nenhuma variável da medida do
 *   destaque veio, ou a que veio não tem aquela ponta. É ausência de dado.
 * - `R$ 0,0000/km` (ou `R$ 0,00`) é **zero medido**. O número existe e vale
 *   zero, e escrevê-lo como travessão apagaria o achado.
 * - `sem alteração` é **existe valor, e ele não mudou**. A variável está no
 *   recorte, as duas pontas estão escritas, e a diferença não é nula: é nenhuma.
 *
 * O que decide entre eles vem do núcleo (`destaqueExibido`), não daqui: a tela
 * escolhe a cor e escreve, como em toda esta tabela.
 */
function CelulasDoDestaque<L extends LinhaDeRubrica, V extends VeiculoDaRubrica<L>>({
  veiculo: v,
  escrita,
  medida,
}: {
  veiculo: V;
  escrita: EscritaDaRubrica<L, V>;
  /** A medida do destaque da rubrica — a unidade das colunas do cabeçalho. */
  medida: MedidaDaVariavel;
}) {
  const d = v.destaqueExibido;

  /* Nenhuma variável da medida do destaque no recorte: quatro travessões, e é
     exatamente isto que eles significam. */
  if (d === null) {
    return (
      <>
        {[0, 1, 2, 3].map((i) => (
          <td
            key={i}
            className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-muted-foreground"
          >
            {escrita.escreverValor(null, medida)}
          </td>
        ))}
      </>
    );
  }

  /*
    Mais de uma variável da mesma medida se moveu, e nenhuma delas é a que a
    rubrica declarou. A linha-mãe diz quantas são e para de afirmar: eleger uma
    representante aqui seria inventar um critério de desempate que ninguém pediu
    e que a expansão contradiria logo abaixo, onde as duas estão escritas.
  */
  if (d.tipo === "MULTIPLOS") {
    return (
      <td
        colSpan={4}
        className="whitespace-nowrap px-3 py-2 text-right text-xs text-muted-foreground"
      >
        {formatNumber(d.variaveis.length, 0)} valores em {UNIDADE_DA_MEDIDA[d.medida]}{" "}
        alterados
        <span className="sr-only">: {d.variaveis.join(", ")}. Abra a placa para vê-los.</span>
      </td>
    );
  }

  const { base, comparada, diferenca, variacao } = d.valores;
  const parado = d.estado === "SEM_ALTERACAO";

  return (
    <>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        {/*
          O nome da variável só aparece quando ela **não** é a do cabeçalho.
          Sem ele, o R$/km do BID desta placa seria lido como o R$/km resolvido
          dela — o mesmo número sob o rótulo errado, que é o erro que este
          produto documenta em toda parte.
        */}
        {d.tipo === "SUBSTITUTO" && (
          <span className="block text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {nomeComUnidade(d.rotulo, d.medida)}
            <span className="sr-only">
              {" "}
              — no lugar de {escrita.destaque}, que não está no recorte desta placa
            </span>
          </span>
        )}
        <span className="font-mono tabular-nums">
          {escrita.escreverValor(base?.toString() ?? null, d.medida)}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
        {escrita.escreverValor(comparada?.toString() ?? null, d.medida)}
      </td>
      {parado ? (
        /* As duas colunas de movimento numa só, porque a frase é uma só: a
           variável está aqui, escrita nas duas pontas, e não se moveu. */
        <td
          colSpan={2}
          className="whitespace-nowrap px-3 py-2 text-right text-xs text-muted-foreground"
        >
          sem alteração
        </td>
      ) : (
        <>
          <td
            className={cn(
              "whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums",
              escrita.corDaDiferenca(diferenca, d.medida),
            )}
          >
            {escrita.escreverDiferenca(diferenca, d.medida)}
          </td>
          <td
            className={cn(
              "whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums",
              escrita.corDaDiferenca(diferenca, d.medida),
            )}
          >
            {escrita.escreverVariacao(variacao)}
          </td>
        </>
      )}
    </>
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
  selecao,
  onJustificar,
  onAlternar,
  onAbrir,
}: {
  veiculo: V;
  escrita: EscritaDaRubrica<L, V>;
  colunas: number;
  aberta: boolean;
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  selecao?: SelecaoEmLote;
  onJustificar?: AbrirJustificativa;
  onAlternar: () => void;
  onAbrir: () => void;
}) {
  const medida = escrita.agrupamento
    ? medidaDoDestaque(escrita.agrupamento)
    : "DINHEIRO";
  const temDinheiro = escrita.agrupamento
    ? rubricaTemDinheiro(escrita.agrupamento)
    : true;
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

  /*
    A linha marcada é a que tem **todas** as suas alterações marcadas.

    Uma placa de quatro variáveis com duas marcadas — o que acontece quando
    alguém marca uma pela seleção rápida das iguais — aparece parcial, e não
    marcada: dizer "esta placa está selecionada" ali prometeria justificar as
    quatro.
  */
  const idsDaPlaca = justificaveisDoVeiculo(v.linhas);
  const marcadasNaPlaca = selecao
    ? idsDaPlaca.filter((id) => selecao.marcadas.has(id)).length
    : 0;
  const estadoDaCaixa: boolean | "indeterminate" =
    marcadasNaPlaca === 0
      ? false
      : marcadasNaPlaca === idsDaPlaca.length
        ? true
        : "indeterminate";
  const selecionada = marcadasNaPlaca > 0;

  return (
    <>
      <tr
        className={cn(
          "cursor-pointer border-b border-superficie-borda hover:bg-muted/50",
          aberta && "bg-muted/40",
          /* O azul muito suave da linha escolhida. Vem depois do `aberta` de
             propósito: com o modo em lote ligado, é a seleção que a linha
             precisa afirmar. */
          selecionada && "bg-brand/[0.06] hover:bg-brand/10",
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
        {selecao && (
          /* O clique da caixa é da caixa: sem parar a propagação, marcar uma
             linha abriria a expansão dela junto. */
          <td className="w-10 px-3 py-2" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={estadoDaCaixa}
              disabled={idsDaPlaca.length === 0}
              onCheckedChange={(marcar) => selecao.onMarcar(idsDaPlaca, marcar !== false)}
              aria-label={
                idsDaPlaca.length === 0
                  ? `${v.entityLabel ?? "Veículo sem placa"} não tem alteração que possa ser justificada`
                  : `${estadoDaCaixa === true ? "Desmarcar" : "Selecionar"} ${
                      idsDaPlaca.length === 1
                        ? "a alteração"
                        : `as ${idsDaPlaca.length} alterações`
                    } de ${v.entityLabel ?? "veículo sem placa"}`
              }
            />
          </td>
        )}
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
          {/*
            Quantas das alterações são dinheiro — o resto é prazo, taxa, ano e
            data, que não viram reais e não entram em soma nenhuma.

            Só onde a conta separa alguma coisa: numa rubrica sem variável
            nenhuma em reais — a Manutenção é toda R$/km, meses e percentual —
            o complemento sairia "(0 em R$)" em **todas** as placas, dizendo da
            rubrica o que a coluna de unidade já diz, e ao lado de uma contagem
            um zero constante é lido como se variasse.
          */}
          {temDinheiro && v.alteracoes > v.alteracoesEmDinheiro && (
            <span className="ml-1 text-[0.7rem] text-muted-foreground">
              ({formatNumber(v.alteracoesEmDinheiro, 0)} em R$)
            </span>
          )}
        </td>
        <CelulasDoDestaque veiculo={v} escrita={escrita} medida={medida} />
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
