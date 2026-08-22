import { Fragment } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AtributosDaLinha } from "./atributos";
import {
  APARENCIA,
  numero,
  percentual,
  type CelulaDaMatriz,
  type ColunaDaMatriz,
  type LinhaDaMatriz,
} from "./tipos";

/**
 * A matriz: conjunto × vigência.
 *
 * A leitura de relance da tela inteira. Linha é (família · equipamento), coluna
 * é vigência, e cada célula diz em que estado aquele recorte está.
 *
 * **A cor nunca decide sozinha.** Cada célula carrega o percentual (ou a sigla
 * do estado, quando percentual não é a informação), o `title` com a frase por
 * extenso e um ponto colorido — três canais para a mesma informação. Uma matriz
 * que só se leia por cor exclui quem não distingue verde de vermelho e some
 * numa impressão em preto e branco.
 *
 * **A ordem das linhas é a da gravidade, não a alfabética.** Quem abre esta
 * tela procura problema; deixar a pior linha em quinto lugar porque o nome dela
 * começa com R é obrigar a varrer a tabela para achar o que ela deveria
 * entregar de relance. A ordenação vem pronta do servidor.
 *
 * **A linha abre por dentro.** O percentual da célula responde *quanto* falta;
 * abrir a linha responde *o quê* — uma sublinha por atributo, nas mesmas
 * colunas. Três meses seguidos de 88,1% podem ser o mesmo campo ausente desde
 * junho ou três campos se revezando, e a matriz sozinha mostrava os dois
 * exatamente igual. As sublinhas nascem dentro desta mesma `<table>`, que é o
 * que mantém cada vigência debaixo da sua própria coluna.
 */
export function Matriz({
  colunas,
  linhas,
  vigencias,
  selecionada,
  aoSelecionar,
  expandida,
  aoExpandir,
  aoAbrirLacuna,
}: {
  colunas: ColunaDaMatriz[];
  linhas: LinhaDaMatriz[];
  /** A janela, para que as sublinhas peçam exatamente estas colunas. */
  vigencias: number;
  selecionada: { snapshotId: string; entityType: string } | null;
  aoSelecionar: (celula: CelulaDaMatriz) => void;
  /** A chave da linha aberta por dentro, ou `null`. Uma de cada vez. */
  expandida: string | null;
  aoExpandir: (linha: LinhaDaMatriz) => void;
  aoAbrirLacuna: (celula: { snapshotId: string; attributeCode: string }) => void;
}) {
  if (linhas.length === 0) return null;

  return (
    <section className="mt-8" id="matriz-de-cobertura">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-bold uppercase tracking-wide">Matriz de cobertura</h2>
        <Legenda />
      </div>
      <div className="border-b-2 border-brand mt-2" />
      <p className="text-xs text-muted-foreground mt-3 max-w-4xl">
        Clique numa célula para ver o que falta nela, por que o FreightCheck acha que falta e de
        qual arquivo veio o que chegou. Clique na seta ao lado do conjunto para abrir a linha
        por dentro: um atributo por linha, as mesmas vigências nas colunas.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm bg-card border border-collapse">
          <caption className="sr-only">
            Cobertura por conjunto e vigência. Cada célula traz o percentual de cobertura e o
            estado por extenso.
          </caption>
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th
                scope="col"
                className="px-4 py-2.5 text-[0.6875rem] uppercase tracking-wider font-semibold text-muted-foreground sticky left-0 bg-muted/50 z-10"
              >
                Conjunto
              </th>
              {colunas.map((coluna) => (
                <th
                  key={coluna.chave}
                  scope="col"
                  className="px-3 py-2.5 text-[0.6875rem] uppercase tracking-wider font-semibold text-muted-foreground text-right whitespace-nowrap"
                  title={coluna.rotulos.join(", ")}
                >
                  {coluna.periodo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => {
              const aberta = expandida === linha.chave;
              return (
                <Fragment key={linha.chave}>
                  <tr className="border-b last:border-b-0">
                    <th
                      scope="row"
                      className="px-4 py-3 text-left font-medium whitespace-nowrap sticky left-0 bg-card z-10 border-r"
                    >
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => aoExpandir(linha)}
                          aria-expanded={aberta}
                          title={
                            aberta
                              ? `Fechar os atributos de ${linha.rotulo}`
                              : `Ver o que este conjunto tem e o que falta, atributo por atributo`
                          }
                          aria-label={
                            aberta
                              ? `Fechar os atributos de ${linha.rotulo}`
                              : `Abrir os atributos de ${linha.rotulo}`
                          }
                          className="shrink-0 text-muted-foreground hover:text-brand focus:outline-none focus:ring-2 focus:ring-brand"
                        >
                          {aberta ? (
                            <ChevronDown className="w-4 h-4" aria-hidden />
                          ) : (
                            <ChevronRight className="w-4 h-4" aria-hidden />
                          )}
                        </button>
                        <span>{linha.rotulo}</span>
                      </div>
                      <div className="text-xs text-muted-foreground font-normal pl-[1.375rem]">
                        {linha.scopeLabel}
                        {linha.canal ? ` · ${linha.canal}` : ""}
                      </div>
                    </th>
                    {colunas.map((coluna) => (
                      <td key={coluna.chave} className="px-1.5 py-1.5">
                        <Celula
                          celula={linha.celulas[coluna.chave]}
                          selecionada={
                            !!selecionada &&
                            linha.celulas[coluna.chave]?.vigencia.snapshotId ===
                              selecionada.snapshotId &&
                            linha.entityType === selecionada.entityType
                          }
                          aoSelecionar={aoSelecionar}
                        />
                      </td>
                    ))}
                  </tr>
                  {aberta && (
                    <AtributosDaLinha
                      linha={linha}
                      colunas={colunas}
                      vigencias={vigencias}
                      aoAbrirLacuna={aoAbrirLacuna}
                    />
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Celula({
  celula,
  selecionada,
  aoSelecionar,
}: {
  celula: CelulaDaMatriz | undefined;
  selecionada: boolean;
  aoSelecionar: (celula: CelulaDaMatriz) => void;
}) {
  if (!celula) {
    return (
      <div
        className="px-2 py-2 text-center text-xs text-muted-foreground border border-dashed"
        title="Esta vigência não trouxe este conjunto."
      >
        —
      </div>
    );
  }

  const aparencia = APARENCIA[celula.estado];
  /*
    O percentual só aparece quando ele informa. Numa célula AUSENTE ele seria
    sempre 0% e numa NAO_APLICAVEL seria sempre 100% — dois números que dizem
    menos do que a palavra e que, piores, convidam a comparações que não
    existem.
  */
  const mostraPercentual = celula.estado !== "AUSENTE" && celula.estado !== "NAO_APLICAVEL";

  const descricao =
    `${aparencia.rotulo}. ${percentual(celula.conta.percentual)} de cobertura ` +
    `(${numero(celula.conta.combinacoesEncontradas)} de ` +
    `${numero(celula.conta.combinacoesEsperadas - celula.conta.combinacoesNaoAplicaveis)} ` +
    `combinações esperadas).` +
    (celula.lacunas.critico > 0 ? ` ${celula.lacunas.critico} lacuna crítica.` : "") +
    (celula.novos > 0 ? ` ${celula.novos} atributo novo.` : "");

  return (
    <button
      type="button"
      onClick={() => aoSelecionar(celula)}
      title={descricao}
      aria-label={descricao}
      className={cn(
        "w-full px-2 py-2 border text-right transition-colors hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-brand",
        aparencia.classe,
        selecionada && "ring-2 ring-brand",
      )}
    >
      <div className="flex items-center justify-end gap-1.5">
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", aparencia.ponto)} aria-hidden />
        <span className="font-semibold tabular-nums text-sm">
          {mostraPercentual ? percentual(celula.conta.percentual) : aparencia.sigla}
        </span>
      </div>
      <div className="text-[0.625rem] uppercase tracking-wide mt-0.5 opacity-80">
        {aparencia.rotulo}
      </div>
      {(celula.lacunas.critico > 0 || celula.novos > 0) && (
        <div className="text-[0.625rem] mt-0.5 opacity-90">
          {celula.lacunas.critico > 0 && `${celula.lacunas.critico} crít.`}
          {celula.lacunas.critico > 0 && celula.novos > 0 && " · "}
          {celula.novos > 0 && `${celula.novos} novo${celula.novos === 1 ? "" : "s"}`}
        </div>
      )}
    </button>
  );
}

function Legenda() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[0.6875rem] text-muted-foreground">
      {(
        ["COMPLETO", "PARCIAL", "AUSENTE", "NOVO", "ALTERADO", "NAO_APLICAVEL"] as const
      ).map((estado) => (
        <li key={estado} className="flex items-center gap-1.5">
          <span
            className={cn("w-2 h-2 rounded-full", APARENCIA[estado].ponto)}
            aria-hidden
          />
          {APARENCIA[estado].rotulo}
        </li>
      ))}
    </ul>
  );
}
