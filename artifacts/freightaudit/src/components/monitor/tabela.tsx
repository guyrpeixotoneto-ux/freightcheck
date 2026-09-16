import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight, Minus } from "lucide-react";
import type { LinhaDoMonitor } from "@workspace/comparison/monitor-custo-fixo";
import { ROTULO_DA_SITUACAO } from "@workspace/comparison/monitor-custo-fixo";
import { SEVERITY_LABELS } from "@workspace/comparison/cockpit";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FRASE_DA_SITUACAO,
  corDaDirecao,
  escreverImpacto,
  rotuloDaPeriodicidade,
  type ColunaOrdenavel,
  type Ordenacao,
} from "@/lib/monitor-custo-fixo";
import { cn } from "@/lib/utils";

/**
 * TODAS AS ALTERAÇÕES — a tabela central do Monitor.
 *
 * ---------------------------------------------------------------------------
 * Por que "Identificação", e não "Veículo"
 * ---------------------------------------------------------------------------
 * Porque uma linha pode ser uma placa, uma unidade, um cargo ou um centro de
 * custo. Hoje os quatro módulos são de placa e a coluna mostraria placa em
 * 100% das linhas — e é justamente por isso que o nome tem de estar certo
 * agora: quando o QLP entrar, "Veículo" sobre um cargo seria o número certo sob
 * o rótulo errado, que é o defeito que este produto documenta em toda parte.
 *
 * ---------------------------------------------------------------------------
 * A cor nunca carrega a informação
 * ---------------------------------------------------------------------------
 * Aumento e redução têm seta **e** palavra; situação tem selo com texto. Quem
 * não distingue vermelho de verde lê a mesma tabela — e quem imprime, também.
 *
 * ---------------------------------------------------------------------------
 * A periodicidade viaja com o número
 * ---------------------------------------------------------------------------
 * Cada célula de impacto escreve o sufixo (`/mês`, `/ano`, ` no evento`), e
 * não só o cabeçalho da coluna. Uma coluna de reais em que duas linhas são de
 * grandezas diferentes é um convite a somar de cabeça, e o sufixo é o que
 * recusa o convite em cada linha.
 */
export function TabelaDoMonitor({
  linhas,
  ordem,
  onOrdenar,
  selecionada,
  onSelecionar,
}: {
  linhas: readonly LinhaDoMonitor[];
  ordem: Ordenacao;
  onOrdenar: (coluna: ColunaOrdenavel) => void;
  selecionada: string | null;
  onSelecionar: (linha: LinhaDoMonitor) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <caption className="sr-only">
          Todas as alterações de custo fixo do recorte, com módulo, entidade,
          variável, valores, impacto e situação.
        </caption>
        <TableHeader>
          <TableRow>
            <Cabecalho coluna="prioridade" ordem={ordem} onOrdenar={onOrdenar}>
              Prioridade
            </Cabecalho>
            <Cabecalho coluna="modulo" ordem={ordem} onOrdenar={onOrdenar}>
              Módulo
            </Cabecalho>
            <TableHead scope="col">Vigência</TableHead>
            <Cabecalho coluna="identificacao" ordem={ordem} onOrdenar={onOrdenar}>
              Identificação
            </Cabecalho>
            <Cabecalho coluna="variavel" ordem={ordem} onOrdenar={onOrdenar}>
              Variável
            </Cabecalho>
            <TableHead scope="col" className="text-right">
              Valor anterior
            </TableHead>
            <TableHead scope="col" className="text-right">
              Valor atual
            </TableHead>
            <Cabecalho
              coluna="impacto"
              ordem={ordem}
              onOrdenar={onOrdenar}
              className="text-right"
            >
              Impacto
            </Cabecalho>
            <TableHead scope="col">Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map((l) => (
            <TableRow
              key={l.id}
              /*
                A linha inteira é o alvo, e é um `button` de verdade na célula
                de identificação — não um `onClick` numa `<tr>`. Sem isso o
                painel não abriria pelo teclado, e a tabela deixaria de fora
                quem navega sem mouse.
              */
              data-state={selecionada === l.id ? "selected" : undefined}
              className={cn(selecionada === l.id && "bg-muted/60")}
            >
              <TableCell>
                <Badge
                  variant={l.prioridade.nivel === "CRITICO" ? "destructive" : "secondary"}
                  className="whitespace-nowrap"
                >
                  {SEVERITY_LABELS[l.prioridade.nivel]}
                </Badge>
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs">{l.origem.rotulo}</TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {l.par.baseRotulo ?? "—"} → {l.par.comparadaRotulo ?? "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => onSelecionar(l)}
                  className="rounded font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Abrir o detalhe de ${l.entidade.rotulo}, ${l.variavel.rotulo}, no módulo ${l.origem.rotulo}`}
                >
                  {l.entidade.rotulo}
                </button>
                <span className="ml-1 text-[0.7rem] text-muted-foreground">
                  {l.entidade.entityType}
                </span>
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs">
                {l.variavel.rotulo}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right font-mono text-xs tabular-nums">
                {l.valorAnterior ?? "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right font-mono text-xs tabular-nums">
                {l.valorAtual ?? "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right">
                <CelulaDeImpacto linha={l} />
              </TableCell>
              <TableCell>
                <SeloDaSituacao linha={l} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Cabecalho({
  coluna,
  ordem,
  onOrdenar,
  children,
  className,
}: {
  coluna: ColunaOrdenavel;
  ordem: Ordenacao;
  onOrdenar: (coluna: ColunaOrdenavel) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const ativa = ordem.coluna === coluna;
  return (
    <TableHead
      scope="col"
      className={className}
      aria-sort={ativa ? (ordem.ascendente ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onOrdenar(coluna)}
        className="inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
        {ativa &&
          (ordem.ascendente ? (
            <ArrowUp className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ArrowDown className="h-3 w-3" aria-hidden="true" />
          ))}
      </button>
    </TableHead>
  );
}

/**
 * A célula do impacto — número com periodicidade, ou a frase que diz por que
 * não há número.
 *
 * Nunca em branco e nunca R$ 0,00. As três situações sem valor escrevem o que
 * elas são, em texto, e o motivo inteiro fica no painel lateral.
 */
function CelulaDeImpacto({ linha }: { linha: LinhaDoMonitor }) {
  const { situacao, valor, periodicidade, direcao } = linha.impacto;
  if (situacao !== "VALORADO" || valor === null) {
    return (
      <span className="text-xs text-muted-foreground">{FRASE_DA_SITUACAO[situacao]}</span>
    );
  }
  const Seta = direcao === "AUMENTO" ? ArrowUpRight : direcao === "REDUCAO" ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex items-center gap-1 font-mono text-xs tabular-nums", corDaDirecao(direcao))}>
      <Seta className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {/* A palavra ao lado da seta: a cor nunca carrega sozinha a informação. */}
      <span className="sr-only">
        {direcao === "AUMENTO" ? "Aumento de" : direcao === "REDUCAO" ? "Redução de" : "Sem variação:"}
      </span>
      {escreverImpacto(valor, periodicidade)}
    </span>
  );
}

function SeloDaSituacao({ linha }: { linha: LinhaDoMonitor }) {
  const { situacao } = linha.impacto;
  return (
    <span className="flex flex-col gap-0.5">
      <Badge
        variant={situacao === "VALORADO" ? "secondary" : "outline"}
        className="w-fit whitespace-nowrap text-[0.7rem]"
      >
        {ROTULO_DA_SITUACAO[situacao]}
      </Badge>
      {situacao === "VALORADO" && linha.impacto.periodicidade && (
        <span className="text-[0.7rem] text-muted-foreground">
          {rotuloDaPeriodicidade(linha.impacto.periodicidade)}
        </span>
      )}
    </span>
  );
}
