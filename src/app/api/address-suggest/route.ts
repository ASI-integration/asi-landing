import { NextRequest, NextResponse } from 'next/server';

interface DaDataSuggestion {
  value: string;
  data: {
    geo_lat: string | null;
    geo_lon: string | null;
  };
}

interface DaDataResponse {
  suggestions: DaDataSuggestion[];
}

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ suggestions: [] });

  const apiKey = process.env.DADATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ suggestions: [], status: 'no_key' });
  }

  try {
    const res = await fetch(
      'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Token ${apiKey}`,
        },
        body: JSON.stringify({ query: q, count: 7 }),
        cache: 'no-store',
      },
    );

    if (!res.ok) return NextResponse.json({ suggestions: [], status: 'error' });

    const data: DaDataResponse = await res.json();

    const suggestions = data.suggestions.map(s => ({
      value: s.value,
      lat: s.data.geo_lat,
      lon: s.data.geo_lon,
    }));

    return NextResponse.json({
      suggestions,
      status: suggestions.length > 0 ? 'ok' : 'no_results',
    });
  } catch {
    return NextResponse.json({ suggestions: [], status: 'error' });
  }
}
