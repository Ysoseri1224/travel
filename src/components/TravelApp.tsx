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
import ImageLayer from 'ol/layer/Image';
import VectorLayer from 'ol/layer/Vector';
import XYZ from 'ol/source/XYZ';
import ImageStatic from 'ol/source/ImageStatic';
import VectorSource from 'ol/source/Vector';
import TileGrid from 'ol/tilegrid/TileGrid';
import Modify from 'ol/interaction/Modify';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import GeoJSON from 'ol/format/GeoJSON';
import Projection from 'ol/proj/Projection';
import { addCoordinateTransforms, addProjection, transform } from 'ol/proj';
import { getDistance } from 'ol/sphere';
import {
  Check, Home, Languages, LogIn, LogOut,
  Map as MapIcon, MapPin, Pencil, Search, Trash2, Upload, X
} from 'lucide-react';
import { detectLocale, translate, type Locale, type TranslationKey } from '../lib/i18n';
import type {
  FootprintSearchResponse, FootprintSearchResult, MediaAsset, Pin, PlaceCandidate, SessionState
} from '../lib/types';

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
const COUNTRY_EXTENT: [number, number, number, number] = [0, -3072, 4096, 0];
const PIN_DETAIL_ZOOM = 3;

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

interface EditorTarget {
  draft: DraftPin;
  selected: Pin | null;
}

interface Props { manageRequested?: boolean; }

interface CountryCatalogItem {
  countryCode: string;
  iso3: string;
  name: { en: string; zh: string };
  status: 'ready';
  packageVersion: string;
  manifestUrl: string;
  bounds: [number, number, number, number];
}

interface CountryPackage {
  countryCode: string;
  packageVersion: string;
  bounds: [number, number, number, number];
  baseZoom: number;
  maxZoom: number;
  keepsakesFromZoom: number;
  raster: { key: string; width: number; height: number };
}

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

function createCountryProjection(country: CountryCatalogItem, manifest: CountryPackage): Projection {
  const [west, south, east, north] = manifest.bounds;
  const raw = geoNaturalEarth1().scale(1).translate([0, 0]);
  const samples: Array<[number, number]> = [];
  for (let step = 0; step <= 64; step += 1) {
    const progress = step / 64;
    const lng = west + (east - west) * progress;
    const lat = south + (north - south) * progress;
    samples.push(raw([lng, south])!, raw([lng, north])!, raw([west, lat])!, raw([east, lat])!);
  }
  const xs = samples.map(([x]) => x);
  const ys = samples.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const margin = 139.2;
  const scale = Math.min((4096 - margin * 2) / (maxX - minX), (3072 - margin * 2) / (maxY - minY));
  const projection = geoNaturalEarth1().scale(scale).translate([
    margin + (4096 - margin * 2 - (maxX - minX) * scale) / 2 - minX * scale,
    margin + (3072 - margin * 2 - (maxY - minY) * scale) / 2 - minY * scale
  ]).precision(.18);
  const olProjection = new Projection({
    code: `YSOSERI:COUNTRY-${country.countryCode}-${manifest.packageVersion}`,
    units: 'pixels',
    extent: COUNTRY_EXTENT
  });
  addProjection(olProjection);
  addCoordinateTransforms(
    'EPSG:4326',
    olProjection,
    (coordinate) => {
      const projected = projection([coordinate[0], coordinate[1]]);
      return projected ? [projected[0], -projected[1]] : [2048, -1536];
    },
    (coordinate) => projection.invert?.([coordinate[0], -coordinate[1]]) || [0, 0]
  );
  return olProjection;
}

function centerForPixel(coordinate: number[], size: [number, number], resolution: number, pixel: [number, number]): number[] {
  return [
    coordinate[0] - (pixel[0] - size[0] / 2) * resolution,
    coordinate[1] + (pixel[1] - size[1] / 2) * resolution
  ];
}

function focusViewOnPin(view: View, map: Map, coordinate: number[], resolution: number, duration: number): void {
  const size = map.getSize();
  if (!size?.[0] || !size[1]) {
    view.animate({ center: coordinate, resolution, duration });
    return;
  }
  const targetPixel: [number, number] = [size[0] / 2, size[1] * 0.67];
  const targetCenter = centerForPixel(coordinate, [size[0], size[1]], resolution, targetPixel);
  view.animate({ center: targetCenter, resolution, duration });
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
  const openViewRef = useRef<{ center: number[]; resolution: number } | null>(null);
  const initialPathHandled = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const footprintSearchAbortRef = useRef<AbortController | null>(null);
  const authRevisionRef = useRef(0);
  const permissionRef = useRef({ authenticated: false, managementActive: false });
  const scaleRef = useRef<HTMLDivElement>(null);
  const scaleFrameRef = useRef<number | null>(null);
  const activeProjectionRef = useRef<Projection>(MAP_PROJECTION);
  const countryBaseResolutionRef = useRef<number | null>(null);
  const pendingFocusRef = useRef<{ coordinate: [number, number]; zoom: number; centered?: boolean } | null>(null);
  const editorStateRef = useRef<{ draft: DraftPin | null; dirty: boolean }>({ draft: null, dirty: false });

  const [locale, setLocale] = useState<Locale>('zh');
  const [pins, setPins] = useState<Pin[]>(() => window.__TRAVEL_INITIAL__?.pins || []);
  const [selected, setSelected] = useState<Pin | null>(() => window.__TRAVEL_INITIAL__?.pin || null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchResults, setSearchResults] = useState<FootprintSearchResult[]>([]);
  const [searchScope, setSearchScope] = useState<FootprintSearchResponse['scope']>('records');
  const [searchLabel, setSearchLabel] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const [searchRegionIds, setSearchRegionIds] = useState<string[]>([]);
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
  const [pendingEditorTarget, setPendingEditorTarget] = useState<EditorTarget | null>(null);
  const [lightbox, setLightbox] = useState<MediaAsset | null>(null);
  const [toast, setToast] = useState('');
  const [mapReady, setMapReady] = useState(false);
  const [countries, setCountries] = useState<CountryCatalogItem[]>([]);
  const [activeCountry, setActiveCountry] = useState<CountryCatalogItem | null>(null);
  const [countryPackage, setCountryPackage] = useState<CountryPackage | null>(null);
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [countryChooserOpen, setCountryChooserOpen] = useState(false);
  const [countryLoading, setCountryLoading] = useState(false);

  permissionRef.current = { authenticated: session.authenticated, managementActive };
  editorStateRef.current = { draft, dirty };

  const t = useCallback((key: TranslationKey, values?: Record<string, string | number>) => translate(locale, key, values), [locale]);
  const renderedContent = useMemo(() => DOMPurify.sanitize(marked.parse(selected?.content || '') as string), [selected?.content]);
  const renderedDraft = useMemo(() => DOMPurify.sanitize(marked.parse(draft?.content || '') as string), [draft?.content]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  }, []);

  const requestEditor = useCallback((nextDraft: DraftPin, nextSelected: Pin | null) => {
    const current = editorStateRef.current;
    if (current.draft?.id && current.draft.id === nextDraft.id) return true;
    if (current.draft && current.dirty) {
      setPendingEditorTarget({ draft: nextDraft, selected: nextSelected });
      setConfirmDiscard(true);
      return false;
    }
    editorStateRef.current = { draft: nextDraft, dirty: false };
    setSelected(nextSelected);
    setDraft(nextDraft);
    setDirty(false);
    setEditorMode('write');
    history.replaceState({}, '', '/manage');
    return true;
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

  const loadCountries = useCallback(async () => {
    try {
      const result = await api<{ countries: CountryCatalogItem[] }>('/api/countries');
      setCountries(result.countries);
    } catch {
      setCountries([]);
    }
  }, []);

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
    void loadCountries();
  }, [loadCountries, loadPins, loadSession]);

  const selectCountry = useCallback(async (country: CountryCatalogItem) => {
    setCountryLoading(true);
    try {
      const response = await fetch(country.manifestUrl, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('COUNTRY_MANIFEST');
      const manifest = await response.json() as CountryPackage;
      setCountryPackage(manifest);
      setActiveCountry(country);
      setCountryChooserOpen(false);
      setCountryMenuOpen(false);
    } catch {
      showToast(t('countryUnavailable'));
    } finally {
      setCountryLoading(false);
    }
  }, [showToast, t]);

  const returnToWorld = useCallback(() => {
    setActiveCountry(null);
    setCountryPackage(null);
    setCountryChooserOpen(false);
    setCountryMenuOpen(false);
    setSelected(null);
    setDraft(null);
    setDirty(false);
    panelOverlayRef.current?.setPosition(undefined);
    history.replaceState({}, '', managementActive ? '/manage' : '/');
  }, [managementActive]);

  useEffect(() => {
    if (!mapTargetRef.current || mapRef.current) return;
    const ghostLayer = new VectorLayer({
      source: ghostSourceRef.current,
      style: new Style({
        image: new CircleStyle({ radius: 10, fill: new Fill({ color: 'rgba(200,95,60,.72)' }), stroke: new Stroke({ color: '#fff4d7', width: 2 }) })
      }),
      zIndex: 40
    });
    const isWorld = !activeCountry || !countryPackage;
    let projection = MAP_PROJECTION;
    let view: View;
    const layers: Array<TileLayer<XYZ> | ImageLayer<ImageStatic> | VectorLayer<VectorSource>> = [];
    if (isWorld) {
      const tileGrid = new TileGrid({ extent: MAP_EXTENT, origin: [0, 0], resolutions: [16, 8, 4, 2, 1], tileSize: 256 });
      layers.push(new TileLayer({
        extent: MAP_EXTENT,
        preload: 2,
        source: new XYZ({ projection: MAP_PROJECTION, tileGrid, url: '/tiles/v1/{z}/{x}/{y}.webp', wrapX: false, transition: 0 })
      }));
      const readyCodes = new Set(countries.map((country) => country.countryCode));
      const outlineSource = new VectorSource({
        url: '/maps/country-index-v1.geojson',
        format: new GeoJSON({ dataProjection: 'EPSG:4326', featureProjection: MAP_PROJECTION })
      });
      let hoveredCountry = '';
      const outlineLayer = new VectorLayer({
        source: outlineSource,
        style: (feature) => {
          const code = String(feature.get('countryCode') || '');
          if (!readyCodes.has(code)) return undefined;
          return new Style({
            fill: new Fill({ color: code === hoveredCountry ? 'rgba(200,95,60,.12)' : 'rgba(0,0,0,0)' }),
            stroke: new Stroke({ color: code === hoveredCountry ? 'rgba(74,49,31,.92)' : 'rgba(74,49,31,0)', width: code === hoveredCountry ? 2.2 : 0 })
          });
        },
        zIndex: 18
      });
      layers.push(outlineLayer);
      view = new View({ projection: MAP_PROJECTION, center: [4096, -2048], resolution: 4, extent: MAP_EXTENT, constrainResolution: false });
      const map = new Map({ target: mapTargetRef.current, layers: [...layers, ghostLayer], view, controls: [], interactions: [] });
      mapRef.current = map;
      activeProjectionRef.current = MAP_PROJECTION;
      countryBaseResolutionRef.current = null;
      const fitWorld = () => {
        map.updateSize();
        const size = map.getSize();
        if (size?.[0] && size[1]) view.setResolution(Math.min((8000.6 - 191.4) / size[0], (3904.6 - 191.4) / size[1]));
        view.setCenter([4096, -2048]);
      };
      requestAnimationFrame(fitWorld);
      const showChooser = (event: Event) => { event.preventDefault(); setCountryChooserOpen(true); setCountryMenuOpen(false); };
      const viewport = map.getViewport();
      viewport.addEventListener('wheel', showChooser, { passive: false });
      viewport.addEventListener('dblclick', showChooser);
      map.on('pointermove', (event) => {
        const feature = map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate, { layerFilter: (layer) => layer === outlineLayer });
        const next = feature && readyCodes.has(String(feature.get('countryCode') || '')) ? String(feature.get('countryCode')) : '';
        if (next !== hoveredCountry) { hoveredCountry = next; outlineSource.changed(); }
        viewport.style.cursor = next ? 'pointer' : 'default';
      });
      map.on('singleclick', (event) => {
        const feature = map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate, { layerFilter: (layer) => layer === outlineLayer });
        const code = String(feature?.get('countryCode') || '');
        const country = countries.find((item) => item.countryCode === code);
        if (country) void selectCountry(country);
      });
      setMapReady(true);
      return () => {
        viewport.removeEventListener('wheel', showChooser);
        viewport.removeEventListener('dblclick', showChooser);
        map.setTarget(undefined);
        mapRef.current = null;
        setMapReady(false);
      };
    }

    projection = createCountryProjection(activeCountry, countryPackage);
    activeProjectionRef.current = projection;
    const width = mapTargetRef.current.clientWidth || window.innerWidth;
    const height = mapTargetRef.current.clientHeight || window.innerHeight;
    const baseResolution = Math.max(4096 / width, 3072 / height);
    countryBaseResolutionRef.current = baseResolution;
    layers.push(new ImageLayer({
      extent: COUNTRY_EXTENT,
      source: new ImageStatic({
        projection,
        imageExtent: COUNTRY_EXTENT,
        url: `/tiles/${countryPackage.raster.key}`,
        interpolate: true
      })
    }));
    view = new View({
      projection,
      center: [2048, -1536],
      resolution: baseResolution,
      minResolution: baseResolution / 2 ** countryPackage.maxZoom,
      maxResolution: baseResolution,
      extent: COUNTRY_EXTENT,
      smoothExtentConstraint: true,
      constrainResolution: false
    });
    const map = new Map({ target: mapTargetRef.current, layers: [...layers, ghostLayer], view, controls: [] });
    mapRef.current = map;
    const updateZoomClass = () => {
      const resolution = view.getResolution() || baseResolution;
      const relativeZoom = Math.max(0, Math.log2(baseResolution / resolution));
      mapTargetRef.current?.classList.toggle('zoom-local', relativeZoom >= countryPackage.keepsakesFromZoom);
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
        transform(start, projection, 'EPSG:4326'),
        transform(end, projection, 'EPSG:4326')
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
    view.on('change:resolution', scheduleScale);
    view.on('change:center', scheduleScale);
    updateZoomClass();
    scheduleScale();

    const panelOverlay = new Overlay({
      element: panelHost,
      positioning: 'bottom-center',
      offset: [0, -42],
      stopEvent: true,
      autoPan: false
    });
    map.addOverlay(panelOverlay);
    panelOverlayRef.current = panelOverlay;

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      if (!permissionRef.current.authenticated || !permissionRef.current.managementActive || isMobileEditor()) return;
      const coordinate = map.getEventCoordinate(event);
      const [lng, lat] = transform(coordinate, projection, 'EPSG:4326');
      requestEditor(freshDraft(lng, lat), null);
    };
    map.getViewport().addEventListener('contextmenu', onContextMenu);
    if (pendingFocusRef.current) {
      const request = pendingFocusRef.current;
      const coordinate = transform(request.coordinate, 'EPSG:4326', projection);
      pendingFocusRef.current = null;
      if (request.centered) view.animate({ center: coordinate, resolution: baseResolution / 2 ** request.zoom, duration: 520 });
      else focusViewOnPin(view, map, coordinate, baseResolution / 2 ** request.zoom, 520);
    }
    setMapReady(true);
    return () => {
      view.un('change:resolution', updateZoomClass);
      view.un('change:resolution', scheduleScale);
      view.un('change:center', scheduleScale);
      if (scaleFrameRef.current !== null) cancelAnimationFrame(scaleFrameRef.current);
      map.getViewport().removeEventListener('contextmenu', onContextMenu);
      map.setTarget(undefined);
      mapRef.current = null;
      setMapReady(false);
    };
  }, [activeCountry, countries, countryPackage, panelHost, requestEditor, selectCountry]);

  const openPin = useCallback(async (pinOrId: Pin | string, updateAddress = true) => {
    try {
      const pin = typeof pinOrId === 'string'
        ? await api<Pin>(`/api/pins/${encodeURIComponent(pinOrId)}`)
        : pinOrId;
      if (permissionRef.current.authenticated && permissionRef.current.managementActive && !isMobileEditor()) {
        requestEditor(pinToDraft(pin), pin);
        return;
      }
      const pinCountry = pin.country_code ? countries.find((country) => country.countryCode === pin.country_code) : null;
      if (pinCountry && (!activeCountry || activeCountry.countryCode !== pinCountry.countryCode)) {
        pendingFocusRef.current = { coordinate: [pin.lng, pin.lat], zoom: PIN_DETAIL_ZOOM };
        await selectCountry(pinCountry);
      }
      const map = mapRef.current;
      if (map && !openViewRef.current) {
        openViewRef.current = { center: [...(map.getView().getCenter() || [4096, -2048])], resolution: map.getView().getResolution() || 1 };
      }
      setSelected(pin);
      setDraft(null);
      if (updateAddress && window.location.pathname !== `/p/${pin.id}`) history.pushState({ pinId: pin.id }, '', `/p/${pin.id}`);
      const coordinate = transform([pin.lng, pin.lat], 'EPSG:4326', activeProjectionRef.current);
      if (map && activeCountry) {
        focusViewOnPin(map.getView(), map, coordinate, (countryBaseResolutionRef.current || 1) / 2 ** PIN_DETAIL_ZOOM, 420);
      }
    } catch {
      showToast(t('notFoundTitle'));
    }
  }, [activeCountry, countries, requestEditor, selectCountry, showToast, t]);

  const resetPanel = useCallback((updateAddress = true) => {
    setSelected(null);
    setDraft(null);
    setDirty(false);
    editorStateRef.current = { draft: null, dirty: false };
    panelOverlayRef.current?.setPosition(undefined);
    if (updateAddress && window.location.pathname.startsWith('/p/')) history.pushState({}, '', managementActive ? '/manage' : '/');
    const map = mapRef.current;
    if (map && openViewRef.current) {
      map.getView().animate({ center: openViewRef.current.center, resolution: openViewRef.current.resolution, duration: 360 });
      openViewRef.current = null;
    }
  }, [managementActive]);

  const closePanel = useCallback((updateAddress = true) => {
    if (dirty && draft) {
      setPendingEditorTarget(null);
      setConfirmDiscard(true);
      return;
    }
    resetPanel(updateAddress);
  }, [dirty, draft, resetPanel]);

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

    const worldMode = !activeCountry;
    const projection = activeProjectionRef.current;
    for (const pin of pins.filter((item) => !activeCountry || item.country_code === activeCountry.countryCode)) {
      const element = document.createElement('div');
      element.className = `pin-anchor${selected?.id === pin.id ? ' is-selected' : ''}${pin.region_id && searchRegionIds.includes(pin.region_id) ? ' is-search-match' : ''}`;
      element.style.setProperty('--rotation', `${((pin.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 9) - 4) * 0.72}deg`);
      const button = document.createElement('button');
      button.className = 'pin-button';
      button.type = 'button';
      if (worldMode) button.disabled = true;
      const pinImage = document.createElement('img');
      pinImage.src = PIN_ASSETS[pin.color.toLowerCase()] || PIN_ASSETS[PIN_COLORS[0]];
      pinImage.alt = '';
      pinImage.setAttribute('aria-hidden', 'true');
      pinImage.draggable = false;
      button.append(pinImage);
      button.setAttribute('aria-label', t('pinLabel', { title: pin.title }));
      if (!worldMode) button.addEventListener('click', (event) => { event.stopPropagation(); void openPin(pin); });
      element.append(button);

      if (pin.place_name) {
        const label = document.createElement('span');
        label.className = 'place-label';
        label.textContent = pin.place_names?.[locale] || pin.place_name;
        element.append(label);
      }

      if (worldMode) {
        const overlay = new Overlay({ element, positioning: 'bottom-center', stopEvent: false });
        overlay.setPosition(transform([pin.lng, pin.lat], 'EPSG:4326', projection));
        map.addOverlay(overlay);
        pinOverlaysRef.current.push(overlay);
        continue;
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
      const overlay = new Overlay({ element, positioning: 'bottom-center', stopEvent: true });
      overlay.setPosition(transform([pin.lng, pin.lat], 'EPSG:4326', projection));
      map.addOverlay(overlay);
      pinOverlaysRef.current.push(overlay);
    }
  }, [activeCountry, locale, mapReady, openPin, pins, searchRegionIds, selected?.id, t]);

  useEffect(() => {
    if (!selected || draft) {
      panelOverlayRef.current?.setPosition(undefined);
      return;
    }
    const overlay = panelOverlayRef.current;
    const map = mapRef.current;
    if (!overlay || !map) return;
    overlay.setElement(panelHost);

    const placePanel = () => {
      overlay.setPositioning('center-center');
      overlay.setOffset([0, 0]);
      overlay.setPosition(map.getView().getCenter() || transform([selected.lng, selected.lat], 'EPSG:4326', activeProjectionRef.current));
    };
    placePanel();
    const onCenter = () => placePanel();
    map.getView().on('change:center', onCenter);
    return () => {
      map.getView().un('change:center', onCenter);
    };
  }, [Boolean(draft), panelHost, selected?.id, selected?.lat, selected?.lng, activeCountry]);

  useEffect(() => {
    const map = mapRef.current;
    const source = ghostSourceRef.current;
    source.clear();
    ghostFeatureRef.current = null;
    if (!draft || !session.authenticated || !managementActive || isMobileEditor()) return;
    const feature = new Feature(new Point(transform([draft.lng, draft.lat], 'EPSG:4326', activeProjectionRef.current)));
    source.addFeature(feature);
    ghostFeatureRef.current = feature;
    const modify = new Modify({ source, pixelTolerance: 18 });
    modify.on('modifyend', () => {
      const coordinate = feature.getGeometry()?.getCoordinates();
      if (!coordinate) return;
      const [lng, lat] = transform(coordinate, activeProjectionRef.current, 'EPSG:4326');
      setDraft((current) => current ? { ...current, lng, lat, region_id: '', country_code: '' } : current);
      setDirty(true);
    });
    map?.addInteraction(modify);
    return () => { map?.removeInteraction(modify); source.clear(); };
  }, [Boolean(draft), draft?.id, managementActive, session.authenticated, activeCountry]);

  useEffect(() => {
    if (!draft || !ghostFeatureRef.current) return;
    ghostFeatureRef.current.getGeometry()?.setCoordinates(transform([draft.lng, draft.lat], 'EPSG:4326', activeProjectionRef.current));
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

  const runFootprintSearch = useCallback(async (value: string) => {
    const normalized = value.normalize('NFKC').trim();
    footprintSearchAbortRef.current?.abort();
    if (!normalized) {
      setSearchResults([]);
      setSearchLabel('');
      setSearchedQuery('');
      setSearching(false);
      setSearchError(false);
      return;
    }
    const controller = new AbortController();
    footprintSearchAbortRef.current = controller;
    setSearching(true);
    setSearchError(false);
    try {
      const response = await api<FootprintSearchResponse>(`/api/search/footprints?q=${encodeURIComponent(normalized)}&lang=${locale}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setSearchResults(response.results);
      setSearchScope(response.scope);
      setSearchLabel(response.label);
      setSearchedQuery(normalized);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      setSearchResults([]);
      setSearchLabel('');
      setSearchedQuery(normalized);
      setSearchError(true);
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }, [locale]);

  useEffect(() => {
    if (!searchOpen) {
      footprintSearchAbortRef.current?.abort();
      return;
    }
    const normalized = query.normalize('NFKC').trim();
    if (!normalized) {
      void runFootprintSearch('');
      return;
    }
    const timer = window.setTimeout(() => void runFootprintSearch(normalized), 240);
    return () => window.clearTimeout(timer);
  }, [query, runFootprintSearch, searchOpen]);

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

  const submitSearch = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runFootprintSearch(query);
  };

  const chooseSearchResult = async (result: FootprintSearchResult) => {
    setSearchOpen(false);
    setSearchRegionIds(result.regionIds?.length ? result.regionIds : [result.regionId]);
    if (result.kind === 'pin' && result.pinId) {
      await openPin(result.pinId);
      return;
    }
    const country = countries.find((item) => item.countryCode === result.countryCode);
    const countryChanged = Boolean(country && (!activeCountry || activeCountry.countryCode !== country.countryCode));
    if (country && countryChanged) {
      pendingFocusRef.current = { coordinate: [result.lng, result.lat], zoom: PIN_DETAIL_ZOOM, centered: true };
      await selectCountry(country);
      return;
    }
    const coordinate = transform([result.lng, result.lat], 'EPSG:4326', activeProjectionRef.current);
    const base = countryBaseResolutionRef.current || 1;
    mapRef.current?.getView().animate({ center: coordinate, resolution: base / 2 ** PIN_DETAIL_ZOOM, duration: 520 });
  };

  const chooseDraftCandidate = async (candidate: PlaceCandidate) => {
    if (!draft) return;
    const country = countries.find((item) => item.countryCode === candidate.countryCode);
    const countryChanged = Boolean(country && (!activeCountry || activeCountry.countryCode !== country.countryCode));
    if (country && countryChanged) {
      pendingFocusRef.current = { coordinate: [candidate.lng, candidate.lat], zoom: 0 };
      await selectCountry(country);
    }
    const nextDraft = { ...draft, lng: candidate.lng, lat: candidate.lat, place_name: candidate.name, region_id: candidate.regionId, country_code: candidate.countryCode };
    editorStateRef.current = { draft: nextDraft, dirty: true };
    setDraft(nextDraft);
    setDraftCandidates([]);
    setDirty(true);
    if (!countryChanged) {
      const coordinate = transform([candidate.lng, candidate.lat], 'EPSG:4326', activeProjectionRef.current);
      const view = mapRef.current?.getView();
      if (view) view.animate({ center: coordinate, resolution: view.getResolution(), duration: 360 });
    }
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
    requestEditor(pinToDraft(selected), selected);
  };

  const discardChanges = () => {
    const target = pendingEditorTarget;
    setConfirmDiscard(false);
    setPendingEditorTarget(null);
    if (target) {
      editorStateRef.current = { draft: target.draft, dirty: false };
      setSelected(target.selected);
      setDraft(target.draft);
      setDirty(false);
      setEditorMode('write');
      history.replaceState({}, '', '/manage');
      return;
    }
    resetPanel();
  };

  return (
    <main id="travel-root" className="travel-app">
      <div ref={mapTargetRef} className={`map-canvas paper-settle ${activeCountry ? 'country-mode' : 'world-mode'}`} role="application" aria-label={t('mapLabel')} />
      <div ref={scaleRef} className="map-scale" aria-hidden="true" />

      <button className="edge-action action-map" type="button" title={t('mapSelector')} aria-label={t('mapSelector')} onClick={() => setCountryMenuOpen((current) => !current)}><MapIcon /></button>
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

      {countryMenuOpen && (
        <section className="country-menu floating-paper" aria-label={t('mapSelector')}>
          <button type="button" className={!activeCountry ? 'is-active' : ''} onClick={returnToWorld}>{t('worldMap')}</button>
          {countries.map((country) => <button type="button" key={country.countryCode} className={activeCountry?.countryCode === country.countryCode ? 'is-active' : ''} onClick={() => void selectCountry(country)}>{locale === 'zh' ? country.name.zh : country.name.en}</button>)}
          {countryLoading && <small>{t('loading')}</small>}
        </section>
      )}

      {countryChooserOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('chooseCountryTitle')}>
          <section className="modal-paper floating-paper country-chooser">
            <h2>{t('chooseCountryTitle')}</h2>
            <p>{t('chooseCountryBody')}</p>
            <div className="country-choices">
              {countries.map((country) => <button key={country.countryCode} type="button" onClick={() => void selectCountry(country)}>{locale === 'zh' ? country.name.zh : country.name.en}</button>)}
            </div>
            <div className="modal-actions"><button className="text-command" type="button" onClick={() => setCountryChooserOpen(false)}>{t('cancel')}</button></div>
          </section>
        </div>
      )}

      {searchOpen && (
        <section className="search-panel floating-paper" aria-label={t('search')}>
          <form className="search-row" onSubmit={submitSearch}>
            <button className="icon-command search-submit" type="submit" aria-label={t('search')} title={t('search')}><Search aria-hidden="true" /></button>
            <input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} />
            <button className="language-switch" type="button" onClick={switchLocale} title={locale === 'zh' ? t('switchEnglish') : t('switchChinese')} aria-label={locale === 'zh' ? t('switchEnglish') : t('switchChinese')}><Languages size={15} aria-hidden="true" /> {locale === 'zh' ? 'EN' : '中'}</button>
            <button className="icon-command" type="button" aria-label={t('close')} title={t('close')} onClick={() => setSearchOpen(false)}><X /></button>
          </form>
          {(searching || searchError || (!searching && searchedQuery === query.normalize('NFKC').trim() && !!searchedQuery && !searchResults.length)) && <p className="search-status">{searching ? t('searching') : searchError ? t('searchError') : t('searchEmpty')}</p>}
          {!!searchResults.length && (
            <>
              <p className="search-summary">{searchScope === 'country' ? t('searchScopeCountry', { name: searchLabel }) : searchScope === 'province' ? t('searchScopeProvince', { name: searchLabel }) : searchScope === 'city' ? t('searchScopeCity') : t('searchScopeRecords')}</p>
              <ul className="search-results" aria-label={t('footprintResults')}>
              {searchResults.map((result) => (
                <li className="search-result" key={result.id}>
                  <button type="button" onClick={() => void chooseSearchResult(result)}>
                    <span className="result-name">{result.name}</span>
                    <span className="result-address">{result.subtitle}</span>
                    {!!result.excerpt && <span className="result-excerpt">{result.excerpt}</span>}
                    <span className="result-count">{result.kind === 'pin' ? t('searchResultRecord') : result.pinCount === 1 ? t('searchCountOne') : t('searchCountMany', { count: result.pinCount })}</span>
                  </button>
                </li>
              ))}
              </ul>
            </>
          )}
        </section>
      )}

      {createPortal((selected || draft) ? (
          <article className={`node-panel floating-paper${draft ? ' editor-drawer' : ''}`} role="dialog" aria-modal="false" aria-label={draft ? t('editorLabel') : t('panelLabel')}>
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
                    <label className="field location-field"><span>{t('place')}</span><input required value={draft.place_name} onChange={(event) => updateDraftPlace(event.target.value)} placeholder={t('placePlaceholder')} autoComplete="off" />{draft.region_id ? <small className="location-confirmed">{t('placeConfirmed')}</small> : <small>{t('placeRequired')}</small>}{(draftSearching || draftSearchError) && <small>{draftSearching ? t('placeSearching') : t('placeSearchError')}</small>}{!!draftCandidates.length && <ul className="draft-location-results">{draftCandidates.map((candidate) => <li key={candidate.id}><button type="button" onClick={() => chooseDraftCandidate(candidate)}><strong>{candidate.name}</strong><span>{candidate.address}</span></button></li>)}</ul>}</label>
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
                  <div className="editor-buttons">{draft.id && <button className="text-command danger" type="button" onClick={() => setConfirmDelete(true)}><Trash2 size={14} aria-hidden="true" /> {t('delete')}</button>}<button className="text-command" type="button" onClick={() => closePanel()}>{t('cancel')}</button><button className="text-command primary" type="button" disabled={saving || !draft.title.trim() || !draft.region_id || !draft.country_code} onClick={() => void saveDraft()}><Check size={14} aria-hidden="true" /> {saving ? t('saving') : t('save')}</button></div>
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
        ) : null, draft ? document.body : panelHost)}

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
          <section className="modal-paper floating-paper"><h2>{t('discardTitle')}</h2><p>{t('discardBody')}</p><div className="modal-actions"><button className="text-command" type="button" onClick={() => { setConfirmDiscard(false); setPendingEditorTarget(null); }}>{t('cancel')}</button><button className="text-command danger" type="button" onClick={discardChanges}>{t('discardAction')}</button></div></section>
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
