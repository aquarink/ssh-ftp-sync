const { EventEmitter } = require('events');
const { WebSocket } = require('ws');
const { createDeadPeerMonitor } = require('../wsKeepalive');

function fakeSocket() {
  const ws = new EventEmitter();
  ws.readyState = WebSocket.OPEN;
  ws.pings = 0;
  ws.ping = jest.fn(() => {
    ws.pings += 1;
  });
  return ws;
}

describe('createDeadPeerMonitor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('keeps the socket alive while pongs arrive', () => {
    const ws = fakeSocket();
    const onDead = jest.fn();
    const onTick = jest.fn();
    const monitor = createDeadPeerMonitor(ws, { intervalMs: 1000, maxMissedPongs: 2, onDead, onTick });

    for (let i = 0; i < 5; i += 1) {
      jest.advanceTimersByTime(1000);
      ws.emit('pong');
    }

    expect(ws.pings).toBe(5);
    expect(onTick).toHaveBeenCalledTimes(5);
    expect(onDead).not.toHaveBeenCalled();
    expect(monitor.getState()).toEqual({ awaitingPong: false, missedPongs: 0, stopped: false });
    monitor.stop();
  });

  test('declares the peer dead after consecutive missed pongs', () => {
    const ws = fakeSocket();
    const onDead = jest.fn();
    const monitor = createDeadPeerMonitor(ws, { intervalMs: 1000, maxMissedPongs: 2, onDead });

    jest.advanceTimersByTime(1000); // ping 1, awaiting pong
    expect(onDead).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000); // missed 1, ping 2
    expect(onDead).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000); // missed 2 -> dead
    expect(onDead).toHaveBeenCalledWith(2);
    expect(monitor.getState().stopped).toBe(true);

    jest.advanceTimersByTime(5000);
    expect(onDead).toHaveBeenCalledTimes(1);
    expect(ws.listenerCount('pong')).toBe(0);
  });

  test('a late pong resets the missed counter', () => {
    const ws = fakeSocket();
    const onDead = jest.fn();
    const monitor = createDeadPeerMonitor(ws, { intervalMs: 1000, maxMissedPongs: 2, onDead });

    jest.advanceTimersByTime(2000); // one miss
    expect(monitor.getState().missedPongs).toBe(1);
    ws.emit('pong');
    expect(monitor.getState().missedPongs).toBe(0);
    jest.advanceTimersByTime(1000);
    expect(onDead).not.toHaveBeenCalled();
    monitor.stop();
  });

  test('does not ping a socket that is not open', () => {
    const ws = fakeSocket();
    ws.readyState = WebSocket.CLOSING;
    const onDead = jest.fn();
    const monitor = createDeadPeerMonitor(ws, { intervalMs: 1000, maxMissedPongs: 1, onDead });

    jest.advanceTimersByTime(5000);
    expect(ws.pings).toBe(0);
    expect(onDead).not.toHaveBeenCalled();
    monitor.stop();
  });
});
