import { useState } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';

export function useCompletion({ SERVER_URL }: 
	{ SERVER_URL: string }
) {
    let [completion, setCompletion] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);

	async function complete(prompt: any) {

        setCompletion('');
        completion = '';
        setIsLoading(true);

		await fetchEventSource(`${SERVER_URL}/completion`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				prompt: prompt,
			}),
			onmessage(msg) {
				const message = JSON.parse(msg.data);
				const choice = message.choices[0];

                console.log(message);
				if (choice.finish_reason === 'stop') {
                    setIsLoading(false);
                } else {
    				const newContent = choice.text;
                    setCompletion(completion = completion + newContent);
                }
			},
            onerror(err) {
                console.error(err);
                // rethrow to avoid infinite retry.
                throw err;
            }
		});

        return completion;
	}

	return { complete, completion, setCompletion, isLoading };
}
