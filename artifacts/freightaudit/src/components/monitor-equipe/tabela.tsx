import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight, Minus } from "lucide-react";
import type { LinhaDoMonitorDeEquipe } from "@workspace/comparison/monitor-equipe";
import { ROTULO_DO_QUADRO } from "@workspace/comparison/monitor-equipe";
/*
  Pelos subcaminhos, e não pelo barril: `@workspace/comparison` reexporta
  módulos que só o servidor pode carregar, e um `import` de valor pelo barril
  arrasta todos eles para o bundle — ver a nota em `components/monitor/tabela.tsx`.
*/
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
import { escreverCargo, escreverValor } from "@/lib/qlp-comparacao";
import {
  FRASE_DA_SITUACAO_DE_EQUIPE,
  corDaDiferencaDeEquipe,
  escreverModulo,
  type ColunaOrdenavel,
  type Ordenacao,
} from "@/lib/monitor-equipe";
import { cn } from "@/lib/utils";

/**
 * TODAS AS ALTERAÇÕES — a tabela central do Monitor Equipe.
 *
 * ---------------------------------------------------------------------------
 * O grão é o **cargo**, e a coluna diz isso
 * ---------------------------------------------------------------------------
 * A unidade fica ao lado do cargo porque a chave do quadro é a dupla: o mesmo
 * "Gerente de operações" existe em Camaçari e em Alagoinhas, e uma coluna que
 * mostrasse só o cargo juntaria dois cargos diferentes sob um nome só.
 *
 * O nome legível sai do dicionário que a rota devolve; sem entrada nele, a
 * chave normalizada aparece como está — menos bonita e igualmente verdadeira.
 * Inventar um nome seria pior.
 *
 * ---------------------------------------------------------------------------
 * A coluna da direita é "Diferença", e nunca "Impacto"
 * ---------------------------------------------------------------------------
 * Porque não há impacto: nenhuma coluna do QLP vira reais enquanto a semântica
 * não for confirmada. O que a tabela mostra é o que o motor produziu — a
 * diferença entre as duas pontas, na unidade da própria variável — e o selo de
 * situação diz o que se pode fazer com ela.
 *
 * ---------------------------------------------------------------------------
 * A cor nunca carrega a informação
 * ---------------------------------------------------------------------------
 * Alta e queda têm seta **e** palavra; situação tem selo com texto. Quem não
 * distingue vermelho de verde lê a mesma tabela — e quem imprime, também.
 */
export function TabelaDoMonitorDeEquipe({
  linhas,
  rotulos,
  ordem,
  onOrdenar,
  selecionada,
  onSelecionar,
}: {
  linhas: readonly LinhaDoMonitorDeEquipe[];
  rotulos: Record<string, string>;
  ordem: Ordenacao;
  onOrdenar: (coluna: ColunaOrdenavel) => void;
  selecionada: string | null;
  onSelecionar: (linha: LinhaDoMonitorDeEquipe) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <caption className="sr-only">
          Todas as alterações do quadro de pessoal do recorte, com módulo,
          quadro, cargo, variável, valores, diferença e situação.
        </caption>
        <TableHeader>
          <TableRow>
            <Cabecalho coluna="prioridade" ordem={ordem} onOrdenar={onOrdenar}>
              Prioridade
            </Cabecalho>
            <Cabecalho coluna="modulo" ordem={ordem} onOrdenar={onOrdenar}>
              Módulo
            </Cabecalho>
            <Cabecalho coluna="quadro" ordem={ordem} onOrdenar={onOrdenar}>
              Quadro
            </Cabecalho>
            <TableHead scope="col">Vigência</TableHead>
            <Cabecalho coluna="cargo" ordem={ordem} onOrdenar={onOrdenar}>
              Cargo
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
              coluna="diferenca"
              ordem={ordem}
              onOrdenar={onOrdenar}
              className="text-right"
            >
              Diferença
            </Cabecalho>
            <TableHead scope="col">Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map((l) => {
            const { unidade, cargo, turno } = escreverCargo(l.cargo.chave, rotulos);
            return (
              <TableRow
                key={l.id}
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
                <TableCell className="whitespace-nowrap text-xs">
                  {escreverModulo(l.modulo)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {ROTULO_DO_QUADRO[l.quadro].replace("QLP ", "")}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {l.par.baseRotulo ?? "—"} → {l.par.comparadaRotulo ?? "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {/*
                    A linha inteira é o alvo, e é um `button` de verdade — não um
                    `onClick` numa `<tr>`. Sem isso o painel não abriria pelo
                    teclado, e a tabela deixaria de fora quem navega sem mouse.
                  */}
                  <button
                    type="button"
                    onClick={() => onSelecionar(l)}
                    className="rounded text-left font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Abrir o detalhe de ${[cargo, turno].filter(Boolean).join(", ")}, ${l.variavel.rotulo}, no módulo ${escreverModulo(l.modulo)}`}
                  >
                    {cargo}
                  </button>
                  {/*
                    Turno e unidade embaixo do cargo, cada um no seu lugar. No
                    quadro operacional a chave é cargo **e** turno: o mesmo
                    "Motorista 28" existe no 8x16 e no 12x36, e emendar os dois
                    numa linha só devolveria a sopa que a chave normalizada já é.
                  */}
                  {(turno || unidade) && (
                    <span className="mt-0.5 flex flex-col text-[0.7rem] text-muted-foreground">
                      {turno && <span>{turno}</span>}
                      {unidade && <span>{unidade}</span>}
                    </span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  {l.variavel.rotulo}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono text-xs tabular-nums">
                  {escreverValor(l.valorAnterior, l.variavel.medida)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono text-xs tabular-nums">
                  {escreverValor(l.valorAtual, l.variavel.medida)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  <CelulaDaDiferenca linha={l} />
                </TableCell>
                <TableCell>
                  <SeloDaSituacao linha={l} />
                </TableCell>
              </TableRow>
            );
          })}
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
 * A célula da diferença — o número do motor, na unidade da variável.
 *
 * Nunca em branco e nunca zero inventado: a linha que o motor não mediu escreve
 * um traço, e o painel lateral diz por quê.
 */
function CelulaDaDiferenca({ linha }: { linha: LinhaDoMonitorDeEquipe }) {
  if (linha.diferenca === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const Seta =
    linha.diferenca > 0 ? ArrowUpRight : linha.diferenca < 0 ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-end gap-1 font-mono text-xs tabular-nums",
        corDaDiferencaDeEquipe(linha.diferenca),
      )}
    >
      <Seta className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {/* A palavra ao lado da seta: a cor nunca carrega sozinha a informação. */}
      <span className="sr-only">
        {linha.diferenca > 0 ? "Alta de" : linha.diferenca < 0 ? "Queda de" : "Sem variação:"}
      </span>
      {escreverValor(String(linha.diferenca), linha.variavel.medida)}
    </span>
  );
}

function SeloDaSituacao({ linha }: { linha: LinhaDoMonitorDeEquipe }) {
  return (
    <Badge
      variant={linha.situacao.tipo === "EFETIVO" ? "secondary" : "outline"}
      className="w-fit whitespace-nowrap text-[0.7rem]"
    >
      {FRASE_DA_SITUACAO_DE_EQUIPE[linha.situacao.tipo]}
    </Badge>
  );
}
