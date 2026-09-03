-- ---------------------------------------------------------------------------
-- O NOME GERENCIAL VOLTA A NASCER VAZIO — e só o que a máquina escreveu sai.
-- ---------------------------------------------------------------------------
--
-- `attribute.display_name` é apelido de leitura: o nome que quem opera dá à
-- coluna para reconhecê-la, quando `valorPisCofins` não é o que se fala numa
-- reunião. A importação, porém, criava a coluna com `display_name` igual a
-- `source_name` — e um campo que nasce preenchido com a resposta errada é pior
-- do que um campo vazio, porque parece respondido. Na tela de curadoria a
-- consequência era literal: o card exibia `periodoFiname · periodoFiname` e o
-- formulário oferecia `periodoFiname` no lugar onde alguém escreveria "Prazo
-- do FINAME, em meses".
--
-- Todo leitor deste campo já trata o vazio do jeito certo — `attributeLabel`
-- cai no nome de origem, e as telas o mostram em fonte monoespaçada enquanto
-- não há apelido —, de modo que o `NULL` não deixa nada sem nome em lugar
-- nenhum.
--
-- ---------------------------------------------------------------------------
-- Por que `display_name = source_name` NÃO basta como critério
-- ---------------------------------------------------------------------------
--
-- Seria cômodo apagar todo `display_name` idêntico ao nome de origem e chamar
-- isso de "limpar o automático". Mas as duas coisas são indistinguíveis pelo
-- valor: alguém pode ter aberto a curadoria e salvo, à mão, exatamente o nome
-- que já estava lá — e essa linha é curadoria, com data e autor, não sobra da
-- importação. Apagá-la seria destruir o único registro de que uma pessoa
-- olhou aquela coluna e decidiu que o nome estava bom.
--
-- O que distingue as duas não é o valor: é o rastro. `attribute.display_name`
-- tem exatamente dois escritores em todo o produto, e eles deixam rastros
-- diferentes:
--
--   1. a promoção (`promote`, em `lib/ingest/pipeline.ts`), que criava a linha
--      com `display_name = source_name` num INSERT e **não** escreve evento
--      nenhum — é a cópia que esta migration existe para desfazer;
--   2. `saveMeaning` (`lib/curation/meaning.ts`), único caminho de escrita
--      humana — a tela de curadoria e a planilha de atributos passam as duas
--      por ele —, que grava, na mesma transação do UPDATE, um `curation_event`
--      com `target_kind = 'ATTRIBUTE'` e `field = 'display_name'`, dizendo
--      quem, quando, de quê para quê.
--
-- `curation_event` é append-only na prática: nenhuma linha do produto a apaga,
-- nem a exclusão de importação, que remove fatos e vigências e não toca nesta
-- tabela. Então "existe evento de `display_name` para este atributo" é uma
-- afirmação que, uma vez verdadeira, não deixa de ser — e é por isso que ela
-- serve de guarda aqui.
--
-- O `NOT EXISTS` abaixo é essa guarda: **sai só o que nenhuma pessoa jamais
-- tocou**. Um nome gerencial salvo à mão fica, mesmo quando é idêntico ao nome
-- de origem, mesmo quando foi depois reescrito para outro valor e de volta.
--
-- ---------------------------------------------------------------------------
-- Idempotência e volta atrás
-- ---------------------------------------------------------------------------
--
-- **Idempotente.** A segunda execução não encontra linha nenhuma: o que ela
-- apagaria já está `NULL`, e `display_name IS NOT NULL` exclui essas linhas.
-- Rodar dez vezes tem o mesmo efeito de rodar uma.
--
-- **Reversível sem backup.** O valor removido não é informação: é uma cópia de
-- `source_name`, que esta migration não toca e que nada no produto reescreve.
-- Voltar atrás é reconstruir a cópia:
--
--     UPDATE attribute
--        SET display_name = source_name
--      WHERE display_name IS NULL;
--
-- Isso restaura o estado anterior e, por definição, também preenche as colunas
-- criadas depois — que é exatamente o que "voltar ao comportamento antigo"
-- significa. Nenhuma curadoria é afetada nos dois sentidos: as linhas com
-- evento nunca saíram daqui, e o `UPDATE` de volta não as alcança, porque elas
-- não estão nulas.
--
-- ---------------------------------------------------------------------------
-- Por que isto não é cosmético
-- ---------------------------------------------------------------------------
--
-- A exclusão de importação passou a preservar a coluna curada (ver
-- `CURADORIA_DO_ATRIBUTO`, em `lib/ingest/deletion.ts`), e "tem nome gerencial
-- escrito" é um dos sinais de que alguém trabalhou nela. Com toda coluna
-- nascendo com o campo preenchido, esse sinal valeria para todas e não
-- distinguiria nada. Depois desta migration ele volta a significar o que diz.
--
-- O nome de origem não se perde em circunstância nenhuma: ele é `source_name`,
-- que nunca é reescrito, e é por ele — com a aba — que `attribute_alias`
-- reconhece a coluna na importação seguinte.

UPDATE attribute a
   SET display_name = NULL
 WHERE a.display_name IS NOT NULL
   AND a.display_name = a.source_name
   AND NOT EXISTS (
         SELECT 1
           FROM curation_event e
          WHERE e.target_kind = 'ATTRIBUTE'
            AND e.target_id = a.id
            AND e.field = 'display_name'
       );
