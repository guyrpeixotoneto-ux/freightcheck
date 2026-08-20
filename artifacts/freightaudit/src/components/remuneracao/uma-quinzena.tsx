import { Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  escreverValor,
  type BlocoApurado,
  type CadastroDaUnidade,
  type LinhaApurada,
} from "@/lib/remuneracao";
import {
  Conferido,
  ExplicacaoDaAusencia,
  frasedoMaterial,
  Legenda,
  MarcaDeInformado,
  MarcaDoPreenchimento,
  Numero,
} from "./comuns";

/**
 * O cadastro de **uma** quinzena, com a memória de cálculo inteira.
 *
 * É a vista densa: cada linha traz, embaixo do número, a regra que o produziu e
 * as colunas do export que a sustentam. Não cabe em duas colunas, e é por isso
 * que a comparação lado a lado é outra vista em vez de uma variação desta —
 * espremer a procedência em meia largura a tornaria ilegível justamente onde
 * ela mais importa, que é quando alguém discorda do número.
 */
export function VistaDeUmaQuinzena({ dados }: { dados: CadastroDaUnidade }) {
  return (
    <div className="space-y-6">
      <Lastro dados={dados} />
      {dados.blocos.map((bloco) => (
        <Bloco key={bloco.titulo} bloco={bloco} />
      ))}
      <Legenda />
    </div>
  );
}

/**
 * O lastro, antes das linhas.
 *
 * Quantas linhas o acervo sustenta e o que a vigência entregou vêm primeiro
 * porque são o que decide como ler o resto: trinta linhas com onze apuradas é
 * um cadastro em construção, e quem abre precisa saber disso antes de olhar o
 * primeiro número — e não depois de rolar até o rodapé.
 */
function Lastro({ dados }: { dados: CadastroDaUnidade }) {
  const { resumo, material, contexto, periodLabel } = dados;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="w-4 h-4" />
          {contexto.label} · {periodLabel}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <Numero titulo="Linhas do cadastro" valor={resumo.linhas} />
          <Numero titulo="Com lastro" valor={resumo.apuradas} destaque />
          <Numero titulo="Medidas em par" valor={resumo.emConjunto} />
          <Numero titulo="Informadas" valor={resumo.informadas} />
          <Numero titulo="Sem número" valor={resumo.semLastro} />
          <Numero titulo="Divergentes" valor={resumo.divergentes} alerta />
        </div>

        <p className="text-xs text-muted-foreground border-t pt-3">
          Esta vigência entregou <strong>{frasedoMaterial(material)}</strong>. Nenhuma linha
          abaixo mostra número medido que esses registros não sustentem — e as informadas dizem,
          uma a uma, quem as digitou.
          {resumo.conferidas > 0 && (
            <>
              {" "}
              <strong>
                {resumo.conferidas}{" "}
                {resumo.conferidas === 1 ? "linha tem as duas respostas" : "linhas têm as duas respostas"}
              </strong>{" "}
              — o acervo e a planilha —, e {resumo.divergentes === 0 ? "todas batem" : `${resumo.divergentes} ${resumo.divergentes === 1 ? "não bate" : "não batem"}`}.
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

function Bloco({ bloco }: { bloco: BlocoApurado }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold uppercase tracking-wide">{bloco.titulo}</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">{bloco.resumo}</p>
      </CardHeader>
      <CardContent className="p-0">
        <ul>
          {bloco.linhas.map((linha) => (
            <Linha key={linha.chave} linha={linha} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Uma linha do cadastro.
 *
 * Três formas, uma por estado, e a diferença entre elas é deliberadamente
 * visível de longe: a linha apurada tem número à direita; a medida em par tem o
 * par escrito por extenso, sem fingir que a metade é dela; a sem lastro tem
 * travessão e o motivo logo abaixo. Nenhuma das três deixa a coluna da direita
 * vazia e calada — vazio é o que faz quem confere concluir "então é zero".
 */
function Linha({ linha }: { linha: LinhaApurada }) {
  return (
    <li className="border-t first:border-t-0 px-6 py-3">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium flex items-center gap-2 min-w-0">
          <MarcaDoPreenchimento preenchimento={linha.preenchimento} />
          {linha.rotulo}
        </p>

        <div className="text-right shrink-0 space-y-1">
          {(linha.estado === "APURADO" || linha.estado === "INFORMADO") && linha.valor !== null && (
            <span className="text-base font-bold tabular-nums block">
              {escreverValor(linha.valor, linha.medida)}
            </span>
          )}
          {linha.estado === "EM_CONJUNTO" && linha.conjunto && (
            <span className="text-sm font-semibold tabular-nums text-muted-foreground block">
              {linha.conjunto.rotulo} = {escreverValor(linha.conjunto.valor, linha.conjunto.medida)}
            </span>
          )}
          {linha.estado === "SEM_LASTRO" && (
            <span className="text-base font-bold text-muted-foreground/60 block" aria-label="sem número">
              —
            </span>
          )}
          {/*
            A marca fica junto do número, e não junto do rótulo: quem percorre a
            coluna da direita procurando um valor precisa saber, no mesmo olhar,
            se aquele valor foi medido ou digitado.
          */}
          {linha.estado === "INFORMADO" && <MarcaDeInformado declarado={linha.declarado} />}
        </div>
      </div>

      {linha.procedencia && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {linha.procedencia.regra}
          {linha.procedencia.colunas.map((coluna) => (
            <code
              key={coluna}
              className="ml-1 rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem] whitespace-nowrap"
            >
              {coluna}
            </code>
          ))}
        </p>
      )}

      {linha.conjunto && (
        <p className="mt-1.5 text-xs text-muted-foreground">{linha.conjunto.procedencia.regra}</p>
      )}

      {/*
        A conferência da linha e a do par são duas, e as duas aparecem: a
        primeira compara o que o cadastro apurou com o que a aba diz naquela
        linha; a segunda compara o par PIS + COFINS medido com a soma das duas
        metades informadas. Só a primeira existiria se o par não pudesse ser
        conferido — e ele é exatamente a linha em que a aba e o export mais
        divergem, porque o export não os separa.
      */}
      {linha.conferencia && (
        <div className="mt-1.5">
          <Conferido
            conferencia={linha.conferencia}
            medida={linha.medida}
            declarado={linha.declarado}
          />
        </div>
      )}

      {linha.conjunto?.conferencia && (
        <div className="mt-1.5">
          <Conferido conferencia={linha.conjunto.conferencia} medida={linha.conjunto.medida} />
        </div>
      )}

      {linha.ausencia && (
        <div className="mt-1.5">
          <ExplicacaoDaAusencia ausencia={linha.ausencia} />
        </div>
      )}
    </li>
  );
}
