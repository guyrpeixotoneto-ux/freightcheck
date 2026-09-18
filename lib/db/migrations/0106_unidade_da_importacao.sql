-- ---------------------------------------------------------------------------
-- A UNIDADE DA IMPORTAÇÃO — o vínculo que a importação deixou de exigir de
-- alguém depois.
-- ---------------------------------------------------------------------------
--
-- **O defeito que esta migration desfaz.** A lateral fala em `scope_hash`; o
-- Fechamento endereça a frota por `unidade.id`. A única ponte entre os dois era
-- `remuneracao_unidade.unidade_id`, e ela só nascia de um cadastro manual — o
-- `POST /remuneracao/unidades`. Quem importava o acervo de CAMAÇARI com
-- CAMAÇARI aberta na lateral não criava ponte nenhuma, e a tela de Ativos e
-- Parados recusava a série mandando associar à mão o que a importação já
-- sabia. O caso real: o acervo inteiro de CAMAÇARI importado, o escopo
-- `07526557001505_CERV` gravado com o CNPJ dentro, e `unidadeDoEscopo`
-- respondendo `SEM_CADASTRO`.
--
-- ---------------------------------------------------------------------------
-- Duas colunas, e cada uma responde uma pergunta diferente
-- ---------------------------------------------------------------------------
--
-- `scope.unidade_id` — **de qual unidade cadastrada é este escopo**. É a ponte,
-- e ela mora em `scope` porque é ali que a importação já escreve: `resolveScopes`
-- cria a linha do escopo a partir da coluna `Unidade - CNPJ` do próprio arquivo.
-- O par (`scope_type`, `code`) é único, então a resposta é do código, não do
-- envio: dois arquivos do mesmo CDD atravessam a mesma ponte.
--
-- `import_run.unidade_id` — **que unidade quem enviou tinha aberta**. É a
-- declaração, irmã de `declared_type`, `declared_period` e `declared_family`: o
-- que a pessoa afirmou, guardado para ser conferido contra o que o arquivo diz.
-- Ela é a autoridade quando o código do arquivo não carrega documento nenhum —
-- `443` não identifica ninguém, e quem estava na tela identifica.
--
-- Sem chave estrangeira nas duas, pela razão da `0076` e da `0077`: uma
-- restrição nova em `scope` ou em `import_run` apareceria na proposta do
-- Publishing. A integridade está em quem grava — a unidade é lida de `unidade`
-- antes de o `id` ser escrito — e na leitura, que junta à esquerda.
--
-- ---------------------------------------------------------------------------
-- O backfill, e por que ele não é adivinhação
-- ---------------------------------------------------------------------------
--
-- As importações anteriores ganham a ponte por **três** faixas, e nenhuma delas
-- compara nome:
--
-- 1. **O CNPJ dentro do código do escopo.** `07526557001505_CERV` traz os
--    catorze dígitos de um documento, e `unidade.cnpj` é único — o documento é
--    a identidade, e não há o que interpretar. É a mesma faixa que
--    `identidade-da-competencia.ts` chama de `CNPJ_NO_CODIGO`, escrita aqui em
--    SQL porque ela roda uma vez sobre o acervo inteiro.
-- 2. **A decisão que uma pessoa já tomou, do lado de Remuneração.** O escopo
--    cujo `scope_hash` já foi associado à mão em `remuneracao_unidade` herda
--    aquela associação: quem disse "este escopo é esta unidade" disse sobre
--    este escopo.
-- 3. **A decisão que uma pessoa já tomou, do lado do Fechamento.** A
--    competência associada a uma unidade com **exatamente o mesmo texto** no
--    `unidade_codigo` responde pelo escopo daquele texto. É a mesma chave, não
--    uma interpretação dela.
--
-- `CAMAÇARI` continua não casando com `CAMAÇARI`. Semelhança de nome, prefixo e
-- nome igual ficam de fora — dois CDDs podem chamar-se igual, e a frota de um
-- sob o nome do outro é o estrago que este produto inteiro se organiza para não
-- cometer. O escopo que nenhuma das duas faixas alcança fica nulo, que é a
-- resposta honesta, e para ele a associação manual continua sendo o caminho.
--
-- O `GROUP BY ... HAVING count(distinct ...) = 1` da segunda e da terceira é o mesmo
-- `LIMIT 1` que `cadastro-porta.ts` recusa: dois cadastros do mesmo escopo
-- apontando para unidades diferentes é erro de alguém, e escolher um em
-- silêncio poria o contrato de uma unidade a responder pelo fechamento de
-- outra. Escopo ambíguo fica nulo, e a tela o nomeia.
--
-- `unidade` nasce vazia e nada aqui a popula — a regra do schema dela continua
-- de pé. Este backfill só liga escopos a cadastros que **já existem**; num banco
-- sem cadastro nenhum ele não escreve uma linha, e é o certo.
-- ---------------------------------------------------------------------------

ALTER TABLE "scope" ADD COLUMN IF NOT EXISTS "unidade_id" uuid;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "unidade_id" uuid;--> statement-breakpoint

-- Faixa 1 — o CNPJ que o próprio código do escopo carrega.
--
-- `regexp_replace(code, '\D', '', 'g')` é o `somenteDigitos` de `lerCnpj` em
-- SQL: `07526557001505_CERV` vira `07526557001505`. O `= 14` recusa o que não
-- tem tamanho de CNPJ antes de comparar; os dígitos verificadores não são
-- reconferidos aqui porque o que fecha a identidade é a igualdade com
-- `unidade.cnpj`, que já é único e já passou por `lerCnpj` quando foi cadastrado.
UPDATE "scope" s
   SET "unidade_id" = u."id"
  FROM "unidade" u
 WHERE s."scope_type" = 'UNIDADE'
   AND s."unidade_id" IS NULL
   AND u."cnpj" IS NOT NULL
   AND length(regexp_replace(s."code", '\D', '', 'g')) = 14
   AND regexp_replace(s."code", '\D', '', 'g') = u."cnpj";--> statement-breakpoint

-- Faixa 2 — a decisão que já foi tomada sobre este escopo, em Remuneração.
--
-- O caminho é o mesmo que a leitura faz: `remuneracao_unidade.scope_hash` →
-- `snapshot.scope_hash` → `snapshot_scope` → `scope`. Só escopo UNIDADE, só
-- quando o `scope_hash` tem uma resposta só, e só sobre o que a faixa 1 deixou
-- nulo — quando as duas respondem, a do documento é a que vale.
UPDATE "scope" s
   SET "unidade_id" = d."unidade_id"
  FROM (
        SELECT sc."id" AS "scope_id", min(ru."unidade_id"::text)::uuid AS "unidade_id"
          FROM "remuneracao_unidade" ru
          JOIN "snapshot" sn ON sn."scope_hash" = ru."scope_hash"
          JOIN "snapshot_scope" ss ON ss."snapshot_id" = sn."id"
          JOIN "scope" sc ON sc."id" = ss."scope_id"
         WHERE ru."unidade_id" IS NOT NULL
           AND sc."scope_type" = 'UNIDADE'
         GROUP BY sc."id"
        HAVING count(DISTINCT ru."unidade_id") = 1
       ) d
 WHERE s."id" = d."scope_id"
   AND s."unidade_id" IS NULL;--> statement-breakpoint

-- Faixa 3 — a decisão já tomada sobre o **mesmo texto**, do lado do Fechamento.
--
-- Uma competência associada a uma unidade é alguém dizendo, por escrito, que
-- aquele `unidade_codigo` é aquela unidade. Quando o código do escopo é
-- exatamente o mesmo texto, é a mesma chave respondida — é a faixa que
-- `identidade-da-competencia.ts` chama de `DECISAO_JA_TOMADA`, lida aqui na
-- direção oposta.
--
-- **Igualdade de texto, e não semelhança.** `07526557001505_CERV` não casa com
-- `07526557001505`, e é o certo: o que esta faixa aproveita é a decisão sobre
-- aquela grafia, não uma interpretação dela. O `HAVING` recusa o texto que duas
-- competências associaram a unidades diferentes, pela razão da faixa 2.
UPDATE "scope" s
   SET "unidade_id" = d."unidade_id"
  FROM (
        SELECT c."unidade_codigo" AS "codigo",
               min(c."unidade_id"::text)::uuid AS "unidade_id"
          FROM "fechamento_competencia" c
         WHERE c."unidade_id" IS NOT NULL
         GROUP BY c."unidade_codigo"
        HAVING count(DISTINCT c."unidade_id") = 1
       ) d
 WHERE s."scope_type" = 'UNIDADE'
   AND s."unidade_id" IS NULL
   AND s."code" = d."codigo";
