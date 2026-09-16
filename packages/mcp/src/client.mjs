import { apiV5, auditBase } from './config.mjs';

const MAX_PEM_CHARS = 64 * 1024;
const MAX_SEARCH_NAME = 200;
const MAX_LEI = 32;

export async function validateCertificate(token, countries, pem) {
  if (String(pem).length > MAX_PEM_CHARS) {
    throw new Error('Certificate PEM is too large');
  }
  const url = new URL(apiV5());
  url.searchParams.set('cc', countries);
  url.searchParams.set('details', 'true');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      Authorization: `Bearer ${token}`,
    },
    body: String(pem).trim(),
  });

  const headers = {
    'x-tpp-reason': res.headers.get('x-tpp-reason'),
    'x-tpp-cert': res.headers.get('x-tpp-cert'),
    'x-tpp-entity': res.headers.get('x-tpp-entity'),
    'x-tpp-passports': res.headers.get('x-tpp-passports'),
    'x-tpp-identifier': res.headers.get('x-tpp-identifier'),
    'x-tpp-latest': res.headers.get('x-tpp-latest'),
    'x-tpp-pop': res.headers.get('x-tpp-pop'),
    'x-tpp-sig': res.headers.get('x-tpp-sig'),
  };

  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep raw text */
  }

  return { status: res.status, ok: res.status === 200, headers, body };
}

export async function auditChain(token, identifier, timestamp) {
  const url = `${auditBase()}/audit/${encodeURIComponent(timestamp)}/${encodeURIComponent(identifier)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  return { status: res.status, ok: res.ok, body, url };
}

function ebaProp(props, key) {
  if (!Array.isArray(props)) return null;
  for (const p of props) {
    if (p && typeof p === 'object' && key in p) return p[key];
    if (p?.K === key) return p.V;
  }
  return null;
}

export async function searchEntity(register, { name, country, lei }) {
  if (!name && !lei) {
    return { ok: false, error: 'Provide name or lei' };
  }
  if (name && name.length > MAX_SEARCH_NAME) {
    return { ok: false, error: 'Name is too long' };
  }
  if (lei && lei.length > MAX_LEI) {
    return { ok: false, error: 'LEI is too long' };
  }
  if (country && !/^[A-Za-z]{2}$/.test(country)) {
    return { ok: false, error: 'Country must be a two-letter code' };
  }

  const searchUrl = `https://euclid.eba.europa.eu/register/api/search/entities?t=${Date.now()}`;
  let body;

  if (lei) {
    body = {
      $and: [
        { _messagetype: 'EUCLIDMD' },
        { '_payload.EntityCode': { $regex: lei, $options: 'i' } },
        { _searchkeys: { T: 'P', K: 'ENT_COD_TYP', V: 'LEI' } },
      ],
    };
  } else if (register === 'CIR') {
    const conditions = [
      { _messagetype: 'EUCLIDMD' },
      {
        _searchkeys: {
          $elemMatch: {
            T: 'P',
            K: { $in: ['ENT_NAM', 'ENT_NAM_COM'] },
            V: { $regex: name, $options: 'i' },
          },
        },
      },
      { '_payload.EntityType': { $nin: ['PSD', 'PSD_AG', 'PSD_BR'] } },
    ];
    if (country) {
      conditions.push({
        _searchkeys: {
          $elemMatch: { T: 'P', K: 'ENT_COU_RES', V: country.toUpperCase() },
        },
      });
    }
    body = { $and: conditions };
  } else {
    const conditions = [
      { '_payload.EntityType': { $regex: 'PSD' } },
      {
        _searchkeys: {
          $elemMatch: {
            T: 'P',
            K: { $in: ['ENT_NAM', 'ENT_NAM_COM'] },
            V: { $regex: name, $options: 'i' },
          },
        },
      },
      { '_payload.EntityType': { $nin: ['PSD_AG', 'PSD_BR'] } },
    ];
    if (country) {
      conditions.push({
        _searchkeys: {
          $elemMatch: { T: 'P', K: 'ENT_COU_RES', V: country.toUpperCase() },
        },
      });
    }
    body = { $and: conditions };
  }

  const res = await fetch(searchUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return { ok: false, error: `EBA HTTP ${res.status}` };
  }

  const data = await res.json();
  const raw = Array.isArray(data) ? data : data?.items || [];
  const results = raw.slice(0, 10).map((entity) => {
    const payload = entity._payload || entity;
    const props = payload.Properties || [];
    return {
      name: ebaProp(props, 'ENT_NAM') || payload.EntityName || 'Unknown',
      country: ebaProp(props, 'ENT_COU_RES') || payload.EntityCountry || '??',
      code: payload.EntityCode || 'N/A',
      type: payload.EntityType || 'Unknown',
      lei: ebaProp(props, 'ENT_COD_LEI') || null,
      status: ebaProp(props, 'ENT_STA') || 'Unknown',
    };
  });

  return {
    ok: true,
    register,
    query: { name, country, lei },
    total: raw.length,
    results,
  };
}
