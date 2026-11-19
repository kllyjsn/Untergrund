export const ROOM_MEDIA_LEAD = 0.04;
export const ROOM_MEDIA_STARTUP_HORIZON = 4;

export function roomMediaLead(room, mediaRoute) {
  return room && mediaRoute ? ROOM_MEDIA_LEAD : 0;
}

export function roomMediaTime(time, room, mediaRoute) {
  const lead = roomMediaLead(room, mediaRoute);
  return lead ? time - lead : time;
}

export function createRoomMediaSync(now = Date.now) {
  let startup = false, pendingCold = false, joiningCold = false, joined = null, duplicateUntil = 0;
  let priming = false, primedUntil = 0, refillUntil = 0;
  const identity = item => item?.broadcastId && Number.isFinite(item.startsAt)
    ? [item.broadcastId, item.version, item.startsAt, item.by] : null;
  return {
    begin(item, playing, room, mediaRoute) {
      const next = identity(item);
      pendingCold ||= Boolean(mediaRoute && next && !joined && (!playing || !room));
    },
    start(room, mediaRoute) {
      joiningCold = Boolean(room && mediaRoute && pendingCold);
      startup = joiningCold;
      pendingCold = false;
    },
    horizon(normal, room, mediaRoute, time = 0) {
      const prime = startup && room && mediaRoute;
      startup = false;
      priming = Boolean(prime);
      const refill = room && mediaRoute ? refillUntil - time : 0;
      refillUntil = 0;
      return prime ? Math.max(normal, ROOM_MEDIA_STARTUP_HORIZON) : refill > normal ? refill : normal;
    },
    queued(until, sources = []) {
      if (priming) primedUntil = sources.reduce((end, note) => Math.max(end, note.t), until);
      priming = false;
    },
    active(time) {
      return time < primedUntil;
    },
    refill() {
      refillUntil = primedUntil;
    },
    cancel(time) {
      const active = time < primedUntil;
      primedUntil = 0;
      refillUntil = 0;
      priming = false;
      return active;
    },
    remember(item) {
      joined = identity(item);
      if (joiningCold) duplicateUntil = now() + 250;
      joiningCold = false;
    },
    duplicate(item, playing, room, mediaRoute) {
      const next = identity(item);
      return Boolean(now() <= duplicateUntil && playing && room && mediaRoute && item?.state && !item.replay && joined && next
        && next.every((value, i) => value === joined[i]));
    },
  };
}
