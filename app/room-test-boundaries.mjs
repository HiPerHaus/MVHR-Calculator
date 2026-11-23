const EPS = 1e-7;
function cross(ax, ay, bx, by) { return ax * by - ay * bx; }

export function containsPlanPoint(loop, p) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[j], b = loop[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(cross(dx, dy, p.x - a.x, p.y - a.y)) <= EPS * Math.max(1, Math.hypot(dx, dy))
      && p.x >= Math.min(a.x,b.x) - EPS && p.x <= Math.max(a.x,b.x) + EPS
      && p.y >= Math.min(a.y,b.y) - EPS && p.y <= Math.max(a.y,b.y) + EPS) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + (b.x-a.x)*(p.y-a.y)/(b.y-a.y)) inside = !inside;
  }
  return inside;
}

export function isRoomInsideOutline(room, outline) {
  if (room.length < 3 || outline.length < 3 || !room.every(p =>
    Number.isFinite(p.x) && Number.isFinite(p.y) && containsPlanPoint(outline, p))) return false;
  // Split each room edge at outline intersections. A concave outline can contain both ends but not the edge.
  return room.every((a, i) => {
    const b = room[(i+1)%room.length], dx = b.x-a.x, dy = b.y-a.y;
    const cuts = [0,1];
    for (let j = 0; j < outline.length; j++) {
      const c = outline[j], d = outline[(j+1)%outline.length];
      const ex = d.x-c.x, ey = d.y-c.y, den = cross(dx,dy,ex,ey);
      if (Math.abs(den) < EPS) continue;
      const t = cross(c.x-a.x,c.y-a.y,ex,ey)/den, u = cross(c.x-a.x,c.y-a.y,dx,dy)/den;
      if (t > 0 && t < 1 && u >= -EPS && u <= 1+EPS) cuts.push(t);
    }
    cuts.sort((x,y)=>x-y);
    return cuts.slice(1).every((end,j) => {
      const t = (cuts[j]+end)/2;
      return containsPlanPoint(outline,{x:a.x+dx*t,y:a.y+dy*t});
    });
  });
}

export function findRoomMarker(loop) {
  const ys = [...new Set(loop.map(p=>p.y))].sort((a,b)=>a-b);
  let best = null, span = 0;
  for (let j = 1; j < ys.length; j++) {
    const y = (ys[j-1]+ys[j])/2, intersections = [];
    for (let i=0; i<loop.length; i++) {
      const a=loop[i], b=loop[(i+1)%loop.length];
      if ((a.y>y)!==(b.y>y)) intersections.push(a.x+(b.x-a.x)*(y-a.y)/(b.y-a.y));
    }
    intersections.sort((a,b)=>a-b);
    for (let i=1; i<intersections.length;i+=2) {
      const clearSpan = Math.min(intersections[i]-intersections[i-1], ys[j]-ys[j-1]);
      if (clearSpan > span) { span=clearSpan; best={x:(intersections[i]+intersections[i-1])/2,y}; }
    }
  }
  return best;
}

export function applyLabelSuggestions(rooms, suggestions) {
  if (!Array.isArray(suggestions)) throw new Error("The server did not return room labels. The label-test backend may need updating.");
  const requested = new Set(rooms.map(room => room.id));
  const labels = new Map();
  for (const item of suggestions) {
    if (!requested.has(item?.id) || labels.has(item.id) || typeof item.label !== "string" || item.label.length > 150) {
      throw new Error("The server returned invalid room labels.");
    }
    labels.set(item.id,item.label.trim());
  }
  return rooms.map(room => ({...room, label:labels.get(room.id) || ""}));
}
