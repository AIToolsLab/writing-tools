import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    status: 'ok',
  });
}
