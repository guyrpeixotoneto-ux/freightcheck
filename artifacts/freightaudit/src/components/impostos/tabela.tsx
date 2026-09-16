import type { LinhaDeImpostos, VeiculoDeImpostos } from "@workspace/comparison/impostos";
import {
  TabelaPorVeiculo,
  type EscritaDaRubrica,
} from "@/components/comparacao/tabela-por-veiculo";
import type { AbrirJustificativa } from "@/components/justificativas/coluna";
import type { Justificativa } from "@/lib/justificativas";
import {
  ROTULO_DO_ESTADO,
  ROTULO_DO_TRIBUTO,
  SELO_DO_ESTADO,
  corDaDiferenca,
  escreverDiferenca,
  escreverValor,
  escreverVariacao,
} from "@/lib/impostos";

/**
 * A tabela da comparação de impostos — **uma linha por placa**.
 *
 * A estrutura toda mora em `comparacao/tabela-por-veiculo.tsx`, com as outras
 * três rubricas de custo fixo. Este arquivo é o que só os impostos têm a dizer.
 *
 * **A coluna "Tributo" é a que esta tabela tem a mais**, e ela não é decoração:
 * ICMS e PIS/COFINS não somam entre si, e sem ela as duas rubricas se misturam
 * na expansão de uma mesma placa. Ela é da linha, e não do veículo — a mesma
 * placa tem linhas dos dois tributos, e é justamente isso que a coluna mostra.
 *
 * **A coluna de dinheiro da placa é o PIS/COFINS da compra.** É o único tributo
 * desta rubrica com montante preenchido: o ICMS vem zerado nas 1.215 linhas do
 * acervo, e isso é coluna sem dado, não imposto zero. Um destaque chamado
 * "impostos" que somasse os dois esconderia exatamente esse achado — e é o
 * mesmo motivo pelo qual o gráfico de totais mantém um balde por tributo. O que
 * se mover no ICMS continua contado em "Alterações" e escrito na expansão.
 *
 * **A alíquota se anuncia.** Numa coluna de números em que a linha de cima é
 * R$ 37.890,84, o `12` da linha de baixo pede o aviso de que não é dinheiro. O
 * ⓘ fica junto do nome da variável, e não em coluna própria, pela mesma razão do
 * motivo da recusa: existe em poucas linhas de cada cem.
 *
 * **A cor se inverte aqui**, e só aqui: um tributo maior é dinheiro a menos para
 * quem opera. Quem decide é `corDaDiferenca` — ver `lib/impostos.ts`.
 */
const ESCRITA_DOS_IMPOSTOS: EscritaDaRubrica<LinhaDeImpostos, VeiculoDeImpostos> = {
  rubrica: "impostos",
  destaque: "PIS/COFINS",
  escreverValor,
  escreverDiferenca,
  escreverVariacao,
  corDaDiferenca,
  selo: SELO_DO_ESTADO,
  rotuloDoEstado: ROTULO_DO_ESTADO,
  colunaDaVariavel: {
    titulo: "Tributo",
    celula: (l) =>
      l.tributo ? (
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-semibold">
          {ROTULO_DO_TRIBUTO[l.tributo]}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  avisoDaVariavel: (l) =>
    l.papel === "ALIQUOTA"
      ? {
          rotulo: "Esta linha é uma alíquota declarada, e não dinheiro",
          texto: (
            <>
              <strong className="font-semibold">Alíquota, não montante.</strong> É a taxa que
              o ativo declara — nunca entra numa soma de reais. O dinheiro correspondente
              está na linha do montante do mesmo tributo.
            </>
          ),
        }
      : null,
};

export function TabelaDeImpostos({
  veiculos,
  justificadaPor,
  onAbrir,
  onJustificar,
}: {
  veiculos: VeiculoDeImpostos[];
  /** A justificativa mais recente de cada alteração, por `change.id`. */
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onAbrir: (veiculo: { entityLabel: string | null; entityType: string }) => void;
  /** Ausente, a coluna fica só de leitura. */
  onJustificar?: AbrirJustificativa;
}) {
  return (
    <TabelaPorVeiculo
      veiculos={veiculos}
      escrita={ESCRITA_DOS_IMPOSTOS}
      justificadaPor={justificadaPor}
      onAbrir={onAbrir}
      onJustificar={onJustificar}
    />
  );
}
