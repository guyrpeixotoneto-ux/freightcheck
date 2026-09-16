import { ExternalLink } from "lucide-react";
import { Link } from "wouter";
import type { LinhaDoMonitor } from "@workspace/comparison/monitor-custo-fixo";
import {
  ROTULO_DA_NATUREZA,
  ROTULO_DA_SITUACAO,
} from "@workspace/comparison/monitor-custo-fixo";
import { ROTULO_DO_ESTADO, SEVERITY_LABELS } from "@workspace/comparison";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { escreverImpacto, rotuloDaPeriodicidade } from "@/lib/monitor-custo-fixo";

/**
 * O painel lateral — a alteração inteira, sem sair do Monitor.
 *
 * ---------------------------------------------------------------------------
 * A regra deste painel é o que ele **não** escreve
 * ---------------------------------------------------------------------------
 * Ele mostra os campos que o domínio entregou, e some com os que vieram vazios.
 * Não há "—" preenchendo linha, não há "0" no lugar de ausência e não há frase
 * inventada para dar corpo: um painel que escreve sobre o que não sabe é pior
 * do que um painel curto, porque a invenção tem a mesma aparência do fato.
 *
 * A fila de prioridade aparece **aberta**, parcela a parcela, com os pontos de
 * cada uma. É o que separa uma régua transparente de uma nota que ninguém sabe
 * de onde veio — e é a mesma lista que o Acompanhamento mostra, da mesma régua.
 */
export function DetalheDaAlteracao({
  linha,
  enderecoDaAuditoria,
  onFechar,
}: {
  linha: LinhaDoMonitor | null;
  enderecoDaAuditoria: (linha: LinhaDoMonitor) => string;
  onFechar: () => void;
}) {
  return (
    <Sheet open={linha !== null} onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {linha && (
          <>
            <SheetHeader>
              <SheetTitle>{linha.entidade.rotulo}</SheetTitle>
              <SheetDescription>
                {linha.variavel.rotulo} · {linha.origem.rotulo}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 flex flex-col gap-4 text-sm">
              <section className="flex flex-wrap gap-2">
                <Badge variant="secondary">{ROTULO_DA_SITUACAO[linha.impacto.situacao]}</Badge>
                <Badge variant="outline">{ROTULO_DO_ESTADO[linha.estado]}</Badge>
                <Badge variant="outline">
                  Prioridade {SEVERITY_LABELS[linha.prioridade.nivel].toLowerCase()}
                </Badge>
                <Badge variant="outline">{ROTULO_DA_NATUREZA[linha.impacto.natureza]}</Badge>
              </section>

              <Bloco titulo="O par de vigências">
                <Campo rotulo="Anterior" valor={linha.par.baseRotulo} nota={linha.par.baseData} />
                <Campo
                  rotulo="Atual"
                  valor={linha.par.comparadaRotulo}
                  nota={linha.par.comparadaData}
                />
              </Bloco>

              <Bloco titulo="A entidade">
                <Campo rotulo="Identificação" valor={linha.entidade.rotulo} />
                <Campo rotulo="Tipo" valor={linha.entidade.entityType} />
                {linha.entidade.placa && <Campo rotulo="Placa" valor={linha.entidade.placa} />}
              </Bloco>

              <Bloco titulo="A variável">
                <Campo rotulo="Nome" valor={linha.variavel.rotulo} />
                <Campo rotulo="Medida" valor={linha.variavel.medida} />
                <Campo rotulo="Código do atributo" valor={linha.variavel.attributeCode} />
              </Bloco>

              <Bloco titulo="Os valores">
                <Campo rotulo="Anterior" valor={linha.valorAnterior} />
                <Campo rotulo="Atual" valor={linha.valorAtual} />
                {linha.variacao !== null && (
                  <Campo rotulo="Variação" valor={`${linha.variacao.toFixed(2)} p.p.`} />
                )}
              </Bloco>

              <Bloco titulo="O impacto">
                {linha.impacto.situacao === "VALORADO" ? (
                  <>
                    <Campo
                      rotulo="Valor"
                      valor={escreverImpacto(linha.impacto.valor, linha.impacto.periodicidade)}
                    />
                    <Campo
                      rotulo="Periodicidade"
                      valor={
                        linha.impacto.periodicidade
                          ? rotuloDaPeriodicidade(linha.impacto.periodicidade)
                          : null
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Este número foi calculado pela auditoria de {linha.origem.rotulo} e
                      entra no total dela. O Monitor o repete; não o recalcula.
                    </p>
                  </>
                ) : (
                  <>
                    <Campo
                      rotulo="Situação"
                      valor={ROTULO_DA_SITUACAO[linha.impacto.situacao]}
                    />
                    {linha.impacto.motivo && (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {linha.impacto.motivo}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Não há valor para esta alteração — e ausência de número não é
                      R$ 0,00.
                    </p>
                  </>
                )}
              </Bloco>

              <Bloco titulo="Por que esta prioridade">
                {linha.prioridade.motivos.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum critério da régua pontuou esta alteração.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1 text-xs">
                    {linha.prioridade.motivos.map((m) => (
                      <li key={m.label} className="flex items-baseline justify-between gap-2">
                        <span>{m.label}</span>
                        <span className="font-mono tabular-nums text-muted-foreground">
                          +{m.points}
                        </span>
                      </li>
                    ))}
                    <li className="flex items-baseline justify-between gap-2 border-t pt-1 font-medium">
                      <span>Score</span>
                      <span className="font-mono tabular-nums">{linha.prioridade.score}</span>
                    </li>
                  </ul>
                )}
              </Bloco>

              <Bloco titulo="A origem">
                <Campo rotulo="Módulo" valor={linha.origem.rotulo} />
                <Campo
                  rotulo="Alteração"
                  valor={linha.changeId === null ? null : `change #${linha.changeId}`}
                />
                <Campo rotulo="Comparação" valor={linha.origem.changeSetId} />
              </Bloco>

              <Button asChild className="w-full">
                <Link href={enderecoDaAuditoria(linha)}>
                  <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                  Abrir na Auditoria de {linha.origem.rotulo}
                </Link>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </h3>
      {children}
    </section>
  );
}

/** Um campo. **Some quando não há valor** — ver o cabeçalho deste arquivo. */
function Campo({
  rotulo,
  valor,
  nota,
}: {
  rotulo: string;
  valor: string | null;
  nota?: string | null;
}) {
  if (valor === null || valor === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="text-right font-mono tabular-nums">
        {valor}
        {nota && <span className="ml-1 text-muted-foreground">({nota})</span>}
      </span>
    </div>
  );
}
