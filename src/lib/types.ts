export interface MediaAsset {
  id: string;
  url: string;
  filename: string;
  content_type: string;
  size: number;
  caption?: string | null;
  sort_order: number;
}

export interface Pin {
  id: string;
  title: string;
  lat: number;
  lng: number;
  place_name?: string | null;
  place_names?: Record<string, string> | null;
  region_id?: string | null;
  country_code?: string | null;
  event_date?: string | null;
  color: string;
  content: string;
  photo_style?: 'photo-classic' | 'photo-landscape' | 'photo-portrait' | null;
  cover_media_id?: string | null;
  media: MediaAsset[];
  created_at: string;
  updated_at: string;
}

export interface PlaceCandidate {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  regionId: string;
  regionName: string;
  countryCode: string;
  pinCount: number;
  provider: 'Amap' | 'Google';
}

export interface SessionState {
  authenticated: boolean;
  csrfToken?: string;
  expiresAt?: string;
}
