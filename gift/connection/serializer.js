const { getContentType, downloadContentFromMessage, downloadMediaMessage } = require('gifted-baileys');
const { getLidMapping } = require('./groupCache');

const standardizeJid = (jid) => {
    if (!jid) return '';
    try {
        jid = typeof jid === 'string' ? jid : 
            (jid.decodeJid ? jid.decodeJid() : String(jid));
        jid = jid.split(':')[0].split('/')[0];
        if (!jid.includes('@')) {
            jid += '@s.whatsapp.net';
        } else if (jid.endsWith('@lid')) {
            return jid.toLowerCase();
        }
        return jid.toLowerCase();
    } catch (e) {
        console.error('JID standardization error:', e);
        return '';
    }
};

const convertLidToJid = (lid) => {
    if (!lid) return '';
    if (!lid.endsWith('@lid')) return lid;
    const cached = getLidMapping(lid);
    if (cached) return cached;
    return lid;
};

const serializeMessage = async (ms, Gifted, settings = {}) => {
    if (!ms?.message || !ms?.key) {
        return null;
    }

    const botId = standardizeJid(Gifted.user?.id);

    /*
     * WhatsApp may wrap incoming messages inside one or more
     * container messages. Unwrap them before detecting the type
     * or extracting the text.
     */
    let message = ms.message;

    for (let i = 0; i < 5; i++) {
        if (message?.ephemeralMessage?.message) {
            message = message.ephemeralMessage.message;
            continue;
        }

        if (message?.viewOnceMessage?.message) {
            message = message.viewOnceMessage.message;
            continue;
        }

        if (message?.viewOnceMessageV2?.message) {
            message = message.viewOnceMessageV2.message;
            continue;
        }

        if (message?.documentWithCaptionMessage?.message) {
            message = message.documentWithCaptionMessage.message;
            continue;
        }

        break;
    }

    const type = getContentType(message);

    const hasEntryPointContext =
        message?.extendedTextMessage?.contextInfo
            ?.entryPointConversionApp === "whatsapp" ||
        message?.imageMessage?.contextInfo
            ?.entryPointConversionApp === "whatsapp" ||
        message?.videoMessage?.contextInfo
            ?.entryPointConversionApp === "whatsapp" ||
        message?.documentMessage?.contextInfo
            ?.entryPointConversionApp === "whatsapp" ||
        message?.audioMessage?.contextInfo
            ?.entryPointConversionApp === "whatsapp";

    const remoteJid = ms.key.remoteJid || "";

    const isMessageYourself =
        hasEntryPointContext &&
        remoteJid.endsWith("@lid") &&
        ms.key.fromMe;

    const from = isMessageYourself
        ? botId
        : standardizeJid(remoteJid);

    const isGroup = from.endsWith("@g.us");

    const sendr = ms.key.fromMe
        ? `${Gifted.user?.id?.split(":")[0]}@s.whatsapp.net`
        : (
            ms.key.senderPn ||
            ms.key.participantPn ||
            ms.key.participantAlt ||
            ms.key.remoteJidAlt ||
            ms.key.remoteJid ||
            ms.key.participant ||
            ""
        );

    let body = "";
    let isButtonResponse = false;
    let buttonId = null;

    if (message?.interactiveResponseMessage) {
        isButtonResponse = true;

        try {
            const paramsJson =
                message.interactiveResponseMessage
                    ?.nativeFlowResponseMessage?.paramsJson;

            if (paramsJson) {
                buttonId = JSON.parse(paramsJson)?.id || null;
            }
        } catch (_) {
            buttonId = null;
        }

        buttonId =
            buttonId ||
            message.interactiveResponseMessage?.buttonId ||
            null;

        body =
            buttonId ||
            message.interactiveResponseMessage?.body?.text ||
            "";
    } else if (message?.buttonsResponseMessage?.selectedButtonId) {
        isButtonResponse = true;
        buttonId = message.buttonsResponseMessage.selectedButtonId;
        body = buttonId;
    } else if (
        message?.listResponseMessage?.singleSelectReply?.selectedRowId
    ) {
        isButtonResponse = true;
        buttonId =
            message.listResponseMessage.singleSelectReply.selectedRowId;
        body = buttonId;
    } else if (message?.templateButtonReplyMessage?.selectedId) {
        isButtonResponse = true;
        buttonId = message.templateButtonReplyMessage.selectedId;
        body = buttonId;
    } else if (type === "conversation") {
        body = message.conversation || "";
    } else if (type === "extendedTextMessage") {
        body = message.extendedTextMessage?.text || "";
    } else if (type === "imageMessage") {
        body = message.imageMessage?.caption || "";
    } else if (type === "videoMessage") {
        body = message.videoMessage?.caption || "";
    } else if (type === "documentMessage") {
        body = message.documentMessage?.caption || "";
    }

    body = typeof body === "string" ? body.trim() : "";

    const botPrefix = String(settings.PREFIX || ".").trim() || ".";

    const isCommand = body.startsWith(botPrefix);

    const command = isCommand
        ? body
            .slice(botPrefix.length)
            .trim()
            .split(/\s+/)
            .shift()
            .toLowerCase()
        : "";

    const args = body
        ? body.split(/\s+/).slice(1)
        : [];

    const contextInfo =
        message?.extendedTextMessage?.contextInfo ||
        message?.imageMessage?.contextInfo ||
        message?.videoMessage?.contextInfo ||
        message?.audioMessage?.contextInfo ||
        message?.documentMessage?.contextInfo ||
        message?.stickerMessage?.contextInfo ||
        null;

    const repliedMessage =
        contextInfo?.quotedMessage || null;

    const quoted =
        type === "extendedTextMessage" && contextInfo
            ? contextInfo.quotedMessage || []
            : [];

    const mentionedJid = (
        contextInfo?.mentionedJid || []
    ).map(standardizeJid);

    const tagged = contextInfo?.mentionedJid || [];

    const quotedMsg = contextInfo?.quotedMessage || null;

    const rawQuotedUser =
        contextInfo?.participant ||
        contextInfo?.remoteJid;

    const quotedUser = convertLidToJid(
        standardizeJid(rawQuotedUser)
    );

    const repliedMessageAuthor = convertLidToJid(
        standardizeJid(contextInfo?.participant)
    );

    const quotedStanzaId = contextInfo?.stanzaId || null;

    const quotedKey = quotedStanzaId
        ? {
            remoteJid: from,
            fromMe:
                rawQuotedUser === botId ||
                contextInfo?.participant === botId,
            id: quotedStanzaId,
            participant: isGroup
                ? rawQuotedUser
                : undefined,
        }
        : null;

    let messageAuthor = isGroup
        ? standardizeJid(
            ms.key.participant ||
            ms.participant ||
            from
        )
        : from;

    if (ms.key.fromMe) {
        messageAuthor = botId;
    }

    const user = mentionedJid.length > 0
        ? mentionedJid[0]
        : repliedMessage
            ? repliedMessageAuthor
            : "";

    return {
        ms,
        mek: ms,
        message,
        type,
        from,
        isGroup,
        sender: sendr,
        botId,
        body,
        isCommand,
        command,
        args,
        q: args.join(" "),
        pushName:
            ms.pushName ||
            (ms.key.fromMe ? Gifted.user?.name : null) ||
            "𝐀𝐓𝐀𝐒𝐒𝐀-𝐌𝐃 User",
        quoted,
        repliedMessage,
        mentionedJid,
        tagged,
        quotedMsg,
        quotedKey,
        quotedUser,
        repliedMessageAuthor,
        messageAuthor,
        user,
        prefix: botPrefix,
        isButtonResponse,
        buttonId,
    };
};

module.exports = {
    standardizeJid,
    convertLidToJid,
    serializeMessage,
    downloadMediaMessage
};
