-- ---------------------------------------------------------------------------
-- O NOME GERENCIAL VOLTA A NASCER VAZIO.
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
-- nenhum. Quem escreve o campo é `saveMeaning` e a planilha de atributos, e as
-- duas continuam escrevendo igual.
--
-- **O que este UPDATE apaga.** Só o valor que é idêntico ao nome de origem —
-- isto é, só a cópia que a importação fez. Um apelido de verdade difere do
-- nome de origem por definição (é por isso que ele existe), então nenhuma
-- curadoria é perdida aqui. O caso de fronteira — alguém ter digitado à mão
-- exatamente o nome de origem — resulta no mesmo texto na tela, porque é
-- exatamente esse texto que o vazio faz aparecer.
--
-- **Por que isto não é cosmético.** A exclusão de importação passou a preservar
-- a coluna curada (ver `CURADORIA_DO_ATRIBUTO`, em `lib/ingest/deletion.ts`), e
-- "tem nome gerencial escrito" é um dos sinais de que alguém trabalhou nela.
-- Com toda coluna nascendo com o campo preenchido, esse sinal valeria para
-- todas e não distinguiria nada. Depois desta migration ele volta a significar
-- o que diz.
--
-- O nome de origem não se perde em circunstância nenhuma: ele é `source_name`,
-- que nunca é reescrito, e é por ele — com a aba — que `attribute_alias`
-- reconhece a coluna na importação seguinte.

UPDATE attribute
   SET display_name = NULL
 WHERE display_name IS NOT NULL
   AND display_name = source_name;
