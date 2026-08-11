# Proposta — Simulação (F4)

> Desenho, não implementação. Nenhum código desta proposta foi escrito.

A Simulação é a única tela do produto que **produz** um número em vez de
reportar um. Alterações e Comparar mostram o que a Freightec entregou; a
Simulação responde "e se". É por isso que ela é a que mais pode mentir, e a que
precisa da regra mais dura.

---

## 1. O que existe hoje: nada aproveitável

`artifacts/freightaudit/src/pages/simulacao.tsx` é scaffold do schema anterior.
Ela chama `useListSimulations` e `useCreateSimulation`, gerados de
`lib/api-spec/openapi.yaml`, que ainda declara `/simulations`. Essas rotas foram
removidas junto com o schema antigo — está dito em
`artifacts/api-server/src/routes/index.ts:13`. A tela chama endpoints que não
existem, e é por isso que ela aparece trancada no menu.

Ela também soma tudo em um `formatBRL` só, que é exatamente o que este produto
não faz.

Conclusão: a tela é reescrita sobre o modelo canônico, e as rotas
`/simulations` saem do `openapi.yaml`. Não há migração de dados: nunca houve
simulação gravada neste modelo.

---

## 2. O problema de verdade: converter periodicidade

O modelo tem três periodicidades — `MENSAL`, `ANUAL`, `PONTUAL` — e um quarto
estado que não é periodicidade nenhuma: alíquotas (`icms`, `pis_cofins`), que
têm `periodicity: null` porque um percentual não se acumula no tempo.

Alterações e Comparar resolveram isso **não somando**: o impacto é acumulado por
periodicidade, e a tela mostra `ANUAL` e `MENSAL` lado a lado. A Simulação não
tem essa saída. Perguntar "quanto custa esta frota em 2026" exige pôr tudo na
mesma unidade — e é aí que uma suposição vira um número errado.

### As regras

**R1 — Converter é declarado, nunca inferido.** Uma conversão é uma decisão
registrada, com fator explícito, não uma multiplicação que acontece no meio do
cálculo. O código não tem uma função `paraAnual(valor)` genérica.

**R2 — `MENSAL → ANUAL` é ×12, e mesmo isso é uma premissa, não aritmética.**
Doze é o número de vezes que um custo mensal incide num ano *se ele incidir o
ano inteiro*. O FINAME não incide: `periodoFiname` é o prazo do financiamento, e
no ano em que ele termina o custo mensal não ocorre doze vezes. Enquanto a
Simulação não souber ler esse prazo, o resultado é rotulado como
**projeção linear**, não como custo do ano.

**R3 — `PONTUAL` não converte, em nenhuma direção.** `valor_nf_compra` é o que
se pagou uma vez pelo ativo. Dividi-lo por doze não produz um custo mensal —
produz uma depreciação que ninguém declarou, com uma vida útil que ninguém
informou. Um valor pontual entra na simulação como valor pontual, numa linha
própria, ou não entra.

**R4 — Alíquota não é dinheiro.** Nunca é somada, nunca é convertida. Ela
multiplica uma base, e a base tem periodicidade própria — o resultado herda a
da base.

**R5 — Sem periodicidade confirmada, o atributo não entra no total.** Ele
aparece na tela, nomeado, sob "fora do total porque a periodicidade não está
confirmada". Hoje isso ainda vale para boa parte dos atributos monetários — a
auditoria em `docs/AUDITORIA-PERIODICIDADE.md` listou quais e por quê. A
Simulação não é o lugar de resolver isso por atalho.

**R6 — Toda conversão viaja com o resultado.** Cada linha do total carrega de
qual periodicidade veio, qual fator foi aplicado e qual versão da semântica
estava vigente. Sem isso o número não é sustentável, e um número não sustentável
não é exibido.

### A tabela de conversão, inteira

| de → para | MENSAL | ANUAL | PONTUAL |
|---|---|---|---|
| **MENSAL** | ×1 | ×12, rotulado projeção linear (R2) | recusa |
| **ANUAL** | ÷12, rotulado projeção linear | ×1 | recusa |
| **PONTUAL** | recusa | recusa | ×1 |

Três células são recusa explícita, não zero e não omissão: a tela diz que aquele
valor não pode ser convertido e por quê.

---

## 3. O horizonte é do usuário, não do código

A simulação acontece sobre um período que quem opera escolhe — "Jan a Dez/2026",
"os próximos 6 meses". Converter para um "anual" fixo esconde a premissa. O
horizonte é declarado na tela, e todos os valores são convertidos **para ele**,
com o fator à vista:

- custo mensal, horizonte de 6 meses → ×6;
- custo anual, horizonte de 6 meses → ×0,5, rotulado projeção linear;
- valor pontual → entra uma vez se a data cair no horizonte, e nunca é rateado.

---

## 4. Semântica versionada: a interação que não pode ser esquecida

Um horizonte pode atravessar uma mudança de semântica. `ipvaLicenciamento`
mudou de regra de cálculo duas vezes em nove vigências — foi o que motivou
`attribute_semantics`.

Se o horizonte atravessa uma mudança, há duas respostas honestas, e a escolha é
de quem opera:

1. **simular por trecho**, usando em cada data a semântica vigente naquela data
   (`resolveSemanticsAt` já faz isso), somando os trechos; ou
2. **recusar**, dizendo qual atributo mudou e quando.

O que não existe é a terceira: aplicar a semântica de hoje ao passado inteiro e
apresentar um total. Isso é a mesma classe de erro que custou a leitura de
R$ 720 mil no IPVA.

---

## 5. O que a Simulação responde

Com as regras acima, a tela responde:

- quanto custa esta frota no horizonte escolhido, por grupo de custo, separando
  fixo de variável (a classificação já é resolvida por herança na taxonomia);
- o que muda se um parâmetro mudar — uma alíquota, um valor unitário, o tamanho
  da frota;
- quanto do total está fora dele, e por qual motivo, atributo por atributo.

O terceiro item não é rodapé. Numa frota onde a maior parte dos atributos
monetários ainda espera confirmação de periodicidade, "o que ficou de fora" é
tão informativo quanto o total.

---

## 6. Ordem de implementação sugerida

1. o conversor, com a tabela do §2 e as recusas, coberto por testes — inclusive
   testes que provam que ele **se recusa** a converter;
2. o cálculo sobre o horizonte, lendo a semântica vigente por data;
3. a API;
4. a tela, com o total e a lista do que ficou fora, lado a lado.

O passo 1 é onde vale gastar rigor. Os outros três são consequência.

---

## 7. Decisões que preciso de você

1. **Projeção linear é aceitável?** Uma alternativa é a Simulação só operar em
   horizontes de doze meses cheios, evitando ×0,5 e ×6. Mais honesto e menos
   útil. Minha recomendação: permitir, sempre rotulado.
2. **Valor pontual entra?** Ele não é custo do período — é o que se pagou pelo
   ativo. Minha recomendação: mostrar em bloco separado, fora do total.
3. **Horizonte atravessando mudança de semântica:** simular por trecho, ou
   recusar? Minha recomendação: por trecho, com a mudança marcada na linha do
   tempo do resultado.
