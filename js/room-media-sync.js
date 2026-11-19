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
    horizon(normal, room, mediaRoute) {
      const prime = startup && room && mediaRoute;
      startup = false;
      return prime ? Math.max(normal, ROOM_MEDIA_STARTUP_HORIZON) : normal;
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
