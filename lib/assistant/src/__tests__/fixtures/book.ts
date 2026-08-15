import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { bookEntryTable, type Database } from "@workspace/db";
import { BLOCOS_BOOK, chaveDoBloco } from "@workspace/knowledge";

/**
 * Um Book de teste — sintético, e declarado como tal.
 *
 * **Por que ele precisa existir.** O índice dos 66 blocos vive no código; o
 * **conteúdo** de cada bloco é registrado em produção, por quem opera, e por
 * isso `book_entry` está vazia em todo ambiente novo. Uma suíte que roda contra
 * banco vazio não mede o retrieval do Book — ela mede a ausência dele, e passa
 * verde enquanto o ranqueamento apodrece.
 *
 * **Por que não conteúdo real.** Nenhum documento da operação está neste
 * repositório, e nenhum deveria estar: são contratos entre a Ambev e as
 * transportadoras. O que está aqui é escrito para o teste — fiel na
 * **estrutura** (título, seções aninhadas, tabela, regra numérica, prazo) e
 * inventado no conteúdo. É a estrutura que o chunking, o ranqueamento e as
 * citações exercitam; os valores são apenas o que precisa haver para que um
 * número tenha de ter lastro.
 *
 * Os blocos escolhidos são os que a bateria pergunta, e cobrem as formas que o
 * indexador precisa saber tratar: seção com tabela, seção só de prosa, regra
 * com variante por iniciativa, e dois blocos que se referem um ao outro
 * (QLP ADM e DESCONTO QLP ADM) — que é o caso em que o ranqueamento tem de
 * escolher entre vizinhos.
 */
const CONTEUDO: Record<string, string> = {
  PNEU: `# PNEU

## Objetivo

Define como a remuneração de pneu é composta para cavalo e carreta, e o que a transportadora precisa comprovar para receber.

## Composição

A remuneração de pneu considera o custo por quilômetro rodado, aplicado sobre a quilometragem contratada da vigência.

| Item | Cavalo | Carreta |
| --- | --- | --- |
| Vida útil considerada | 120.000 km | 180.000 km |
| Pneus por equipamento | 6 | 12 |
| Recapagem prevista | 2 ciclos | 3 ciclos |

## Frequência de revisão

O valor de pneu é revisto a cada vigência mensal, e o índice aplicado é o do mês anterior ao da vigência.

## Evidência exigida

Nota fiscal de aquisição e relatório de sucateamento. Sem a nota, o item não é remunerado na vigência.`,

  "PREÇO COMBUSTÍVEIS": `# PREÇO COMBUSTÍVEIS

## Objetivo

Estabelece qual referência de preço vale para remunerar combustível.

## Regra do menor valor

No modelo Tradicional, a remuneração usa o menor valor entre o preço praticado pela operadora e o preço de referência da ANP para a praça da unidade.

| Iniciativa | Referência aplicada |
| --- | --- |
| Tradicional / Padrão | Menor entre operadora e ANP |
| Cartão de abastecimento | Preço da operadora do cartão |
| Base própria | Custo comprovado da base |

## Periodicidade

A referência da ANP é atualizada semanalmente; a vigência congela o valor da última semana fechada antes do primeiro dia da vigência.

## Crédito de imposto

Quando a unidade apura crédito de PIS/COFINS sobre o diesel, o crédito é deduzido do preço antes de remunerar.`,

  "CONSUMO DE COMBUSTÍVEIS": `# CONSUMO DE COMBUSTÍVEIS

## Objetivo

Define o consumo negociado por equipamento e como ele é revisto.

## Consumo negociado

O consumo negociado é expresso em km/L e é o divisor da quilometragem para apurar litros remunerados. Uma redução no consumo negociado aumenta o litro reconhecido para a mesma distância.

## Revisão

O consumo negociado é renegociado anualmente, ou fora de ciclo quando houver troca de modelo de equipamento na frota.

## Exceções

Operação urbana com mais de 40 paradas por rota admite consumo negociado específico, registrado em anexo à vigência.`,

  "CUSTO FIXO DE EQUIPAMENTOS": `# CUSTO FIXO DE EQUIPAMENTOS

## Objetivo

Consolida os componentes fixos remunerados por equipamento ativo na vigência.

## Componentes

- Depreciação e amortização
- Financiamento (FINAME), juros e amortização
- IPVA e licenciamento
- Seguro obrigatório e facultativo

## Regra de proporcionalidade

Equipamento ativado ou desativado no meio da vigência é remunerado proporcionalmente aos dias ativos, contados do cadastro de ativação.

## IPVA

O IPVA é lançado como valor mensal na planilha. O valor anual não é campo do modelo — multiplicar o mensal por doze não reproduz o anual contratado, porque o lançamento mensal já embute o parcelamento acordado.`,

  MANUTENÇÃO: `# MANUTENÇÃO

## Objetivo

Define a remuneração de manutenção preventiva e corretiva.

## Composição

A manutenção é remunerada por km rodado, separada em preventiva e corretiva, com teto por equipamento.

## Frequência

Revisão trimestral do valor por km, com base no índice de peças e mão de obra publicado pela Ambev.

## Não conformidade

Equipamento sem plano preventivo em dia tem a parcela preventiva suspensa até regularização.`,

  "QLP ADM": `# QLP ADM

## Objetivo

A auditoria QLP ADM confere se a estrutura administrativa remunerada existe e está aderente ao padrão da operação.

## Frequência

A conferência é bimestral em todas as operações.

## Critérios

| Item | Evidência | Consequência |
| --- | --- | --- |
| Organograma | Documento assinado | Questionamento |
| Folha de pagamento | Relatório do mês | Questionamento |
| Ponto eletrônico | Espelho do período | Desconto |

## Consequência financeira

A consequência financeira de uma não conformidade é tratada no bloco DESCONTO QLP ADM.`,

  "DESCONTO QLP ADM": `# DESCONTO QLP ADM

## Objetivo

Define o desconto aplicado quando a auditoria QLP ADM aponta não conformidade.

## Escala

O desconto é proporcional ao número de posições não comprovadas, limitado ao valor remunerado da estrutura administrativa na vigência.

## Prazo de contestação

A transportadora tem 10 dias corridos a partir do laudo para contestar. Sem contestação, o desconto entra na vigência seguinte.`,

  "Modelo de precificação": `# Modelo de precificação

## Objetivo

Descreve como as parcelas de remuneração se somam e por que elas não são somáveis entre periodicidades diferentes.

## Periodicidade

Parcelas mensais, por km e por evento não podem ser somadas em um total único. Cada uma é acumulada na sua própria periodicidade, e a comparação entre vigências é feita dentro de cada periodicidade.

## Reajuste

O índice de reajuste é aplicado na vigência de aniversário do contrato, e não retroage.`,

  "BOOK VALE PEDÁGIO": `# BOOK VALE PEDÁGIO

## Objetivo

Define o tratamento do vale pedágio na remuneração.

## Regra

O vale pedágio é repassado por reembolso, não compõe a remuneração fixa e não sofre reajuste por índice.

## Comprovação

Extrato da operadora de pedágio por placa e por viagem.`,

  CONSUMO: `# CONSUMO

## Objetivo

Bloco geral de consumo de insumos remunerados que não sejam combustível.

## Itens

Arla, lubrificantes e filtros são remunerados dentro do custo variável, com valor por km.`,
};

/**
 * Preenche o Book de teste — e só quando ele está vazio.
 *
 * A guarda importa: um banco de desenvolvimento com conteúdo real anexado pela
 * operação não pode ser sobrescrito por fixture ao rodar a suíte. Vazio é o
 * único estado em que semear é seguro, e é o estado do CI.
 */
export async function semearBookDeTeste(db: Database): Promise<number> {
  const { rows } = await db.execute<{ n: string }>(
    sql`SELECT count(*)::text AS n FROM book_entry`,
  );
  if (Number(rows[0]?.n ?? 0) > 0) return 0;

  const linhas: (typeof bookEntryTable.$inferInsert)[] = [];
  for (const bloco of BLOCOS_BOOK) {
    const corpo = CONTEUDO[bloco.titulo];
    if (!corpo) continue;
    const chave = chaveDoBloco(bloco);
    // O índice repete três blocos de propósito; a entrada é uma por chave.
    if (linhas.some((l) => l.blockKey === chave)) continue;
    const bytes = Buffer.from(corpo, "utf8");
    linhas.push({
      blockKey: chave,
      blockCategory: bloco.categoria,
      blockTitle: bloco.titulo,
      kind: "TEXTO",
      revision: 1,
      bodyText: corpo,
      mimeType: "text/markdown",
      byteSize: bytes.byteLength,
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
      createdBy: "teste:fixture",
    });
  }

  if (linhas.length > 0) await db.insert(bookEntryTable).values(linhas);
  return linhas.length;
}
