/** Reconcile only visible references. Unchanged nodes stay attached to avoid
 * restarting large image decodes and rebuilding CAD geometry on every redraw. */
export function createKeyedReferenceLayer(layer) {
  const entries = new Map();
  return descriptors => {
    const keys = new Set(descriptors.map(item => item.key));
    if (keys.size !== descriptors.length) throw new TypeError('Duplicate reference render key');
    for (const [key, entry] of entries) {
      if (!keys.has(key)) { entry.node.remove(); entries.delete(key); }
    }
    descriptors.forEach((item, index) => {
      let entry = entries.get(item.key);
      const unchanged = entry && equalSignature(entry.signature, item.signature);
      if (!unchanged) {
        if (entry && item.update) item.update(entry.node);
        else {
          const node = item.create();
          if (entry) entry.node.replaceWith(node);
          entry = { node };
        }
        entry.signature = [...item.signature];
        entries.set(item.key, entry);
      }
      // Avoid append/move on the common unchanged path: detached/reinserted
      // images can trigger browser work even with the same URL.
      if (layer.children[index] !== entry.node) layer.insertBefore(entry.node, layer.children[index] ?? null);
    });
  };
}
function equalSignature(a, b) { return a.length === b.length && a.every((value, index) => Object.is(value, b[index])); }

let nextClipId = 0;
const rasterParts = new WeakMap();
export function rasterReferenceDescriptor({ reference, asset, transform, editingCrop }, svgElement) {
  const crop = reference.cropSourceRectPx;
  const signature = [asset.dataUrl, asset.widthPx, asset.heightPx, transform, reference.opacity, editingCrop, crop?.x, crop?.y, crop?.width, crop?.height];
  const update = group => {
    const { image, clipRect, frame, existingCrop, clipId } = rasterParts.get(group);
    set(group, 'transform', transform);
    set(image, 'href', asset.dataUrl);
    set(image, 'width', asset.widthPx); set(image, 'height', asset.heightPx);
    set(image, 'opacity', editingCrop ? Math.max(0.25, reference.opacity * 0.72) : reference.opacity);
    const visibleRect = !editingCrop && crop ? crop : { x: 0, y: 0, width: asset.widthPx, height: asset.heightPx };
    rect(frame, visibleRect);
    if (crop) { rect(clipRect, crop); rect(existingCrop, crop); }
    set(image, 'clip-path', crop && !editingCrop ? `url(#${clipId})` : null);
    set(existingCrop, 'display', editingCrop && crop ? null : 'none');
  };
  return {
    key: `raster:${reference.id}`, signature, update,
    create() {
      const clipId = `reference-render-crop-${++nextClipId}`;
      const group = svgElement('g', { 'data-reference-id': reference.id });
      const defs = svgElement('defs', {});
      const clipPath = svgElement('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
      const clipRect = svgElement('rect', {});
      clipPath.append(clipRect); defs.append(clipPath);
      const image = svgElement('image', { x: 0, y: 0, class: 'reference-image', preserveAspectRatio: 'none' });
      const frame = svgElement('rect', { class: 'reference-frame', 'vector-effect': 'non-scaling-stroke' });
      const existingCrop = svgElement('rect', { class: 'reference-crop-existing', 'vector-effect': 'non-scaling-stroke' });
      group.append(defs, image, frame, existingCrop);
      rasterParts.set(group, { image, clipRect, frame, existingCrop, clipId });
      update(group);
      return group;
    },
  };
}
function set(node, name, value) {
  if (value === null) { if (node.hasAttribute(name)) node.removeAttribute(name); }
  else if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value));
}
function rect(node, value) { for (const name of ['x', 'y', 'width', 'height']) set(node, name, value[name]); }
