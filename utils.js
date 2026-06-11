const logSafeSendError = (context, error) => {
  if (error?.message) {
    console.error(`Safe send failed (${context}):`, error.message);
  } else {
    console.error(`Safe send failed (${context})`);
  }
};

function isInteraction(obj) {
  return obj && (typeof obj.isChatInputCommand === 'function' || typeof obj.isButton === 'function' || typeof obj.isMessageComponent === 'function');
}

async function sendReply(recipient, content, options = {}) {
  if (!recipient) return;
  const payload = typeof content === 'string' ? { content, ...options } : { ...content, ...options };

  if (isInteraction(recipient)) {
    try {
      if (recipient.replied || recipient.deferred) {
        return await recipient.followUp(payload);
      }
      return await recipient.reply(payload);
    } catch (error) {
      logSafeSendError('interaction reply', error);
      return null;
    }
  }

  if (recipient.channel?.send) {
    return recipient.channel.send(payload).catch((error) => logSafeSendError('message send', error));
  }

  return null;
}

function safeSend(message, content) {
  return sendReply(message, content, { ephemeral: false });
}

function formatDuration(seconds) {
  if (!seconds || Number.isNaN(seconds)) return 'Unknown';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

module.exports = {
  safeSend,
  sendReply,
  formatDuration,
};