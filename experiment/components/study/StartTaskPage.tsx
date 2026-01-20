'use client';

import { useSearchParams } from 'next/navigation';
import { log, logThenRedirect } from '@/lib/logging';
import { getNextPage, getScenario } from '@/lib/studyConfig';

export default function StartTaskPage() {
  const searchParams = useSearchParams();
  const username = searchParams.get('username') || '';
  const scenarioId = searchParams.get('scenario') || undefined;
  const scenario = getScenario(scenarioId);

  const handleStartTask = async () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', getNextPage('start-task')!);
    const nextUrl = `/study?${params.toString()}`;

    await logThenRedirect(
      {
        username,
        event: 'taskStart',
      },
      nextUrl
    );
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">{scenario.taskInstructions.title}</h1>

      <div className="bg-blue-50 p-6 rounded-lg mb-8 space-y-4 text-gray-800">
        <h2 className="text-xl font-semibold">Task Instructions</h2>

        <div>
          <h3 className="font-semibold mb-2">Scenario:</h3>
          <p>
            {scenario.taskInstructions.description}
          </p>
          <p className="mt-2">
            {scenario.colleague.firstName} is available via chat to answer questions about the details of the situation.
          </p>
        </div>

        <div>
          <h3 className="font-semibold mb-2">What to do:</h3>
          <ol className="list-decimal list-inside space-y-1">
            <li>Review {scenario.colleague.firstName}&apos;s messages. The initial message will not give you all the details you need, so <b>you will need to ask follow-up questions</b>.</li>
            <li>
              Compose your email response in the text area provided
            </li>
            <li>
              Depending on your condition, you may see AI-generated suggestions that may or may not be helpful. Feel free to use helpful suggestions, edit them, or ignore them entirely.
            </li>
            <li>
              When you&apos;re satisfied with your response, click the
              &ldquo;Send&rdquo; button
            </li>
          </ol>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Keep in mind:</h3>
          <ul className="list-disc list-inside space-y-1">
            <li>
              {scenario.taskInstructions.companyFraming}
            </li>
            <li>There&apos;s no &ldquo;perfect&rdquo; response - write naturally</li>
            <li>Take as much time as you need</li>
            <li>
              If you encounter any issues, please note them in the final survey
            </li>
            <li>For practical purposes, an AI will be playing the role of {scenario.colleague.firstName}. But treat them as if they were from a real person.</li>
          </ul>
        </div>
      </div>

      <button
        type="button"
        onClick={handleStartTask}
        className="w-full px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition"
      >
        Start Writing Task
      </button>
    </div>
  );
}
