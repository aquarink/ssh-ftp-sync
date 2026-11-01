const { WebSocket } = require('ws');

const DEFAULT_KEEPALIVE_INTERVAL_MS = Number(process.env.WS_KEEPALIVE_INTERVAL_MS || 25000);
const DEFAULT_MAX_MISSED_PONGS = Number(process.env.WS_MAX_MISSED_PONGS || 2);

/**
 * Dead-peer detection for a relay WebSocket.
 *
 * The relay used to ping every interval without ever checking for a pong, so a
 * half-open socket (client lost network, laptop asleep, WireGuard flap) was only
 * noticed when the TCP stack gave up. This monitor marks the socket as awaiting a
 * pong on every ping and terminates it after `maxMissedPongs` consecutive misses,
 * which lets the session lifecycle react within roughly 2 x interval.
 *
 * `onTick` runs on every ping and is used by the relay to send an application
 * level `keepalive` frame, because browsers cannot observe protocol-level pings.
 */
function createDeadPeerMonitor(ws, {
  intervalMs = DEFAULT_KEEPALIVE_INTERVAL_MS,
  maxMissedPongs = DEFAULT_MAX_MISSED_PONGS,
  onDead = () => {},
  onTick = () => {},
} = {}) {
  let awaitingPong = false;
  let missedPongs = 0;
  let stopped = false;

  const onPong = () => {
    awaitingPong = false;
    missedPongs = 0;
  };
  ws.on('pong', onPong);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    if (typeof ws.off === 'function') ws.off('pong', onPong);
    else if (typeof ws.removeListener === 'function') ws.removeListener('pong', onPong);
  };

  const timer = setInterval(() => {
    if (stopped) return;
    if (ws.readyState !== WebSocket.OPEN) return;

    if (awaitingPong) {
      missedPongs += 1;
      if (missedPongs >= maxMissedPongs) {
        stop();
        onDead(missedPongs);
        return;
      }
    }

    awaitingPong = true;
    try {
      ws.ping();
      onTick();
    } catch {
      // Socket may be closing; the next tick or the close event handles it.
    }
  }, intervalMs);

  return {
    timer,
    stop,
    getState: () => ({ awaitingPong, missedPongs, stopped }),
  };
}

module.exports = {
  DEFAULT_KEEPALIVE_INTERVAL_MS,
  DEFAULT_MAX_MISSED_PONGS,
  createDeadPeerMonitor,
};
