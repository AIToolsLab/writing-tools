import { NextResponse } from 'next/server';
import { generateSuggestion } from '@/lib/ai';
import { defaultModel } from '@/lib/models';
import type { DocContext } from '@/lib/types';

export async function POST(req: Request) {
	const { type, docContext } = (await req.json()) as {
		type: string;
		docContext: DocContext;
	};

	const generation = await generateSuggestion({
		model: defaultModel(),
		type,
		docContext,
	});

	return NextResponse.json(generation);
}
