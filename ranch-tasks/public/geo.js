// Converts onX exports (KML or GPX) — or plain GeoJSON — into a GeoJSON
// FeatureCollection in the browser. onX: Markups → select → Export → KML/GPX.

const num = (v) => Number.parseFloat(v);
const round = (x) => Math.round(x * 1e6) / 1e6; // ~10 cm, keeps files small

function text(el, tag) {
  const n = el.getElementsByTagName(tag)[0];
  return n ? n.textContent.trim() : '';
}

function stripHtml(s) {
  const d = new DOMParser().parseFromString(s || '', 'text/html');
  return (d.body.textContent || '').trim().slice(0, 1000);
}

function kmlCoords(s) {
  return s.trim().split(/\s+/).map((c) => {
    const [lng, lat] = c.split(',').map(num);
    return [round(lng), round(lat)];
  }).filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
}

function kmlGeometries(pm) {
  const geoms = [];
  for (const p of pm.getElementsByTagName('Point')) {
    const c = kmlCoords(text(p, 'coordinates'));
    if (c.length) geoms.push({ type: 'Point', coordinates: c[0] });
  }
  for (const l of pm.getElementsByTagName('LineString')) {
    const c = kmlCoords(text(l, 'coordinates'));
    if (c.length > 1) geoms.push({ type: 'LineString', coordinates: c });
  }
  for (const poly of pm.getElementsByTagName('Polygon')) {
    const rings = [];
    for (const tag of ['outerBoundaryIs', 'innerBoundaryIs']) {
      for (const b of poly.getElementsByTagName(tag)) {
        const c = kmlCoords(text(b, 'coordinates'));
        if (c.length > 2) rings.push(c);
      }
    }
    if (rings.length) geoms.push({ type: 'Polygon', coordinates: rings });
  }
  return geoms;
}

export function kmlToGeoJSON(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not read that KML file');
  const features = [];
  for (const pm of doc.getElementsByTagName('Placemark')) {
    const props = { name: text(pm, 'name'), description: stripHtml(text(pm, 'description')) };
    for (const g of kmlGeometries(pm)) features.push({ type: 'Feature', properties: props, geometry: g });
  }
  return { type: 'FeatureCollection', features };
}

export function gpxToGeoJSON(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not read that GPX file');
  const features = [];
  const pt = (el) => [round(num(el.getAttribute('lon'))), round(num(el.getAttribute('lat')))];
  for (const w of doc.getElementsByTagName('wpt')) {
    features.push({ type: 'Feature', properties: { name: text(w, 'name'), description: text(w, 'desc') }, geometry: { type: 'Point', coordinates: pt(w) } });
  }
  for (const trk of doc.getElementsByTagName('trk')) {
    const name = text(trk, 'name');
    for (const seg of trk.getElementsByTagName('trkseg')) {
      const c = [...seg.getElementsByTagName('trkpt')].map(pt);
      if (c.length > 1) features.push({ type: 'Feature', properties: { name }, geometry: { type: 'LineString', coordinates: c } });
    }
  }
  for (const rte of doc.getElementsByTagName('rte')) {
    const c = [...rte.getElementsByTagName('rtept')].map(pt);
    if (c.length > 1) features.push({ type: 'Feature', properties: { name: text(rte, 'name') }, geometry: { type: 'LineString', coordinates: c } });
  }
  return { type: 'FeatureCollection', features };
}

export async function fileToGeoJSON(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.kmz')) throw new Error('KMZ is zipped — in onX choose KML (or GPX) when exporting.');
  const body = await file.text();
  let gj;
  if (name.endsWith('.kml')) gj = kmlToGeoJSON(body);
  else if (name.endsWith('.gpx')) gj = gpxToGeoJSON(body);
  else if (name.endsWith('.geojson') || name.endsWith('.json')) {
    gj = JSON.parse(body);
    if (gj.type === 'Feature') gj = { type: 'FeatureCollection', features: [gj] };
  } else throw new Error('Use a .kml, .gpx or .geojson file');
  if (!gj.features?.length) throw new Error('No points, lines or areas found in that file');
  return gj;
}
