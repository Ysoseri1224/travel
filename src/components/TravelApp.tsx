import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify from 'dompurify';
import { geoNaturalEarth1 } from 'd3-geo';
import { marked } from 'marked';
import Map from 'ol/Map';
import View from 'ol/View';
import Overlay from 'ol/Overlay';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorTileLayer from 'ol/layer/VectorTile';
import XYZ from 'ol/source/XYZ';
import VectorSource from 'ol/source/Vector';
import VectorTileSource from 'ol/source/VectorTile';
import TileGrid from 'ol/tilegrid/TileGrid';
import Modify from 'ol/interaction/Modify';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import MVT from 'ol/format/MVT';
import VectorTile from 'ol/VectorTile';
import RenderFeature from 'ol/render/Feature';
import Projection from 'ol/proj/Projection';
import { addCoordinateTransforms, addProjection, transform } from 'ol/proj';
import { getDistance } from 'ol/sphere';
import { boundingExtent, intersects, type Extent } from 'ol/extent';
import type { TileSourceEvent } from 'ol/source/Tile';
import { PMTiles } from 'pmtiles';
import {
  Check, Home, Languages, LogIn, LogOut,
  MapPin, Pencil, Search, Trash2, Upload, X
} from 'lucide-react';
import { detectLocale, translate, type Locale, type TranslationKey } from '../lib/i18n';
import type { MediaAsset, Pin, PlaceCandidate, SessionState } from '../lib/types';

declare global {
  interface Window {
    __TRAVEL_INITIAL__?: { pin?: Pin; pins?: Pin[] };
  }
}

const MAP_EXTENT: [number, number, number, number] = [0, -4096, 8192, 0];
const MAP_PROJECTION = new Projection({ code: 'YSOSERI:NE1', units: 'pixels', extent: MAP_EXTENT });
const d3Projection = geoNaturalEarth1()
  .precision(0.18)
  .fitExtent([[191.4, 191.4], [8000.6, 3904.6]], { type: 'Sphere' });

addProjection(MAP_PROJECTION);
addCoordinateTransforms(
  'EPSG:4326',
  MAP_PROJECTION,
  (coordinate) => {
    const projected = d3Projection([coordinate[0], coordinate[1]]);
    return projected ? [projected[0], -projected[1]] : [4096, -2048];
  },
  (coordinate) => {
    const inverted = d3Projection.invert?.([coordinate[0], -coordinate[1]]);
    return inverted || [0, 0];
  }
);

const PIN_COLORS = ['#c85f3c', '#47756f', '#d19a3b', '#805b88', '#55739a', '#9a4d4b'];
const PIN_ASSETS: Record<string, string> = {
  '#c85f3c': '/pins/v1/pushpin-coral-v1.webp',
  '#47756f': '/pins/v1/pushpin-verdigris-v1.webp',
  '#d19a3b': '/pins/v1/pushpin-ochre-v1.webp',
  '#805b88': '/pins/v1/pushpin-violet-v1.webp',
  '#55739a': '/pins/v1/pushpin-blue-v1.webp',
  '#9a4d4b': '/pins/v1/pushpin-red-v1.webp'
};
const PHOTO_STYLES = ['photo-classic', 'photo-landscape', 'photo-portrait'] as const;
const ADMIN_STYLES = {
  ADM0: [
    new Style({ stroke: new Stroke({ color: 'rgba(50,35,25,.22)', width: 3.1 }) }),
    new Style({ stroke: new Stroke({ color: 'rgba(50,35,25,.78)', width: 1.15 }) })
  ],
  ADM1: [
    new Style({ stroke: new Stroke({ color: 'rgba(82,61,43,.16)', width: 2.1 }) }),
    new Style({ stroke: new Stroke({ color: 'rgba(82,61,43,.55)', width: .78 }) })
  ],
  ADM2: [
    new Style({ stroke: new Stroke({ color: 'rgba(103,78,55,.14)', width: 1.55 }) }),
    new Style({ stroke: new Stroke({ color: 'rgba(103,78,55,.43)', width: .58 }) })
  ]
};

interface DraftPin {
  id?: string;
  title: string;
  lat: number;
  lng: number;
  place_name: string;
  region_id: string;
  country_code: string;
  event_date: string;
  color: string;
  content: string;
  photo_style: typeof PHOTO_STYLES[number];
  cover_media_id: string;
  media: MediaAsset[];
}

interface Props { manageRequested?: boolean; }

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
  return payload as T;
}

function pinToDraft(pin: Pin): DraftPin {
  return {
    id: pin.id,
    title: pin.title,
    lat: pin.lat,
    lng: pin.lng,
    place_name: pin.place_name || '',
    region_id: pin.region_id || '',
    country_code: pin.country_code || '',
    event_date: pin.event_date || '',
    color: pin.color || PIN_COLORS[0],
    content: pin.content || '',
    photo_style: pin.photo_style || 'photo-classic',
    cover_media_id: pin.cover_media_id || '',
    media: [...(pin.media || [])]
  };
}

function freshDraft(lng: number, lat: number): DraftPin {
  return {
    title: '', lat, lng, place_name: '', region_id: '', country_code: '', event_date: '', color: PIN_COLORS[0],
    content: '', photo_style: 'photo-classic', cover_media_id: '', media: []
  };
}

function isMobileEditor(): boolean {
  return window.matchMedia('(max-width: 820px), (pointer: coarse)').matches;
}

export default function TravelApp({ manageRequested = false }: Props) {
  const mapTargetRef = useRef<HTMLDivElement>(null);
  const [panelHost] = useState(() => {
    const element = document.createElement('div');
    element.className = 'node-overlay';
    return element;
  });
  const mapRef = useRef<Map | null>(null);
  const panelOverlayRef = useRef<Overlay | null>(null);
  const pinOverlaysRef = useRef<Overlay[]>([]);
  const ghostSourceRef = useRef(new VectorSource());
  const ghostFeatureRef = useRef<Feature<Point> | null>(null);
  const openViewRef = useRef<{ center: number[]; zoom: number } | null>(null);
  const initialPathHandled = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const authRevisionRef = useRef(0);
  const permissionRef = useRef({ authenticated: false, managementActive: false });
  const scaleRef = useRef<HTMLDivElement>(null);
  const scaleFrameRef = useRef<number | null>(null);

  const [locale, setLocale] = useState<Locale>('zh');
  const [pins, setPins] = useState<Pin[]>(() => window.__TRAVEL_INITIAL__?.pins || []);
  const [selected, setSelected] = useState<Pin | null>(() => window.__TRAVEL_INITIAL__?.pin || null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([]);
  const [draftCandidates, setDraftCandidates] = useState<PlaceCandidate[]>([]);
  const [draftSearching, setDraftSearching] = useState(false);
  const [draftSearchError, setDraftSearchError] = useState(false);
  const [stats, setStats] = useState({ cities: 0, countries: 0 });
  const [session, setSession] = useState<SessionState>({ authenticated: false });
  const [sessionReady, setSessionReady] = useState(false);
  const [managementActive, setManagementActive] = useState(() => manageRequested || window.location.pathname === '/manage');
  const [loginOpen, setLoginOpen] = useState(manageRequested);
  const [loginError, setLoginError] = useState(false);
  const [draft, setDraft] = useState<DraftPin | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editorMode, setEditorMode] = useState<'write' | 'preview'>('write');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [lightbox, setLightbox] = useState<MediaAsset | null>(null);
  const [toast, setToast] = useState('');
  const [mapReady, setMapReady] = useState(false);

  permissionRef.current = { authenticated: session.authenticated, managementActive };

  const t = useCallback((key: TranslationKey, values?: Record<string, string | number>) => translate(locale, key, values), [locale]);
  const renderedContent = useMemo(() => DOMPurify.sanitize(marked.parse(selected?.content || '') as string), [selected?.content]);
  const renderedDraft = useMemo(() => DOMPurify.sanitize(marked.parse(draft?.content || '') as string), [draft?.content]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  }, []);

  const loadPins = useCallback(async () => {
    try {
      const result = await api<{ pins: Pin[]; stats: { cities: number; countries: number } }>('/api/pins');
      setPins(result.pins);
      setStats(result.stats);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSession = useCallback(async () => {
    const revision = authRevisionRef.current;
    try {
      const next = await api<SessionState>('/api/auth/session');
      if (revision !== authRevisionRef.current) return;
      setSession(next);
      if (manageRequested && !next.authenticated) setLoginOpen(true);
      if (manageRequested && next.authenticated && isMobileEditor()) showToast(t('mobileReadonly'));
    } catch {
      if (revision !== authRevisionRef.current) return;
      setSession({ authenticated: false });
      if (manageRequested) setLoginOpen(true);
    } finally {
      if (revision === authRevisionRef.current) setSessionReady(true);
    }
  }, [manageRequested, showToast, t]);

  useEffect(() => {
    const onPop = () => setManagementActive(window.location.pathname === '/manage');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const next = detectLocale();
    setLocale(next);
    document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
    void loadPins();
    void loadSession();
  }, [loadPins, loadSession]);

  useEffect(() => {
    if (!mapTargetRef.current || mapRef.current) return;
    const tileGrid = new TileGrid({
      extent: MAP_EXTENT,
      origin: [0, 0],
      resolutions: [16, 8, 4, 2, 1, .5, .25, .125, .0625, .03125, .015625],
      tileSize: 256
    });
    const baseTileGrid = new TileGrid({
      extent: MAP_EXTENT,
      origin: [0, 0],
      resolutions: [16, 8, 4, 2, 1],
      tileSize: 256
    });
    const paperTileGrid = new TileGrid({
      extent: MAP_EXTENT,
      origin: [0, 0],
      minZoom: 5,
      resolutions: [16, 8, 4, 2, 1, .5],
      tileSize: 256
    });
    const baseSource = new XYZ({
      projection: MAP_PROJECTION,
      tileGrid: baseTileGrid,
      url: '/tiles/v1/{z}/{x}/{y}.webp',
      wrapX: false,
      transition: 0
    });
    const baseLayer = new TileLayer({
      extent: MAP_EXTENT,
      preload: 2,
      source: baseSource
    });
    const paperSource = new XYZ({
      projection: MAP_PROJECTION,
      tileGrid: paperTileGrid,
      tileUrlFunction: (tileCoordinate) => {
        if (tileCoordinate[0] !== 5) return undefined;
        return `/tiles/v2/paper/${tileCoordinate[0]}/${tileCoordinate[1]}/${tileCoordinate[2]}.webp`;
      },
      gutter: 1,
      wrapX: false,
      transition: 0
    });
    const paperLayer = new TileLayer({ extent: MAP_EXTENT, minZoom: 4.15, preload: 1, opacity: .01, visible: false, source: paperSource });
    const detailLayer = (id: string, period: number) => new TileLayer({
      extent: MAP_EXTENT,
      minZoom: 5.4,
      opacity: 0,
      visible: false,
      source: new XYZ({
        projection: MAP_PROJECTION,
        tileGrid,
        minZoom: 6,
        maxZoom: 10,
        wrapX: false,
        transition: 140,
        tileUrlFunction: (tileCoordinate) => {
          if (!tileCoordinate || tileCoordinate[0] < 6) return undefined;
          const x = ((tileCoordinate[1] % period) + period) % period;
          const y = ((tileCoordinate[2] % period) + period) % period;
          return `/tiles/v2/detail/${id}/${x}/${y}.webp`;
        }
      })
    });
    const fiberLayer = detailLayer('fiber', 4);
    const pulpLayer = detailLayer('pulp', 5);
    const grainLayer = detailLayer('grain', 7);
    const mvtFormat = new MVT();
    const adminSource = (archiveName: string, minZoom: number) => {
      const archive = new PMTiles(`/tiles/v2/admin/${archiveName}.pmtiles`);
      return new VectorTileSource({
        projection: MAP_PROJECTION,
        tileGrid,
        minZoom,
        maxZoom: 10,
        wrapX: false,
        transition: 100,
        tileUrlFunction: (coordinate) => coordinate ? coordinate.join('/') : undefined,
        tileLoadFunction: (tile, url) => {
          const [zoom, x, y] = url.split('/').map(Number);
          const vectorTile = tile as VectorTile<RenderFeature>;
          vectorTile.setLoader(async (extent: Extent, _resolution: number, projection: Projection) => {
            try {
              const result = await archive.getZxy(zoom + 1, x, y);
              const features = result
                ? mvtFormat.readFeatures(result.data, { extent, featureProjection: projection })
                : [];
              vectorTile.setFeatures(features);
              return features;
            } catch {
              vectorTile.setFeatures([]);
              return [];
            }
          });
        }
      });
    };
    const globalAdminSource = adminSource('global', 5);
    const adminStyle = (feature: { get: (key: string) => unknown }) => ADMIN_STYLES[String(feature.get('level')) as keyof typeof ADMIN_STYLES] || ADMIN_STYLES.ADM2;
    const globalAdminLayer = new VectorTileLayer({ source: globalAdminSource, style: adminStyle, minZoom: 4.15, declutter: false, visible: false });
    globalAdminLayer.setZIndex(20);
    const ghostLayer = new VectorLayer({
      source: ghostSourceRef.current,
      style: new Style({
        image: new CircleStyle({ radius: 10, fill: new Fill({ color: 'rgba(200,95,60,.72)' }), stroke: new Stroke({ color: '#fff4d7', width: 2 }) })
      }),
      zIndex: 40
    });
    const view = new View({
      projection: MAP_PROJECTION,
      center: [4096, -2048],
      zoom: 1,
      minZoom: 0,
      maxZoom: 10,
      extent: [-2600, -6700, 10792, 2600],
      smoothExtentConstraint: true,
      constrainResolution: false
    });
    const map = new Map({ target: mapTargetRef.current, layers: [baseLayer, paperLayer, fiberLayer, pulpLayer, grainLayer, globalAdminLayer, ghostLayer], view, controls: [] });
    mapRef.current = map;
    const setWorldCover = () => {
      map.updateSize();
      const size = map.getSize();
      if (!size?.[0] || !size[1]) return;
      view.setCenter([4096, -2048]);
      view.setResolution(Math.min((8000.6 - 191.4) / size[0], (3904.6 - 191.4) / size[1]));
    };
    requestAnimationFrame(setWorldCover);
    const updateZoomClass = () => {
      const zoom = view.getZoom() || 0;
      mapTargetRef.current?.classList.toggle('zoom-city', zoom >= 6.2);
      mapTargetRef.current?.classList.toggle('zoom-local', zoom >= 8.7);
    };
    let paperReady = false;
    let vectorReady = false;
    let syncCountryLayers = () => {};
    const loadedPaperTiles = new Set<string>();
    const loadedVectorTiles = new Set<string>();
    const tileKey = (coordinate: number[]) => `${coordinate[0]}/${coordinate[1]}/${coordinate[2]}`;
    const currentCoverageReady = (grid: TileGrid, loadedTiles: Set<string>, zoom?: number) => {
      if (view.getAnimating()) return false;
      const size = map.getSize();
      if (!size?.[0] || !size[1]) return false;
      const visible = view.calculateExtent(size);
      if (!intersects(visible, MAP_EXTENT)) return false;
      const extent: Extent = [
        Math.max(visible[0], MAP_EXTENT[0]),
        Math.max(visible[1], MAP_EXTENT[1]),
        Math.min(visible[2], MAP_EXTENT[2]),
        Math.min(visible[3], MAP_EXTENT[3])
      ];
      const targetZoom = zoom ?? grid.getZForResolution(view.getResolution() || grid.getResolution(grid.getMinZoom()));
      const range = grid.getTileRangeForExtentAndZ(extent, targetZoom);
      for (let x = range.minX; x <= range.maxX; x += 1) {
        for (let y = range.minY; y <= range.maxY; y += 1) {
          if (!loadedTiles.has(`${targetZoom}/${x}/${y}`)) return false;
        }
      }
      return true;
    };
    const smoothstep = (from: number, to: number, value: number) => {
      const normalized = Math.max(0, Math.min(1, (value - from) / (to - from)));
      return normalized * normalized * (3 - 2 * normalized);
    };
    const updateLayerOpacity = () => {
      const zoom = view.getZoom() || 0;
      const transition = paperReady && vectorReady ? smoothstep(4.3, 4.7, zoom) : 0;
      baseLayer.setOpacity(1 - transition);
      paperLayer.setVisible(zoom >= 4.15);
      paperLayer.setOpacity(paperReady ? transition : .01);
      globalAdminLayer.setVisible(paperReady && zoom >= 4.15);
      fiberLayer.setVisible(paperReady && vectorReady && zoom >= 5.4);
      pulpLayer.setVisible(paperReady && vectorReady && zoom >= 5.4);
      grainLayer.setVisible(paperReady && vectorReady && zoom >= 5.4);
      fiberLayer.setOpacity(.22 * smoothstep(5.45, 6.35, zoom) * (1 - .36 * smoothstep(8.4, 9.4, zoom)));
      pulpLayer.setOpacity(.17 * smoothstep(6.7, 7.7, zoom));
      grainLayer.setOpacity(.13 * smoothstep(8.1, 9.15, zoom));
    };
    const checkPaperReady = () => {
      if (paperReady || !currentCoverageReady(paperTileGrid, loadedPaperTiles, 5)) return;
      paperReady = true;
      updateLayerOpacity();
      map.render();
    };
    const checkVectorReady = () => {
      const targetZoom = tileGrid.getZForResolution(
        view.getResolution() || tileGrid.getResolution(tileGrid.getMinZoom()),
        globalAdminSource.zDirection
      );
      if (vectorReady || !currentCoverageReady(tileGrid, loadedVectorTiles, targetZoom)) return;
      vectorReady = true;
      updateLayerOpacity();
      syncCountryLayers();
      map.render();
    };
    const onPaperLoad = (event: TileSourceEvent) => {
      loadedPaperTiles.add(tileKey(event.tile.tileCoord));
      checkPaperReady();
    };
    const onVectorLoad = (event: TileSourceEvent) => {
      loadedVectorTiles.add(tileKey(event.tile.tileCoord));
      checkVectorReady();
    };
    const updateScale = () => {
      scaleFrameRef.current = null;
      const element = scaleRef.current;
      const size = map.getSize();
      if (!element || !size?.[0] || !size[1]) return;
      const centerY = size[1] / 2;
      const start = map.getCoordinateFromPixel([size[0] / 2 - 60, centerY]);
      const end = map.getCoordinateFromPixel([size[0] / 2 + 60, centerY]);
      if (!start || !end) return;
      const metersPerPixel = getDistance(
        transform(start, MAP_PROJECTION, 'EPSG:4326'),
        transform(end, MAP_PROJECTION, 'EPSG:4326')
      ) / 120;
      if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return;
      const target = metersPerPixel * 150;
      const magnitude = 10 ** Math.floor(Math.log10(target));
      const normalized = target / magnitude;
      const nice = (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * magnitude;
      const width = Math.max(42, Math.min(160, nice / metersPerPixel));
      element.style.setProperty('--scale-width', `${width}px`);
      element.textContent = nice >= 1000
        ? `${Number((nice / 1000).toPrecision(3))} km`
        : `${Math.round(nice)} m`;
    };
    const scheduleScale = () => {
      if (scaleFrameRef.current !== null) return;
      scaleFrameRef.current = requestAnimationFrame(updateScale);
    };
    view.on('change:resolution', updateZoomClass);
    view.on('change:resolution', updateLayerOpacity);
    view.on('change:resolution', scheduleScale);
    view.on('change:center', scheduleScale);
    updateZoomClass();
    updateLayerOpacity();
    scheduleScale();
    paperSource.on('tileloadend', onPaperLoad);
    globalAdminSource.on('tileloadend', onVectorLoad);

    let adminManifest: { countries: Record<string, { file: string; bbox: [number, number, number, number] }> } | null = null;
    const countryLayers = new globalThis.Map<string, VectorTileLayer>();
    const projectedCountryExtent = (bbox: [number, number, number, number]) => {
      const [west, south, east, north] = bbox;
      const points: number[][] = [];
      for (let step = 0; step <= 4; step += 1) {
        const progress = step / 4;
        points.push(
          transform([west + (east - west) * progress, south], 'EPSG:4326', MAP_PROJECTION),
          transform([west + (east - west) * progress, north], 'EPSG:4326', MAP_PROJECTION),
          transform([west, south + (north - south) * progress], 'EPSG:4326', MAP_PROJECTION),
          transform([east, south + (north - south) * progress], 'EPSG:4326', MAP_PROJECTION)
        );
      }
      return boundingExtent(points);
    };
    syncCountryLayers = () => {
      if (!adminManifest || !vectorReady || (view.getZoom() || 0) < 6.1) return;
      const size = map.getSize();
      if (!size) return;
      const visible = view.calculateExtent(size);
      for (const [countryCode, country] of Object.entries(adminManifest.countries)) {
        const extent = projectedCountryExtent(country.bbox);
        if (!intersects(visible, extent)) continue;
        if (countryLayers.has(countryCode)) continue;
        const layer = new VectorTileLayer({ source: adminSource(countryCode, 6), style: adminStyle, extent, declutter: false });
        layer.setZIndex(21);
        countryLayers.set(countryCode, layer);
        map.addLayer(layer);
      }
    };
    map.on('moveend', checkPaperReady);
    map.on('moveend', checkVectorReady);
    map.on('moveend', syncCountryLayers);
    view.on('change:resolution', syncCountryLayers);
    void fetch('/tiles/v2/admin/manifest.json', { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('ADMIN_MANIFEST')))
      .then((manifest) => { adminManifest = manifest; syncCountryLayers(); })
      .catch(() => undefined);

    const panelOverlay = new Overlay({
      element: panelHost,
      positioning: 'bottom-center',
      offset: [0, -42],
      stopEvent: true,
      autoPan: { animation: { duration: 280 }, margin: 28 }
    });
    map.addOverlay(panelOverlay);
    panelOverlayRef.current = panelOverlay;

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      if (!permissionRef.current.authenticated || !permissionRef.current.managementActive || isMobileEditor()) return;
      const coordinate = map.getEventCoordinate(event);
      const [lng, lat] = transform(coordinate, MAP_PROJECTION, 'EPSG:4326');
      setSelected(null);
      setDraft(freshDraft(lng, lat));
      setDirty(false);
    };
    map.getViewport().addEventListener('contextmenu', onContextMenu);
    setMapReady(true);
    return () => {
      view.un('change:resolution', updateZoomClass);
      view.un('change:resolution', updateLayerOpacity);
      view.un('change:resolution', scheduleScale);
      view.un('change:center', scheduleScale);
      paperSource.un('tileloadend', onPaperLoad);
      globalAdminSource.un('tileloadend', onVectorLoad);
      map.un('moveend', checkPaperReady);
      map.un('moveend', checkVectorReady);
      map.un('moveend', syncCountryLayers);
      view.un('change:resolution', syncCountryLayers);
      if (scaleFrameRef.current !== null) cancelAnimationFrame(scaleFrameRef.current);
      map.getViewport().removeEventListener('contextmenu', onContextMenu);
      map.setTarget(undefined);
      mapRef.current = null;
      setMapReady(false);
    };
  }, [panelHost]);

  const openPin = useCallback(async (pinOrId: Pin | string, updateAddress = true) => {
    try {
      const pin = typeof pinOrId === 'string'
        ? await api<Pin>(`/api/pins/${encodeURIComponent(pinOrId)}`)
        : pinOrId;
      const map = mapRef.current;
      if (map && !openViewRef.current) {
        openViewRef.current = { center: [...(map.getView().getCenter() || [4096, -2048])], zoom: map.getView().getZoom() || 1 };
      }
      setSelected(pin);
      setDraft(null);
      if (updateAddress && window.location.pathname !== `/p/${pin.id}`) history.pushState({ pinId: pin.id }, '', `/p/${pin.id}`);
      const coordinate = transform([pin.lng, pin.lat], 'EPSG:4326', MAP_PROJECTION);
      if (map && (map.getView().getZoom() || 0) < 3.15) map.getView().animate({ center: coordinate, zoom: 3.35, duration: 420 });
    } catch {
      showToast(t('notFoundTitle'));
    }
  }, [showToast, t]);

  const closePanel = useCallback((updateAddress = true) => {
    if (dirty && draft) {
      setConfirmDiscard(true);
      return;
    }
    setSelected(null);
    setDraft(null);
    setDirty(false);
    panelOverlayRef.current?.setPosition(undefined);
    if (updateAddress && window.location.pathname.startsWith('/p/')) history.pushState({}, '', managementActive ? '/manage' : '/');
    const map = mapRef.current;
    if (map && openViewRef.current) {
      map.getView().animate({ center: openViewRef.current.center, zoom: openViewRef.current.zoom, duration: 360 });
      openViewRef.current = null;
    }
  }, [dirty, draft, managementActive]);

  useEffect(() => {
    const pathId = window.location.pathname.match(/^\/p\/([^/]+)$/)?.[1];
    if (pathId && !initialPathHandled.current) {
      initialPathHandled.current = true;
      void openPin(window.__TRAVEL_INITIAL__?.pin?.id === pathId ? window.__TRAVEL_INITIAL__.pin : pathId, false);
    }
    const onPop = () => {
      const nextId = window.location.pathname.match(/^\/p\/([^/]+)$/)?.[1];
      if (nextId) void openPin(nextId, false);
      else closePanel(false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [closePanel, openPin]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const overlay of pinOverlaysRef.current) map.removeOverlay(overlay);
    pinOverlaysRef.current = [];

    for (const pin of pins) {
      const element = document.createElement('div');
      element.className = `pin-anchor${selected?.id === pin.id ? ' is-selected' : ''}`;
      element.style.setProperty('--rotation', `${((pin.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 9) - 4) * 0.72}deg`);
      const button = document.createElement('button');
      button.className = 'pin-button';
      button.type = 'button';
      button.style.setProperty('--pin-image', `url('${PIN_ASSETS[pin.color.toLowerCase()] || PIN_ASSETS[PIN_COLORS[0]]}')`);
      button.setAttribute('aria-label', t('pinLabel', { title: pin.title }));
      button.addEventListener('click', (event) => { event.stopPropagation(); void openPin(pin); });
      element.append(button);

      if (pin.place_name) {
        const label = document.createElement('span');
        label.className = 'place-label';
        label.textContent = pin.place_names?.[locale] || pin.place_name;
        element.append(label);
      }

      const keepsake = document.createElement('button');
      keepsake.type = 'button';
      keepsake.setAttribute('aria-label', t('pinLabel', { title: pin.title }));
      const cover = pin.media.find((item) => item.id === pin.cover_media_id) || pin.media[0];
      if (cover) {
        keepsake.className = `map-keepsake photo ${pin.photo_style || 'photo-classic'}`;
        const media = document.createElement(cover.content_type.startsWith('video/') ? 'video' : 'img');
        media.className = 'keepsake-cover';
        media.setAttribute('src', cover.url);
        if (media instanceof HTMLVideoElement) media.muted = true;
        keepsake.append(media);
      } else {
        keepsake.className = 'map-keepsake note';
        const title = document.createElement('strong');
        title.className = 'keepsake-title';
        title.textContent = pin.title;
        keepsake.append(title);
        if (pin.place_name) {
          const place = document.createElement('span');
          place.className = 'keepsake-place';
          place.textContent = pin.place_name;
          keepsake.append(place);
        }
      }
      keepsake.addEventListener('click', (event) => { event.stopPropagation(); void openPin(pin); });
      element.append(keepsake);
      const overlay = new Overlay({ element, positioning: 'center-center', stopEvent: true });
      overlay.setPosition(transform([pin.lng, pin.lat], 'EPSG:4326', MAP_PROJECTION));
      map.addOverlay(overlay);
      pinOverlaysRef.current.push(overlay);
    }
  }, [locale, mapReady, openPin, pins, selected?.id, t]);

  useEffect(() => {
    const active = draft || selected;
    if (!active) {
      panelOverlayRef.current?.setPosition(undefined);
      return;
    }
    panelOverlayRef.current?.setElement(panelHost);
    panelOverlayRef.current?.setPosition(transform([active.lng, active.lat], 'EPSG:4326', MAP_PROJECTION));
    const overlay = panelOverlayRef.current;
    const keepInsideViewport = () => overlay?.panIntoView({ animation: { duration: 280 }, margin: 28 });
    const frame = requestAnimationFrame(keepInsideViewport);
    const observer = new ResizeObserver(() => requestAnimationFrame(keepInsideViewport));
    observer.observe(panelHost);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [Boolean(draft), draft?.id, draft?.lat, draft?.lng, panelHost, selected?.id, selected?.lat, selected?.lng]);

  useEffect(() => {
    const map = mapRef.current;
    const source = ghostSourceRef.current;
    source.clear();
    ghostFeatureRef.current = null;
    if (!draft || !session.authenticated || !managementActive || isMobileEditor()) return;
    const feature = new Feature(new Point(transform([draft.lng, draft.lat], 'EPSG:4326', MAP_PROJECTION)));
    source.addFeature(feature);
    ghostFeatureRef.current = feature;
    const modify = new Modify({ source, pixelTolerance: 18 });
    modify.on('modifyend', () => {
      const coordinate = feature.getGeometry()?.getCoordinates();
      if (!coordinate) return;
      const [lng, lat] = transform(coordinate, MAP_PROJECTION, 'EPSG:4326');
      setDraft((current) => current ? { ...current, lng, lat, region_id: '', country_code: '' } : current);
      setDirty(true);
    });
    map?.addInteraction(modify);
    return () => { map?.removeInteraction(modify); source.clear(); };
  }, [Boolean(draft), draft?.id, managementActive, session.authenticated]);

  useEffect(() => {
    if (!draft || !ghostFeatureRef.current) return;
    ghostFeatureRef.current.getGeometry()?.setCoordinates(transform([draft.lng, draft.lat], 'EPSG:4326', MAP_PROJECTION));
    panelOverlayRef.current?.setPosition(transform([draft.lng, draft.lat], 'EPSG:4326', MAP_PROJECTION));
  }, [draft?.lat, draft?.lng]);

  useEffect(() => {
    const place = draft?.place_name.trim() || '';
    if (!draft || draft.region_id || place.length < 2) {
      setDraftCandidates([]);
      setDraftSearching(false);
      setDraftSearchError(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setDraftSearching(true);
      setDraftSearchError(false);
      try {
        const response = await api<{ candidates: PlaceCandidate[] }>(`/api/search/places?q=${encodeURIComponent(place)}&lang=${locale}`, { signal: controller.signal });
        setDraftCandidates(response.candidates);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          setDraftCandidates([]);
          setDraftSearchError(true);
        }
      } finally {
        if (!controller.signal.aborted) setDraftSearching(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft?.place_name, draft?.region_id, locale]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.matches('input, textarea, select, [contenteditable="true"]');
      if ((event.key === '/' && !typing) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) {
        event.preventDefault();
        setSearchOpen(true);
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      if (event.key === 'Escape') {
        if (lightbox) setLightbox(null);
        else if (searchOpen) setSearchOpen(false);
        else closePanel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closePanel, lightbox, searchOpen]);

  const submitSearch = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized) return;
    setSearching(true);
    setSearchError(false);
    try {
      const response = await api<{ candidates: PlaceCandidate[] }>(`/api/search/places?q=${encodeURIComponent(normalized)}&lang=${locale}`);
      setCandidates(response.candidates);
    } catch {
      setCandidates([]);
      setSearchError(true);
    } finally {
      setSearching(false);
    }
  };

  const chooseCandidate = (candidate: PlaceCandidate) => {
    const coordinate = transform([candidate.lng, candidate.lat], 'EPSG:4326', MAP_PROJECTION);
    mapRef.current?.getView().animate({ center: coordinate, zoom: 8.6, duration: 560 });
    setSearchOpen(false);
    if (draft) {
      setDraft({ ...draft, lng: candidate.lng, lat: candidate.lat, place_name: candidate.name, region_id: candidate.regionId, country_code: candidate.countryCode });
      setDirty(true);
    } else if (session.authenticated && managementActive && !isMobileEditor()) {
      setDraft({ ...freshDraft(candidate.lng, candidate.lat), place_name: candidate.name, region_id: candidate.regionId, country_code: candidate.countryCode });
    }
  };

  const chooseDraftCandidate = (candidate: PlaceCandidate) => {
    if (!draft) return;
    const coordinate = transform([candidate.lng, candidate.lat], 'EPSG:4326', MAP_PROJECTION);
    setDraft({ ...draft, lng: candidate.lng, lat: candidate.lat, place_name: candidate.name, region_id: candidate.regionId, country_code: candidate.countryCode });
    setDraftCandidates([]);
    setDirty(true);
    mapRef.current?.getView().animate({ center: coordinate, zoom: Math.max(8.6, mapRef.current.getView().getZoom() || 0), duration: 480 });
  };

  const switchLocale = () => {
    const next = locale === 'zh' ? 'en' : 'zh';
    setLocale(next);
    window.localStorage.setItem('travel-locale', next);
    document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
  };

  const login = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const revision = ++authRevisionRef.current;
    setLoginError(false);
    try {
      const next = await api<SessionState>('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: form.get('password') })
      });
      if (revision !== authRevisionRef.current) return;
      setSession(next);
      setSessionReady(true);
      setLoginOpen(false);
      setManagementActive(true);
      if (window.location.pathname !== '/manage') history.replaceState({}, '', '/manage');
      if (isMobileEditor()) showToast(t('mobileReadonly'));
    } catch {
      setLoginError(true);
    }
  };

  const logout = async () => {
    authRevisionRef.current += 1;
    try {
      await api('/api/auth/logout', { method: 'POST', headers: { 'x-csrf-token': session.csrfToken || '' } });
    } finally {
      setSession({ authenticated: false });
      setSessionReady(true);
      setDraft(null);
      setLoginOpen(true);
      setManagementActive(true);
    }
  };

  const updateDraft = <K extends keyof DraftPin>(key: K, value: DraftPin[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setDirty(true);
  };

  const updateDraftPlace = (value: string) => {
    setDraft((current) => current ? { ...current, place_name: value, region_id: '', country_code: '' } : current);
    setDirty(true);
  };

  const saveDraft = async () => {
    if (!managementActive || !draft?.title.trim() || !draft.region_id || !draft.country_code) return;
    setSaving(true);
    try {
      const payload = {
        ...draft,
        title: draft.title.trim(),
        place_name: draft.place_name.trim() || null,
        region_id: draft.region_id || null,
        country_code: draft.country_code || null,
        event_date: draft.event_date || null,
        cover_media_id: draft.cover_media_id || null,
        photo_style: draft.media.length ? draft.photo_style : null,
        media: draft.media.map((item, index) => ({ media_id: item.id, sort_order: index, caption: item.caption || null }))
      };
      const pin = await api<Pin>(draft.id ? `/api/pins/${draft.id}` : '/api/pins', {
        method: draft.id ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken || '' },
        body: JSON.stringify(payload)
      });
      setPins((current) => [pin, ...current.filter((item) => item.id !== pin.id)]);
      setSelected(null);
      setDraft(null);
      setDirty(false);
      panelOverlayRef.current?.setPosition(undefined);
      history.replaceState({}, '', '/manage');
      void loadPins();
    } catch (error) {
      if (String(error).includes('UNAUTHORIZED')) {
        setSession({ authenticated: false });
        setLoginOpen(true);
        showToast(t('sessionExpired'));
      } else showToast(t('unknownError'));
    } finally {
      setSaving(false);
    }
  };

  const uploadMedia = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files || [])];
    if (!managementActive || !files.length || !draft) return;
    setUploading(true);
    try {
      const uploaded: MediaAsset[] = [];
      for (const file of files) {
        const form = new FormData();
        form.set('file', file);
        const media = await api<MediaAsset>('/api/media', { method: 'POST', headers: { 'x-csrf-token': session.csrfToken || '' }, body: form });
        uploaded.push(media);
      }
      const next = [...draft.media, ...uploaded].map((item, index) => ({ ...item, sort_order: index }));
      setDraft({ ...draft, media: next, cover_media_id: draft.cover_media_id || next[0]?.id || '' });
      setDirty(true);
    } catch {
      showToast(t('unknownError'));
    } finally {
      event.target.value = '';
      setUploading(false);
    }
  };

  const deletePin = async () => {
    if (!managementActive || !selected) return;
    setSaving(true);
    try {
      await api(`/api/pins/${selected.id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken || '' },
        body: JSON.stringify({ confirm: true })
      });
      setConfirmDelete(false);
      setSelected(null);
      setDraft(null);
      history.replaceState({}, '', '/manage');
      await loadPins();
    } catch {
      showToast(t('unknownError'));
    } finally {
      setSaving(false);
    }
  };

  const editSelected = () => {
    if (!selected || !session.authenticated || !managementActive) return;
    if (isMobileEditor()) { showToast(t('mobileReadonly')); return; }
    setDraft(pinToDraft(selected));
    setDirty(false);
  };

  return (
    <main id="travel-root" className="travel-app">
      <div ref={mapTargetRef} className="map-canvas paper-settle" role="application" aria-label={t('mapLabel')} />
      <div ref={scaleRef} className="map-scale" aria-hidden="true" />

      <button className="edge-action action-search" type="button" title={t('search')} aria-label={t('search')} onClick={() => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0); }}><Search /></button>
      <a className="edge-action action-home" href="https://ysoseri.us" title={t('home')} aria-label={t('home')}><Home /></a>
      <button className="edge-action action-manage" type="button" disabled={!sessionReady} title={session.authenticated && managementActive ? t('logout') : t('manage')} aria-label={session.authenticated && managementActive ? t('logout') : t('manage')} onClick={() => {
        if (!session.authenticated) { setLoginOpen(true); return; }
        if (!managementActive) {
          setManagementActive(true);
          history.pushState({}, '', '/manage');
          if (isMobileEditor()) showToast(t('mobileReadonly'));
          return;
        }
        void logout();
      }}>{session.authenticated && managementActive ? <LogOut /> : <MapPin />}</button>
      <span className="source-note">{t('sourceNote')}</span>
      <span className="footprint-stats">{t('footprintStats', stats)}</span>

      {loading && <div className="status-toast">{t('loading')}</div>}
      {loadError && <div className="status-toast">{t('loadError')}</div>}
      {toast && <div className="status-toast" role="status">{toast}</div>}

      {searchOpen && (
        <section className="search-panel floating-paper" aria-label={t('search')}>
          <form className="search-row" onSubmit={submitSearch}>
            <Search size={18} aria-hidden="true" />
            <input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} />
            <button className="language-switch" type="button" onClick={switchLocale} title={locale === 'zh' ? t('switchEnglish') : t('switchChinese')} aria-label={locale === 'zh' ? t('switchEnglish') : t('switchChinese')}><Languages size={15} aria-hidden="true" /> {locale === 'zh' ? 'EN' : '中'}</button>
            <button className="icon-command" type="button" aria-label={t('close')} title={t('close')} onClick={() => setSearchOpen(false)}><X /></button>
          </form>
          {(searching || searchError || (!searching && query && !candidates.length)) && <p className="search-status">{searching ? t('searching') : searchError ? t('searchError') : t('searchEmpty')}</p>}
          {!!candidates.length && (
            <ul className="search-results" aria-label={t('locationResults')}>
              {candidates.map((candidate) => (
                <li className="search-result" key={candidate.id}>
                  <button type="button" onClick={() => chooseCandidate(candidate)}>
                    <span className="result-name">{candidate.name}</span>
                    <span className="result-address">{candidate.address}</span>
                    <span className="result-count">{candidate.pinCount === 0 ? t('searchCountNone') : candidate.pinCount === 1 ? t('searchCountOne') : t('searchCountMany', { count: candidate.pinCount })}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!!candidates.length && <p className="search-attribution">{t('searchAttribution', { provider: [...new Set(candidates.map((item) => item.provider))].join(' / ') })}</p>}
        </section>
      )}

      {createPortal((selected || draft) ? (
          <article className="node-panel floating-paper" role="dialog" aria-modal="false" aria-label={draft ? t('editorLabel') : t('panelLabel')}>
            <div className="panel-actions">
              {!draft && selected && session.authenticated && managementActive && <button className="icon-command" type="button" aria-label={t('edit')} title={t('edit')} onClick={editSelected}><Pencil /></button>}
              <button className="icon-command" type="button" aria-label={t('close')} title={t('close')} onClick={() => closePanel()}><X /></button>
            </div>
            <div className="panel-scroll">
              {draft ? (
                <div className="editor-form">
                  <h1 className="node-title">{draft.id ? t('edit') : t('newPin')}</h1>
                  <p className="search-status">{t('dragPin')}</p>
                  <label className="field"><span>{t('title')}</span><input required maxLength={160} value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} placeholder={t('titlePlaceholder')} /></label>
                  <div className="field-row">
                    <label className="field location-field"><span>{t('place')}</span><input required value={draft.place_name} onChange={(event) => updateDraftPlace(event.target.value)} placeholder={t('placePlaceholder')} autoComplete="off" />{draft.region_id ? <small className="location-confirmed">{t('placeConfirmed')}</small> : <small>{t('placeRequired')}</small>}{(draftSearching || draftSearchError) && <small>{draftSearching ? t('searching') : t('searchError')}</small>}{!!draftCandidates.length && <ul className="draft-location-results">{draftCandidates.map((candidate) => <li key={candidate.id}><button type="button" onClick={() => chooseDraftCandidate(candidate)}><strong>{candidate.name}</strong><span>{candidate.address}</span></button></li>)}</ul>}</label>
                    <label className="field"><span>{t('dateOptional')}</span><input type="date" value={draft.event_date} onChange={(event) => updateDraft('event_date', event.target.value)} /></label>
                  </div>
                  <div className="field">
                    <span>{t('pinColor')}</span>
                    <div className="color-swatches" role="radiogroup" aria-label={t('pinColor')}>{PIN_COLORS.map((color) => <button key={color} type="button" className="color-swatch" style={{ background: color }} role="radio" aria-checked={draft.color === color} aria-label={color} onClick={() => updateDraft('color', color)} />)}</div>
                  </div>
                  <div className="field">
                    <span>{t('content')}</span>
                    <div className="mode-tabs" role="tablist"><button type="button" role="tab" aria-selected={editorMode === 'write'} onClick={() => setEditorMode('write')}>{t('write')}</button><button type="button" role="tab" aria-selected={editorMode === 'preview'} onClick={() => setEditorMode('preview')}>{t('preview')}</button></div>
                    {editorMode === 'write' ? <textarea value={draft.content} onChange={(event) => updateDraft('content', event.target.value)} placeholder={t('contentPlaceholder')} /> : <div className="node-content" dangerouslySetInnerHTML={{ __html: renderedDraft }} />}
                  </div>
                  <div className="field">
                    <span>{t('media')}</span>
                    <div className="upload-row"><label className="text-command upload-label"><Upload size={15} aria-hidden="true" />{uploading ? t('uploading') : t('uploadMedia')}<input type="file" accept="image/*,video/*" multiple disabled={uploading} onChange={uploadMedia} /></label>{!draft.media.length && <small>{t('noMedia')}</small>}</div>
                    {!!draft.media.length && <div className="media-editor-list">{draft.media.map((media) => <div className="media-editor-item" key={media.id}>{media.content_type.startsWith('video/') ? <video src={media.url} muted /> : <img src={media.url} alt="" />}<div className="media-editor-tools"><button type="button" onClick={() => updateDraft('cover_media_id', media.id)}>{draft.cover_media_id === media.id ? `✓ ${t('cover')}` : t('setCover')}</button><button type="button" aria-label={t('removeReference')} title={t('removeReference')} onClick={() => updateDraft('media', draft.media.filter((item) => item.id !== media.id).map((item, index) => ({ ...item, sort_order: index })))}><X size={13} /></button></div></div>)}</div>}
                  </div>
                  {!!draft.media.length && <label className="field"><span>{t('photoStyle')}</span><select value={draft.photo_style} onChange={(event) => updateDraft('photo_style', event.target.value as DraftPin['photo_style'])}><option value="photo-classic">{t('photoClassic')}</option><option value="photo-landscape">{t('photoLandscape')}</option><option value="photo-portrait">{t('photoPortrait')}</option></select></label>}
                  <div className="editor-buttons">{draft.id && <button className="text-command danger" type="button" onClick={() => setConfirmDelete(true)}><Trash2 size={14} aria-hidden="true" /> {t('delete')}</button>}<button className="text-command" type="button" onClick={() => dirty ? setConfirmDiscard(true) : (setDraft(null), setSelected(draft.id ? selected : null))}>{t('cancel')}</button><button className="text-command primary" type="button" disabled={saving || !draft.title.trim() || !draft.region_id || !draft.country_code} onClick={() => void saveDraft()}><Check size={14} aria-hidden="true" /> {saving ? t('saving') : t('save')}</button></div>
                </div>
              ) : selected ? (
                <>
                  <h1 className="node-title">{selected.title}</h1>
                  <div className="node-meta">{selected.place_name && <span>{selected.place_name}</span>}{selected.event_date && <time dateTime={selected.event_date}>{selected.event_date}</time>}</div>
                  {!!selected.media.length && <div className="media-grid">{selected.media.map((media) => <button type="button" className="media-thumb" key={media.id} title={t('mediaOpen')} aria-label={t('mediaOpen')} onClick={() => setLightbox(media)}>{media.content_type.startsWith('video/') ? <video src={media.url} muted preload="metadata" /> : <img src={media.url} alt={media.caption || selected.title} loading="eager" />}</button>)}</div>}
                  <div className="node-content" dangerouslySetInnerHTML={{ __html: renderedContent }} />
                </>
              ) : null}
            </div>
          </article>
        ) : null, panelHost)}

      {loginOpen && !session.authenticated && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('loginLabel')}>
          <section className="modal-paper floating-paper">
            <h2>{t('loginTitle')}</h2><p>{t('loginBody')}</p>
            <form className="login-form" onSubmit={login}><label className="field"><span>{t('password')}</span><input autoFocus name="password" type="password" required autoComplete="current-password" placeholder={t('passwordPlaceholder')} /></label>{loginError && <span className="error-text" role="alert">{t('loginError')}</span>}<div className="modal-actions"><a className="text-command" href="/">{t('backToMap')}</a><button className="text-command primary" type="submit"><LogIn size={15} aria-hidden="true" /> {t('login')}</button></div></form>
          </section>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-backdrop" role="alertdialog" aria-modal="true" aria-label={t('confirmLabel')}>
          <section className="modal-paper floating-paper"><h2>{t('confirmDeleteTitle')}</h2><p>{t('confirmDeleteBody')}</p><div className="modal-actions"><button className="text-command" type="button" onClick={() => setConfirmDelete(false)}>{t('cancel')}</button><button className="text-command danger" disabled={saving} type="button" onClick={() => void deletePin()}>{t('confirmDeleteAction')}</button></div></section>
        </div>
      )}

      {confirmDiscard && (
        <div className="modal-backdrop" role="alertdialog" aria-modal="true" aria-label={t('confirmLabel')}>
          <section className="modal-paper floating-paper"><h2>{t('discardTitle')}</h2><p>{t('discardBody')}</p><div className="modal-actions"><button className="text-command" type="button" onClick={() => setConfirmDiscard(false)}>{t('cancel')}</button><button className="text-command danger" type="button" onClick={() => { setConfirmDiscard(false); setDirty(false); setDraft(null); if (!selected) panelOverlayRef.current?.setPosition(undefined); }}>{t('discardAction')}</button></div></section>
        </div>
      )}

      {lightbox && (
        <div className="modal-backdrop lightbox" role="dialog" aria-modal="true" aria-label={t('mediaOpen')} onClick={() => setLightbox(null)}>
          <button className="edge-action lightbox-close" type="button" aria-label={t('close')} title={t('close')} onClick={() => setLightbox(null)}><X /></button>
          <figure onClick={(event) => event.stopPropagation()}>{lightbox.content_type.startsWith('video/') ? <video src={lightbox.url} controls autoPlay /> : <img src={lightbox.url} alt={lightbox.caption || selected?.title || ''} />}</figure>
        </div>
      )}
    </main>
  );
}
