# A quitação do cavalo — a terceira parcela que faltava, e a ponte entre dois totais

> Escrito para sustentar a variável `lucro_fixo_do_cavalo` no catálogo do FINAME
> e o campo `ImpactoDeFiname.porOutroModulo` (`lib/comparison/src/finame.ts`).
> As medições são do acervo do `dev:seed` — 18 vigências de `Modelo_Carreta` e 9
> de `Modelo_Cavalo`, com as 8 comparações que `prova-dados` calcula — e as
> consultas estão no corpo de cada seção.

---

## 1. A pergunta que chegou

Dois números da mesma tela de FINAME, no mesmo par, para o mesmo mês:

| Leitura | Valor |
|---|---|
| Painel "Evolução entre as duas vigências", parcela alterada | **+R$ 15.809,57** |
| Cartão "Impacto financeiro", mensal | **+R$ 11.131,72** |

A diferença — R$ 4.677,85 — não era arredondamento nem recorte: era o valor
**inteiro** da parcela nova de uma placa. No acervo do `dev:seed` o mesmo par
aparece como julho → 1ª de agosto de 2026, com os mesmos R$ 4.677,85:
R$ 11.916,70 no painel contra R$ 7.238,85 no cartão.

---

## 2. O que a placa fez

`QYP3G72`, cavalo, entre 16/07/2026 e 01/08/2026:

```
cavalo.status_financiamento    FINAME  ->  QUITADO
cavalo.finame_cavalo           9.847,35 -> 4.677,85   Δ −5.169,50
cavalo.amortizacao_cavalo      7.700,16 ->     0,00   Δ −7.700,16
cavalo.juros_finame_cavalo     2.147,19 ->     0,00   Δ −2.147,19
cavalo.lucro_fixomodelo_novo_ciclo_cavalo
                                   0,00 -> 4.677,85   Δ +4.677,85
```

O financiamento acabou. Amortização e juros zeraram, e o custo do equipamento
passou a sair como **lucro fixo** — rubrica de outro módulo. A parcela caiu
apenas R$ 5.169,50, que é a diferença entre o que saiu e o que entrou.

A primeira hipótese era que a fonte estivesse incoerente (a parcela dizendo uma
coisa e as partes, outra). A medição derrubou a hipótese: `composition.ts` já
declarava e media a identidade do cavalo —
`finame_cavalo = amortizacao + juros + lucro_fixomodelo_novo_ciclo_cavalo`, 532
de 533 linhas com total não nulo —, e com a terceira parcela dentro dela a conta
fecha ao centavo: `−7.700,16 − 2.147,19 + 4.677,85 = −5.169,50`.

**Quem estava incompleto era o catálogo do FINAME**, que só conhecia duas das
três parcelas do cavalo. É o mesmo defeito que `docs/ACHADO-ALUGUEL.md` descreve
nos implementos alugados, do outro lado da frota.

---

## 3. As duas consequências, e o que cada correção faz

**A expansão da placa não explicava a parcela.** Ela mostrava o total caindo
R$ 5.169,50 ao lado de duas partes zeradas, sem nada dizendo para onde o
dinheiro tinha ido — exatamente o que o aluguel fazia antes de entrar no
catálogo. Declarar `lucro_fixo_do_cavalo` resolve isso.

**E havia uma dupla contagem à espreita.** A regra de `cobertasPorParcelasEm`
tira a parcela do total quando uma parcela dela se move. Sem o lucro fixo no
catálogo, uma quitação em que **só** o lucro fixo mexesse deixaria a parcela
inteira na soma do FINAME enquanto o Lucro Fixo somava o mesmo dinheiro. No
acervo de hoje isso não acontece — nas 10 quitações medidas a amortização e os
juros sempre se movem junto —, mas nada impedia:

```
veículo × par com parcela E lucro fixo alterados: 10
casos de dupla contagem hoje: 0
```

**A variável mora no detalhe, e não na tabela** — é onde ela difere do aluguel.
Os códigos da tabela são o universo que a aba Evolução soma
(`EVOLUCAO_DO_FINAME`), e ali não há `foraDaSoma` para consultar: pôr no
universo uma coluna que se move e que outro módulo soma faria a Evolução do
FINAME publicar dinheiro do Lucro Fixo. O aluguel está na tabela porque é
constante no acervo (36 linhas, sempre o mesmo valor); o lucro fixo do cavalo se
move em toda quitação.

---

## 4. Os dois totais continuam diferentes — e agora a tela diz por quê

Com o catálogo correto, o cartão de impacto continua somando R$ 7.238,85 e o
painel continua somando R$ 11.916,70, **e os dois estão certos**: o painel soma
a parcela FINAME inteira, o cartão soma o que é rubrica deste módulo. Os
R$ 4.677,85 de diferença são do Lucro Fixo, e é a auditoria dele que os soma —
somá-los aqui também seria contar o mesmo dinheiro duas vezes.

O que faltava era **escrever isso**. `ImpactoDeFiname.porOutroModulo` publica a
diferença, por periodicidade, e a tela escreve uma frase ao lado do cartão. O
número é o resíduo medido — `Δparcela − Σ(partes que este módulo somou)`, por
veículo cuja parcela saiu por estar coberta —, e não uma dedução a partir da
composição: nas quitações de dezembro a parcela vai a zero e o lucro fixo que
aparece no lugar **não** está dentro dela; na QYP3G72 está. A diferença é o que
ela é, medida.

A identidade `impacto + ponte = Σ Δparcela`, nos 8 pares do acervo:

| Par | Parcela alterada | Impacto do módulo | Ponte | Fecha? |
|---|---|---|---|---|
| dez/2025 → jan/2026 | −R$ 57.800,77 | −R$ 57.800,80 | +R$ 0,03 | sim |
| jan → fev/2026 | +R$ 427,33 | +R$ 427,34 | −R$ 0,01 | sim |
| fev → mar/2026 | R$ 0,00 | R$ 0,00 | R$ 0,00 | sim |
| mar → abr/2026 | +R$ 16.588,38 | +R$ 16.588,35 | +R$ 0,03 | sim |
| abr → mai/2026 | +R$ 5,85 | +R$ 5,85 | R$ 0,00 | sim |
| mai → jun/2026 | −R$ 35.923,94 | −R$ 35.923,94 | R$ 0,00 | sim |
| jun → jul/2026 | −R$ 20.007,78 | −R$ 20.007,78 | R$ 0,00 | sim |
| **jul → 1ª ago/2026** | **+R$ 11.916,70** | **+R$ 7.238,85** | **+R$ 4.677,85** | **sim** |

Os resíduos de um a três centavos são arredondamento de duas casas nas partes —
a mesma folga que `composition.ts` já media ("46 por arredondamento").

---

## 5. O que **não** se fez, e por quê

A primeira proposta foi uma guarda de coerência no dedupe: quando as partes não
reconstroem o total, ficaria o total e sairiam as partes. Ela chegou a ser
escrita e foi **descartada pela medição**, por duas razões:

1. **A premissa era falsa.** As partes reconstroem o total — faltava a terceira
   delas no catálogo. Não havia incoerência da fonte para guardar.
2. **A guarda criaria a dupla contagem que este módulo existe para impedir.**
   Manter a parcela na soma do FINAME quando uma das partes dela é rubrica de
   outro módulo faz o mesmo dinheiro entrar nos dois totais — precisamente o
   caso da QYP3G72, em que R$ 4.677,85 já são somados pelo Lucro Fixo.

O teste `evolucao-de-finame-real.test.ts` ("as duas réguas de impacto do FINAME
respondem o mesmo para cada par") foi quem reprovou a guarda, com o par e o
número: `2026-07-16 → 2026-08-01: comparação=11916.7 evolução=7238.85`. É o
guarda-corpo funcionando como foi desenhado.
