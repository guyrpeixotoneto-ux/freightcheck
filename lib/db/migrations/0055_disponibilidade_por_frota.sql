-- O 03.08.18 vira dois relatórios: a frota fixa e as vans.
--
-- **O que isto conserta.** O relatório de disponibilidade sai do Promax em dois
-- arquivos — um da frota de caminhões (`FF`) e outro da frota dedicada
-- (`Van`) —, exportados por pessoas diferentes e em horas diferentes. O produto
-- oferecia uma casinha só, e uma casinha só é uma vigência só: o segundo
-- arquivo a chegar despromovia o primeiro e apagava as linhas dele. A
-- competência ficava com metade do desconto de disponibilidade e nada na tela
-- dizia qual metade tinha sumido — não como aviso, e sim como um total menor.
--
-- Duas fontes resolvem pela raiz: `DISPONIBILIDADE_FF` e `DISPONIBILIDADE_VAN`
-- têm cada uma o seu documento vigente, o seu histórico e a sua pendência. As
-- duas são esperadas nas duas quinzenas, porque as duas descontam nas duas.
--
-- **A chave de repetição passa a incluir o tipo.** `(competência, sha256)`
-- dizia "este arquivo já entrou aqui"; com duas casinhas lendo o mesmo arquivo
-- de duas abas — cada uma a sua frota — a frase deixou de ser verdadeira. A
-- chave vira `(competência, tipo, sha256)`: repetição continua barrada dentro
-- da mesma fonte, e o `.xlsx` com as duas abas pode ser enviado nas duas
-- casinhas sem que a segunda seja recusada como reenvio.
--
-- **Os documentos que já existem são separados pela frota das linhas deles**, e
-- não por palpite sobre o nome do arquivo: o que decide é
-- `fechamento_disponibilidade.tipo_de_frota`, que a importação gravou linha a
-- linha. O documento que trazia as duas abas vira dois — o original fica com a
-- FF, um clone recebe as linhas da van, com os mesmos bytes, o mesmo remetente
-- e a mesma data — e nenhuma linha é apagada no caminho.
--
-- O que **não** é reescrito: `fechamento_apuracao.fontes_presentes` e
-- `fontes_ausentes`. Eles são o retrato do que existia quando aquela apuração
-- rodou, e um retrato que se corrige deixa de ser retrato. A próxima apuração
-- os regrava no vocabulário novo.
--
-- Os gatilhos de competência congelada saem do caminho durante a separação e
-- voltam no fim. Sem isso, toda quinzena já encerrada recusaria a própria
-- migração — e o que este arquivo faz não é escrita nova na conta de ninguém:
-- é a mesma linha, no mesmo lugar, com o documento que a sustenta nomeado pela
-- frota que ela sempre teve.

-- 1. A constraint do tipo sai enquanto o backfill roda: durante ele existem
--    linhas com o nome antigo e linhas com os novos, e nenhuma das duas
--    versões da lista aceitaria as duas.
ALTER TABLE "fechamento_documento" DROP CONSTRAINT IF EXISTS "fechamento_documento_tipo";--> statement-breakpoint

-- 2. A chave de repetição passa a incluir o tipo — antes do backfill, porque é
--    ela que permite o clone da van conviver com o original da FF.
DROP INDEX IF EXISTS "fechamento_documento_sem_repeticao";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fechamento_documento_sem_repeticao" ON "fechamento_documento" USING btree ("competencia_id","tipo","sha256");--> statement-breakpoint

-- 3. Os gatilhos da competência congelada saem do caminho.
ALTER TABLE "fechamento_documento" DISABLE TRIGGER "fechamento_documento_congelada";--> statement-breakpoint
ALTER TABLE "fechamento_disponibilidade" DISABLE TRIGGER "fechamento_disponibilidade_congelada";--> statement-breakpoint

-- 4. O documento que traz as duas frotas vira dois. O clone nasce com as
--    mesmas credenciais do original — competência, arquivo, sha256, remetente,
--    data e vigência — porque ele **é** o mesmo envio, lido pela outra metade.
INSERT INTO "fechamento_documento" (
	"competencia_id", "tipo", "nome_do_arquivo", "sha256", "tamanho_em_bytes",
	"caminho", "linhas_lidas", "recusas", "vigente", "enviado_por", "enviado_em"
)
SELECT
	d."competencia_id", 'DISPONIBILIDADE_VAN', d."nome_do_arquivo", d."sha256",
	d."tamanho_em_bytes", d."caminho", 0, d."recusas", d."vigente",
	d."enviado_por", d."enviado_em"
FROM "fechamento_documento" d
WHERE d."tipo" = 'DISPONIBILIDADE'
	AND EXISTS (
		SELECT 1 FROM "fechamento_disponibilidade" l
		WHERE l."documento_id" = d."id" AND l."tipo_de_frota" = 'FF'
	)
	AND EXISTS (
		SELECT 1 FROM "fechamento_disponibilidade" l
		WHERE l."documento_id" = d."id" AND l."tipo_de_frota" = 'VAN'
	);--> statement-breakpoint

-- 5. Os bytes vão junto: sem eles o clone não teria de onde ser reimportado, e
--    reimportar é o conserto de uma leitura que discorda do arquivo.
INSERT INTO "fechamento_documento_conteudo" ("documento_id", "conteudo", "bytes_originais", "guardado_em")
SELECT clone."id", k."conteudo", k."bytes_originais", k."guardado_em"
FROM "fechamento_documento" clone
JOIN "fechamento_documento" original
	ON original."competencia_id" = clone."competencia_id"
	AND original."sha256" = clone."sha256"
	AND original."tipo" = 'DISPONIBILIDADE'
JOIN "fechamento_documento_conteudo" k ON k."documento_id" = original."id"
WHERE clone."tipo" = 'DISPONIBILIDADE_VAN'
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- 6. As linhas da van passam para o clone. O `documento_id` é o único campo que
--    muda: a linha continua a mesma, na mesma competência, no mesmo dia.
UPDATE "fechamento_disponibilidade" l
SET "documento_id" = clone."id"
FROM "fechamento_documento" clone
JOIN "fechamento_documento" original
	ON original."competencia_id" = clone."competencia_id"
	AND original."sha256" = clone."sha256"
	AND original."tipo" = 'DISPONIBILIDADE'
WHERE clone."tipo" = 'DISPONIBILIDADE_VAN'
	AND l."documento_id" = original."id"
	AND l."tipo_de_frota" = 'VAN';--> statement-breakpoint

-- 7. Cada um passa a declarar as linhas que sustenta. Só os separados: o
--    documento que não sustenta nenhuma linha — o que ficou em quarentena, o
--    que foi substituído — mantém o número que a importação dele leu, porque
--    zerá-lo apagaria o que ele diz sobre o próprio arquivo.
UPDATE "fechamento_documento" d
SET "linhas_lidas" = (
	SELECT count(*) FROM "fechamento_disponibilidade" l WHERE l."documento_id" = d."id"
)
WHERE d."tipo" IN ('DISPONIBILIDADE', 'DISPONIBILIDADE_VAN')
	AND EXISTS (SELECT 1 FROM "fechamento_disponibilidade" l WHERE l."documento_id" = d."id");--> statement-breakpoint

-- 8. O que restou é nomeado pela frota que ele tem dentro. O documento sem
--    linha nenhuma vai para a FF: ele não sustenta desconto de frota nenhuma, e
--    o que se preserva dele é o histórico do envio, não uma conta.
UPDATE "fechamento_documento" d
SET "tipo" = 'DISPONIBILIDADE_VAN'
WHERE d."tipo" = 'DISPONIBILIDADE'
	AND EXISTS (
		SELECT 1 FROM "fechamento_disponibilidade" l
		WHERE l."documento_id" = d."id" AND l."tipo_de_frota" = 'VAN'
	);--> statement-breakpoint
UPDATE "fechamento_documento" SET "tipo" = 'DISPONIBILIDADE_FF' WHERE "tipo" = 'DISPONIBILIDADE';--> statement-breakpoint

-- 9. Os gatilhos voltam.
ALTER TABLE "fechamento_documento" ENABLE TRIGGER "fechamento_documento_congelada";--> statement-breakpoint
ALTER TABLE "fechamento_disponibilidade" ENABLE TRIGGER "fechamento_disponibilidade_congelada";--> statement-breakpoint

-- 10. E a lista fechada volta sem o nome antigo: depois do backfill não existe
--     documento nenhum com ele, e admiti-lo deixaria a porta aberta para um
--     03.08.18 sem frota entrar de novo.
ALTER TABLE "fechamento_documento" ADD CONSTRAINT "fechamento_documento_tipo" CHECK ("fechamento_documento"."tipo" in ('OPERACAO', 'CTE', 'PAGAMENTO', 'DISPONIBILIDADE_FF', 'DISPONIBILIDADE_VAN', 'REQUISICOES', 'CONCILIACAO'));
