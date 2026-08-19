# Quarentena por chave: o arquivo entra, o registro em conflito não

## O que se decidiu

Quando a mesma entidade aparece mais de uma vez na mesma vigência **com valores
que discordam**, a importação não escolhe entre as linhas e não para o arquivo:
ela deixa **aquela chave** de fora, importa todo o resto, e a vigência fica
marcada como incompleta enquanto o registro estiver faltando.

Antes, o mesmo conflito segurava o arquivo inteiro.

## Por que mudou

O caso que forçou a decisão está numa tela, e o número dela é o argumento
inteiro:

> `QLP ADM_Remunerado Camaçari_V@.xlsx` — 12.765 células, 11.760 fatos, **8
> erros**, 0 avisos. Estado: *dado não fecha*. Nada foi importado.

Oito conflitos seguravam onze mil setecentos e sessenta fatos bons. A saída
oferecida era "corrija a origem e envie o arquivo de novo" — e enquanto ninguém
corrigisse, o quadro de pessoal daquela unidade simplesmente não existia no
produto.

O bloqueio não estava errado quanto ao princípio. Ele estava errado quanto ao
**escopo**: o que não tem resposta certa são as 8 chaves, não o arquivo.

## O que continua valendo

**O FreightCheck não escolhe em silêncio entre dois valores conflitantes.** Essa
regra não foi relaxada — ela foi aplicada com precisão. O pipeline continua sem
escolher; o que mudou é que "não escolher" deixou de significar "não importar
nada" e passou a significar "não importar aquilo".

A chave sai **inteira**, e não só nos atributos que discordam. Duas linhas para
o mesmo cargo são duas afirmações concorrentes sobre ele: ficar com os campos em
que elas concordam montaria um registro que nenhuma das duas faz, e a ausência
dos outros se leria, lá na frente, como "o export não trouxe essa coluna" — que
é outra afirmação, e falsa.

## As três consequências que uma importação pode ter

São exaustivas, e a tela escreve cada uma no selo do apontamento:

| Consequência | O que cai | Exemplo | Selo |
| --- | --- | --- | --- |
| Linha recusada | a linha | linha sem placa, rótulo de vigência ilegível | `Erro` |
| Chave em quarentena | o registro, em todas as suas colunas | a mesma chave duas vezes com valores que discordam | `Registro não importado` |
| Promoção bloqueada | o arquivo | a aba prometia um tipo e entregou outro | `Erro bloqueante` |

A lista de códigos de cada categoria mora em `lib/ingest/src/apontamentos.ts`
(`CODIGOS_QUE_BLOQUEIAM_PROMOCAO` e `CODIGOS_QUE_ISOLAM_A_CHAVE`), num módulo que
o pipeline e a tela alcançam — as duas leituras não podem divergir sobre o que um
código faz.

## A contrapartida obrigatória

Deixar o arquivo entrar cria uma dívida que o bloqueio não tinha: **um registro
que ficou de fora não aparece como faltando — ele simplesmente não aparece.** Na
tabela do quadro, o cargo em quarentena é indistinguível do cargo que a unidade
não tem. "Cargos no quadro: 214" passa a ser verdade sobre o quadro e mentira
sobre a unidade.

Por isso a decisão não é só a mudança no pipeline. Ela tem três partes, e as três
são obrigatórias:

1. **A quarentena** (`lib/ingest/src/pipeline.ts`, em `stage`). A classificação
   dos grãos acontece antes de qualquer fato entrar na staging — sem isso, as
   colunas de uma chave já teriam sido empurradas quando o conflito aparecesse.
2. **A marca de incompleta** (`VisaoDoQuadro.registrosFaltando`). A leitura do
   quadro conta o que falta e a tela escreve a ressalva acima do conteúdo, em
   todas as abas, antes de qualquer contagem — nunca atrás de um clique.
3. **A aba de Inconsistências** (`/qlp-administrativo?aba=inconsistencias`). A
   evidência inteira: a chave como está escrita no arquivo, as linhas que
   colidiram, os valores lado a lado e o que fazer.

## Por que não há tabela de pendências

Tudo o que a aba mostra já foi gravado por quem decidiu — `validation_issue`
guarda a chave legível, as linhas, os valores em desacordo e o texto de como
corrigir. Copiar isso para uma tabela de pendências criaria uma segunda verdade
que pode divergir da primeira, e a pergunta "esta chave ainda está faltando?" tem
resposta exata sem cópia nenhuma: é o apontamento do run que produziu a vigência
**viva**.

Isso tem uma consequência boa: corrigida a origem e importado o arquivo de novo,
a vigência viva passa a ser outra, o run é outro, e a pendência desaparece
sozinha. Ninguém precisa marcar nada como resolvido, e não existe o estado
"resolvido no sistema, errado na planilha".

## O que ainda para o arquivo

Um arquivo em que **todas** as chaves conflitam não tem o que importar, e para —
mas com o motivo certo. A frase antiga ("nenhuma aba foi aceita como fonte")
mandaria conferir os papéis das abas, e as abas foram aceitas: o que não fecha
são as linhas.

## Onde isto está provado

| Prova | Arquivo |
| --- | --- |
| O que não conflita entra; só a chave em conflito sai | `lib/ingest/src/__tests__/deduplicacao.test.ts` |
| A quarentena que leva tudo para com o motivo certo | idem |
| Repetição que **concorda** consolida, e não vai para quarentena | `lib/ingest/src/__tests__/tipo-declarado.test.ts` |
| A vigência entra incompleta, o quadro diz, e a evidência está na aba | `artifacts/api-server/src/routes/__tests__/qlp.test.ts` |
