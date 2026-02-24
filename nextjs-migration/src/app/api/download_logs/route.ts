import { NextRequest, NextResponse } from 'next/server';
import { getAllLogFiles } from '@/lib/logger';
import { promises as fs } from 'fs';
import path from 'path';
import archiver from 'archiver';
import { Readable } from 'stream';

export const runtime = 'nodejs';

/**
 * Download all logs as a ZIP file (protected by LOG_SECRET)
 * Used by researchers to download study data
 */
export async function GET(request: NextRequest) {
  try {
    const secret = request.nextUrl.searchParams.get('secret');

    // Verify secret
    const LOG_SECRET = process.env.LOG_SECRET;
    if (!LOG_SECRET || secret !== LOG_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const logFiles = await getAllLogFiles();
    if (logFiles.length === 0) {
      return NextResponse.json({ error: 'No logs found' }, { status: 404 });
    }

    // Create ZIP archive
    const archive = archiver('zip', { zlib: { level: 9 } });
    const logsDir = path.join(process.cwd(), 'logs');

    // Add all log files to archive
    for (const file of logFiles) {
      const filePath = path.join(logsDir, file);
      const content = await fs.readFile(filePath);
      archive.append(content, { name: file });
    }

    // Finalize archive
    archive.finalize();

    // Convert archive stream to web stream
    const stream = Readable.toWeb(archive as any) as ReadableStream;

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="logs-${new Date().toISOString()}.zip"`,
      },
    });
  } catch (error: any) {
    console.error('Error in /api/download_logs:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
