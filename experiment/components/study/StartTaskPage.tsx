'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { logThenRedirect } from '@/lib/logging';
import { getNextPage, getScenario } from '@/lib/studyConfig';

export default function StartTaskPage() {
  const searchParams = useSearchParams();
  const username = searchParams.get('username') || '';
  const scenarioId = searchParams.get('scenario') || undefined;
  const scenario = getScenario(scenarioId);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleStartTask = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
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
            {scenario.colleague.firstName} is available via chat. They have a lot going on but know you need help getting up to speed — don&apos;t hesitate to ask questions, but keep them simple and don&apos;t expect them to write your email for you.
          </p>
        </div>

        <div>
          <h3 className="font-semibold mb-2">What to do:</h3>
          <ol className="list-decimal list-inside space-y-1">
            <li>Review {scenario.colleague.firstName}&apos;s messages. Since it&apos;s your first day, you won&apos;t have all the context — ask {scenario.colleague.firstName} follow-up questions to get the details you need.</li>
            <li>
              Compose your email response in the text area provided
            </li>
            <li>
              You may see AI-generated writing suggestions on the right side of the screen. If so, feel free to use them, edit them, or ignore them — it&apos;s entirely up to you.
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
            <li>For practical purposes, an AI will be playing the role of {scenario.colleague.firstName}. Treat them as you would a real colleague.</li>
          </ul>
        </div>
      </div>

      <button
        type="button"
        onClick={handleStartTask}
        disabled={isSubmitting}
        className="w-full px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition disabled:bg-green-400 disabled:cursor-not-allowed"
      >
        {isSubmitting ? 'Loading...' : 'Start Writing Task'}
      </button>
    </div>
  );
}
