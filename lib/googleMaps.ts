// Loads the Google Maps JS API (Places library) once and caches the promise
// so multiple <AddressFields> instances on the same page (e.g. 7 of them on
// the student form) don't each inject their own <script> tag.
// No @types/google.maps dependency — this stays a thin, optional
// progressive-enhancement layer, so the shape is kept loose.
declare global {
  interface Window {
    google?: {
      maps: {
        places: {
          Autocomplete: new (input: HTMLInputElement, opts?: Record<string, unknown>) => GoogleAutocomplete
        }
        event: { removeListener: (listener: unknown) => void }
      }
    }
  }
}

export type GoogleAddressComponent = { long_name: string; short_name: string; types: string[] }
export type GooglePlace = { address_components?: GoogleAddressComponent[] }
export type GoogleAutocomplete = {
  addListener: (event: 'place_changed', handler: () => void) => unknown
  getPlace: () => GooglePlace
}

let loadPromise: Promise<void> | null = null

export function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('loadGoogleMapsScript is client-only'))
  if (window.google?.maps?.places) return Promise.resolve()
  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => { loadPromise = null; reject(new Error('Failed to load Google Maps script')) }
    document.head.appendChild(script)
  })
  return loadPromise
}
