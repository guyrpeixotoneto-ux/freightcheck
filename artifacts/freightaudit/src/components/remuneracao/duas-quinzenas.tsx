import { ArrowDownRight, ArrowUpRight, Building2, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  escreverValor,
  escreverVariacao,
  EXPLICACAO_DO_MOVIMENTO,
  type BlocoComparado,
  type ComparacaoDeCadastros,
  type LinhaApurada,
  type LinhaComparada,
  type Movimento,
} from "@/lib/remuneracao";
import {
  ExplicacaoDaAusencia,
  frasedoMaterial,
  Legenda,
  MarcaDoPreenchimento,
  Numero,
} from "./comuns";

/**
 * As duas quinzenas lado a lado — a planilha como ela de fato é.
 *
 * A aba de cadastro do Excel traz **dois blocos idênticos, um ao lado do
 * outro**: as duas quinzenas do mês. As alíquotas e a frota costumam repetir
 * entre eles; o que se move são as parcelas por veículo e as proporções de
 * documento. Quem confere lê as duas colunas juntas, de olho na terceira — a
 * diferença —, e é essa terceira coluna que a planilha não tem e esta tela dá.
 *
 * **A procedência sai daqui, e sai de propósito.** Ela mora na vista de uma
 * quinzena, onde há largura para ela. Aqui o espaço é da comparação: três
 * colunas de número por linha já é o limite do que se lê sem rolar na
 * horizontal, e uma regra de medição espremida em meia largura atrapalharia
 * justamente a leitura que esta vista existe para permitir.
 *
 * O que **não** sai é a explicação de uma ausência que mudou de estado: quando
 * uma linha ganha ou perde lastro, a frase aparece inteira. É a única coisa
 * nesta tela que pode ser lida como dinheiro sem ser, e por isso é a única que
 * nunca é abreviada.
 */
export function VistaDeDuasQuinzenas({ dados }: { dados: ComparacaoDeCadastros }) {
  return (
    <div className="space-y-6">
      <Placar dados={dados} />
      {dados.blocos.map((bloco) => (
        <Bloco
          key={bloco.titulo}
          bloco={bloco}
          rotuloEsquerda={dados.esquerda.periodLabel}
          rotuloDireita={dados.direita.periodLabel}
        />
      ))}
      <Legenda />
    </div>
  );
}

/**
 * O placar do par, antes das linhas.
 *
 * "Mudaram" conta só o que tem número dos dois lados. As outras duas contagens
 * são sobre o acervo e ficam separadas por isso — somá-las a "mudaram" diria
 * que dezenove linhas se moveram numa quinzena em que ninguém mexeu em nada, e
 * a única coisa que aconteceu foi um arquivo a mais ter sido importado.
 */
function Placar({ dados }: { dados: ComparacaoDeCadastros }) {
  const { resumo, contexto, esquerda, direita } = dados;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="w-4 h-4" />
          {contexto.label} · {esquerda.periodLabel} → {direita.periodLabel}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Numero titulo="Mudaram de valor" valor={resumo.mudaram} destaque />
          <Numero titulo="Sem mudança" valor={resumo.iguais} />
          <Numero titulo="Ganharam lastro" valor={resumo.ganharamLastro} />
          <Numero titulo="Perderam lastro" valor={resumo.perderamLastro} alerta />
        </div>

        <div className="text-xs text-muted-foreground border-t pt-3 space-y-1">
          <p>
            <strong>{esquerda.periodLabel}</strong> entregou {frasedoMaterial(esquerda.material)}.{" "}
            <strong>{direita.periodLabel}</strong> entregou {frasedoMaterial(direita.material)}.
          </p>
          <p>
            A variação descreve o caminho da esquerda para a direita. Linha que ganhou ou perdeu
            lastro <strong>não tem variação</strong>: o que mudou ali foi a cobertura do acervo,
            não o valor — e tratá-la como movimento de dinheiro seria o único número perigoso que
            esta tela poderia mostrar.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Bloco({
  bloco,
  rotuloEsquerda,
  rotuloDireita,
}: {
  bloco: BlocoComparado;
  rotuloEsquerda: string;
  rotuloDireita: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold uppercase tracking-wide">{bloco.titulo}</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">{bloco.resumo}</p>
      </CardHeader>
      <CardContent className="p-0">
        {/*
          A tabela rola sozinha na horizontal em tela estreita, em vez de
          empurrar a página inteira: são quatro colunas, e num celular a
          alternativa seria quebrar o rótulo em cinco linhas.
        */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="text-left font-semibold px-6 py-2">
                  Linha
                </th>
                <th scope="col" className="text-right font-semibold px-3 py-2 whitespace-nowrap">
                  {rotuloEsquerda}
                </th>
                <th scope="col" className="text-right font-semibold px-3 py-2 whitespace-nowrap">
                  {rotuloDireita}
                </th>
                <th scope="col" className="text-right font-semibold px-6 py-2 whitespace-nowrap">
                  Variação
                </th>
              </tr>
            </thead>
            <tbody>
              {bloco.linhas.map((linha) => (
                <Linha key={linha.chave} linha={linha} />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** A cor de cada movimento. Só os dois de dinheiro ganham cor. */
const COR_DO_MOVIMENTO: Record<Movimento, string> = {
  SUBIU: "text-emerald-600 dark:text-emerald-400",
  DESCEU: "text-destructive",
  IGUAL: "text-muted-foreground",
  /*
    Cobertura ganha e perdida não é verde nem vermelho: verde diria "melhorou o
    resultado" e vermelho, "piorou", e nenhuma das duas fala de resultado. Ficam
    na cor do texto secundário, com a frase inteira embaixo — que é o que de
    fato precisa ser lido.
  */
  GANHOU_LASTRO: "text-muted-foreground",
  PERDEU_LASTRO: "text-muted-foreground",
  SEM_COMPARACAO: "text-muted-foreground",
};

const ICONE_DO_MOVIMENTO: Partial<Record<Movimento, typeof Minus>> = {
  SUBIU: ArrowUpRight,
  DESCEU: ArrowDownRight,
  IGUAL: Minus,
};

function Linha({ linha }: { linha: LinhaComparada }) {
  const Icone = ICONE_DO_MOVIMENTO[linha.movimento];
  const explicacao = EXPLICACAO_DO_MOVIMENTO[linha.movimento];
  const mexeu = linha.movimento === "SUBIU" || linha.movimento === "DESCEU";

  /*
    A ausência só é mostrada quando ela é a novidade do par. Repetir os dois
    motivos em toda linha que nenhuma das quinzenas sustenta encheria a tabela
    com dezenove parágrafos idênticos — e eles estão, íntegros, na vista de uma
    quinzena. O que muda de estado, porém, aparece sempre.
  */
  const ausenciaRelevante =
    linha.movimento === "PERDEU_LASTRO"
      ? linha.direita.ausencia
      : linha.movimento === "GANHOU_LASTRO"
        ? linha.esquerda.ausencia
        : null;

  return (
    <>
      <tr className={cn("border-t", !explicacao && "align-baseline")}>
        <th scope="row" className="text-left font-medium px-6 py-2.5">
          <span className="flex items-center gap-2">
            <MarcaDoPreenchimento preenchimento={linha.preenchimento} />
            {linha.rotulo}
          </span>
        </th>
        <Celula linha={linha.esquerda} />
        <Celula linha={linha.direita} destaque={mexeu} />
        <td
          className={cn(
            "text-right px-6 py-2.5 tabular-nums whitespace-nowrap",
            COR_DO_MOVIMENTO[linha.movimento],
          )}
        >
          <span className="inline-flex items-center justify-end gap-1">
            {Icone && <Icone className="w-3.5 h-3.5 shrink-0" aria-hidden />}
            {linha.variacao === null ? (
              <span className="text-xs">
                {linha.movimento === "GANHOU_LASTRO"
                  ? "passou a ter lastro"
                  : linha.movimento === "PERDEU_LASTRO"
                    ? "perdeu o lastro"
                    : "—"}
              </span>
            ) : mexeu ? (
              <span className="font-semibold">
                {escreverVariacao(linha.variacao, linha.medida)}
                {linha.variacao.percentual !== null && (
                  <span className="ml-1 font-normal text-xs">
                    (
                    {linha.variacao.percentual > 0 ? "+" : "−"}
                    {Math.abs(linha.variacao.percentual).toLocaleString("pt-BR", {
                      maximumFractionDigits: 1,
                    })}
                    %)
                  </span>
                )}
              </span>
            ) : (
              <span className="text-xs">sem mudança</span>
            )}
          </span>
        </td>
      </tr>

      {explicacao && (
        <tr className="border-t border-dashed">
          <td colSpan={4} className="px-6 pb-3 pt-1.5">
            <p className="text-xs text-muted-foreground">{explicacao}</p>
            {ausenciaRelevante && (
              <div className="mt-1.5">
                <ExplicacaoDaAusencia ausencia={ausenciaRelevante} />
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/** Uma célula de valor — a mesma leitura das três formas da vista de uma quinzena. */
function Celula({ linha, destaque = false }: { linha: LinhaApurada; destaque?: boolean }) {
  return (
    <td
      className={cn(
        "text-right px-3 py-2.5 tabular-nums whitespace-nowrap",
        destaque ? "font-bold" : "font-semibold",
      )}
    >
      {linha.estado === "APURADO" && linha.valor !== null && (
        escreverValor(linha.valor, linha.medida)
      )}
      {linha.estado === "EM_CONJUNTO" && linha.conjunto && (
        <span
          className="font-normal text-muted-foreground"
          title={`${linha.conjunto.rotulo}, medidos juntos — o export não os separa`}
        >
          {escreverValor(linha.conjunto.valor, linha.conjunto.medida)}
          <span className="ml-1 text-xs">(par)</span>
        </span>
      )}
      {linha.estado === "SEM_LASTRO" && (
        <span className="text-muted-foreground/60" aria-label="sem lastro">
          —
        </span>
      )}
    </td>
  );
}
