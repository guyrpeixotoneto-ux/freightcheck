# Prova no navegador: Evolução anual do FINAME

O roteiro que a skill `prova-no-navegador` cita, escrito para esta tela e
reaproveitável para qualquer auditoria de grão equipamento.

## Por que existe um roteiro, e não só "abrir e olhar"

Porque abrir a página prova que a rota resolve, e mais nada. Os dois defeitos
que a primeira conferência visual encontrou só apareceram **dirigindo**:

- o cartão da variação ponta a ponta vinha vazio — visível ao abrir, mas só
  diagnosticável ao comparar com os outros cartões;
- o recorte interno não separava cavalo de carreta na ponta a ponta — e isso
  **não** era visível: só apareceu ao trocar de recorte e somar as metades.

A segunda é a lição cara: um número errado sozinho parece certo. O que o
denuncia é uma identidade que ele tem de satisfazer.

## Subir

```bash
node scripts/prova-local.mjs subir
TOKEN=$(node scripts/prova-local.mjs cookie)
```

## O roteiro

### 1. Cabeçalho segue o modo

Em `/custo-fixo-finame` a pastilha diz **Comparação entre vigências**; ao abrir
a aba Evolução ela vira **Evolução anual**, e a descrição troca junto. Um
cabeçalho fixo põe a matriz do ano sob a promessa de uma comparação entre duas
datas.

### 2. A fileira tem quatro abas, e só uma marcada

`Cavalo + Carreta | Cavalo | Carreta ┊ Evolução`. Com a Evolução aberta,
**nenhum** recorte fica aceso: dois botões marcados diriam que os dois valem.

### 3. A identidade que denuncia o recorte quebrado

Troque o seletor de dentro e leia os **dois** cartões em cada posição. As duas
metades têm de particionar o todo:

| recorte | movimentos | ponta a ponta |
|---|---|---|
| Cavalo | −R$ 373.692 | −R$ 90.584 |
| Carreta | −R$ 138.679 | −R$ 32.570 |
| **Cavalo + Carreta** | **−R$ 512.370** | **−R$ 123.154** |

`90.584 + 32.570 = 123.154`, ao real. Foi essa soma — e não o print — que
provou que o filtro interno recorta as **duas** leituras. Antes da correção a
segunda coluna vinha vazia, e a tela parecia funcionar.

### 4. Os dois números são diferentes, e isso é o ponto

−R$ 512.370 (soma dos movimentos) contra −R$ 123.154 (ponta a ponta). Se
fossem iguais, o segundo cartão não teria razão de existir; a diferença vem
escrita no próprio cartão — quem saiu da frota e o que voltou ao ponto de
partida.

### 5. O idioma é de custo

A matriz fala **Redução de custo** e **Aumento de custo**, não "Ganho" e
"Perda". Não é preferência de palavra: o sinal do impacto é a direção do
valor, e `cavalo.finame_cavalo` indo de R$ 10.578,03 para R$ 0 — financiamento
quitado — grava −10.578,03. No vocabulário de origem isso era "Perda", em
vermelho, sob o cartão que pintava o mesmo número de verde.

Confira que a célula, o acumulado da linha, a gaveta e o cartão concordam na
cor para o mesmo veículo.

### 6. Painel lateral

Clicar numa linha abre a gaveta com prioridade, tendência, o porquê do score,
o gráfico do acumulado e "Ver histórico completo".

### 7. A saída não custa nada

Clicar em `Carreta` sai da Evolução e devolve `/custo-fixo-finame` com o
recorte, o par de vigências e a unidade como estavam.

### 8. Console limpo

`pageerror` e `console.error` vazios do começo ao fim.

## Automatizado

`scripts/prova-da-evolucao.mjs` roda os oito passos e imprime a tabela da
identidade. Ele falha com código diferente de zero se qualquer uma das somas
não fechar, ou se aparecer erro de console.

```bash
node scripts/prova-da-evolucao.mjs
```
