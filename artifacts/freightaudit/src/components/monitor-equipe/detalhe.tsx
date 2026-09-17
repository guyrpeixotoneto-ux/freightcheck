import { ExternalLink } from "lucide-react";
import { Link } from "wouter";
import type { LinhaDoMonitorDeEquipe } from "@workspace/comparison/monitor-equipe";
import { ROTULO_DO_QUADRO } from "@workspace/comparison/monitor-equipe";
/* Pelos subcaminhos, e não pelo barril — ver a nota em `tabela.tsx`. */
import { ROTULO_DO_ESTADO } from "@workspace/comparison/recorte-de-rubrica";
import { ROTULO_DO_PAPEL } from "@workspace/comparison/qlp";
import { SEVERITY_LABELS } from "@workspace/comparison/cockpit";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cargoEmUmaLinha, escreverCargo, escreverValor } from "@/lib/qlp-comparacao";
import {
  AJUDA_DA_SITUACAO_DE_EQUIPE,
  FRASE_DA_SITUACAO_DE_EQUIPE,
  escreverModulo,
} from "@/lib/monitor-equipe";

/**
 * O painel lateral — a alteração inteira, sem sair do Monitor.
 *
 * ---------------------------------------------------------------------------
 * A regra deste painel é o que ele **não** escreve
 * ---------------------------------------------------------------------------
 * Ele mostra os campos que o domínio entregou e some com os que vieram vazios.
 * Não há "—" preenchendo linha, não há "0" no lugar de ausência e não há frase
 * inventada para dar corpo: um painel que escreve sobre o que não sabe é pior
 * do que um painel curto, porque a invenção tem a mesma aparência do fato.
 *
 * E não há bloco de impacto em reais. No lugar dele, a situação da linha com a
 * frase que explica por que aquela grandeza não vira dinheiro — que é a
 * pergunta que quem abre este painel numa tela de QLP vai fazer.
 *
 * A fila de prioridade aparece **aberta**, parcela a parcela, com os pontos de
 * cada uma. É a mesma régua do resto do produto (`severityOf`), sobre os fatos
 * que um quadro de pessoal tem.
 */
export function DetalheDaAlteracaoDeEquipe({
  linha,
  rotulos,
  enderecoDaOrigem,
  onFechar,
}: {
  linha: LinhaDoMonitorDeEquipe | null;
  rotulos: Record<string, string>;
  enderecoDaOrigem: (linha: LinhaDoMonitorDeEquipe) => string;
  onFechar: () => void;
}) {
  return (
    <Sheet open={linha !== null} onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {linha && (
          <>
            <SheetHeader>
              <SheetTitle>{cargoEmUmaLinha(linha.cargo.chave, rotulos)}</SheetTitle>
              <SheetDescription>
                {linha.variavel.rotulo} · {escreverModulo(linha.modulo)}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 flex flex-col gap-4 text-sm">
              <section className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  {FRASE_DA_SITUACAO_DE_EQUIPE[linha.situacao.tipo]}
                </Badge>
                <Badge variant="outline">{ROTULO_DO_ESTADO[linha.estado]}</Badge>
                <Badge variant="outline">
                  Prioridade {SEVERITY_LABELS[linha.prioridade.nivel].toLowerCase()}
                </Badge>
                <Badge variant="outline">{ROTULO_DO_QUADRO[linha.quadro]}</Badge>
              </section>

              <Bloco titulo="O par de vigências">
                <Campo rotulo="Anterior" valor={linha.par.baseRotulo} nota={linha.par.baseData} />
                <Campo
                  rotulo="Atual"
                  valor={linha.par.comparadaRotulo}
                  nota={linha.par.comparadaData}
                />
                <p className="text-xs text-muted-foreground">
                  Este par é o do {ROTULO_DO_QUADRO[linha.quadro]}. O outro quadro é
                  outra série, com as vigências dele — o motor não compara coberturas
                  diferentes.
                </p>
              </Bloco>

              <BlocoDoCargo cargo={linha.cargo} rotulos={rotulos} />

              <Bloco titulo="A variável">
                <Campo rotulo="Nome" valor={linha.variavel.rotulo} />
                <Campo rotulo="Papel no quadro" valor={ROTULO_DO_PAPEL[linha.variavel.papel]} />
                <Campo rotulo="Medida" valor={linha.variavel.medida} />
                <Campo rotulo="Código do atributo" valor={linha.variavel.attributeCode} />
              </Bloco>

              <Bloco titulo="Os valores">
                <Campo
                  rotulo="Anterior"
                  valor={
                    linha.valorAnterior === null
                      ? null
                      : escreverValor(linha.valorAnterior, linha.variavel.medida)
                  }
                />
                <Campo
                  rotulo="Atual"
                  valor={
                    linha.valorAtual === null
                      ? null
                      : escreverValor(linha.valorAtual, linha.variavel.medida)
                  }
                />
                {linha.diferenca !== null && (
                  <Campo
                    rotulo="Diferença"
                    valor={escreverValor(String(linha.diferenca), linha.variavel.medida)}
                  />
                )}
                {linha.variacao !== null && (
                  <Campo rotulo="Variação" valor={`${linha.variacao.toFixed(2)} p.p.`} />
                )}
              </Bloco>

              <Bloco titulo="O que se pode somar aqui">
                <Campo
                  rotulo="Situação"
                  valor={FRASE_DA_SITUACAO_DE_EQUIPE[linha.situacao.tipo]}
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {AJUDA_DA_SITUACAO_DE_EQUIPE[linha.situacao.tipo]}
                </p>
                {linha.situacao.motivo && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {linha.situacao.motivo}
                  </p>
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
                <Campo rotulo="Módulo" valor={escreverModulo(linha.modulo)} />
                <Campo rotulo="Quadro" valor={ROTULO_DO_QUADRO[linha.quadro]} />
                <Campo
                  rotulo="Alteração"
                  valor={linha.changeId === null ? null : `change #${linha.changeId}`}
                />
                <Campo rotulo="Comparação" valor={linha.origem.changeSetId} />
              </Bloco>

              <Button asChild className="w-full">
                <Link href={enderecoDaOrigem(linha)}>
                  <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                  Abrir em {escreverModulo(linha.modulo)}
                </Link>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * O cargo aberto em campos — unidade, cargo, classificação e o que mais a fonte
 * tiver grudado no rótulo, cada um com o seu nome. A identificação numa linha
 * só ficou para o título da gaveta, onde ela é nome, e não tabela.
 */
function BlocoDoCargo({
  cargo,
  rotulos,
}: {
  cargo: LinhaDoMonitorDeEquipe["cargo"];
  rotulos: Record<string, string>;
}) {
  const { unidade, cargo: nome, classificacao, outros } = escreverCargo(cargo.chave, rotulos);
  return (
    <Bloco titulo="O cargo">
      <Campo rotulo="Unidade" valor={unidade} />
      <Campo rotulo="Cargo" valor={nome} />
      <Campo rotulo="Classificação" valor={classificacao} />
      {outros.map((campo) => (
        <Campo key={campo.rotulo} rotulo={campo.rotulo} valor={campo.valor} />
      ))}
      <Campo rotulo="Chave no acervo" valor={cargo.chave} />
      <Campo rotulo="Tipo" valor={cargo.entityType} />
    </Bloco>
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
      <span className="break-all text-right font-mono tabular-nums">
        {valor}
        {nota && <span className="ml-1 text-muted-foreground">({nota})</span>}
      </span>
    </div>
  );
}
