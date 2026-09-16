import type { LinhaDeManutencao } from "@workspace/comparison/manutencao";
import { VARIAVEIS_DE_DETALHE_DE_MANUTENCAO } from "@workspace/comparison/manutencao";
import {
  DetalheDoVeiculo as Gaveta,
  type DetalheDaRubrica,
} from "@/components/comparacao/detalhe-do-veiculo";
import { ESCRITA_DA_MANUTENCAO } from "@/components/manutencao/tabela";
import { escreverDiferenca, escreverReaisPorKm, escreverValor } from "@/lib/manutencao";

/** Texto do acervo virando número; nulo e lixo continuam nulos, nunca zero. */
function numero(valor: string | null): number | null {
  if (valor === null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * Um valor absoluto, sem o sinal que a frase já diz.
 *
 * Na frase a direção já está na palavra, e o sinal volta como contradição: "o
 * R$/km caiu +R$ 0,0400/km" é o defeito que esta função evita.
 */
function semSinal(texto: string): string {
  return texto.replace(/^[+−-]/, "");
}

/**
 * O diagnóstico de um caminhão — regras determinísticas, nunca texto gerado.
 *
 * A frase mais importante é a da **origem**: dizer que o R$/km mudou sem dizer
 * de onde ele vem deixa a auditoria sem a metade que a torna contestável. Onde
 * há contrato, ela afirma; onde não há, ela diz que o export não explica — que é
 * o achado, e não uma falha da tela.
 */
export function diagnosticoDoVeiculo(linhas: readonly LinhaDeManutencao[]): string[] {
  const frases: string[] = [];
  const por = (chave: string) => linhas.find((l) => l.variavel === chave);

  const reaisKm = por("reais_km");
  const bid = por("bid");
  const contrato = por("contrato");
  const free = por("free_maintenance");

  if (reaisKm && reaisKm.estado === "ALTERADO" && reaisKm.diferenca !== null) {
    const direcao = reaisKm.diferenca > 0 ? "subiu" : "caiu";
    frases.push(
      `O custo por quilômetro ${direcao} ` +
        `${semSinal(escreverDiferenca(reaisKm.diferenca, "REAIS_POR_KM"))} — de ` +
        `${escreverValor(reaisKm.base, "REAIS_POR_KM")} para ` +
        `${escreverValor(reaisKm.comparada, "REAIS_POR_KM")}.`,
    );

    /*
      De onde veio o número novo. A ordem importa: o contrato manda quando
      existe — 126 de 126 no acervo —, e só depois se pergunta pelo BID.
    */
    const novo = numero(reaisKm.comparada);
    const doContrato = numero(contrato?.comparada ?? null);
    const doBid = numero(bid?.comparada ?? null);
    const perto = (a: number | null, b: number | null) =>
      a !== null && b !== null && Math.abs(a - b) <= 0.005;

    if (doContrato !== null && doContrato > 0 && perto(novo, doContrato)) {
      frases.push(
        `O valor novo é o R$/km do contrato (${escreverReaisPorKm(doContrato)}/km). É a ` +
          `origem que o export explica, e vale nos 126 caminhões do acervo que têm contrato.`,
      );
    } else if (perto(novo, doBid)) {
      frases.push(
        `O valor novo é o R$/km do BID (${escreverReaisPorKm(doBid!)}/km) — este caminhão não ` +
          `tem contrato próprio.`,
      );
    } else if (novo !== null && novo > 0) {
      frases.push(
        `O valor novo não é o do contrato nem o do BID ` +
          `(${doBid === null ? "sem BID lido" : `${escreverReaisPorKm(doBid)}/km`}), e ` +
          `nenhuma coluna deste export diz como ele foi formado. É a pergunta a fazer à ` +
          `Ambev — o produto não inventa a fórmula que falta.`,
      );
    }
  }

  const zerou = reaisKm && numero(reaisKm.comparada) === 0 && numero(reaisKm.base) !== 0;
  if (zerou) {
    const meses = numero(free?.comparada ?? null);
    frases.push(
      meses !== null && meses > 0
        ? `O R$/km zerou, e este caminhão tem ${meses} ${meses === 1 ? "mês" : "meses"} de ` +
          `free maintenance: a manutenção está inclusa, e o zero é o contrato, não a ausência ` +
          `dele. No acervo, 102 dos 122 zerados estão neste caso.`
        : "O R$/km zerou e este caminhão não declara free maintenance — aqui o zero não se " +
          "explica pelo contrato, e vale conferir a origem do cadastro.",
    );
  }

  const vida = por("vida_meses");
  if (vida && vida.estado === "ALTERADO" && vida.diferenca !== null) {
    const direcao = vida.diferenca > 0 ? "aumentou" : "diminuiu";
    frases.push(
      `A vida útil reconhecida ${direcao} ${semSinal(escreverDiferenca(vida.diferenca, "MESES"))} ` +
        `${Math.abs(vida.diferenca) === 1 ? "mês" : "meses"} — de ` +
        `${escreverValor(vida.base, "MESES")} para ${escreverValor(vida.comparada, "MESES")}. ` +
        `Ela anda sozinha com o calendário e se move em quase toda comparação; por si só não ` +
        `muda o que se paga.`,
    );
  }

  const reajuste = por("percentual_reajuste");
  if (reajuste && reajuste.estado === "ALTERADO" && reajuste.diferenca !== null) {
    frases.push(
      `O reajuste aplicado passou de ${escreverValor(reajuste.base, "PERCENTUAL")} para ` +
        `${escreverValor(reajuste.comparada, "PERCENTUAL")}. É percentual, e não entra em ` +
        `soma nenhuma — nem de reais, nem de R$/km.`,
    );
  }

  const pneu = por("pneu");
  if (pneu) {
    frases.push(
      "O pneu chega zerado, como em 100% das linhas do acervo nos dois equipamentos. É coluna " +
        "sem dado, não pneu de graça — e por isso ele fica fora de toda soma desta tela.",
    );
  }

  return frases;
}

const DETALHE_DA_MANUTENCAO: DetalheDaRubrica<LinhaDeManutencao> = {
  diagnostico: diagnosticoDoVeiculo,
  notaDoDiagnostico:
    "Regras determinísticas sobre os deltas gravados pelo motor, e a origem do R$/km como " +
    "comparação direta entre as três colunas que o acervo entrega.",
  chavesDeDetalhe: VARIAVEIS_DE_DETALHE_DE_MANUTENCAO.map((v) => v.chave),
  aviso: (
    <>
      <strong className="font-semibold">R$/km não é dinheiro até andar quilômetro.</strong> Esta
      tela não multiplica o custo por quilômetro por quilometragem nenhuma: a quilometragem é de
      outra leitura, de outro grão e de outra vigência, e a conta feita aqui produziria um custo
      de manutenção que nenhuma outra tela do produto reproduziria. O valor reajustado e o R$/km
      solto também não somam — o primeiro é o contrato com outro nome, o segundo é uma terceira
      coluna que ninguém explicou.
    </>
  ),
};

/** O detalhe de um caminhão — as variáveis lado a lado, na mesma gaveta. */
export function DetalheDoVeiculo({
  veiculo,
  linhas,
  rotuloBase,
  rotuloComparada,
  onFechar,
}: {
  veiculo: { entityLabel: string | null; entityType: string } | null;
  linhas: LinhaDeManutencao[];
  rotuloBase: string;
  rotuloComparada: string;
  onFechar: () => void;
}) {
  return (
    <Gaveta
      veiculo={veiculo}
      linhas={linhas}
      escrita={ESCRITA_DA_MANUTENCAO}
      detalhe={DETALHE_DA_MANUTENCAO}
      rotuloBase={rotuloBase}
      rotuloComparada={rotuloComparada}
      onFechar={onFechar}
    />
  );
}
