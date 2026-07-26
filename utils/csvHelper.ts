
import { House, VisitStatus, RegistryEntry } from '../types';

export const generateId = (lat: number, lng: number, address: string): string => {
  return `${lat.toFixed(5)}_${lng.toFixed(5)}_${address.replace(/\s/g, '').toLowerCase()}`;
};

const splitCSVRow = (row: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuote = false;
  
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === '"') {
      if (inQuote && row[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (char === ',' && !inQuote) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
};

export const parseRegistry = (text: string): RegistryEntry[] => {
  const cleanText = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = cleanText.split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) return [];

  const headers = splitCSVRow(lines[0]).map(h => h.trim().toLowerCase());
  const idxArea = headers.indexOf('area');
  const idxZip = headers.indexOf('zip');
  const idxLink = headers.indexOf('link');

  if (idxZip === -1 || idxLink === -1) return [];

  return lines.slice(1).map(line => {
    const cols = splitCSVRow(line);
    return {
      area: (cols[idxArea] || '').trim(),
      zip: (cols[idxZip] || '').trim(),
      link: (cols[idxLink] || '').trim()
    };
  }).filter(entry => entry.zip && entry.link);
};

export const parseCSV = (text: string): House[] => {
  const cleanText = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = cleanText.split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) return [];

  const headers = splitCSVRow(lines[0]).map(h => h.trim().toLowerCase());

  const colMap = {
    lat: ['lat', 'latitude', 'y', 'lat_dec'],
    lng: ['lng', 'long', 'longitude', 'x', 'lng_dec'],
    address: ['address', 'addr', 'location', 'house', 'house_no', 'house no'],
    street: ['street', 'road', 'st', 'street_name', 'street name'],
    owner: ['owner_name', 'owner name', 'owner', 'resident_name', 'resident name', 'name'],
    zip: ['zip', 'zipcode', 'zip_code', 'postal', 'area', 'region', 'neighborhood']
  };

  const clean = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');
  
  const getIdx = (keys: string[]) => {
    const cleanedKeys = keys.map(clean);
    return headers.findIndex(h => cleanedKeys.includes(clean(h)));
  };

  const idxLat = getIdx(colMap.lat);
  const idxLng = getIdx(colMap.lng);
  const idxAddress = getIdx(colMap.address);
  const idxStreet = getIdx(colMap.street);
  const idxOwner = getIdx(colMap.owner);
  const idxZip = getIdx(colMap.zip);

  if (idxLat === -1 || idxLng === -1) return [];

  const houses: House[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVRow(lines[i]);
    const getVal = (idx: number) => (idx !== -1 && cols[idx]) ? cols[idx].trim() : '';
    const lat = parseFloat(getVal(idxLat));
    const lng = parseFloat(getVal(idxLng));

    if (!isNaN(lat) && !isNaN(lng)) {
      houses.push({
        id: generateId(lat, lng, getVal(idxAddress) || 'unknown'),
        address: getVal(idxAddress) || `House at ${lat}, ${lng}`,
        street: getVal(idxStreet) || '',
        owner: getVal(idxOwner) || '',
        lat,
        lng,
        zip: getVal(idxZip) || 'Other',
        status: VisitStatus.TODO,
        notes: [],
      });
    }
  }
  return houses;
};

export const exportToCSV = (houses: House[]) => {
  const headers = ['ID', 'Address', 'Street', 'Owner', 'Zip', 'Lat', 'Lng', 'Status', 'LastUpdated', 'Notes'];
  const esc = (val: string | number | undefined) => {
    const str = String(val || '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const rows = houses.map(h => [
    h.id, esc(h.address), esc(h.street), esc(h.owner), esc(h.zip), h.lat, h.lng, h.status,
    h.lastUpdated ? new Date(h.lastUpdated).toISOString() : '',
    esc(h.notes.map(n => n.text).join(' | '))
  ]);
  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `dawahmap_outreach_${new Date().toISOString().split('T')[0]}.csv`);
  link.click();
};
