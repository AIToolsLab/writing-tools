import { streamRevision } from '@/lib/ai';
import { defaultModel } from '@/lib/models';
import type { DocContext } from '@/lib/types';

export async function POST(req: Request) {
	const { docContext, request: visualizationRequest } = (await req.json()) as {
		docContext: DocContext;
		request: string;
	};

	const result = streamRevision({
		model: defaultModel(),
		docContext,
		request: visualizationRequest,
	});

	// The Revise UI consumes a raw text stream of deltas.
	return result.toTextStreamResponse();
}
