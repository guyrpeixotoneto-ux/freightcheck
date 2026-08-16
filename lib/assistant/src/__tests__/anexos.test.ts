import { describe, expect, it } from "vitest";
import { extrairAnexo, lerZip, textoDoXml } from "../anexos";

/**
 * A extração é testada contra arquivos de verdade — zips reais, escritos com o
 * mesmo compressor que o Office usa, e não contra um objeto que finge ser um
 * documento. É a única forma de o teste falhar pelos motivos certos: um leitor
 * de zip que erra o deslocamento do cabeçalho local, ou um XML cujo texto vem
 * partido em várias execuções de formatação, só aparecem no arquivo verdadeiro.
 *
 * As fixtures são mínimas de propósito, e cada uma carrega um caso que já
 * quebrou implementações parecidas: texto partido em dois `<w:t>`, entidade
 * XML escapada, imagem em formato que o modelo não lê no meio das que ele lê,
 * e slides cuja ordem alfabética contradiz a ordem da apresentação.
 */

const DOCX = Buffer.from(
  "UEsDBBQAAAAIAMiqDl1hU7AHhgAAANUAAAARAAAAd29yZC9kb2N1bWVudC54bWxtjsEKwjAQRH9lCehJTD2IUNP24B/4B6uJUkk2Jcna+ve6oFjBy1uYmR3GdFPwcHcp95EatVlXqmvNWNt45uCowMumXI+NmpTop2gfcgdBEpT26PDGuThAYvRgHRgtujDNcrvVdvHj6HfPvOzgkTN7hOyuTBZhiWHYw6Un9H+e9WeS/m5un1BLAwQUAAAACADIqg5dUQ/aAkAAAABFAAAAFQAAAHdvcmQvbWVkaWEvaW1hZ2UxLnBuZ+sM8HPn5ZLiYmBg4PX0cAkC0owgzMEEJCeUB98DUjyeLo4hFXOSf5w/wMDAzMjIcPLfpPdAcQZPVz+XdU4JTQBQSwMEFAAAAAgAyKoOXUphAbMWAAAAFAAAABQAAAB3b3JkL21lZGlhL3RodW1iLmVtZstLzNdN1c3MTUxPzdXNSU3PLEvNAQBQSwECFAMUAAAACADIqg5dYVOwB4YAAADVAAAAEQAAAAAAAAAAAAAAgAEAAAAAd29yZC9kb2N1bWVudC54bWxQSwECFAMUAAAACADIqg5dUQ/aAkAAAABFAAAAFQAAAAAAAAAAAAAAgAG1AAAAd29yZC9tZWRpYS9pbWFnZTEucG5nUEsBAhQDFAAAAAgAyKoOXUphAbMWAAAAFAAAABQAAAAAAAAAAAAAAIABKAEAAHdvcmQvbWVkaWEvdGh1bWIuZW1mUEsFBgAAAAADAAMAxAAAAHABAAAAAA==",
  "base64",
);
const PPTX = Buffer.from(
  "UEsDBBQAAAAIAMiqDl3kBUWsNgAAAD8AAAAVAAAAcHB0L3NsaWRlcy9zbGlkZTEueG1ssymwKs5JUajIzckrtkq0VapQsrNJtCoAESV2AUWZuamZRfkKxTmZKak2+iAxEAmU1gfrswMAUEsDBBQAAAAIAMiqDl0gCbCoNQAAAD4AAAAVAAAAcHB0L3NsaWRlcy9zbGlkZTIueG1ssymwKs5JUajIzckrtkq0VapQsrNJtCoAESV2wanppXkp+QrFOZkpqTb6ICEQCZTVB2uzAwBQSwMEFAAAAAgAyKoOXXJna6s0AAAAPQAAABYAAABwcHQvc2xpZGVzL3NsaWRlMTAueG1ssymwKs5JUajIzckrtkq0VapQsrNJtCoAESV2LqnJmbn5CsU5mSmpNvogERAJlNQH67IDAFBLAwQUAAAACADIqg5drj8hoBAAAAAOAAAAEwAAAHBwdC9tZWRpYS9mb3RvLmpwZWf7f+O/blpiTnG+blZBajoAUEsBAhQDFAAAAAgAyKoOXeQFRaw2AAAAPwAAABUAAAAAAAAAAAAAAIABAAAAAHBwdC9zbGlkZXMvc2xpZGUxLnhtbFBLAQIUAxQAAAAIAMiqDl0gCbCoNQAAAD4AAAAVAAAAAAAAAAAAAACAAWkAAABwcHQvc2xpZGVzL3NsaWRlMi54bWxQSwECFAMUAAAACADIqg5dcmdrqzQAAAA9AAAAFgAAAAAAAAAAAAAAgAHRAAAAcHB0L3NsaWRlcy9zbGlkZTEwLnhtbFBLAQIUAxQAAAAIAMiqDl2uPyGgEAAAAA4AAAATAAAAAAAAAAAAAACAATkBAABwcHQvbWVkaWEvZm90by5qcGVnUEsFBgAAAAAEAAQACwEAAHoBAAAAAA==",
  "base64",
);
/*
  As planilhas são escritas pelo mesmo leitor que as lê, e isso é uma limitação
  declarada: o teste prova que o caminho funciona ponta a ponta num arquivo do
  formato certo — o `.xls` abaixo começa com a assinatura OLE2, não é um zip —,
  e não prova compatibilidade com um arquivo que o Excel de 2003 escreveu. Para
  `.xls` não há alternativa prática: gerar BIFF à mão seria reimplementar o
  formato dentro do teste.
*/
const XLSX_FILE = Buffer.from(
  "UEsDBBQAAAAAAAAAAACkAYS4tQIAALUCAAAaAAAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHM8P3htbCB2ZXJzaW9uPSIxLjAiIGVuY29kaW5nPSJVVEYtOCIgc3RhbmRhbG9uZT0ieWVzIj8+DQo8UmVsYXRpb25zaGlwcyB4bWxucz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3BhY2thZ2UvMjAwNi9yZWxhdGlvbnNoaXBzIj48UmVsYXRpb25zaGlwIElkPSJySWQxIiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzL3dvcmtzaGVldCIgVGFyZ2V0PSJ3b3Jrc2hlZXRzL3NoZWV0MS54bWwiLz48UmVsYXRpb25zaGlwIElkPSJySWQyIiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzL3RoZW1lIiBUYXJnZXQ9InRoZW1lL3RoZW1lMS54bWwiLz48UmVsYXRpb25zaGlwIElkPSJySWQzIiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzL3N0eWxlcyIgVGFyZ2V0PSJzdHlsZXMueG1sIi8+PFJlbGF0aW9uc2hpcCBJZD0icklkNCIgVHlwZT0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL29mZmljZURvY3VtZW50LzIwMDYvcmVsYXRpb25zaGlwcy9zaGVldE1ldGFkYXRhIiBUYXJnZXQ9Im1ldGFkYXRhLnhtbCIvPjwvUmVsYXRpb25zaGlwcz5QSwMEFAAAAAAAAAAAADAPiGveHQAA3h0AABMAAAB4bC90aGVtZS90aGVtZTEueG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pg0KPGE6dGhlbWUgeG1sbnM6YT0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL2RyYXdpbmdtbC8yMDA2L21haW4iIG5hbWU9Ik9mZmljZSBUaGVtZSI+PGE6dGhlbWVFbGVtZW50cz48YTpjbHJTY2hlbWUgbmFtZT0iT2ZmaWNlIj48YTpkazE+PGE6c3lzQ2xyIHZhbD0id2luZG93VGV4dCIgbGFzdENscj0iMDAwMDAwIi8+PC9hOmRrMT48YTpsdDE+PGE6c3lzQ2xyIHZhbD0id2luZG93IiBsYXN0Q2xyPSJGRkZGRkYiLz48L2E6bHQxPjxhOmRrMj48YTpzcmdiQ2xyIHZhbD0iMUY0OTdEIi8+PC9hOmRrMj48YTpsdDI+PGE6c3JnYkNsciB2YWw9IkVFRUNFMSIvPjwvYTpsdDI+PGE6YWNjZW50MT48YTpzcmdiQ2xyIHZhbD0iNEY4MUJEIi8+PC9hOmFjY2VudDE+PGE6YWNjZW50Mj48YTpzcmdiQ2xyIHZhbD0iQzA1MDREIi8+PC9hOmFjY2VudDI+PGE6YWNjZW50Mz48YTpzcmdiQ2xyIHZhbD0iOUJCQjU5Ii8+PC9hOmFjY2VudDM+PGE6YWNjZW50ND48YTpzcmdiQ2xyIHZhbD0iODA2NEEyIi8+PC9hOmFjY2VudDQ+PGE6YWNjZW50NT48YTpzcmdiQ2xyIHZhbD0iNEJBQ0M2Ii8+PC9hOmFjY2VudDU+PGE6YWNjZW50Nj48YTpzcmdiQ2xyIHZhbD0iRjc5NjQ2Ii8+PC9hOmFjY2VudDY+PGE6aGxpbms+PGE6c3JnYkNsciB2YWw9IjAwMDBGRiIvPjwvYTpobGluaz48YTpmb2xIbGluaz48YTpzcmdiQ2xyIHZhbD0iODAwMDgwIi8+PC9hOmZvbEhsaW5rPjwvYTpjbHJTY2hlbWU+PGE6Zm9udFNjaGVtZSBuYW1lPSJPZmZpY2UiPjxhOm1ham9yRm9udD48YTpsYXRpbiB0eXBlZmFjZT0iQ2FtYnJpYSIvPjxhOmVhIHR5cGVmYWNlPSIiLz48YTpjcyB0eXBlZmFjZT0iIi8+PGE6Zm9udCBzY3JpcHQ9IkpwYW4iIHR5cGVmYWNlPSLvvK3vvLMg77yw44K044K344OD44KvIi8+PGE6Zm9udCBzY3JpcHQ9IkhhbmciIHR5cGVmYWNlPSLrp5HsnYAg6rOg65SVIi8+PGE6Zm9udCBzY3JpcHQ9IkhhbnMiIHR5cGVmYWNlPSLlrovkvZMiLz48YTpmb250IHNjcmlwdD0iSGFudCIgdHlwZWZhY2U9IuaWsOe0sOaYjumrlCIvPjxhOmZvbnQgc2NyaXB0PSJBcmFiIiB0eXBlZmFjZT0iVGltZXMgTmV3IFJvbWFuIi8+PGE6Zm9udCBzY3JpcHQ9IkhlYnIiIHR5cGVmYWNlPSJUaW1lcyBOZXcgUm9tYW4iLz48YTpmb250IHNjcmlwdD0iVGhhaSIgdHlwZWZhY2U9IlRhaG9tYSIvPjxhOmZvbnQgc2NyaXB0PSJFdGhpIiB0eXBlZmFjZT0iTnlhbGEiLz48YTpmb250IHNjcmlwdD0iQmVuZyIgdHlwZWZhY2U9IlZyaW5kYSIvPjxhOmZvbnQgc2NyaXB0PSJHdWpyIiB0eXBlZmFjZT0iU2hydXRpIi8+PGE6Zm9udCBzY3JpcHQ9IktobXIiIHR5cGVmYWNlPSJNb29sQm9yYW4iLz48YTpmb250IHNjcmlwdD0iS25kYSIgdHlwZWZhY2U9IlR1bmdhIi8+PGE6Zm9udCBzY3JpcHQ9Ikd1cnUiIHR5cGVmYWNlPSJSYWF2aSIvPjxhOmZvbnQgc2NyaXB0PSJDYW5zIiB0eXBlZmFjZT0iRXVwaGVtaWEiLz48YTpmb250IHNjcmlwdD0iQ2hlciIgdHlwZWZhY2U9IlBsYW50YWdlbmV0IENoZXJva2VlIi8+PGE6Zm9udCBzY3JpcHQ9IllpaWkiIHR5cGVmYWNlPSJNaWNyb3NvZnQgWWkgQmFpdGkiLz48YTpmb250IHNjcmlwdD0iVGlidCIgdHlwZWZhY2U9Ik1pY3Jvc29mdCBIaW1hbGF5YSIvPjxhOmZvbnQgc2NyaXB0PSJUaGFhIiB0eXBlZmFjZT0iTVYgQm9saSIvPjxhOmZvbnQgc2NyaXB0PSJEZXZhIiB0eXBlZmFjZT0iTWFuZ2FsIi8+PGE6Zm9udCBzY3JpcHQ9IlRlbHUiIHR5cGVmYWNlPSJHYXV0YW1pIi8+PGE6Zm9udCBzY3JpcHQ9IlRhbWwiIHR5cGVmYWNlPSJMYXRoYSIvPjxhOmZvbnQgc2NyaXB0PSJTeXJjIiB0eXBlZmFjZT0iRXN0cmFuZ2VsbyBFZGVzc2EiLz48YTpmb250IHNjcmlwdD0iT3J5YSIgdHlwZWZhY2U9IkthbGluZ2EiLz48YTpmb250IHNjcmlwdD0iTWx5bSIgdHlwZWZhY2U9IkthcnRpa2EiLz48YTpmb250IHNjcmlwdD0iTGFvbyIgdHlwZWZhY2U9IkRva0NoYW1wYSIvPjxhOmZvbnQgc2NyaXB0PSJTaW5oIiB0eXBlZmFjZT0iSXNrb29sYSBQb3RhIi8+PGE6Zm9udCBzY3JpcHQ9Ik1vbmciIHR5cGVmYWNlPSJNb25nb2xpYW4gQmFpdGkiLz48YTpmb250IHNjcmlwdD0iVmlldCIgdHlwZWZhY2U9IlRpbWVzIE5ldyBSb21hbiIvPjxhOmZvbnQgc2NyaXB0PSJVaWdoIiB0eXBlZmFjZT0iTWljcm9zb2Z0IFVpZ2h1ciIvPjxhOmZvbnQgc2NyaXB0PSJHZW9yIiB0eXBlZmFjZT0iU3lsZmFlbiIvPjwvYTptYWpvckZvbnQ+PGE6bWlub3JGb250PjxhOmxhdGluIHR5cGVmYWNlPSJDYWxpYnJpIi8+PGE6ZWEgdHlwZWZhY2U9IiIvPjxhOmNzIHR5cGVmYWNlPSIiLz48YTpmb250IHNjcmlwdD0iSnBhbiIgdHlwZWZhY2U9Iu+8re+8syDvvLDjgrTjgrfjg4Pjgq8iLz48YTpmb250IHNjcmlwdD0iSGFuZyIgdHlwZWZhY2U9IuunkeydgCDqs6DrlJUiLz48YTpmb250IHNjcmlwdD0iSGFucyIgdHlwZWZhY2U9IuWui+S9kyIvPjxhOmZvbnQgc2NyaXB0PSJIYW50IiB0eXBlZmFjZT0i5paw57Sw5piO6auUIi8+PGE6Zm9udCBzY3JpcHQ9IkFyYWIiIHR5cGVmYWNlPSJBcmlhbCIvPjxhOmZvbnQgc2NyaXB0PSJIZWJyIiB0eXBlZmFjZT0iQXJpYWwiLz48YTpmb250IHNjcmlwdD0iVGhhaSIgdHlwZWZhY2U9IlRhaG9tYSIvPjxhOmZvbnQgc2NyaXB0PSJFdGhpIiB0eXBlZmFjZT0iTnlhbGEiLz48YTpmb250IHNjcmlwdD0iQmVuZyIgdHlwZWZhY2U9IlZyaW5kYSIvPjxhOmZvbnQgc2NyaXB0PSJHdWpyIiB0eXBlZmFjZT0iU2hydXRpIi8+PGE6Zm9udCBzY3JpcHQ9IktobXIiIHR5cGVmYWNlPSJEYXVuUGVuaCIvPjxhOmZvbnQgc2NyaXB0PSJLbmRhIiB0eXBlZmFjZT0iVHVuZ2EiLz48YTpmb250IHNjcmlwdD0iR3VydSIgdHlwZWZhY2U9IlJhYXZpIi8+PGE6Zm9udCBzY3JpcHQ9IkNhbnMiIHR5cGVmYWNlPSJFdXBoZW1pYSIvPjxhOmZvbnQgc2NyaXB0PSJDaGVyIiB0eXBlZmFjZT0iUGxhbnRhZ2VuZXQgQ2hlcm9rZWUiLz48YTpmb250IHNjcmlwdD0iWWlpaSIgdHlwZWZhY2U9Ik1pY3Jvc29mdCBZaSBCYWl0aSIvPjxhOmZvbnQgc2NyaXB0PSJUaWJ0IiB0eXBlZmFjZT0iTWljcm9zb2Z0IEhpbWFsYXlhIi8+PGE6Zm9udCBzY3JpcHQ9IlRoYWEiIHR5cGVmYWNlPSJNViBCb2xpIi8+PGE6Zm9udCBzY3JpcHQ9IkRldmEiIHR5cGVmYWNlPSJNYW5nYWwiLz48YTpmb250IHNjcmlwdD0iVGVsdSIgdHlwZWZhY2U9IkdhdXRhbWkiLz48YTpmb250IHNjcmlwdD0iVGFtbCIgdHlwZWZhY2U9IkxhdGhhIi8+PGE6Zm9udCBzY3JpcHQ9IlN5cmMiIHR5cGVmYWNlPSJFc3RyYW5nZWxvIEVkZXNzYSIvPjxhOmZvbnQgc2NyaXB0PSJPcnlhIiB0eXBlZmFjZT0iS2FsaW5nYSIvPjxhOmZvbnQgc2NyaXB0PSJNbHltIiB0eXBlZmFjZT0iS2FydGlrYSIvPjxhOmZvbnQgc2NyaXB0PSJMYW9vIiB0eXBlZmFjZT0iRG9rQ2hhbXBhIi8+PGE6Zm9udCBzY3JpcHQ9IlNpbmgiIHR5cGVmYWNlPSJJc2tvb2xhIFBvdGEiLz48YTpmb250IHNjcmlwdD0iTW9uZyIgdHlwZWZhY2U9Ik1vbmdvbGlhbiBCYWl0aSIvPjxhOmZvbnQgc2NyaXB0PSJWaWV0IiB0eXBlZmFjZT0iQXJpYWwiLz48YTpmb250IHNjcmlwdD0iVWlnaCIgdHlwZWZhY2U9Ik1pY3Jvc29mdCBVaWdodXIiLz48YTpmb250IHNjcmlwdD0iR2VvciIgdHlwZWZhY2U9IlN5bGZhZW4iLz48L2E6bWlub3JGb250PjwvYTpmb250U2NoZW1lPjxhOmZtdFNjaGVtZSBuYW1lPSJPZmZpY2UiPjxhOmZpbGxTdHlsZUxzdD48YTpzb2xpZEZpbGw+PGE6c2NoZW1lQ2xyIHZhbD0icGhDbHIiLz48L2E6c29saWRGaWxsPjxhOmdyYWRGaWxsIHJvdFdpdGhTaGFwZT0iMSI+PGE6Z3NMc3Q+PGE6Z3MgcG9zPSIwIj48YTpzY2hlbWVDbHIgdmFsPSJwaENsciI+PGE6dGludCB2YWw9IjUwMDAwIi8+PGE6c2F0TW9kIHZhbD0iMzAwMDAwIi8+PC9hOnNjaGVtZUNscj48L2E6Z3M+PGE6Z3MgcG9zPSIzNTAwMCI+PGE6c2NoZW1lQ2xyIHZhbD0icGhDbHIiPjxhOnRpbnQgdmFsPSIzNzAwMCIvPjxhOnNhdE1vZCB2YWw9IjMwMDAwMCIvPjwvYTpzY2hlbWVDbHI+PC9hOmdzPjxhOmdzIHBvcz0iMTAwMDAwIj48YTpzY2hlbWVDbHIgdmFsPSJwaENsciI+PGE6dGludCB2YWw9IjE1MDAwIi8+PGE6c2F0TW9kIHZhbD0iMzUwMDAwIi8+PC9hOnNjaGVtZUNscj48L2E6Z3M+PC9hOmdzTHN0PjxhOmxpbiBhbmc9IjE2MjAwMDAwIiBzY2FsZWQ9IjEiLz48L2E6Z3JhZEZpbGw+PGE6Z3JhZEZpbGwgcm90V2l0aFNoYXBlPSIxIj48YTpnc0xzdD48YTpncyBwb3M9IjAiPjxhOnNjaGVtZUNsciB2YWw9InBoQ2xyIj48YTp0aW50IHZhbD0iMTAwMDAwIi8+PGE6c2hhZGUgdmFsPSIxMDAwMDAiLz48YTpzYXRNb2QgdmFsPSIxMzAwMDAiLz48L2E6c2NoZW1lQ2xyPjwvYTpncz48YTpncyBwb3M9IjEwMDAwMCI+PGE6c2NoZW1lQ2xyIHZhbD0icGhDbHIiPjxhOnRpbnQgdmFsPSI1MDAwMCIvPjxhOnNoYWRlIHZhbD0iMTAwMDAwIi8+PGE6c2F0TW9kIHZhbD0iMzUwMDAwIi8+PC9hOnNjaGVtZUNscj48L2E6Z3M+PC9hOmdzTHN0PjxhOmxpbiBhbmc9IjE2MjAwMDAwIiBzY2FsZWQ9IjAiLz48L2E6Z3JhZEZpbGw+PC9hOmZpbGxTdHlsZUxzdD48YTpsblN0eWxlTHN0PjxhOmxuIHc9Ijk1MjUiIGNhcD0iZmxhdCIgY21wZD0ic25nIiBhbGduPSJjdHIiPjxhOnNvbGlkRmlsbD48YTpzY2hlbWVDbHIgdmFsPSJwaENsciI+PGE6c2hhZGUgdmFsPSI5NTAwMCIvPjxhOnNhdE1vZCB2YWw9IjEwNTAwMCIvPjwvYTpzY2hlbWVDbHI+PC9hOnNvbGlkRmlsbD48YTpwcnN0RGFzaCB2YWw9InNvbGlkIi8+PC9hOmxuPjxhOmxuIHc9IjI1NDAwIiBjYXA9ImZsYXQiIGNtcGQ9InNuZyIgYWxnbj0iY3RyIj48YTpzb2xpZEZpbGw+PGE6c2NoZW1lQ2xyIHZhbD0icGhDbHIiLz48L2E6c29saWRGaWxsPjxhOnByc3REYXNoIHZhbD0ic29saWQiLz48L2E6bG4+PGE6bG4gdz0iMzgxMDAiIGNhcD0iZmxhdCIgY21wZD0ic25nIiBhbGduPSJjdHIiPjxhOnNvbGlkRmlsbD48YTpzY2hlbWVDbHIgdmFsPSJwaENsciIvPjwvYTpzb2xpZEZpbGw+PGE6cHJzdERhc2ggdmFsPSJzb2xpZCIvPjwvYTpsbj48L2E6bG5TdHlsZUxzdD48YTplZmZlY3RTdHlsZUxzdD48YTplZmZlY3RTdHlsZT48YTplZmZlY3RMc3Q+PGE6b3V0ZXJTaGR3IGJsdXJSYWQ9IjQwMDAwIiBkaXN0PSIyMDAwMCIgZGlyPSI1NDAwMDAwIiByb3RXaXRoU2hhcGU9IjAiPjxhOnNyZ2JDbHIgdmFsPSIwMDAwMDAiPjxhOmFscGhhIHZhbD0iMzgwMDAiLz48L2E6c3JnYkNscj48L2E6b3V0ZXJTaGR3PjwvYTplZmZlY3RMc3Q+PC9hOmVmZmVjdFN0eWxlPjxhOmVmZmVjdFN0eWxlPjxhOmVmZmVjdExzdD48YTpvdXRlclNoZHcgYmx1clJhZD0iNDAwMDAiIGRpc3Q9IjIzMDAwIiBkaXI9IjU0MDAwMDAiIHJvdFdpdGhTaGFwZT0iMCI+PGE6c3JnYkNsciB2YWw9IjAwMDAwMCI+PGE6YWxwaGEgdmFsPSIzNTAwMCIvPjwvYTpzcmdiQ2xyPjwvYTpvdXRlclNoZHc+PC9hOmVmZmVjdExzdD48L2E6ZWZmZWN0U3R5bGU+PGE6ZWZmZWN0U3R5bGU+PGE6ZWZmZWN0THN0PjxhOm91dGVyU2hkdyBibHVyUmFkPSI0MDAwMCIgZGlzdD0iMjMwMDAiIGRpcj0iNTQwMDAwMCIgcm90V2l0aFNoYXBlPSIwIj48YTpzcmdiQ2xyIHZhbD0iMDAwMDAwIj48YTphbHBoYSB2YWw9IjM1MDAwIi8+PC9hOnNyZ2JDbHI+PC9hOm91dGVyU2hkdz48L2E6ZWZmZWN0THN0PjxhOnNjZW5lM2Q+PGE6Y2FtZXJhIHByc3Q9Im9ydGhvZ3JhcGhpY0Zyb250Ij48YTpyb3QgbGF0PSIwIiBsb249IjAiIHJldj0iMCIvPjwvYTpjYW1lcmE+PGE6bGlnaHRSaWcgcmlnPSJ0aHJlZVB0IiBkaXI9InQiPjxhOnJvdCBsYXQ9IjAiIGxvbj0iMCIgcmV2PSIxMjAwMDAwIi8+PC9hOmxpZ2h0UmlnPjwvYTpzY2VuZTNkPjxhOnNwM2Q+PGE6YmV2ZWxUIHc9IjYzNTAwIiBoPSIyNTQwMCIvPjwvYTpzcDNkPjwvYTplZmZlY3RTdHlsZT48L2E6ZWZmZWN0U3R5bGVMc3Q+PGE6YmdGaWxsU3R5bGVMc3Q+PGE6c29saWRGaWxsPjxhOnNjaGVtZUNsciB2YWw9InBoQ2xyIi8+PC9hOnNvbGlkRmlsbD48YTpncmFkRmlsbCByb3RXaXRoU2hhcGU9IjEiPjxhOmdzTHN0PjxhOmdzIHBvcz0iMCI+PGE6c2NoZW1lQ2xyIHZhbD0icGhDbHIiPjxhOnRpbnQgdmFsPSI0MDAwMCIvPjxhOnNhdE1vZCB2YWw9IjM1MDAwMCIvPjwvYTpzY2hlbWVDbHI+PC9hOmdzPjxhOmdzIHBvcz0iNDAwMDAiPjxhOnNjaGVtZUNsciB2YWw9InBoQ2xyIj48YTp0aW50IHZhbD0iNDUwMDAiLz48YTpzaGFkZSB2YWw9Ijk5MDAwIi8+PGE6c2F0TW9kIHZhbD0iMzUwMDAwIi8+PC9hOnNjaGVtZUNscj48L2E6Z3M+PGE6Z3MgcG9zPSIxMDAwMDAiPjxhOnNjaGVtZUNsciB2YWw9InBoQ2xyIj48YTpzaGFkZSB2YWw9IjIwMDAwIi8+PGE6c2F0TW9kIHZhbD0iMjU1MDAwIi8+PC9hOnNjaGVtZUNscj48L2E6Z3M+PC9hOmdzTHN0PjxhOnBhdGggcGF0aD0iY2lyY2xlIj48YTpmaWxsVG9SZWN0IGw9IjUwMDAwIiB0PSItODAwMDAiIHI9IjUwMDAwIiBiPSIxODAwMDAiLz48L2E6cGF0aD48L2E6Z3JhZEZpbGw+PGE6Z3JhZEZpbGwgcm90V2l0aFNoYXBlPSIxIj48YTpnc0xzdD48YTpncyBwb3M9IjAiPjxhOnNjaGVtZUNsciB2YWw9InBoQ2xyIj48YTp0aW50IHZhbD0iODAwMDAiLz48YTpzYXRNb2QgdmFsPSIzMDAwMDAiLz48L2E6c2NoZW1lQ2xyPjwvYTpncz48YTpncyBwb3M9IjEwMDAwMCI+PGE6c2NoZW1lQ2xyIHZhbD0icGhDbHIiPjxhOnNoYWRlIHZhbD0iMzAwMDAiLz48YTpzYXRNb2QgdmFsPSIyMDAwMDAiLz48L2E6c2NoZW1lQ2xyPjwvYTpncz48L2E6Z3NMc3Q+PGE6cGF0aCBwYXRoPSJjaXJjbGUiPjxhOmZpbGxUb1JlY3QgbD0iNTAwMDAiIHQ9IjUwMDAwIiByPSI1MDAwMCIgYj0iNTAwMDAiLz48L2E6cGF0aD48L2E6Z3JhZEZpbGw+PC9hOmJnRmlsbFN0eWxlTHN0PjwvYTpmbXRTY2hlbWU+PC9hOnRoZW1lRWxlbWVudHM+PGE6b2JqZWN0RGVmYXVsdHM+PGE6c3BEZWY+PGE6c3BQci8+PGE6Ym9keVByLz48YTpsc3RTdHlsZS8+PGE6c3R5bGU+PGE6bG5SZWYgaWR4PSIxIj48YTpzY2hlbWVDbHIgdmFsPSJhY2NlbnQxIi8+PC9hOmxuUmVmPjxhOmZpbGxSZWYgaWR4PSIzIj48YTpzY2hlbWVDbHIgdmFsPSJhY2NlbnQxIi8+PC9hOmZpbGxSZWY+PGE6ZWZmZWN0UmVmIGlkeD0iMiI+PGE6c2NoZW1lQ2xyIHZhbD0iYWNjZW50MSIvPjwvYTplZmZlY3RSZWY+PGE6Zm9udFJlZiBpZHg9Im1pbm9yIj48YTpzY2hlbWVDbHIgdmFsPSJsdDEiLz48L2E6Zm9udFJlZj48L2E6c3R5bGU+PC9hOnNwRGVmPjxhOmxuRGVmPjxhOnNwUHIvPjxhOmJvZHlQci8+PGE6bHN0U3R5bGUvPjxhOnN0eWxlPjxhOmxuUmVmIGlkeD0iMiI+PGE6c2NoZW1lQ2xyIHZhbD0iYWNjZW50MSIvPjwvYTpsblJlZj48YTpmaWxsUmVmIGlkeD0iMCI+PGE6c2NoZW1lQ2xyIHZhbD0iYWNjZW50MSIvPjwvYTpmaWxsUmVmPjxhOmVmZmVjdFJlZiBpZHg9IjEiPjxhOnNjaGVtZUNsciB2YWw9ImFjY2VudDEiLz48L2E6ZWZmZWN0UmVmPjxhOmZvbnRSZWYgaWR4PSJtaW5vciI+PGE6c2NoZW1lQ2xyIHZhbD0idHgxIi8+PC9hOmZvbnRSZWY+PC9hOnN0eWxlPjwvYTpsbkRlZj48L2E6b2JqZWN0RGVmYXVsdHM+PGE6ZXh0cmFDbHJTY2hlbWVMc3QvPjwvYTp0aGVtZT5QSwMEFAAAAAAAAAAAAFX0BJRaBAAAWgQAAA0AAAB4bC9zdHlsZXMueG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pg0KPHN0eWxlU2hlZXQgeG1sbnM9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9zcHJlYWRzaGVldG1sLzIwMDYvbWFpbiIgeG1sbnM6dnQ9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9vZmZpY2VEb2N1bWVudC8yMDA2L2RvY1Byb3BzVlR5cGVzIj48bnVtRm10cyBjb3VudD0iMSI+PG51bUZtdCBudW1GbXRJZD0iNTYiIGZvcm1hdENvZGU9IiZxdW90O+S4iuWNiC/kuIvljYggJnF1b3Q7aGgmcXVvdDvmmYImcXVvdDttbSZxdW90O+WIhiZxdW90O3NzJnF1b3Q756eSICZxdW90OyIvPjwvbnVtRm10cz48Zm9udHMgY291bnQ9IjEiPjxmb250PjxzeiB2YWw9IjEyIi8+PGNvbG9yIHRoZW1lPSIxIi8+PG5hbWUgdmFsPSJDYWxpYnJpIi8+PGZhbWlseSB2YWw9IjIiLz48c2NoZW1lIHZhbD0ibWlub3IiLz48L2ZvbnQ+PC9mb250cz48ZmlsbHMgY291bnQ9IjIiPjxmaWxsPjxwYXR0ZXJuRmlsbCBwYXR0ZXJuVHlwZT0ibm9uZSIvPjwvZmlsbD48ZmlsbD48cGF0dGVybkZpbGwgcGF0dGVyblR5cGU9ImdyYXkxMjUiLz48L2ZpbGw+PC9maWxscz48Ym9yZGVycyBjb3VudD0iMSI+PGJvcmRlcj48bGVmdC8+PHJpZ2h0Lz48dG9wLz48Ym90dG9tLz48ZGlhZ29uYWwvPjwvYm9yZGVyPjwvYm9yZGVycz48Y2VsbFN0eWxlWGZzIGNvdW50PSIxIj48eGYgbnVtRm10SWQ9IjAiIGZvbnRJZD0iMCIgZmlsbElkPSIwIiBib3JkZXJJZD0iMCIvPjwvY2VsbFN0eWxlWGZzPjxjZWxsWGZzIGNvdW50PSIxIj48eGYgbnVtRm10SWQ9IjAiIGZvbnRJZD0iMCIgZmlsbElkPSIwIiBib3JkZXJJZD0iMCIgeGZJZD0iMCIgYXBwbHlOdW1iZXJGb3JtYXQ9IjEiLz48L2NlbGxYZnM+PGNlbGxTdHlsZXMgY291bnQ9IjEiPjxjZWxsU3R5bGUgbmFtZT0iTm9ybWFsIiB4ZklkPSIwIiBidWlsdGluSWQ9IjAiLz48L2NlbGxTdHlsZXM+PGR4ZnMgY291bnQ9IjAiLz48dGFibGVTdHlsZXMgY291bnQ9IjAiIGRlZmF1bHRUYWJsZVN0eWxlPSJUYWJsZVN0eWxlTWVkaXVtOSIgZGVmYXVsdFBpdm90U3R5bGU9IlBpdm90U3R5bGVNZWRpdW00Ii8+PC9zdHlsZVNoZWV0PlBLAwQUAAAAAAAAAAAAVLBpUj4CAAA+AgAAGAAAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04IiBzdGFuZGFsb25lPSJ5ZXMiPz4NCjx3b3Jrc2hlZXQgeG1sbnM9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9zcHJlYWRzaGVldG1sLzIwMDYvbWFpbiIgeG1sbnM6cj0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL29mZmljZURvY3VtZW50LzIwMDYvcmVsYXRpb25zaGlwcyI+PGRpbWVuc2lvbiByZWY9IkExOkIyIi8+PHNoZWV0Vmlld3M+PHNoZWV0VmlldyB3b3JrYm9va1ZpZXdJZD0iMCIvPjwvc2hlZXRWaWV3cz48c2hlZXREYXRhPjxyb3cgcj0iMSI+PGMgcj0iQTEiIHQ9InN0ciI+PHY+UGxhY2E8L3Y+PC9jPjxjIHI9IkIxIiB0PSJzdHIiPjx2PklQVkE8L3Y+PC9jPjwvcm93Pjxyb3cgcj0iMiI+PGMgcj0iQTIiIHQ9InN0ciI+PHY+QUJDMUQyMzwvdj48L2M+PGMgcj0iQjIiPjx2PjEyMzQuNTwvdj48L2M+PC9yb3c+PC9zaGVldERhdGE+PGlnbm9yZWRFcnJvcnM+PGlnbm9yZWRFcnJvciBudW1iZXJTdG9yZWRBc1RleHQ9IjEiIHNxcmVmPSJBMTpCMiIvPjwvaWdub3JlZEVycm9ycz48L3dvcmtzaGVldD5QSwMEFAAAAAAAAAAAAGCAAIGIAwAAiAMAAA8AAAB4bC9tZXRhZGF0YS54bWw8P3htbCB2ZXJzaW9uPSIxLjAiIGVuY29kaW5nPSJVVEYtOCIgc3RhbmRhbG9uZT0ieWVzIj8+DQo8bWV0YWRhdGEgeG1sbnM9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9zcHJlYWRzaGVldG1sLzIwMDYvbWFpbiIgeG1sbnM6eGxyZD0iaHR0cDovL3NjaGVtYXMubWljcm9zb2Z0LmNvbS9vZmZpY2Uvc3ByZWFkc2hlZXRtbC8yMDE3L3JpY2hkYXRhIiB4bWxuczp4ZGE9Imh0dHA6Ly9zY2hlbWFzLm1pY3Jvc29mdC5jb20vb2ZmaWNlL3NwcmVhZHNoZWV0bWwvMjAxNy9keW5hbWljYXJyYXkiPgogIDxtZXRhZGF0YVR5cGVzIGNvdW50PSIxIj4KICAgIDxtZXRhZGF0YVR5cGUgbmFtZT0iWExEQVBSIiBtaW5TdXBwb3J0ZWRWZXJzaW9uPSIxMjAwMDAiIGNvcHk9IjEiIHBhc3RlQWxsPSIxIiBwYXN0ZVZhbHVlcz0iMSIgbWVyZ2U9IjEiIHNwbGl0Rmlyc3Q9IjEiIHJvd0NvbFNoaWZ0PSIxIiBjbGVhckZvcm1hdHM9IjEiIGNsZWFyQ29tbWVudHM9IjEiIGFzc2lnbj0iMSIgY29lcmNlPSIxIiBjZWxsTWV0YT0iMSIvPgogIDwvbWV0YWRhdGFUeXBlcz4KICA8ZnV0dXJlTWV0YWRhdGEgbmFtZT0iWExEQVBSIiBjb3VudD0iMSI+CiAgICA8Yms+CiAgICAgIDxleHRMc3Q+CiAgICAgICAgPGV4dCB1cmk9IntiZGJiOGNkYy1mYTFlLTQ5NmUtYTg1Ny0zYzNmMzBjMDI5YzN9Ij4KICAgICAgICAgIDx4ZGE6ZHluYW1pY0FycmF5UHJvcGVydGllcyBmRHluYW1pYz0iMSIgZkNvbGxhcHNlZD0iMCIvPgogICAgICAgIDwvZXh0PgogICAgICA8L2V4dExzdD4KICAgIDwvYms+CiAgPC9mdXR1cmVNZXRhZGF0YT4KICA8Y2VsbE1ldGFkYXRhIGNvdW50PSIxIj4KICAgIDxiaz4KICAgICAgPHJjIHQ9IjEiIHY9IjAiLz4KICAgIDwvYms+CiAgPC9jZWxsTWV0YWRhdGE+CjwvbWV0YWRhdGE+UEsDBBQAAAAAAAAAAACarCYQQQEAAEEBAAAPAAAAeGwvd29ya2Jvb2sueG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pg0KPHdvcmtib29rIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvc3ByZWFkc2hlZXRtbC8yMDA2L21haW4iIHhtbG5zOnI9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9vZmZpY2VEb2N1bWVudC8yMDA2L3JlbGF0aW9uc2hpcHMiPjx3b3JrYm9va1ByIGNvZGVOYW1lPSJUaGlzV29ya2Jvb2siLz48c2hlZXRzPjxzaGVldCBuYW1lPSJGcm90YSIgc2hlZXRJZD0iMSIgcjppZD0icklkMSIvPjwvc2hlZXRzPjwvd29ya2Jvb2s+UEsDBBQAAAAAAAAAAABKahH5TAIAAEwCAAALAAAAX3JlbHMvLnJlbHM8P3htbCB2ZXJzaW9uPSIxLjAiIGVuY29kaW5nPSJVVEYtOCIgc3RhbmRhbG9uZT0ieWVzIj8+DQo8UmVsYXRpb25zaGlwcyB4bWxucz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3BhY2thZ2UvMjAwNi9yZWxhdGlvbnNoaXBzIj48UmVsYXRpb25zaGlwIElkPSJySWQyIiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFja2FnZS8yMDA2L3JlbGF0aW9uc2hpcHMvbWV0YWRhdGEvY29yZS1wcm9wZXJ0aWVzIiBUYXJnZXQ9ImRvY1Byb3BzL2NvcmUueG1sIi8+PFJlbGF0aW9uc2hpcCBJZD0icklkMyIgVHlwZT0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL29mZmljZURvY3VtZW50LzIwMDYvcmVsYXRpb25zaGlwcy9leHRlbmRlZC1wcm9wZXJ0aWVzIiBUYXJnZXQ9ImRvY1Byb3BzL2FwcC54bWwiLz48UmVsYXRpb25zaGlwIElkPSJySWQxIiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzL29mZmljZURvY3VtZW50IiBUYXJnZXQ9InhsL3dvcmtib29rLnhtbCIvPjwvUmVsYXRpb25zaGlwcz5QSwMEFAAAAAAAAAAAADKQisUxAgAAMQIAABAAAABkb2NQcm9wcy9hcHAueG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pg0KPFByb3BlcnRpZXMgeG1sbnM9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9vZmZpY2VEb2N1bWVudC8yMDA2L2V4dGVuZGVkLXByb3BlcnRpZXMiIHhtbG5zOnZ0PSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9kb2NQcm9wc1ZUeXBlcyI+PEFwcGxpY2F0aW9uPlNoZWV0SlM8L0FwcGxpY2F0aW9uPjxIZWFkaW5nUGFpcnM+PHZ0OnZlY3RvciBzaXplPSIyIiBiYXNlVHlwZT0idmFyaWFudCI+PHZ0OnZhcmlhbnQ+PHZ0Omxwc3RyPldvcmtzaGVldHM8L3Z0Omxwc3RyPjwvdnQ6dmFyaWFudD48dnQ6dmFyaWFudD48dnQ6aTQ+MTwvdnQ6aTQ+PC92dDp2YXJpYW50PjwvdnQ6dmVjdG9yPjwvSGVhZGluZ1BhaXJzPjxUaXRsZXNPZlBhcnRzPjx2dDp2ZWN0b3Igc2l6ZT0iMSIgYmFzZVR5cGU9Imxwc3RyIj48dnQ6bHBzdHI+RnJvdGE8L3Z0Omxwc3RyPjwvdnQ6dmVjdG9yPjwvVGl0bGVzT2ZQYXJ0cz48L1Byb3BlcnRpZXM+UEsDBBQAAAAAAAAAAADWknwRWgEAAFoBAAARAAAAZG9jUHJvcHMvY29yZS54bWw8P3htbCB2ZXJzaW9uPSIxLjAiIGVuY29kaW5nPSJVVEYtOCIgc3RhbmRhbG9uZT0ieWVzIj8+DQo8Y3A6Y29yZVByb3BlcnRpZXMgeG1sbnM6Y3A9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9wYWNrYWdlLzIwMDYvbWV0YWRhdGEvY29yZS1wcm9wZXJ0aWVzIiB4bWxuczpkYz0iaHR0cDovL3B1cmwub3JnL2RjL2VsZW1lbnRzLzEuMS8iIHhtbG5zOmRjdGVybXM9Imh0dHA6Ly9wdXJsLm9yZy9kYy90ZXJtcy8iIHhtbG5zOmRjbWl0eXBlPSJodHRwOi8vcHVybC5vcmcvZGMvZGNtaXR5cGUvIiB4bWxuczp4c2k9Imh0dHA6Ly93d3cudzMub3JnLzIwMDEvWE1MU2NoZW1hLWluc3RhbmNlIi8+UEsDBBQAAAAAAAAAAACo12qAFQgAABUIAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04IiBzdGFuZGFsb25lPSJ5ZXMiPz4NCjxUeXBlcyB4bWxucz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3BhY2thZ2UvMjAwNi9jb250ZW50LXR5cGVzIiB4bWxuczp4c2Q9Imh0dHA6Ly93d3cudzMub3JnLzIwMDEvWE1MU2NoZW1hIiB4bWxuczp4c2k9Imh0dHA6Ly93d3cudzMub3JnLzIwMDEvWE1MU2NoZW1hLWluc3RhbmNlIj48RGVmYXVsdCBFeHRlbnNpb249InhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3htbCIvPjxEZWZhdWx0IEV4dGVuc2lvbj0iYmluIiBDb250ZW50VHlwZT0iYXBwbGljYXRpb24vdm5kLm1zLWV4Y2VsLnNoZWV0LmJpbmFyeS5tYWNyb0VuYWJsZWQubWFpbiIvPjxEZWZhdWx0IEV4dGVuc2lvbj0idm1sIiBDb250ZW50VHlwZT0iYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnZtbERyYXdpbmciLz48RGVmYXVsdCBFeHRlbnNpb249ImRhdGEiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQubW9kZWwrZGF0YSIvPjxEZWZhdWx0IEV4dGVuc2lvbj0iYm1wIiBDb250ZW50VHlwZT0iaW1hZ2UvYm1wIi8+PERlZmF1bHQgRXh0ZW5zaW9uPSJwbmciIENvbnRlbnRUeXBlPSJpbWFnZS9wbmciLz48RGVmYXVsdCBFeHRlbnNpb249ImdpZiIgQ29udGVudFR5cGU9ImltYWdlL2dpZiIvPjxEZWZhdWx0IEV4dGVuc2lvbj0iZW1mIiBDb250ZW50VHlwZT0iaW1hZ2UveC1lbWYiLz48RGVmYXVsdCBFeHRlbnNpb249IndtZiIgQ29udGVudFR5cGU9ImltYWdlL3gtd21mIi8+PERlZmF1bHQgRXh0ZW5zaW9uPSJqcGciIENvbnRlbnRUeXBlPSJpbWFnZS9qcGVnIi8+PERlZmF1bHQgRXh0ZW5zaW9uPSJqcGVnIiBDb250ZW50VHlwZT0iaW1hZ2UvanBlZyIvPjxEZWZhdWx0IEV4dGVuc2lvbj0idGlmIiBDb250ZW50VHlwZT0iaW1hZ2UvdGlmZiIvPjxEZWZhdWx0IEV4dGVuc2lvbj0idGlmZiIgQ29udGVudFR5cGU9ImltYWdlL3RpZmYiLz48RGVmYXVsdCBFeHRlbnNpb249InBkZiIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3BkZiIvPjxEZWZhdWx0IEV4dGVuc2lvbj0icmVscyIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1wYWNrYWdlLnJlbGF0aW9uc2hpcHMreG1sIi8+PE92ZXJyaWRlIFBhcnROYW1lPSIveGwvd29ya2Jvb2sueG1sIiBDb250ZW50VHlwZT0iYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc2hlZXQubWFpbit4bWwiLz48T3ZlcnJpZGUgUGFydE5hbWU9Ii94bC93b3Jrc2hlZXRzL3NoZWV0MS54bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC53b3Jrc2hlZXQreG1sIi8+PE92ZXJyaWRlIFBhcnROYW1lPSIveGwvdGhlbWUvdGhlbWUxLnhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC50aGVtZSt4bWwiLz48T3ZlcnJpZGUgUGFydE5hbWU9Ii94bC9zdHlsZXMueG1sIiBDb250ZW50VHlwZT0iYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNwcmVhZHNoZWV0bWwuc3R5bGVzK3htbCIvPjxPdmVycmlkZSBQYXJ0TmFtZT0iL2RvY1Byb3BzL2NvcmUueG1sIiBDb250ZW50VHlwZT0iYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLXBhY2thZ2UuY29yZS1wcm9wZXJ0aWVzK3htbCIvPjxPdmVycmlkZSBQYXJ0TmFtZT0iL2RvY1Byb3BzL2FwcC54bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuZXh0ZW5kZWQtcHJvcGVydGllcyt4bWwiLz48T3ZlcnJpZGUgUGFydE5hbWU9Ii94bC9tZXRhZGF0YS54bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldE1ldGFkYXRhK3htbCIvPjwvVHlwZXM+UEsBAgAAFAAAAAAAAAAAAKQBhLi1AgAAtQIAABoAAAAAAAAAAAAAAAAAAAAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzUEsBAgAAFAAAAAAAAAAAADAPiGveHQAA3h0AABMAAAAAAAAAAAAAAAAA7QIAAHhsL3RoZW1lL3RoZW1lMS54bWxQSwECAAAUAAAAAAAAAAAAVfQElFoEAABaBAAADQAAAAAAAAAAAAAAAAD8IAAAeGwvc3R5bGVzLnhtbFBLAQIAABQAAAAAAAAAAABUsGlSPgIAAD4CAAAYAAAAAAAAAAAAAAAAAIElAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWxQSwECAAAUAAAAAAAAAAAAYIAAgYgDAACIAwAADwAAAAAAAAAAAAAAAAD1JwAAeGwvbWV0YWRhdGEueG1sUEsBAgAAFAAAAAAAAAAAAJqsJhBBAQAAQQEAAA8AAAAAAAAAAAAAAAAAqisAAHhsL3dvcmtib29rLnhtbFBLAQIAABQAAAAAAAAAAABKahH5TAIAAEwCAAALAAAAAAAAAAAAAAAAABgtAABfcmVscy8ucmVsc1BLAQIAABQAAAAAAAAAAAAykIrFMQIAADECAAAQAAAAAAAAAAAAAAAAAI0vAABkb2NQcm9wcy9hcHAueG1sUEsBAgAAFAAAAAAAAAAAANaSfBFaAQAAWgEAABEAAAAAAAAAAAAAAAAA7DEAAGRvY1Byb3BzL2NvcmUueG1sUEsBAgAAFAAAAAAAAAAAAKjXaoAVCAAAFQgAABMAAAAAAAAAAAAAAAAAdTMAAFtDb250ZW50X1R5cGVzXS54bWxQSwUGAAAAAAoACgB7AgAAuzsAAAAA",
  "base64",
);
const XLS_FILE = Buffer.from(
  "0M8R4KGxGuEAAAAAAAAAAAAAAAAAAAAAPgADAP7/CQAGAAAAAAAAAAAAAAABAAAAAgAAAAAAAAAAEAAAAQAAAAEAAAD+////AAAAAAAAAAD////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9/////v////7///8EAAAABQAAAP7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7///8CAAAAAwAAAAQAAAAFAAAABgAAAAcAAAAIAAAACQAAAAoAAAALAAAADAAAAA0AAAAOAAAADwAAABAAAAARAAAAEgAAAP7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+/////v////7////+////UgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQABQH//////////wEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAwAQAAAAAAAABAFMAaAAzADMAdABKADUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEgACAf////8CAAAA/////wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAFcAbwByAGsAYgBvAG8AawAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASAAIB////////////////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAG8EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///////////////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3MjYyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQgQAAAGBQBics0HCcABAAYHAADhAAIAsATBAAIAAADiAAAAXABwAAcAAFNoMzN0SlMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABCAAIAsARhAQIAAADAAQAAPQECAAEAnAACABEAGQACAAAAEgACAAAAEwACAAAArwECAAAAvAECAAAAPQASAAAAAABgcsBEOAAAAAAAAQD0AUAAAgAAAI0AAgAAACIAAgAAAA4AAgABALcBAgAAANoAAgAAADEAGgDwAAAAAACQAQAAAAAAAAUBQQByAGkAYQBsAB4ENQA4ABgAASIACk5IUy8AC05IUyAAIgBoAGgAIgBCZiIAbQBtACIABlIiAHMAcwAiANJ5IAAiAOAAFAAAAAAA9P8AAAAAAAAAAAAAAAAAAOAAFAAAAAAA9P8AAAAAAAAAAAAAAAAAAOAAFAAAAAAA9P8AAAAAAAAAAAAAAAAAAOAAFAAAAAAA9P8AAAAAAAAAAAAAAAAAAOAAFAAAAAAA9P8AAAAAAAAAAAAAAAAAAOAAFAAAAAAA9P8AAAAAAAAAAAAAAAAAAOAAFAAAAAAA9P8AAAAAAAAAAAAAAAAAAOAAFAAAAAAA9P8AAAAAAAAAAAAAAAAAAOAAFAAAAAAA9P8AAAAAAAAAAAAAAAAAAOAAFAAAAAAA9P8AAAAAAAAAAAAAAAAAAOAAFAAAAAAA9P8AAAAAAAAAAAAAAAAAAOAAFAAAAAAA9P8AAAAAAAAAAAAAAAAAAOAAFAAAAAAA9P8AAAAAAAAAAAAAAAAAAOAAFAAAAAAA9P8AAAAAAAAAAAAAAAAAAOAAFAAAAAAA9P8AAAAAAAAAAAAAAAAAAOAAFAAAAAAA9P8AAAAAAAAAAAAAAAAAAOAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAGABAgAAAIUAEgAvAwAAAAAFAUYAcgBvAHQAYQCMAAQAAQABAPwACAAAAAAAAAAAAAoAAAAJCBAAAAYQAGJyzQcJwAEABgcAAA0AAgABAAwAAgBkAA8AAgABABEAAgAAABAACAD8qfHSTWJQP18AAgABACoAAgAAACsAAgAAAIIAAgABAIAACAAAAAAAAAAAAIMAAgAAAIQAAgAAAAACDgAAAAAAAgAAAAAAAgAAAAQCEwAAAAAAEAAFAAFQAGwAYQBjAGEABAIRAAAAAQAQAAQAAUkAUABWAEEABAIXAAEAAAAQAAcAAUEAQgBDADEARAAyADMAAwIOAAEAAQAQAAAAAAAASpNAPgISALYGAAAAAEAAAAAAAAAAAAAAALoBDQAFAAFGAHIAbwB0AGEAZwgTAGcIAAAAAAAAAAAAAAMAAQAAAABoCCcAaAgAAAAAAAAAAAAAAwAAAAAAAAEABAAAAAAAAAABAAAAAQAEAAAACgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  "base64",
);

const MIME_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIME_PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MIME_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MIME_XLS = "application/vnd.ms-excel";

describe("leitor de zip", () => {
  it("abre um zip real e devolve os arquivos por caminho", () => {
    const arquivos = lerZip(DOCX);
    expect([...arquivos.keys()]).toContain("word/document.xml");
    expect(arquivos.get("word/document.xml")!.toString("utf8")).toContain(
      "Reajuste",
    );
  });

  it("devolve vazio para bytes que não são zip, sem lançar", () => {
    expect(lerZip(Buffer.from("nao sou um zip")).size).toBe(0);
  });
});

describe("texto de XML do Office", () => {
  it("junta execuções partidas e desescapa entidades", () => {
    const t = textoDoXml(
      "<w:p><w:r><w:t>Reajuste de </w:t></w:r><w:r><w:t>7,5%</w:t></w:r></w:p>",
    );
    expect(t).toBe("Reajuste de 7,5%");
  });
});

describe("Word", () => {
  it("tira o texto do documento, com o valor íntegro", () => {
    const r = extrairAnexo(MIME_DOCX, DOCX)!;
    expect(r.texto).toContain("Reajuste anual de 7,5%");
    expect(r.texto, "entidade XML volta a ser o caractere").toContain(
      "Clausula segunda & final",
    );
  });

  it("traz as figuras intactas e ignora o que o modelo não lê", () => {
    const r = extrairAnexo(MIME_DOCX, DOCX)!;
    expect(r.imagens).toHaveLength(1);
    expect(r.imagens[0].mimeType).toBe("image/png");
    // Os bytes são os do PNG original — a assinatura sobrevive ao base64.
    expect(
      Buffer.from(r.imagens[0].dados, "base64").subarray(1, 4).toString(),
    ).toBe("PNG");
  });
});

describe("PowerPoint", () => {
  it("põe os slides na ordem da apresentação, não na alfabética", () => {
    const r = extrairAnexo(MIME_PPTX, PPTX)!;
    // Cada slide entra como um título — "## Slide 4" —, que é como se cita um.
    const ordem = [...r.texto.matchAll(/## Slide (\d+)\n\n(.+)/g)].map(
      (m) => m[2],
    );
    expect(ordem).toEqual(["Primeiro slide", "Segundo slide", "Decimo slide"]);
  });

  it("traz as figuras do deck", () => {
    expect(extrairAnexo(MIME_PPTX, PPTX)!.imagens[0]!.mimeType).toBe(
      "image/jpeg",
    );
  });
});

describe("Excel", () => {
  /*
    A folha sai como tabela, não como CSV.

    A versão anterior entregava `Placa,IPVA` seguido de `ABC1D23,1234.5`, e num
    arquivo com oito colunas ninguém — nem o modelo — sabia qual valor era de
    qual coluna. O cabeçalho e o separador de markdown restabelecem a relação
    que a planilha sempre teve.
  */
  it("lê o .xlsx moderno, com o nome da folha e a tabela inteira", () => {
    const r = extrairAnexo(MIME_XLSX, XLSX_FILE)!;
    expect(r.texto).toContain("### Frota");
    expect(r.texto).toContain("| Placa | IPVA |");
    expect(r.texto).toContain("| ABC1D23 | 1234.5 |");
  });

  /*
    O `.xls` antigo não é zip — é BIFF dentro de OLE2, e a assinatura abaixo é a
    prova de que a fixture é mesmo do formato legado. Se um dia alguém rotear
    este mime para o leitor de zip, este teste falha em vez de devolver vazio em
    silêncio, que é o modo como esse erro normalmente passa despercebido.
  */
  it("lê o .xls legado, que não é zip nenhum", () => {
    expect(XLS_FILE.subarray(0, 4).toString("hex"), "assinatura OLE2").toBe(
      "d0cf11e0",
    );
    expect(
      lerZip(XLS_FILE).size,
      "não é zip — o leitor de zip não acha nada",
    ).toBe(0);

    const r = extrairAnexo(MIME_XLS, XLS_FILE)!;
    expect(r.texto).toContain("| Placa | IPVA |");
    expect(r.texto).toContain("| ABC1D23 | 1234.5 |");
  });
});

describe("texto puro", () => {
  it("entra como é, sem tradução nenhuma", () => {
    const r = extrairAnexo("text/plain", Buffer.from("regra escrita à mão"))!;
    expect(r.texto).toBe("regra escrita à mão");
    expect(r.imagens).toEqual([]);
  });

  it("markdown entra como é; csv vira a tabela que ele é", () => {
    expect(extrairAnexo("text/markdown", Buffer.from("# t"))!.texto).toBe(
      "## t",
    );
    expect(extrairAnexo("text/csv", Buffer.from("a,b\n1,2"))!.texto).toBe(
      "| a | b |\n| --- | --- |\n| 1 | 2 |",
    );
  });
});

describe("o que não tem caminho", () => {
  /*
    O `.doc` antigo é OLE2, não zip. Devolver null aqui é o que faz a resposta
    voltar a dizer que não leu o documento — que continua sendo verdade, e é
    melhor do que entregar o lixo binário que uma leitura otimista produziria.
  */
  it("Word e PowerPoint legados continuam sem caminho", () => {
    // OLE2 como o .xls, mas sem leitor: BIFF de planilha o `xlsx` abre, o
    // formato binário do Word e do PowerPoint não.
    const ole2 = Buffer.from("d0cf11e0a1b11ae1", "hex");
    expect(extrairAnexo("application/msword", ole2)).toBeNull();
    expect(extrairAnexo("application/vnd.ms-powerpoint", ole2)).toBeNull();
  });

  it("arquivo vazio ou ilegível devolve null", () => {
    expect(extrairAnexo(MIME_DOCX, Buffer.from(""))).toBeNull();
    expect(extrairAnexo("text/plain", Buffer.from("   "))).toBeNull();
  });
});
