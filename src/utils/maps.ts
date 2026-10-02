import { requestUrl } from 'obsidian';

/**
 * Location helpers.
 *
 * IMPORTANT: none of this requires a Google Maps API key or any paid service.
 *  - `buildGoogleMapsUrl` uses the public "Maps URLs" search endpoint, which is
 *    free and key-less.
 *  - `searchAddresses` uses Photon (photon.komoot.io), a free, key-less
 *    autocomplete geocoder built on OpenStreetMap data.
 * Google's own Places Autocomplete would require a billed API key AND would
 * have to be embedded in the (client-side) plugin, which is not advisable.
 */

export interface AddressSuggestion {
    label: string;
    lat?: number;
    lon?: number;
}

interface PhotonProperties {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    district?: string;
    state?: string;
    postcode?: string;
    country?: string;
}

interface PhotonFeature {
    properties?: PhotonProperties;
    geometry?: { coordinates?: [number, number] };
}

const formatSuggestion = (feature: PhotonFeature): AddressSuggestion | null => {
    const p = feature.properties || {};
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    const parts: string[] = [];
    if (p.name && p.name !== p.street) parts.push(p.name);
    if (street) parts.push(street);
    const locality = [p.city, p.state].filter(Boolean).join(', ');
    if (locality) parts.push(locality);
    if (p.postcode) parts.push(p.postcode);
    if (p.country) parts.push(p.country);
    const label = parts.join(', ').trim();
    if (!label) return null;
    const coords = feature.geometry?.coordinates;
    return {
        label,
        lon: Array.isArray(coords) ? coords[0] : undefined,
        lat: Array.isArray(coords) ? coords[1] : undefined
    };
};

/**
 * Forward-geocodes a free-text query into up to 6 address suggestions using the
 * free Photon (OpenStreetMap) service. Returns an empty array on any failure so
 * callers can fall back to the raw typed text.
 */
export const searchAddresses = async (query: string): Promise<AddressSuggestion[]> => {
    const q = (query || '').trim();
    if (q.length < 3) return [];
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`;
    try {
        const res = await requestUrl({ url, method: 'GET', headers: { Accept: 'application/json' } });
        const data = JSON.parse(res.text) as { features?: PhotonFeature[] };
        if (!data || !Array.isArray(data.features)) return [];
        const seen = new Set<string>();
        const out: AddressSuggestion[] = [];
        for (const feature of data.features) {
            const suggestion = formatSuggestion(feature);
            if (suggestion && !seen.has(suggestion.label)) {
                seen.add(suggestion.label);
                out.push(suggestion);
            }
        }
        return out;
    } catch (e) {
        return [];
    }
};

/**
 * Builds a Google Maps URL for a location. If the stored value is already a
 * URL it is returned as-is; otherwise it becomes a Maps search link.
 */
export const buildGoogleMapsUrl = (location: string): string => {
    const value = (location || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`;
};
