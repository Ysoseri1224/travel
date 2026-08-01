declare global {
  interface Env {
    GITHUB_OWNER: string;
    GITHUB_REPO: string;
    TRAVEL_PASSWORD: string;
    TRAVEL_SESSION_SECRET: string;
    AMAP_PLACE_API_KEY: string;
    GOOGLE_PLACES_API_KEY: string;
    GITHUB_TOKEN: string;
    COUNTRY_BUILD_CALLBACK_SECRET: string;
  }
}

export {};
