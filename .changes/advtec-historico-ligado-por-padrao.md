---
impacto: capacidade_nova
secao: alterado
titulo: Conexão nova de WhatsApp já nasce guardando o histórico anterior
---

AdvTec (fork). "Guardar o histórico anterior à vinculação" passa a vir LIGADO: a chave ausente em `channel_sessions.metadata.guardar_historico` agora significa ligado, e só `false` explícito desliga (no original, a #999 decidiu o contrário). O histórico de cerca de um ano só chega no primeiro pareamento, então o padrão desligado perdia esse histórico de todo escritório que não mexesse na opção antes de escanear o QR. Quem não quiser desmarca no cartão da conexão antes de escanear. Canais que já existem e nunca tocaram na opção passam a guardar daqui em diante na próxima reconexão; o histórico de antes do pareamento deles não volta. Sem migration e sem variável de ambiente nova.
