import { NextResponse } from 'next/server';
import { getClient, health } from 'server/src/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  const { db } = getClient();
  return NextResponse.json(health(db));
}
